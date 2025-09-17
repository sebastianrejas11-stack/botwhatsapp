// Bot WhatsApp (Baileys) – Capa 0 pulida con configuración centralizada

const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

// ========== CONFIG EDITABLE ==========
const OWNER_PHONE   = '59177441414'; // tu número con prefijo
const COUNTRY_PREFIX = '591';        // prefijo permitido

// Links de tu reto
const LINK_GRUPO = 'https://chat.whatsapp.com/IWA2ae5podREHVFzoUSvxI?mode=ems_copy_t';
const LINK_BONO  = 'https://www.youtube.com/watch?v=XkjFZY30vHc&list=PLnT-PzQPCplvsx4c-vAvLyk5frp_nHTGx&index=1';
const LINK_PAGO  = 'https://tu-link-de-pago'; // fallback si no hay qr.jpg

// Tiempos de recordatorio
const REMINDER_WELCOME_MIN = 10; // tras bienvenida si no responde
const REMINDER_QR_MIN      = 10; // tras enviar QR si no responde/paga
// =====================================

// Mensaje premium post-pago
function buildMensajePago() {
  return (
`🌟 ¡Te doy la bienvenida al Reto de 21 Días de Gratitud y de Abundancia! 🌟

Prepárate para iniciar un viaje transformador hacia una vida más plena, consciente y conectada con la energía de la gratitud y la abundancia 💖✨

🔗 Ingresa al grupo aquí:
${LINK_GRUPO}

🎁 BONO ESPECIAL POR INSCRIBIRTE
Al unirte, también recibes totalmente gratis el taller de 12 clases para aprender a meditar, ideal para profundizar en tu bienestar y armonía interior 🧘‍♀️🌿

📺 Accede al taller aquí:
${LINK_BONO}

✨ ¡Gracias por ser parte de este hermoso camino! Nos vemos dentro.`
  );
}

// Bienvenida que pide nombre completo
function buildBienvenida(fechaLunes) {
  return (
`Hola 🌟 ¡Gracias por tu interés en el Reto de 21 Días de Gratitud y Abundancia! 🙏✨

Este hermoso reto se realizará por WhatsApp y empieza este lunes ${fechaLunes} 🗓️

📌 Incluye:
✔️ Reflexión + ejercicio diario
✔️ Videos explicativos
✔️ Libro digital al finalizar

💛 Este es un bonito regalo para ti, date la oportunidad.

Las clases se envían vía WhatsApp por la mañana y puedes verlas cuando gustes.

Si deseas inscribirte, por favor respóndeme tu *nombre completo (nombre y apellido)* ✅`);
}

const OWNER_JID = OWNER_PHONE.replace(/\D/g, '') + '@s.whatsapp.net';

// Guardas de tiempo para NO reprocesar historial
const START_EPOCH = Math.floor(Date.now() / 1000);
const HISTORY_GRACE_SEC = 30;

// Estado por usuario
const users = new Map(); // { stage, nombre, lastMsg, welcomeReminderSent, qrReminderSent, paid }

// Próximo lunes
function nextMondayDate() {
  const now = new Date();
  const day = now.getDay();
  const add = (1 - day + 7) % 7 || 7;
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + add);
  return d.toLocaleDateString('es-BO', { day: 'numeric', month: 'long' });
}

// Texto útil
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

// Es nombre completo
function isFullName(s) {
  if (!s) return false;
  if (!/^[\p{L} .'\-]+$/u.test(s)) return false;
  const parts = s.trim().split(/\s+/);
  return parts.length >= 2;
}

// Enviar QR
async function sendQR(sock, to) {
  try {
    const file = path.join(__dirname, 'qr.jpg');
    if (fs.existsSync(file)) {
      const buffer = fs.readFileSync(file);
      await sock.sendMessage(to, { image: buffer, caption: 'Escanea este QR para inscribirte ✅' });
    } else {
      await sock.sendMessage(to, { text: `Escanea aquí: ${LINK_PAGO}` });
    }
  } catch (e) {
    console.error('Error enviando QR:', e?.message);
  }
}

// Notificar al dueño
async function notifyOwner(sock, customerJid, title, body) {
  const human = customerJid.replace('@s.whatsapp.net', '');
  const text = `*${title}*\nDe: ${human}\n${body ? body + '\n' : ''}`;
  try { await sock.sendMessage(OWNER_JID, { text }); } catch {}
}

// Handler principal
async function handleMessage(sock, m) {
  const from = m.key?.remoteJid || '';
  if (!from || from.endsWith('@g.us')) return;
  if (m.key.fromMe) return;
  const ts = Number(m.messageTimestamp || 0);
  if (ts && ts < START_EPOCH - HISTORY_GRACE_SEC) return;

  const num = from.replace('@s.whatsapp.net', '');
  if (!num.startsWith(COUNTRY_PREFIX)) {
    await notifyOwner(sock, from, 'Contacto fuera de país', 'No se respondió (bloqueado por prefijo).');
    return;
  }

  const textRaw = extractText(m);
  const text = (textRaw || '').replace(/\s+/g, ' ').trim();
  if (!text) return;
  const lowered = text.toLowerCase();

  let st = users.get(from);
  if (!st) {
    st = { stage: 'start', nombre: '', lastMsg: 0, welcomeReminderSent: false, qrReminderSent: false, paid: false };
    users.set(from, st);
  }
  st.lastMsg = Date.now();
  users.set(from, st);

  const said = (re) => re.test(lowered);

  // ping
  if (said(/^ping$/i)) {
    await sock.sendMessage(from, { text: '¡Estoy vivo! 🤖' });
    return;
  }

  // saludo
  if (said(/\b(hola|buen dia|buen día|buenas)\b/i) || st.stage === 'start') {
    const fecha = nextMondayDate();
    await sock.sendMessage(from, { text: buildBienvenida(fecha) });

    st.stage = 'askedName';
    st.welcomeReminderSent = false;
    users.set(from, st);

    setTimeout(async () => {
      const u = users.get(from);
      if (!u) return;
      const noRespuesta = Date.now() - u.lastMsg >= REMINDER_WELCOME_MIN * 60 * 1000;
      if (u.stage === 'askedName' && !u.welcomeReminderSent && !u.paid && noRespuesta) {
        await sock.sendMessage(from, { text: '¿Aún tienes interés en el reto? Si es así mándame tu *nombre completo* por favor para anotarte 🙌' });
        u.welcomeReminderSent = true;
        users.set(from, u);
      }
    }, REMINDER_WELCOME_MIN * 60 * 1000);

    return;
  }

  // nombre completo
  if (st.stage === 'askedName') {
    const parts = text.split(/\s+/).filter(Boolean);
    if (parts.length < 2 || !isFullName(text)) {
      await sock.sendMessage(from, { text: '🙏 Para continuar, envíame tu *nombre completo* (nombre y apellido).' });
      return;
    }

    st.nombre = text.replace(/[^\p{L}\s'.-]/gu, '').trim();
    const fecha = nextMondayDate();
    await sock.sendMessage(from, { text: `Buen día, ${st.nombre}. El reto de 21 días inicia el próximo lunes ${fecha}. El valor del programa es 35 Bs.` });
    await sock.sendMessage(from, { text: 'Si te inscribes hoy, recibes de regalo el curso de 12 días: "Aprende a meditar desde cero".' });
    await sendQR(sock, from);

    st.stage = 'quoted';
    st.qrReminderSent = false;
    users.set(from, st);

    setTimeout(async () => {
      const u = users.get(from);
      if (!u) return;
      const noRespuesta = Date.now() - u.lastMsg >= REMINDER_QR_MIN * 60 * 1000;
      if ((u.stage === 'quoted' || u.stage === 'askedName') && !u.qrReminderSent && !u.paid && noRespuesta) {
        await sock.sendMessage(from, { text: 'Hola, ¿me confirmas el pago para enviarte el *curso de 12 días* y el *acceso al reto*? 🙌' });
        u.qrReminderSent = true;
        users.set(from, u);
      }
    }, REMINDER_QR_MIN * 60 * 1000);

    return;
  }

  // pago/comprobante
  const hasImage = !!m.message?.imageMessage;
  const hasDoc = !!m.message?.documentMessage;
  const isPdf = (m.message?.documentMessage?.mimetype || '').includes('pdf');
  const saidPayment = /\b(pagu[eé]|pague|pago|comprobante|transferencia)\b/.test(lowered);

  if (hasImage || isPdf || saidPayment) {
    await sock.sendMessage(from, { text: buildMensajePago() });

    st.paid = true;
    st.stage = 'enrolled';
    users.set(from, st);

    await notifyOwner(sock, from, 'Pago/Comprobante recibido', '(Imagen, PDF o texto de pago detectado)');
    return;
  }

  // fallback
  await notifyOwner(sock, from, 'Duda detectada', `Mensaje: "${text}"`);
}

// ---------- Bootstrap ----------
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
      const url = 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(qr);
      console.log('🔗 QR directo (clic y escanear):', url);
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
