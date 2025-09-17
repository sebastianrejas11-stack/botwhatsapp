// Bot WhatsApp (Baileys) – Capa 0 endurecida para producción
// - Sin Chromium, solo @whiskeysockets/baileys
// - Ignora mensajes viejos (previos al arranque) para evitar re-spam
// - Solo trabaja con contactos que escriban desde que el bot está encendido
// - Bloquea números que no sean de +591 (te avisa a ti, no les responde)
// - Flujo: saludo -> nombre completo -> QR -> 1 recordatorio
// - Reportes: cada 60 min y resumen diario a las 22:00 (hora del server)

const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

// ========== CONFIG EDITABLE ==========
const OWNER_PHONE = '59177441414';             // <- tu celular (solo dígitos con código de país)
const COUNTRY_PREFIX = '591';                   // <- prefijo permitido
const LINK_GRUPO   = 'https://chat.whatsapp.com/FahDpskFeuf7rqUVz7lgYr';
const LINK_BONO    = 'https://www.youtube.com/watch?v=XkjFZY30vHc';
const LINK_PAGO    = 'https://tu-link-de-pago';
const REMINDER_MINUTES = 10;                    // recordatorio si no responde
const REPORT_EVERY_MIN = 60;                    // reporte cada 60 minutos
// =====================================

const OWNER_JID = OWNER_PHONE.replace(/\D/g, '') + '@s.whatsapp.net';

// Guardas de tiempo para NO reprocesar historial
const START_EPOCH = Math.floor(Date.now() / 1000);     // timestamp en segundos del arranque
const HISTORY_GRACE_SEC = 30;                          // margen de seguridad para desfases

// Estado en memoria por usuario
const users = new Map(); // { stage, nombre, lastMsg, reminderSent, paid, firstSeenAt }

// Métricas rápidas
let events = []; // { t: ms, type: 'contact'|'paid'|'reminder' }
function addEvent(type) { events.push({ t: Date.now(), type }); }
function countSince(msAgo, type) {
  const cutoff = Date.now() - msAgo;
  return events.filter(e => e.type === type && e.t >= cutoff).length;
}

// Próximo lunes (formato “22 de septiembre”)
function nextMondayDate() {
  const now = new Date();
  const day = now.getDay();
  const daysToMon = (8 - day) % 7 || 7;
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysToMon);
  return d.toLocaleDateString('es-BO', { day: 'numeric', month: 'long' });
}

// Extraer texto
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

// ¿Nombre y apellido?
function isFullName(s) {
  if (!/^[\p{L} .'\-]+$/u.test(s)) return false;
  const parts = s.trim().split(/\s+/);
  return parts.length >= 2;
}

// Enviar QR (como imagen si existe qr.jpg; si no, link)
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
  if (customerJid === OWNER_JID) return;
  const human = customerJid.replace('@s.whatsapp.net', '');
  const text = `*${title}*\nDe: ${human}\n${body ? body + '\n' : ''}`;
  try { await sock.sendMessage(OWNER_JID, { text }); } catch {}
}

// Lógica por mensaje
async function handleMessage(sock, m) {
  const from = m.key?.remoteJid || '';
  if (!from || from.endsWith('@g.us')) return;   // ignora grupos
  if (from === OWNER_JID) return;                // ignora tus envíos

  // 1) Evitar reprocesar historial (lo que existía antes de arrancar)
  const ts = Number(m.messageTimestamp || 0); // segundos
  if (ts && ts < START_EPOCH - HISTORY_GRACE_SEC) return;

  // 2) Bloquear números fuera de +591 (avisar a ti y salir)
  const num = from.replace('@s.whatsapp.net', '');
  if (!num.startsWith(COUNTRY_PREFIX)) {
    await notifyOwner(sock, from, 'Contacto fuera de país', 'No se respondió (bloqueado por prefijo).');
    return;
  }

  const textRaw = extractText(m);
  const text = textRaw.replace(/\s+/g, ' ');
  const lowered = text.toLowerCase();

  // 3) Tomar/crear estado SOLO cuando entra el primer mensaje (nuevo contacto)
  let st = users.get(from);
  if (!st) {
    st = { stage: 'start', nombre: '', lastMsg: 0, reminderSent: false, paid: false, firstSeenAt: Date.now() };
    users.set(from, st);
    addEvent('contact');
  }
  st.lastMsg = Date.now();
  users.set(from, st);

  const said = (re) => re.test(lowered);

  // Comandos útiles (solo si los escriben)
  if (said(/^ping$/i)) {
    await sock.sendMessage(from, { text: '¡Estoy vivo! 🤖' });
    return;
  }
  if (said(/^reset$/i)) {
    users.delete(from);
    await sock.sendMessage(from, { text: '🔄 Reiniciado. Escribe "hola" para comenzar.' });
    return;
  }

  // 4) Flujo de bienvenida
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

Si deseas inscribirte, por favor respóndeme tu *nombre completo (nombre y apellido)* ✅`;
    await sock.sendMessage(from, { text: bienvenida });
    st.stage = 'askedName';
    users.set(from, st);
    return;
  }

  // 5) Nombre completo
  if (st.stage === 'askedName') {
    if (isFullName(text)) {
      st.nombre = text.replace(/[^\p{L}\s'.-]/gu, '').trim();
      const fecha = nextMondayDate();
      await sock.sendMessage(from, { text: `Buen día, ${st.nombre}. El reto de 21 días inicia el próximo lunes ${fecha}. El valor del programa es 35 Bs.` });
      await sock.sendMessage(from, { text: 'Si te inscribes hoy, recibes de regalo el curso de 12 días: "Aprende a meditar desde cero".' });
      await sendQR(sock, from);

      st.stage = 'quoted';
      st.reminderSent = false;
      users.set(from, st);

      // 1 solo recordatorio si no responde
      setTimeout(async () => {
        const u = users.get(from);
        if (!u) return;
        if (!u.reminderSent && !u.paid && Date.now() - u.lastMsg >= REMINDER_MINUTES * 60 * 1000) {
          await sock.sendMessage(from, { text: `Hola ${u.nombre || 'amigo'}, ¿sigues interesado en el reto? 😊` });
          u.reminderSent = true;
          users.set(from, u);
          addEvent('reminder');
        }
      }, REMINDER_MINUTES * 60 * 1000);
      return;
    } else {
      await sock.sendMessage(from, { text: '🙏 Por favor envíame tu *nombre completo* (nombre y apellido).' });
      return;
    }
  }

  // 6) Pago / comprobante
  const hasImage = !!m.message?.imageMessage;
  if (hasImage || said(/pagu[eé]|comprobante|transferencia|pago/)) {
    await sock.sendMessage(from, {
      text:
        '🌟 ¡Bienvenido al Reto de 21 Días de Gratitud y Abundancia! 🌟\n\n' +
        `🔗 Grupo: ${LINK_GRUPO}\n` +
        `🎁 Bono:  ${LINK_BONO}`
    });
    st.paid = true;
    st.stage = 'enrolled';
    users.set(from, st);
    addEvent('paid');

    await notifyOwner(sock, from, 'Pago/Comprobante recibido', '(Imagen o texto de pago detectado)');
    return;
  }

  // 7) Duda / fuera de flujo → te avisa, no responde al cliente
  await notifyOwner(sock, from, 'Duda detectada', `Mensaje: "${text}"`);
}

// ---------- Reportes ----------
function scheduleHourlyReport(sock) {
  setInterval(async () => {
    // Ventana: última hora
    const hourMs = 60 * 60 * 1000;
    const contact = countSince(hourMs, 'contact');
    const paid    = countSince(hourMs, 'paid');

    // “dejaron en visto”: usuarios que recibieron QR (stage>=quoted), no pagaron y llevan +REMINDER_MINUTES sin responder
    const ignored = [...users.values()].filter(u =>
      (u.stage === 'quoted' || u.stage === 'askedName') &&
      !u.paid &&
      (Date.now() - u.lastMsg >= REMINDER_MINUTES * 60 * 1000)
    ).length;

    const txt =
`📊 *Reporte último ${REPORT_EVERY_MIN} min*
- Contactaron: ${contact}
- Pagaron: ${paid}
- Sin respuesta: ${ignored}`;
    try { await sock.sendMessage(OWNER_JID, { text: txt }); } catch {}
  }, REPORT_EVERY_MIN * 60 * 1000);
}

function scheduleDailyReport(sock) {
  const now = new Date();
  const next = new Date(now);
  next.setHours(22, 0, 0, 0); // 22:00
  if (next <= now) next.setDate(next.getDate() + 1);
  const delay = next - now;

  setTimeout(function runDaily() {
    // Conteo simple del día
    const today = new Date();
    today.setHours(0,0,0,0);
    const sinceMs = Date.now() - today.getTime();

    const contact = countSince(sinceMs, 'contact');
    const paid    = countSince(sinceMs, 'paid');
    const ignored = [...users.values()].filter(u =>
      (u.stage === 'quoted' || u.stage === 'askedName') &&
      !u.paid &&
      (Date.now() - u.lastMsg >= REMINDER_MINUTES * 60 * 1000)
    ).length;

    const txt =
`🗓️ *Reporte diario*
- Contactaron hoy: ${contact}
- Pagaron hoy: ${paid}
- Sin respuesta: ${ignored}`;
    sock.sendMessage(OWNER_JID, { text: txt }).catch(()=>{});

    // re-programar cada 24h
    setTimeout(runDaily, 24 * 60 * 60 * 1000);
  }, delay);
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
      scheduleHourlyReport(sock);
      scheduleDailyReport(sock);
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
    try {
      await handleMessage(sock, m);
    } catch (e) {
      console.error('Error al responder:', e?.message);
    }
  });
}

start().catch(err => console.error('Error general:', err));
