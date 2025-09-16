// Bot WhatsApp (Baileys) para Railway
// - Sin Chromium
// - QR como link clickeable en logs (api.qrserver.com)
// - Persistencia de sesión en ./auth (si no usas Volumes, se pierde al redeploy)
// - Flujo: saludo -> nombre -> QR -> recordatorio
// - Si no entiende: NO responde al cliente; te notifica a ti por WhatsApp
// - NUEVO: notifica pago SIEMPRE; dudas sin enfriamiento por defecto

const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

// ========== CONFIGURA AQUÍ ==========
// Tu número con código de país, solo dígitos:
const OWNER_PHONE = process.env.OWNER_PHONE || '59177441414';

const LINK_GRUPO   = process.env.LINK_GRUPO || 'https://chat.whatsapp.com/FahDpskFeuf7rqUVz7lgYr?mode=ems_copy_t';
const LINK_BONO    = process.env.LINK_BONO  || 'https://www.youtube.com/watch?v=XkjFZY30vHc&list=PLnT-PzQPCplvsx4c-vAvLyk5frp_nHTGx&index=1';
const LINK_PAGO    = process.env.LINK_PAGO  || 'https://tu-link-de-pago';

// Recordatorio al cliente si no responde tras enviar el QR
const REMINDER_MINUTES = parseFloat(process.env.REMINDER_MINUTES || '10');

// ⬇️ Antispam de dudas (en segundos). 0 = sin enfriamiento (notifica TODO).
// Si prefieres un pequeño freno, por ejemplo 10 segundos: pon 10.
const DOUBT_NOTIFY_COOLDOWN_SEC = parseFloat(process.env.DOUBT_NOTIFY_COOLDOWN_SEC || '0');
// ====================================

const OWNER_JID = OWNER_PHONE.replace(/\D/g, '') + '@s.whatsapp.net';

// Memoria simple por contacto (RAM)
const statePerUser = new Map();

// Próximo lunes (“22 de septiembre”)
function nextMondayDate() {
  const now = new Date();
  const day = now.getDay(); // 0=Dom
  const daysToMon = (8 - day) % 7 || 7;
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysToMon);
  return d.toLocaleDateString('es-BO', { day: 'numeric', month: 'long' });
}

// Extraer texto de cualquier tipo de mensaje
function extractText(m) {
  if (!m || !m.message) return '';
  const msg = m.message;
  return (
    msg.conversation ||
    msg.extendedTextMessage?.text ||
    msg.imageMessage?.caption ||
    msg.videoMessage?.caption ||
    ''
  ).trim();
}

// ¿Parece un nombre real?
function isProbablyName(s) {
  if (/[?¿!¡]/.test(s)) return false;
  if (!/^[\p{L} .'\-]+$/u.test(s)) return false;
  const parts = s.trim().split(/\s+/);
  if (parts.length < 2) return false;
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

// Enviar imagen (qr.jpg en la misma carpeta). Si falta, manda LINK_PAGO
async function sendQR(sock, to) {
  try {
    const file = path.join(__dirname, 'qr.jpg');
    const buffer = fs.readFileSync(file);
    await sock.sendMessage(to, { image: buffer, caption: 'Escanea este QR para inscribirte ✅' });
  } catch (e) {
    await sock.sendMessage(to, { text: `No pude adjuntar el QR ahora. Aquí tienes el enlace de pago: ${LINK_PAGO}` });
  }
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

// Notificar posible pago/comprobante al dueño (no se bloquea por cooldown)
async function notifyPayment(sock, customerJid, msgText, hasImage) {
  const human = customerJid.replace('@s.whatsapp.net', '');
  const detalle = hasImage ? '(Imagen/Comprobante adjunto)' : `"${msgText}"`;
  const body =
    `💸 *Posible pago/confirmación*\n` +
    `De: *${human}*\n` +
    `Detalle: ${detalle}\n\n` +
    `👉 *Acción sugerida:* CONFIRMA EL PAGO DE XXXXXX`;
  await sock.sendMessage(OWNER_JID, { text: body }).catch(() => {});
}

// Lógica del bot
async function handleMessage(sock, m) {
  const from = m.key?.remoteJid || '';
  if (!from || from.endsWith('@g.us')) return; // Ignora grupos

  const textRaw = extractText(m);
  const text = textRaw ? textRaw.replace(/\s+/g, ' ') : '';
  const lowered = (text || '').toLowerCase();
  const pushName = m.pushName || '';
  const hasImage = !!m.message?.imageMessage || !!m.message?.documentMessage; // doc por si envía PDF

  let st = statePerUser.get(from) || {
    stage: 'start',
    nombre: '',
    lastMsg: 0,
    lastDoubtNotifyAt: 0
  };
  st.lastMsg = Date.now();
  statePerUser.set(from, st);

  const said = (re) => re.test(lowered);

  // Comandos
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
  if (said(/\b(hola|buen dia|buen día|buenas)\b/i)) {
    const fecha = nextMondayDate();
    const bienvenida =
`Hola 🌟 ¡Gracias por tu interés en el Reto de 21 Días de Gratitud y Abundancia! 🙏✨

Este hermoso reto se realizará por WhatsApp y empieza este lunes ${fecha} 🗓️

📌 Incluye:
✔️ Reflexión + ejercicio diario
✔️ Videos explicativos
✔️ Libro digital al finalizar

💛 Este es un bonito regalo para ti, date la oportunidad.

Las clases se envían vía WhatsApp por la mañana y puedes verlas cuando gustes.

Si deseas inscribirte, por favor responde a este mensaje con tu nombre completo y te paso los pasos para unirte ✅`;
    await sock.sendMessage(from, { text: bienvenida });
    st.stage = 'askedName';
    statePerUser.set(from, st);
    return;
  }

  // 2) NOMBRE
  if (st.stage === 'askedName') {
    if (text && isProbablyName(text)) {
      st.nombre = text.replace(/[^\p{L}\s'.-]/gu, '').trim();
      const fecha = nextMondayDate();
      await sock.sendMessage(from, { text: `Buen día, ${st.nombre}. El reto de 21 días inicia el próximo lunes ${fecha}. El valor del programa es 35 Bs.` });
      await sock.sendMessage(from, { text: 'Si te inscribes hoy, recibes de regalo el curso de 12 días: "Aprende a meditar desde cero".' });
      await sendQR(sock, from);

      st.stage = 'quoted';
      statePerUser.set(from, st);

      // Recordatorio si no responde
      setTimeout(async () => {
        const u = statePerUser.get(from);
        if (u && Date.now() - u.lastMsg >= REMINDER_MINUTES * 60 * 1000) {
          await sock.sendMessage(from, { text: `Hola ${u.nombre || 'amigo'}, ¿sigues interesado en el reto? 😊` });
        }
      }, REMINDER_MINUTES * 60 * 1000);
      return;
    } else {
      // No parece nombre → silencio
      return;
    }
  }

  // 3) PAGO / COMPROBANTE
  if (hasImage || said(/pagu[eé]|comprobante|transferencia|pago/)) {
    // Notifica SIEMPRE al dueño (sin cooldown)
    await notifyPayment(sock, from, text || '', hasImage);

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

  // 4) Duda / Fallback → te notifica (con cooldown en segundos, 0 = sin cooldown)
  const now = Date.now();
  const gap = DOUBT_NOTIFY_COOLDOWN_SEC * 1000;
  const canNotify = !gap || (now - (st.lastDoubtNotifyAt || 0) >= gap);

  if (text && canNotify) {
    await notifyDoubt(sock, from, pushName, text);
    st.lastDoubtNotifyAt = now;
    statePerUser.set(from, st);
  }
  // El bot no contesta al cliente
}

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false
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
      start().catch(err => console.error('Reinicio falló:', err.message));
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async ({ type, messages }) => {
    if (type !== 'notify') return;
    const m = messages && messages[0];
    try {
      await handleMessage(sock, m);
    } catch (e) {
      console.error('Error al responder:', e?.message);
    }
  });
}

start().catch(err => console.error('Error general:', err));
