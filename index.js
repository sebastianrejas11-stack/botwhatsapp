/**
 * WhatsApp bot – capa 0 con alertas al dueño, recordatorios,
 * reportes cada 60 min y reporte diario 22:00 (America/La_Paz).
 * Pensado para Railway (QR como link clickeable en logs).
 */

const wppconnect = require('@wppconnect-team/wppconnect');
const fs = require('fs');
const path = require('path');

// ========= CONFIG NEGOCIO (ajusta en Variables de Railway, o aquí como fallback)
const OWNER_NUMBER = (process.env.OWNER_NUMBER || '59177441414@c.us').trim();   // <- TU CEL
const NEGOCIO      = process.env.NEGOCIO      || 'Reto de 21 Días de Gratitud y Abundancia';
const PRECIO       = process.env.PRECIO       || '35 Bs';
const LINK_GRUPO   = process.env.LINK_GRUPO   || 'https://chat.whatsapp.com/tu-grupo';
const LINK_BONO    = process.env.LINK_BONO    || 'https://tu-bono';
const LINK_PAGO    = process.env.LINK_PAGO    || 'https://tu-link-de-pago';
const REMINDER_MIN = Number(process.env.REMINDER_MIN || '5');          // minutos
const TZ           = 'America/La_Paz'; // Para reportes diarios 22:00

// ====== util: QR clickeable para Railway (evita los “cuadritos”)
function qrClickableLink(qrBase64) {
  const urlData = 'data:image/png;base64,' + qrBase64.replace(/^data:.*base64,/, '');
  const encoded = encodeURIComponent(urlData);
  return `https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encoded}`;
}

// ====== Estado en memoria
const users = new Map(); // from => { stage, nombre, lastMsg, reminderSent, paid }
const timers = new Map(); // from => timeoutId para recordatorio

// Para métricas (rolling 60 min + diario)
const events = []; // { ts, from, type: 'incoming'|'paid'|'reminder' }
let lastHourlySent = 0;
let lastDailyDate = ''; // 'YYYY-MM-DD' cuando ya se envió a las 22:00

function now() { return Date.now(); }
function pushEvent(type, from) { events.push({ ts: now(), from, type }); }

function inLastMs(ms) {
  const cut = now() - ms;
  return events.filter(e => e.ts >= cut);
}

function computeWindowStats(ms) {
  const list = inLastMs(ms);
  const uniqueTalkers = new Set(list.filter(e => e.type === 'incoming').map(e => e.from)).size;
  const paid = list.filter(e => e.type === 'paid').length;
  const reminders = list.filter(e => e.type === 'reminder').length;
  return { talkers: uniqueTalkers, paid, leftOnSeen: reminders };
}

function computeDailyStats(dateStr) {
  // dateStr en TZ 'America/La_Paz'
  const start = new Date(new Date().toLocaleString('en-US', { timeZone: TZ }));
  const [y, m, d] = dateStr.split('-').map(n => parseInt(n, 10));
  start.setFullYear(y); start.setMonth(m-1); start.setDate(d);
  start.setHours(0,0,0,0);
  const end = new Date(start); end.setDate(start.getDate()+1);

  const startMs = start.getTime();
  const endMs   = end.getTime();

  const dayEvents = events.filter(e => e.ts >= startMs && e.ts < endMs);
  const talkers = new Set(dayEvents.filter(e => e.type === 'incoming').map(e => e.from)).size;
  const paid = dayEvents.filter(e => e.type === 'paid').length;
  const leftOnSeen = dayEvents.filter(e => e.type === 'reminder').length;
  return { talkers, paid, leftOnSeen };
}

function todayTZ() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: TZ }));
  const y = d.getFullYear(), m = (d.getMonth()+1).toString().padStart(2,'0'), dd = d.getDate().toString().padStart(2,'0');
  return `${y}-${m}-${dd}`;
}

function hourTZ() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: TZ }));
  return d.getHours(); // 0..23
}

// ====== Mensajes
function saludoInicial(fechaTexto) {
  return (
`Hola 🌟 ¡Gracias por tu interés en el *${NEGOCIO}*! 🙏✨

Este hermoso reto se realizará por WhatsApp y empieza este *lunes ${fechaTexto}* 🗓️

📌 Incluye:
✔️ Reflexión + ejercicio diario
✔️ Videos explicativos
✔️ Libro digital al finalizar

💛 Es un bonito regalo para ti, date la oportunidad.

Las clases se envían vía WhatsApp por la mañana y puedes verlas cuando gustes.

Si deseas inscribirte, por favor responde con tu *nombre completo* y te paso los pasos para unirte ✅`
  );
}

function copyPago(nombre='') {
  return (
`Buen día, ${nombre || 'amigo/a'}. El *${NEGOCIO}* tiene un valor de *${PRECIO}*.

Si te inscribes hoy, recibes de *regalo* el curso de 12 días: "Aprende a meditar desde cero".

Puedes pagar escaneando el *QR* que te envío o directamente aquí:
${LINK_PAGO}`
  );
}

// Próximo lunes (en español corto, sin año)
function nextMondayDate() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: TZ }));
  const day = d.getDay(); // 0 dom .. 6 sáb
  const add = (1 - day + 7) % 7 || 7;
  d.setDate(d.getDate() + add);
  return d.toLocaleDateString('es-BO', { day: 'numeric', month: 'long' });
}

// ====== Recordatorios
function programReminder(client, from) {
  // Si ya existe, no duplicar
  if (timers.has(from)) return;

  const st = users.get(from) || {};
  if (st.paid) return; // no recordar si ya pagó

  const tId = setTimeout(async () => {
    const u = users.get(from) || {};
    // si ya respondió luego del timer o pagó, no enviar
    if (u.paid || (now() - (u.lastMsg || 0) < REMINDER_MIN * 60 * 1000)) return;
    if (u.reminderSent) return;

    u.reminderSent = true;
    users.set(from, u);

    try {
      await client.sendText(from, '¿Aún tienes interés en el *Reto de 21 días* y el *regalo del Taller de Meditación*? 🙌');
      pushEvent('reminder', from);
    } catch (e) { /* no-op */ }
  }, REMINDER_MIN * 60 * 1000);

  timers.set(from, tId);
}

function clearReminder(from) {
  const t = timers.get(from);
  if (t) clearTimeout(t);
  timers.delete(from);
}

// ====== Reportes
async function sendHourlyReport(client) {
  const { talkers, paid, leftOnSeen } = computeWindowStats(60*60*1000);
  const msg =
`🕑 *Reporte últimos 60 min*
• Personas que hablaron: *${talkers}*
• Confirmados (pago): *${paid}*
• Dejaron en visto (recuerdo enviado): *${leftOnSeen}*`;

  await client.sendText(OWNER_NUMBER, msg);
}

async function maybeSendDaily22Report(client) {
  const h = hourTZ();
  const today = todayTZ();
  if (h === 22 && lastDailyDate !== today) {
    const { talkers, paid, leftOnSeen } = computeDailyStats(today);
    const msg =
`📊 *Reporte del día (${today})*
• Total que hablaron: *${talkers}*
• Confirmados (pago): *${paid}*
• Dejaron en visto: *${leftOnSeen}*`;

    await client.sendText(OWNER_NUMBER, msg);
    lastDailyDate = today;
  }
}

// ====== Arranque WPP
wppconnect.create({
  session: 'bot-seba',
  headless: true,
  useChrome: true,
  catchQR: (base64 /* , ascii */) => {
    console.log('📲 Abre WhatsApp > Dispositivos vinculados > Vincular dispositivo');
    console.log('🔗 QR directo (haz clic y escanéalo):', qrClickableLink(base64));
  }
})
.then(async (client) => {
  console.log('✅ Servicio iniciado. Esperando mensajes...');

  // Timers de reportes
  setInterval(() => sendHourlyReport(client).catch(()=>{}), 60 * 60 * 1000); // cada 60 min
  setInterval(() => maybeSendDaily22Report(client).catch(()=>{}), 60 * 1000); // chequeo min a min

  // ---- eventos de mensajes
  client.onMessage(async (msg) => {
    try {
      if (msg.isGroupMsg) return;

      const from = msg.from;
      const textRaw = (msg.body || '').trim();
      const lowered = textRaw.toLowerCase();
      const type = (msg.type || '').toLowerCase();
      const isImage = type.includes('image');
      const isDoc   = type.includes('document') || type.includes('ptt') || type.includes('audio');
      const isPdf   = (msg.mimetype||'').includes('pdf');

      // estado
      let st = users.get(from) || { stage: 'start', reminderSent: false, paid: false, nombre: '' };
      st.lastMsg = now();
      users.set(from, st);
      pushEvent('incoming', from);
      clearReminder(from); // reinicia contador al recibir algo

      // INTENTOS
      // 1) PAGO o comprobante
      if (/\bpag(u|o|ué|ue|ué)\b/.test(lowered) || isImage || isPdf || (isDoc && lowered.includes('comprobante'))) {
        st.paid = true; users.set(from, st);

        // avisarte
        const quien = st.nombre ? `${st.nombre} (${from})` : from;
        await client.sendText(OWNER_NUMBER, `✅ *CONFIRMA EL PAGO DE:* ${quien}`);
        pushEvent('paid', from);

        // respuesta al cliente
        await client.sendText(from,
          '🌟 ¡Bienvenido! Tu registro será verificado en breve.\n\n' +
          `🔗 Grupo: ${LINK_GRUPO}\n` +
          `🎁 Bono:  ${LINK_BONO}`
        );
        return;
      }

      // 2) ESCALADA a humano (consulta no entendida expresamente)
      if (/\b(ayuda|agente|humano|asesor|no entiendo|me explicas|me explicas\?)\b/.test(lowered)) {
        const aviso =
`🧩 *Consulta no entendida*
• De: ${from}${st.nombre ? ` (${st.nombre})` : ''}
• Mensaje: "${textRaw}"`;
        await client.sendText(OWNER_NUMBER, aviso);
        // Silencio para el cliente (no responderle aquí)
        return;
      }

      // 3) Saludo
      if (/\b(hola|buenas|buen d[ií]a|buen dia|hola!?)\b/.test(lowered)) {
        st.stage = 'askedName'; st.reminderSent = false; users.set(from, st);
        await client.sendText(from, saludoInicial(nextMondayDate()));
        // programa recordatorio por si no responde con su nombre
        programReminder(client, from);
        return;
      }

      // 4) Nombre (si parece nombre y estamos esperando nombre)
      const looksLikeName = st.stage === 'askedName' && /\s/.test(textRaw) && textRaw.length >= 5 && !/\d/.test(textRaw);
      if (looksLikeName) {
        st.nombre = textRaw.replace(/[^\p{L}\s'.-]/gu, '').trim();
        st.stage = 'quoted'; st.reminderSent = false;
        users.set(from, st);

        await client.sendText(from, copyPago(st.nombre));

        // enviar QR de pago si existe
        const imgPath = path.join(__dirname, 'qr.jpg');
        if (fs.existsSync(imgPath)) {
          try {
            await client.sendImage(from, imgPath, 'qr.jpg', 'Escanea este QR para inscribirte ✅');
          } catch { /* si falla, sigue con link */ }
        }
        programReminder(client, from);
        return;
      }

      // 5) Fallback general: no entendió → te avisa y (opcional) mensaje al cliente
      {
        const aviso =
`🧩 *Consulta no entendida*
• De: ${from}${st.nombre ? ` (${st.nombre})` : ''}
• Mensaje: "${textRaw}"`;
        await client.sendText(OWNER_NUMBER, aviso);

        // Opcional: al cliente, algo neutro y que no rompa flujo
        if (st.stage === 'start') {
          await client.sendText(from, '¡Hola! 🙌 Escribe *hola* para comenzar.');
        } else if (st.stage === 'askedName') {
          await client.sendText(from, 'Gracias 🙌 ¿Podrías enviarme tu *nombre completo*?');
          programReminder(client, from);
        } else {
          // ya en flujo
          await client.sendText(from, '¿Te ayudo con algo más?');
        }
      }
    } catch (err) {
      // No expongas errores al usuario
      console.error('onMessage error:', err?.message);
    }
  });
})
.catch(err => console.error('Error WPP:', err));
