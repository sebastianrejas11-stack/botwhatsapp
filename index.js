// Bot WhatsApp (Baileys) para Railway
// - Sin Chromium (no puppeteer)
// - QR como link clickeable en logs (api.qrserver.com)
// - Persistencia de sesión en ./auth (si no usas Volumes, se pierde al redeploy)
// - Flujo: saludo -> nombre -> QR -> recordatorio único
// - Si no entiende: NO responde al cliente; te notifica a ti por WhatsApp
// - Dudas: notifica cada una (cooldown = 0 por defecto)
// - Pago/comprobante: SIEMPRE te notifica (sin cooldown)

const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

// ======================= CONFIG =======================
const OWNER_PHONE = process.env.OWNER_PHONE || '59177441414'; // solo dígitos con código de país
const LINK_GRUPO  = process.env.LINK_GRUPO  || 'https://chat.whatsapp.com/IWA2ae5podREHVFzoUSvxI?mode=ems_copy_t';
const LINK_BONO   = process.env.LINK_BONO   || 'https://www.youtube.com/watch?v=XkjFZY30vHc&list=PLnT-PzQPCplvsx4c-vAvLyk5frp_nHTGx&index=1';
const LINK_PAGO   = process.env.LINK_PAGO   || 'https://tu-link-de-pago';

const REMINDER_MINUTES = parseFloat(process.env.REMINDER_MINUTES || '10'); // recordatorio si no responde
const DOUBT_NOTIFY_COOLDOWN_SEC = parseFloat(process.env.DOUBT_NOTIFY_COOLDOWN_SEC || '0'); // 0 = notificar todas
// ======================================================

const OWNER_JID = OWNER_PHONE.replace(/\D/g, '') + '@s.whatsapp.net';

// Memoria por contacto
const statePerUser = new Map(); // { stage, nombre, lastMsg, lastDoubtNotifyAt }

// Próximo lunes (“22 de septiembre”)
function nextMondayDate() {
  const now = new Date();
  const day = now.getDay(); // 0=Dom
  const add = (1 - day + 7) % 7 || 7;
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + add);
  return d.toLocaleDateString('es-BO', { day: 'numeric', month: 'long' });
}

// Extraer texto útil de un mensaje
function extractText(m) {
  if (!m || !m.message) return '';
  const msg = m.message;
  return (
    msg.conversation ||
    msg.extendedTextMessage?.text ||
    msg.imageMessage?.caption ||
    msg.videoMessage?.caption ||
    msg.documentMessage?.caption ||
    ''
  ).trim();
}

// ¿Parece nombre real?
function isProbablyName(s) {
  if (!s) return false;
  if (/[?¿!¡]/.test(s)) return false;
  if (!/^[\p{L} .'\-]+$/u.test(s)) return false;
  const parts = s.trim().split(/\s+/);
  if (parts.length < 2) return false; // <-- clave: nombre + apellido
  if (parts.some(p => p.length < 2)) return false;
  const lowered = s.toLowerCase();
  const badStarts = [
    'me ', 'puedes ', 'quiero ', 'como ', 'cómo ', 'que ', 'qué ',
    'donde ', 'dónde ', 'cuando ', 'cuándo ', 'por que ', 'por qué ', 'porque '
  ];
  if (badStarts.some(b => lowered.startsWith(b))) return false;
  if (s.length > 60) return false;
  return true;
}

// Enviar QR (si no existe qr.jpg, manda LINK_PAGO)
async function sendQR(sock, to) {
  const file = path.join(__dirname, 'qr.jpg');
  if (fs.existsSync(file)) {
    try {
      const buffer = fs.readFileSync(file);
      await sock.sendMessage(to, { image: buffer, caption: 'Escanea este QR para inscribirte ✅' });
      return;
    } catch {}
  }
  await sock.sendMessage(to, { text: `No pude adjuntar el QR ahora. Aquí tienes el enlace de pago:\n${LINK_PAGO}` });
}

// Notificar duda al dueño
async function notifyDoubt(sock, customerJid, customerName, msgText) {
  const human = customerJid.replace('@s.whatsapp.net', '');
  const nombre = customerName ? ` (${customerName})` : '';
  const body =
    `🤖 *Duda detectada*\n` +
    `De: *${human}*${nombre}\n` +
    `Mensaje: "${msgText}"`;
  await sock.sendMessage(OWNER_JID, { text: body }).catch(() => {});
}

// Notificar posible pago/comprobante (sin “DE XXXXX”)
async function notifyOwnerPayment(sock, customerJid, customerName, isAttachment, text) {
  const human = customerJid.replace('@s.whatsapp.net', '');
  const nombre = customerName ? ` (${customerName})` : '';
  const detalle = isAttachment ? '(Imagen/Comprobante adjunto)' : (text ? `"${text}"` : '(sin texto)');
  const body =
    `💸 *Posible pago/confirmación*\n` +
    `De: *${human}*${nombre}\n` +
    `Detalle: ${detalle}\n\n` +
    `👉 Acción sugerida: *CONFIRMA EL PAGO*`;
  await sock.sendMessage(OWNER_JID, { text: body }).catch(() => {});
}

// Detección de pago/comprobante
function detectPayment(m, lowered) {
  const hasImage = !!m.message?.imageMessage;
  const hasDoc = !!m.message?.documentMessage;
  const isPdf = (m.message?.documentMessage?.mimetype || '').includes('pdf');
  const saidPayment = /\b(pagu[eé]|pague|pago|comprobante|transferencia)\b/.test(lowered);
  return { match: hasImage || (hasDoc && isPdf) || saidPayment, hasImageOrDoc: hasImage || hasDoc };
}

// Mensaje de bienvenida
function buildBienvenida() {
  const fecha = nextMondayDate();
  return (
`Hola 🌟 ¡Gracias por tu interés en el Reto de 21 Días de Gratitud y Abundancia! 🙏✨

Este hermoso reto se realizará por WhatsApp y empieza el próximo lunes ${fecha} 🗓️

📌 Incluye:
✔️ Reflexión + ejercicio diario
✔️ Videos explicativos
✔️ Libro digital al finalizar

💛 Este es un bonito regalo para ti, date la oportunidad.

Las clases se envían vía WhatsApp por la mañana y puedes verlas cuando gustes.

Si deseas inscribirte, por favor responde con tu *nombre completo* (nombre y apellido) y te paso los pasos para unirte ✅`);
}

// Handler principal
async function handleMessage(sock, m) {
  const from = m.key?.remoteJid || '';
  if (!from || from.endsWith('@g.us')) return; // ignorar grupos

  const textRaw = extractText(m);
  const text = (textRaw || '').replace(/\s+/g, ' ').trim();
  const lowered = text.toLowerCase();
  const pushName = m.pushName || '';

  let st = statePerUser.get(from) || { stage: 'start', nombre: '', lastMsg: 0, lastDoubtNotifyAt: 0 };
  st.lastMsg = Date.now();
  statePerUser.set(from, st);

  const said = (re) => re.test(lowered);

  // Comandos útiles
  if (said(/^ping$/i)) {
    await sock.sendMessage(from, { text: '¡Estoy vivo! 🤖' });
    return;
  }
  if (said(/^reset$/i)) {
    statePerUser.delete(from);
    await sock.sendMessage(from, { text: '🔄 Reiniciado. Escribe "hola" para comenzar.' });
    return;
  }

  // 1) SALUDO
  if (said(/\b(hola|buen dia|buen día|buenas)\b/i) || st.stage === 'start') {
    await sock.sendMessage(from, { text: buildBienvenida() });
    st.stage = 'askedName';
    statePerUser.set(from, st);
    return;
  }

  // 2) NOMBRE → solo si estamos esperando nombre
  if (st.stage === 'askedName') {
    const parts = text.split(/\s+/).filter(Boolean);

    // Una sola palabra → pedir nombre completo
    if (parts.length < 2) {
      await sock.sendMessage(from, { text: '¿Podrías enviarme tu *nombre completo* (nombre y apellido)? 🙌' });
      return;
    }

    if (isProbablyName(text)) {
      st.nombre = text.replace(/[^\p{L}\s'.-]/gu, '').trim();
      const fecha = nextMondayDate();

      await sock.sendMessage(from, { text: `Buen día, ${st.nombre}. El reto de 21 días inicia el próximo lunes ${fecha}. El valor del programa es 35 Bs.` });
      await sock.sendMessage(from, { text: 'Si te inscribes hoy, recibes de regalo el curso de 12 días: "Aprende a meditar desde cero".' });
      await sendQR(sock, from);

      st.stage = 'quoted';
      statePerUser.set(from, st);

      // Recordatorio único si no responde
      setTimeout(async () => {
        const u = statePerUser.get(from);
        if (u && Date.now() - u.lastMsg >= REMINDER_MINUTES * 60 * 1000) {
          await sock.sendMessage(from, { text: `Hola ${u.nombre || 'amigo'}, ¿sigues interesado en el reto? 😊` });
        }
      }, REMINDER_MINUTES * 60 * 1000);
      return;
    } else {
      await sock.sendMessage(from, { text: 'Para continuar, por favor envíame tu *nombre completo* (nombre y apellido). 😊' });
      return;
    }
  }

  // 3) PAGO / COMPROBANTE (siempre avisa al dueño)
  const { match: isPayment, hasImageOrDoc } = detectPayment(m, lowered);
  if (isPayment) {
    // Aviso interno al dueño (sin "DE XXXXX")
    await notifyOwnerPayment(sock, from, statePerUser.get(from)?.nombre || pushName, hasImageOrDoc, text);

    // Respuesta al cliente
    await sock.sendMessage(from, {
      text:
        '🌟 ¡Bienvenido al Reto de 21 Días de Gratitud y Abundancia! 🌟\n\n' +
        `🔗 Grupo: ${LINK_GRUPO}\n` +
        `🎁 Bono:  ${LINK_BONO}`
    });

    st.stage = 'enrolled';
    statePerUser.set(from, st);
    return;
  }

  // 4) Duda / Fallback → te notifica (cooldown en segundos; 0 = notifica todo)
  const now = Date.now();
  const gap = DOUBT_NOTIFY_COOLDOWN_SEC * 1000;
  const canNotify = !gap || (now - (st.lastDoubtNotifyAt || 0) >= gap);

  if (text && canNotify) {
    await notifyDoubt(sock, from, st.nombre || pushName, text);
    st.lastDoubtNotifyAt = now;
    statePerUser.set(from, st);
  }
  // el bot no responde al cliente aquí (silencio)
}

// ------------------------- ARRANQUE -------------------------
async function start() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false // mostramos link en logs
  });

  sock.ev.on('connection.update', (update) => {
    const { qr, connection } = update;

    if (qr) {
      const qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(qr);
      console.log('🔗 QR directo (haz clic y escanéalo):', qrUrl);
    }

    if (connection === 'open') {
      console.log('✅ Conectado a WhatsApp. Escuchando mensajes...');
    }
    if (connection === 'close') {
      console.log('❌ Conexión cerrada. Reintentando...');
      start().catch(err => console.error('Reinicio falló:', err?.message));
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async ({ type, messages }) => {
    if (type !== 'notify') return;
    const m = messages && messages[0];
    try { await handleMessage(sock, m); }
    catch (e) { console.error('Error al responder:', e?.message); }
  });
}

start().catch(err => console.error('Error general:', err?.message));

