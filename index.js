// Bot WhatsApp (Baileys) — sin Chromium/Puppeteer
// - QR como link clickeable en logs
// - Sesión en ./auth (monta Volume en /app/auth si quieres evitar re-escaneo)
// - Reglas: dudas -> avisa al dueño; pagó -> confirma; recordatorio único; reportes 60min y diario 22:00

const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

// =================== CONFIG FIJA (sin variables de entorno) ===================
const OWNER_PHONE = '59177441414'; // Tu número (solo dígitos con código país)
const OWNER_JID = OWNER_PHONE.replace(/\D/g, '') + '@s.whatsapp.net';

const LINK_GRUPO = 'https://chat.whatsapp.com/FahDpskFeuf7rqUVz7lgYr?mode=ems_copy_t';
const LINK_BONO  = 'https://www.youtube.com/watch?v=XkjFZY30vHc&list=PLnT-PzQPCplvsx4c-vAvLyk5frp_nHTGx&index=1';
const LINK_PAGO  = 'https://tu-link-de-pago'; // fallback si no hay imagen qr.jpg

const PRECIO_BS = '35 Bs';
const REMINDER_MIN = 5; // recordatorio único si no responde en 5 min
const TZ = 'America/La_Paz';
// ============================================================================

// Estado por usuario
const users = new Map();        // from => { stage, nombre, lastMsg, reminderSent, paid }
const reminderTimers = new Map(); // from => timeoutId

// Eventos para métricas
const events = []; // { ts, from, type: 'incoming'|'paid'|'reminder' }
let lastDailyDate = ''; // YYYY-MM-DD para no repetir reporte diario

// Utilidades de tiempo
const now = () => Date.now();
const todayTZ = () => {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: TZ }));
  const y = d.getFullYear(), m = (d.getMonth()+1+'').padStart(2,'0'), dd = (d.getDate()+'').padStart(2,'0');
  return `${y}-${m}-${dd}`;
};
const hourTZ = () => new Date(new Date().toLocaleString('en-US', { timeZone: TZ })).getHours();

// Próximo lunes (“22 de septiembre”)
function nextMondayDate() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: TZ }));
  const add = (1 - d.getDay() + 7) % 7 || 7;
  d.setDate(d.getDate() + add);
  return d.toLocaleDateString('es-BO', { day: 'numeric', month: 'long' });
}

// Extraer texto de cualquier mensaje
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

// Métricas
function pushEvent(type, from) { events.push({ ts: now(), from, type }); }
function computeWindowStats(ms) {
  const cut = now() - ms;
  const list = events.filter(e => e.ts >= cut);
  const talkers = new Set(list.filter(e => e.type === 'incoming').map(e => e.from)).size;
  const paid = list.filter(e => e.type === 'paid').length;
  const leftOnSeen = list.filter(e => e.type === 'reminder').length;
  return { talkers, paid, leftOnSeen };
}
function computeDailyStats(dateStr) {
  const start = new Date(new Date().toLocaleString('en-US', { timeZone: TZ }));
  const [y,m,d] = dateStr.split('-').map(Number);
  start.setFullYear(y); start.setMonth(m-1); start.setDate(d); start.setHours(0,0,0,0);
  const end = new Date(start); end.setDate(start.getDate()+1);
  const dayEvents = events.filter(e => e.ts >= start.getTime() && e.ts < end.getTime());
  const talkers = new Set(dayEvents.filter(e => e.type === 'incoming').map(e => e.from)).size;
  const paid = dayEvents.filter(e => e.type === 'paid').length;
  const leftOnSeen = dayEvents.filter(e => e.type === 'reminder').length;
  return { talkers, paid, leftOnSeen };
}

// Mensajes
function bienvenida(fechaTexto) {
  return (
`Hola 🌟 ¡Gracias por tu interés en el *Reto de 21 Días de Gratitud y Abundancia*! 🙏✨

Este hermoso reto se realizará por WhatsApp y empieza el próximo lunes ${fechaTexto} 🗓️

📌 Incluye:
✔️ Reflexión + ejercicio diario
✔️ Videos explicativos
✔️ Libro digital al finalizar

💛 Este es un bonito regalo para ti, date la oportunidad.

Las clases se envían vía WhatsApp por la mañana y puedes verlas cuando gustes.

Si deseas inscribirte, por favor responde con tu *nombre completo* y te paso los pasos para unirte ✅`);
}

function textoPago(nombre='amigo/a') {
  return (
`Buen día, ${nombre}. El reto tiene un valor de *${PRECIO_BS}*.

Si te inscribes hoy, recibes de *regalo* el curso de 12 días: "Aprende a meditar desde cero".

Puedes pagar escaneando el *QR* que te envío o directamente aquí:
${LINK_PAGO}`);
}

// Recordatorio único por inactividad
function programReminder(sock, from) {
  if (reminderTimers.has(from)) return;
  const st = users.get(from) || {};
  if (st.paid) return;

  const tId = setTimeout(async () => {
    const u = users.get(from) || {};
    if (u.paid) return;
    // Si volvió a escribir antes del timeout, no enviar
    if (now() - (u.lastMsg || 0) < REMINDER_MIN * 60 * 1000) return;
    if (u.reminderSent) return;

    u.reminderSent = true;
    users.set(from, u);
    try {
      await sock.sendMessage(from, { text: '¿Aún tienes interés en el *Reto de 21 días* y el *regalo del Taller de Meditación*? 🙌' });
      pushEvent('reminder', from);
    } catch {}
  }, REMINDER_MIN * 60 * 1000);

  reminderTimers.set(from, tId);
}
function clearReminder(from) {
  const t = reminderTimers.get(from);
  if (t) clearTimeout(t);
  reminderTimers.delete(from);
}

// Notificar al dueño
async function notifyOwner(sock, title, from, nombre, text) {
  const who = from.replace('@s.whatsapp.net', '');
  const name = nombre ? ` (${nombre})` : '';
  const body = `*${title}*\n• De: ${who}${name}\n• Mensaje: "${text}"`;
  try { await sock.sendMessage(OWNER_JID, { text: body }); } catch {}
}

// Enviar QR de pago (archivo local qr.jpg si existe, si no, link)
async function sendPaymentQR(sock, to) {
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

// Detección de pago/comprobante
function detectPaid(m, lowered) {
  const hasImage = !!m.message?.imageMessage;
  const hasDoc = !!m.message?.documentMessage;
  const isPdf = (m.message?.documentMessage?.mimetype || '').includes('pdf');
  const textPaid = /\b(pagu[eé]|pague|pago|comprobante|transferencia)\b/.test(lowered);
  return textPaid || hasImage || (hasDoc && isPdf);
}

// ------------------------- LÓGICA PRINCIPAL -------------------------
async function handleMessage(sock, m) {
  const from = m.key?.remoteJid || '';
  if (!from || from.endsWith('@g.us')) return; // ignorar grupos

  const textRaw = extractText(m);
  const text = textRaw.replace(/\s+/g, ' ').trim();
  const lowered = text.toLowerCase();
  const pushName = m.pushName || '';

  let st = users.get(from) || { stage: 'start', nombre: '', lastMsg: 0, reminderSent: false, paid: false };
  st.lastMsg = now();
  users.set(from, st);
  pushEvent('incoming', from);
  clearReminder(from);

  // 1) Pago / comprobante
  if (detectPaid(m, lowered)) {
    st.paid = true; users.set(from, st);
    await sock.sendMessage(OWNER_JID, { text: `✅ *CONFIRMA EL PAGO DE:* ${st.nombre ? `${st.nombre} (${from})` : from}` });
    await sock.sendMessage(from, { text:
      '🌟 ¡Bienvenido! Tu registro será verificado en breve.\n\n' +
      `🔗 Grupo: ${LINK_GRUPO}\n` +
      `🎁 Bono:  ${LINK_BONO}`
    });
    pushEvent('paid', from);
    return;
  }

  // 2) Duda explícita → avisarte (sin responder al cliente)
  if (/\b(ayuda|agente|humano|asesor|no entiendo|me explicas)\b/.test(lowered)) {
    await notifyOwner(sock, '🤖 Duda detectada', from, st.nombre, textRaw);
    return; // silencio al cliente
  }

  // 3) Saludo
  if (/\b(hola|buenas|buen d[ií]a|buen dia)\b/.test(lowered) || st.stage === 'start') {
    st.stage = 'askedName'; st.reminderSent = false; users.set(from, st);
    await sock.sendMessage(from, { text: bienvenida(nextMondayDate()) });
    programReminder(sock, from);
    return;
  }

  // 4) Nombre si estamos esperando nombre (2+ palabras, sin dígitos)
  if (st.stage === 'askedName') {
    const looksLikeName = /\s/.test(text) && text.length >= 5 && !/\d/.test(text) && !/\b(pago|pagu[eé]|comprobante|transferencia)\b/.test(lowered);
    if (looksLikeName) {
      st.nombre = text.replace(/[^\p{L}\s'.-]/gu, '').trim();
      st.stage = 'quoted'; st.reminderSent = false; users.set(from, st);

      await sock.sendMessage(from, { text: `Buen día, ${st.nombre}. El reto de 21 días inicia el próximo lunes ${nextMondayDate()}. El valor del programa es ${PRECIO_BS}.` });
      await sock.sendMessage(from, { text: 'Si te inscribes hoy, recibes de regalo el curso de 12 días: "Aprende a meditar desde cero".' });
      await sendPaymentQR(sock, from);
      programReminder(sock, from);
      return;
    } else {
      // aún no parece nombre → no respondemos o pedimos de forma amable
      await sock.sendMessage(from, { text: '¿Podrías enviarme tu *nombre completo* para continuar? 🙌' });
      programReminder(sock, from);
      return;
    }
  }

  // 5) Fallback: no entendido → avisa al dueño y mensaje mínimo al cliente según etapa
  await notifyOwner(sock, '🤖 Consulta no entendida', from, st.nombre, textRaw);
  if (st.stage === 'start') {
    await sock.sendMessage(from, { text: '¡Hola! 🙌 Escribe *hola* para comenzar.' });
  } else if (st.stage === 'askedName') {
    await sock.sendMessage(from, { text: 'Gracias 🙌 ¿Me confirmas tu *nombre completo*?' });
    programReminder(sock, from);
  } else {
    await sock.sendMessage(from, { text: '¿Te ayudo con algo más?' });
  }
}

// ------------------------- ARRANQUE BAILEYS -------------------------
async function start() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false
  });

  // Mostrar QR como LINK clickeable en logs
  sock.ev.on('connection.update', (u) => {
    const { qr, connection } = u;
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

  // Mensajes entrantes
  sock.ev.on('messages.upsert', async ({ type, messages }) => {
    if (type !== 'notify') return;
    const m = messages && messages[0];
    try { await handleMessage(sock, m); }
    catch (e) { console.error('Error al responder:', e?.message); }
  });

  // Reporte cada 60 minutos
  setInterval(async () => {
    const { talkers, paid, leftOnSeen } = computeWindowStats(60*60*1000);
    const msg =
`🕑 *Reporte últimos 60 min*
• Personas que hablaron: *${talkers}*
• Confirmados (pago): *${paid}*
• Dejaron en visto (recordatorio enviado): *${leftOnSeen}*`;
    try { await sock.sendMessage(OWNER_JID, { text: msg }); } catch {}
  }, 60 * 60 * 1000);

  // Reporte diario 22:00
  setInterval(async () => {
    const h = hourTZ(), t = todayTZ();
    if (h === 22 && lastDailyDate !== t) {
      const { talkers, paid, leftOnSeen } = computeDailyStats(t);
      const msg =
`📊 *Reporte del día (${t})*
• Total que hablaron: *${talkers}*
• Confirmados (pago): *${paid}*
• Dejaron en visto: *${leftOnSeen}*`;
      try { await sock.sendMessage(OWNER_JID, { text: msg }); } catch {}
      lastDailyDate = t;
    }
  }, 60 * 1000);
}

start().catch(err => console.error('Error general:', err?.message));
