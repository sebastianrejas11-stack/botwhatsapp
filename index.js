// Bot WhatsApp sin navegador (Baileys) + QR como LINK en logs (Railway-friendly)

const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal'); // opcional, también lo dejamos
const pino = require('pino');
const fs = require('fs');
const path = require('path');

// ====== EDITA TUS LINKS ======
const LINK_GRUPO = 'https://chat.whatsapp.com/FahDpskFeuf7rqUVz7lgYr?mode=ems_copy_t';
const LINK_BONO  = 'https://www.youtube.com/watch?v=XkjFZY30vHc&list=PLnT-PzQPCplvsx4c-vAvLyk5frp_nHTGx&index=1';
const LINK_PAGO  = 'https://tu-link-de-pago'; // fallback si no hay imagen
const REMINDER_MINUTES = 10;
// =============================

// Memoria simple por contacto (RAM del server)
const statePerUser = new Map();

// Próximo lunes (“22 de septiembre”)
function nextMondayDate() {
  const now = new Date();
  const day = now.getDay(); // 0=Dom,1=Lun,...
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

// Enviar imagen (qr.jpg en la misma carpeta)
async function sendQR(sock, to) {
  try {
    const file = path.join(__dirname, 'qr.jpg');
    const buffer = fs.readFileSync(file);
    await sock.sendMessage(to, { image: buffer, caption: 'Escanea este QR para inscribirte ✅' });
  } catch (e) {
    console.error('Error enviando QR:', e?.message);
    await sock.sendMessage(to, { text: `No pude adjuntar el QR ahora. Aquí tienes el enlace de pago: ${LINK_PAGO}` });
  }
}

// Lógica del bot (intents básicos)
async function handleMessage(sock, m) {
  const from = m.key?.remoteJid || '';
  if (!from || from.endsWith('@g.us')) return; // Ignora grupos
  const textRaw = extractText(m);
  if (!textRaw) return;

  const text = textRaw.replace(/\s+/g, ' ');
  const lowered = text.toLowerCase();

  let st = statePerUser.get(from) || { stage: 'start', nombre: '', lastMsg: 0 };
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

  // 2) NOMBRE (2+ palabras y no suena a pago)
  const looksLikeName = text.split(' ').length >= 2 && !said(/pagu[eé]|comprobante|transferencia|pago/);
  if (st.stage === 'askedName' || looksLikeName) {
    if (looksLikeName) {
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
      await sock.sendMessage(from, { text: '¿Podrías escribirme tu *nombre completo* para continuar? 🙌' });
      return;
    }
  }

  // 3) PAGO (o si envía imagen/recibo)
  const hasImage = !!m.message?.imageMessage;
  if (hasImage || said(/pagu[eé]|comprobante|transferencia|pago/)) {
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

  // 4) Fallback
  if (st.stage === 'start') {
    await sock.sendMessage(from, { text: '¡Hola! 🙌 Escribe *hola* para comenzar.' });
  } else if (st.stage === 'askedName') {
    await sock.sendMessage(from, { text: 'Gracias 🙌 ¿Podrías confirmarme tu *nombre completo*?' });
  } else {
    await sock.sendMessage(from, { text: '¿Te ayudo con algo más?' });
  }
}

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false // mostramos link en vez de QR ASCII
  });

  sock.ev.on('connection.update', (update) => {
    const { qr, connection } = update;

    if (qr) {
      // 1) ASCII por si quieres (no necesario)
      // qrcode.generate(qr, { small: true });

      // 2) MOSTRAR LINK DIRECTO A PNG (lo importante)
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
