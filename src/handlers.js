// src/handlers.js
const fs = require('fs');
const path = require('path');
const {
  OWNER_PHONE,
  COUNTRY_PREFIX,
  LINK_GRUPO,
  LINK_BONO,
  LINK_PAGO,
  REMINDER_WELCOME_MIN,
  REMINDER_QR_MIN
} = require('./config');

const { getUser, upsertUser } = require('./state');

const OWNER_JID = OWNER_PHONE.replace(/\D/g, '') + '@s.whatsapp.net';

// Para no reprocesar historial antiguo
const START_EPOCH = Math.floor(Date.now() / 1000);
const HISTORY_GRACE_SEC = 30;

// -------- utilidades --------
function nextMondayDate() {
  const now = new Date();
  const day = now.getDay(); // 0=Dom
  const add = (1 - day + 7) % 7 || 7; // próximo lunes
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + add);
  return d.toLocaleDateString('es-BO', { day: 'numeric', month: 'long' });
}

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

function isFullName(s) {
  if (!s) return false;
  if (!/^[\p{L} .'\-]+$/u.test(s)) return false;
  const parts = s.trim().split(/\s+/);
  return parts.length >= 2;
}

function normalizeForMatch(s = "") {
  return (s || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isStartTrigger(loweredRaw = "") {
  const t = normalizeForMatch(loweredRaw);
  if (/\b(hola|buen dia|buen día|buenas)\b/i.test(t)) return true;
  if (t.includes("me uno")) return true;           // “✨ME UNO✨”
  if (t.includes("me apunto")) return true;
  if (t.includes("quiero unirme")) return true;
  return false;
}

// ====== CAPTION EXACTO BAJO EL QR ======
const QR_CAPTION =
  'Si te inscribes hoy, recibes de regalo el curso de 12 días\n\n' +
  '*"Aprende a meditar desde cero"*';

// QR con búsqueda robusta de archivo (varias rutas)
async function sendQR(sock, to) {
  // Posibles rutas del QR dentro del repo/contendor
  const candidatePaths = [
    path.join(process.cwd(), 'qr.jpg'),
    path.join(__dirname, '..', 'qr.jpg'),
    path.join(process.cwd(), 'assets', 'qr.jpg'),
  ];

  let fileFound = null;
  for (const p of candidatePaths) {
    try {
      if (fs.existsSync(p)) { fileFound = p; break; }
    } catch { /* ignore */ }
  }

  try {
    if (fileFound) {
      const buffer = fs.readFileSync(fileFound);
      await sock.sendMessage(to, { image: buffer, caption: QR_CAPTION });
    } else {
      console.warn('⚠️ qr.jpg NO encontrado. Rutas probadas:', candidatePaths);
      // Fallback (texto + link) – se manda solo si realmente no hay imagen
      await sock.sendMessage(to, {
        text: `${QR_CAPTION}\n\nEscanea aquí: ${LINK_PAGO}`
      });
    }
  } catch (e) {
    console.error('Error enviando QR:', e?.message);
  }
}

async function notifyOwner(sock, customerJid, title, body) {
  const human = customerJid.replace('@s.whatsapp.net', '');
  const text = `*${title}*\nDe: ${human}\n${body ? body + '\n' : ''}`;
  try { await sock.sendMessage(OWNER_JID, { text }); } catch {}
}

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

// --------- handler principal ----------
async function handleMessage(sock, m) {
  const from = m.key?.remoteJid || '';
  if (!from || from.endsWith('@g.us')) return; // ignora grupos
  if (m.key.fromMe) return;                     // ignora mensajes propios

  const ts = Number(m.messageTimestamp || 0);
  if (ts && ts < START_EPOCH - HISTORY_GRACE_SEC) return; // ignora historial viejo

  const num = from.replace('@s.whatsapp.net', '');
  if (!num.startsWith(COUNTRY_PREFIX)) {
    await notifyOwner(sock, from, 'Contacto fuera de país', 'No se respondió (bloqueado por prefijo).');
    return;
  }

  const textRaw = extractText(m);
  const text = (textRaw || '').replace(/\s+/g, ' ').trim();
  if (!text) return;
  const lowered = text.toLowerCase();

  let st = getUser(from);
  if (!st) {
    st = { stage: 'start', nombre: '', lastMsg: 0, welcomeReminderSent: false, qrReminderSent: false, paid: false };
    upsertUser(from, st);
  }
  st.lastMsg = Date.now();
  upsertUser(from, st);

  const said = (re) => re.test(lowered);

  // ping
  if (said(/^ping$/i)) {
    await sock.sendMessage(from, { text: '¡Estoy vivo! 🤖' });
    return;
  }

  // INICIO (incluye “✨ME UNO✨”)
  if (isStartTrigger(lowered) || st.stage === 'start') {
    const fecha = nextMondayDate();
    await sock.sendMessage(from, { text: buildBienvenida(fecha) });

    st.stage = 'askedName';
    st.welcomeReminderSent = false;
    upsertUser(from, st);

    // recordatorio si no responde
    setTimeout(async () => {
      const u = getUser(from);
      if (!u) return;
      const noRespuesta = Date.now() - u.lastMsg >= REMINDER_WELCOME_MIN * 60 * 1000;
      if (u.stage === 'askedName' && !u.welcomeReminderSent && !u.paid && noRespuesta) {
        await sock.sendMessage(from, { text: '¿Aún tienes interés en el reto? Si es así mándame tu *nombre completo* por favor para anotarte 🙌' });
        u.welcomeReminderSent = true;
        upsertUser(from, u);
      }
    }, REMINDER_WELCOME_MIN * 60 * 1000);

    return;
  }

  // NOMBRE COMPLETO
  if (st.stage === 'askedName') {
    const parts = text.split(/\s+/).filter(Boolean);
    if (parts.length < 2 || !isFullName(text)) {
      await sock.sendMessage(from, { text: '🙏 Para continuar, envíame tu *nombre completo* (nombre y apellido).' });
      return;
    }

    st.nombre = text.replace(/[^\p{L}\s'.-]/gu, '').trim();
    const fecha = nextMondayDate();

    // Solo precio aquí
    await sock.sendMessage(from, { text: `Buen día, ${st.nombre}. El reto de 21 días inicia el próximo lunes ${fecha}. El valor del programa es 35 Bs.` });

    // QR con caption exacto
    await sendQR(sock, from);

    st.stage = 'quoted';
    st.qrReminderSent = false;
    upsertUser(from, st);

    // recordatorio de pago tras enviar QR
    setTimeout(async () => {
      const u = getUser(from);
      if (!u) return;
      const noRespuesta = Date.now() - u.lastMsg >= REMINDER_QR_MIN * 60 * 1000;
      if ((u.stage === 'quoted' || u.stage === 'askedName') && !u.qrReminderSent && !u.paid && noRespuesta) {
        await sock.sendMessage(from, { text: 'Hola, ¿me confirmas el pago para enviarte el *curso de 12 días* y el *acceso al reto*? 🙌' });
        u.qrReminderSent = true;
        upsertUser(from, u);
      }
    }, REMINDER_QR_MIN * 60 * 1000);

    return;
  }

  // PAGO / COMPROBANTE
  const hasImage = !!m.message?.imageMessage;
  const isPdf = (m.message?.documentMessage?.mimetype || '').includes('pdf');
  const saidPayment = /\b(pagu[eé]|pague|pago|comprobante|transferencia)\b/.test(lowered);

  if (hasImage || isPdf || saidPayment) {
    await sock.sendMessage(from, { text: buildMensajePago() });

    st.paid = true;
    st.stage = 'enrolled';
    upsertUser(from, st);

    await notifyOwner(sock, from, 'Pago/Comprobante recibido', '(Imagen, PDF o texto de pago detectado)');
    return;
  }

  // fallback
  await notifyOwner(sock, from, 'Duda detectada', `Mensaje: "${text}"`);
}

module.exports = { handleMessage };

