// src/handlers.js
const fs = require('fs');
const path = require('path');
const {
  OWNER_PHONE,
  COUNTRY_PREFIX,
  LINK_GRUPO,
  LINK_BONO,
  LINK_PAGO,
  REMINDER_WELCOME_MIN, // mantenidos por compatibilidad
  REMINDER_QR_MIN
} = require('./config');
const { getUser, upsertUser } = require('./state');

const OWNER_JID = OWNER_PHONE.replace(/\D/g, '') + '@s.whatsapp.net';

// ===== Ventana anti-historial
const START_EPOCH = Math.floor(Date.now() / 1000);
const HISTORY_GRACE_SEC = 30;

// ===== Utils =====
const delay = (ms) => new Promise(res => setTimeout(res, ms));
const humanPause = async () => delay(1200 + Math.floor(Math.random() * 600)); // 1.2–1.8s

function nextMondayDate() {
  const now = new Date();
  const day = now.getDay();
  const add = (1 - day + 7) % 7 || 7;
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

function normalize(s = '') {
  return (s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isStartTrigger(raw = '') {
  const t = normalize(raw);
  if (t.includes('me uno')) return true;
  if (/\b(hola|buen dia|buen día|buenas)\b/i.test(t)) return true;
  if (t.includes('me apunto')) return true;
  if (t.includes('quiero unirme')) return true;
  return false;
}

function wantsQR(raw = '') {
  const t = normalize(raw);
  return (
    t.includes('como pago') ||
    t.includes('cómo pago') ||
    t.includes('pagar') ||
    t.includes('pago') ||
    t.includes('metodo de pago') ||
    t.includes('método de pago') ||
    t.includes('qr') ||
    t.includes('pásame el qr') ||
    t.includes('pasame el qr')
  );
}

function saysYes(raw = '') {
  const t = normalize(raw);
  return (
    t === 'si' || t === 'sí' ||
    t.includes('si quiero') || t.includes('sí quiero') ||
    t.includes('si por favor') || t.includes('sí por favor') ||
    t.includes('mándame el qr') || t.includes('mandame el qr') ||
    t.includes('pasame el qr') || t.includes('pásame el qr')
  );
}

async function notifyOwner(sock, customerJid, title, body) {
  const human = customerJid.replace('@s.whatsapp.net', '');
  const text = `*${title}*\nDe: ${human}\n${body ? body + '\n' : ''}`;
  try { await sock.sendMessage(OWNER_JID, { text }); } catch {}
}

// ===== Archivos imágenes =====
function findFirstExisting(paths) {
  for (const p of paths) {
    try { if (fs.existsSync(p)) return p; } catch {}
  }
  return null;
}

function getQRPath() {
  return findFirstExisting([
    path.join(process.cwd(), 'qr.jpg'),
    path.join(__dirname, '..', 'qr.jpg'),
    path.join(process.cwd(), 'assets', 'qr.jpg')
  ]);
}

function getSocialPath() {
  return findFirstExisting([
    path.join(process.cwd(), 'social.jpg'),
    path.join(__dirname, '..', 'social.jpg'),
    path.join(process.cwd(), 'assets', 'social.jpg')
  ]);
}

async function sendSocialProof(sock, to) {
  const social = getSocialPath();
  const texto =
`🌟 ¡Genial! Estás a un paso de asegurar tu cupo en el *Reto de 21 Días de Gratitud y Abundancia* 🙌

Así compartimos dentro del grupo cada día 👇
Mira cómo participan otros estudiantes:`;

  if (social) {
    const buf = fs.readFileSync(social);
    await sock.sendMessage(to, { image: buf, caption: texto });
  } else {
    console.warn('⚠️ social.jpg NO encontrado.');
    await sock.sendMessage(to, { text: texto });
  }
}

async function sendQR(sock, to, caption = 'Escanéalo y envíame tu comprobante aquí mismo 📲') {
  const qr = getQRPath();
  if (qr) {
    const buf = fs.readFileSync(qr);
    await sock.sendMessage(to, { image: buf, caption });
  } else {
    console.warn('⚠️ qr.jpg NO encontrado.');
    await sock.sendMessage(to, { text: `Aquí el enlace alternativo: ${LINK_PAGO}\n\n${caption}` });
  }
}

// ===== Copys =====
function copyPriceAndBonusCaption() {
  // Se envía como CAPTION del QR en S0 (2 mensajes totales)
  return (
`👉 El valor del reto es de *35 Bs*.
Si te inscribes *HOY* recibes *GRATIS* el curso de meditación (12 clases) 🧘‍♀️

Aquí tienes el *QR* para tu inscripción.
*Escanéalo* y envíame tu comprobante aquí mismo 📲`
  );
}

function copyReSendQR() {
  return (
`Aquí tienes nuevamente el *QR* para tu inscripción.
*Escanéalo* y envíame tu comprobante aquí mismo 📲`
  );
}

// Bienvenida exacta post-pago
function copyWelcomeAfterPaymentExact() {
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

function copyClose(name = '') {
  const fecha = nextMondayDate();
  return (
`¡Listo${name ? ' ' + name : ''}! Tu inscripción está confirmada ✅
Arrancamos este *lunes ${fecha}*. ¡Prepárate para una experiencia transformadora! 🙏✨`
  );
}

function copyFollowUp(name = '') {
  return (
`🌟${name ? ' ' + name : ''}, ¿aún tienes interés en el reto?
Recuerda que al inscribirte *HOY* recibes:
✅ El Reto de 21 días
✅ El libro digital del reto 📘
✅ El curso de meditación (12 clases) 🧘‍♀️
✅ Una afirmación poderosa para atraer abundancia 💰

¿Quieres que te pase el *QR* de nuevo?`
  );
}

// ===== Handler principal =====
async function handleMessage(sock, m) {
  const from = m.key?.remoteJid || '';
  if (!from || from.endsWith('@g.us')) return;
  if (m.key.fromMe) return;

  const ts = Number(m.messageTimestamp || 0);
  if (ts && ts < START_EPOCH - HISTORY_GRACE_SEC) return;

  const num = from.replace('@s.whatsapp.net', '');
  if (!num.startsWith(COUNTRY_PREFIX)) {
    await notifyOwner(sock, from, 'Contacto fuera de país', 'No se respondió (prefijo bloqueado).');
    return;
  }

  const textRaw = extractText(m);
  const text = (textRaw || '').trim();
  const lowered = normalize(text);

  let st = getUser(from) || {
    stage: 'start',
    nombre: '',
    lastMsg: 0,
    followUpScheduled: false,
    followUpSent: false,
    lastPromptWasFollowUp: false,
    paid: false
  };
  st.lastMsg = Date.now();
  upsertUser(from, st);

  // ping
  if (/^ping$/i.test(text)) {
    await sock.sendMessage(from, { text: '¡Estoy vivo! 🤖' });
    return;
  }

  // ===== S2 — Pago/comprobante detectado =====
  const hasImage = !!m.message?.imageMessage;
  const isPdf = (m.message?.documentMessage?.mimetype || '').includes('pdf');
  const saidPayment = /\b(pagu[eé]|pague|pago|comprobante|transferencia)\b/.test(lowered);

  if (hasImage || isPdf || saidPayment) {
    st.paid = true;
    st.stage = 'enrolled';
    st.followUpSent = true;
    upsertUser(from, st);

    // 1) Bienvenida exacta
    await sock.sendMessage(from, { text: copyWelcomeAfterPaymentExact() });
    await humanPause();

    // 2) Cierre/fecha
    await sock.sendMessage(from, { text: copyClose(st.nombre) });

    // 3) Notificación al dueño
    await notifyOwner(
      sock,
      from,
      '📢 Nuevo pago recibido',
      `Usuario: ${st.nombre || num}\nYa fue enviado el acceso al grupo y los bonos.`
    );
    return;
  }

  // ===== S1 — Pide/reenviar QR =====
  if (wantsQR(lowered) || (st.lastPromptWasFollowUp && saysYes(lowered))) {
    st.lastPromptWasFollowUp = false;
    upsertUser(from, st);

    await sock.sendMessage(from, { text: `Claro${st.nombre ? ' ' + st.nombre : ''} 🙌` });
    await humanPause();
    await sendQR(sock, from, copyReSendQR());
    return;
  }

  // ===== S0 — Inicio (dos mensajes con pausa humana) =====
  if (isStartTrigger(text) || st.stage === 'start') {
    await sendSocialProof(sock, from);
    await humanPause();
    await sendQR(sock, from, copyPriceAndBonusCaption());

    st.stage = 'waitingPayment';
    upsertUser(from, st);

    // Follow-up único 15 min
    if (!st.followUpScheduled) {
      st.followUpScheduled = true;
      upsertUser(from, st);

      setTimeout(async () => {
        const u = getUser(from);
        if (!u || u.paid || u.followUpSent) return;
        const noRespuesta = Date.now() - u.lastMsg >= 15 * 60 * 1000;
        if (u.stage === 'waitingPayment' && noRespuesta) {
          await sock.sendMessage(from, { text: copyFollowUp(u.nombre) });
          u.followUpSent = true;
          u.lastPromptWasFollowUp = true;
          upsertUser(from, u);
        }
      }, 15 * 60 * 1000);
    }
    return;
  }

  // ===== Duda no reconocida: notifica al dueño y silencio =====
  await notifyOwner(sock, from, 'Duda detectada', `Mensaje: "${text}"`);
}

module.exports = { handleMessage };
