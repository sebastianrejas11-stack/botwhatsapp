const wppconnect = require('@wppconnect-team/wppconnect');
const path = require('path');

// ====== CONFIGURA TUS LINKS ======
const LINK_GRUPO = 'https://chat.whatsapp.com/IWA2ae5podREHVFzoUSvxI?mode=ems_copy_t';
const LINK_BONO  = 'https://www.youtube.com/watch?v=XkjFZY30vHc&list=PLnT-PzQPCplvsx4c-vAvLyk5frp_nHTGx&index=1';
const LINK_PAGO  = 'https://tu-link-de-pago'; // fallback si falla enviar QR
const REMINDER_MINUTES = 10;
// =================================

// Memoria en RAM por contacto
const state = new Map();

// Calcular próximo lunes
function nextMondayDate() {
  const now = new Date();
  const day = now.getDay(); // 0=Dom,1=Lun,...
  const daysToMon = (8 - day) % 7 || 7;
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysToMon);
  return d.toLocaleDateString('es-BO', { day: 'numeric', month: 'long' });
}

// Crear sesión
wppconnect.create({
  session: 'bot-seba',
  headless: true,
  useChrome: false, // obligatorio en Render
  browserArgs: ['--no-sandbox', '--disable-setuid-sandbox'],
  catchQR: (_b64, ascii) => {
    console.log('📲 Escanea este QR en WhatsApp > Dispositivos vinculados:');
    console.log(ascii);
  }
})
.then(client => {
  console.log('✅ Bot conectado. Escuchando mensajes...');

  client.onMessage(async (msg) => {
    try {
      if (msg.isGroupMsg) return;

      const from = msg.from;
      const textRaw = (msg.body || '').trim();
      const text = textRaw.replace(/\s+/g, ' '); // normaliza espacios
      const lowered = text.toLowerCase();
      const isImage = msg?.type === 'image' || msg?.mimetype?.startsWith?.('image/');

      // Estado del usuario
      let st = state.get(from) || { stage: 'start', nombre: '' };
      st.lastMsg = Date.now();
      state.set(from, st);

      // Helpers
      const said = (re) => re.test(lowered);

      // Comandos básicos
      if (said(/^reset$/i)) {
        state.delete(from);
        await client.sendText(from, '🔄 Reiniciado. Escribe "hola" para comenzar.');
        return;
      }
      if (said(/^ping$/i)) {
        await client.sendText(from, '¡Estoy vivo! 🤖');
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
        await client.sendText(from, bienvenida);
        st.stage = 'askedName';
        state.set(from, st);
        return;
      }

      // 2) NOMBRE
      const looksLikeName = text.split(' ').length >= 2 && !said(/pagu[eé]|comprobante|transferencia|pago/);
      if (st.stage === 'askedName' || looksLikeName) {
        if (looksLikeName) {
          st.nombre = text.replace(/[^\p{L}\s'.-]/gu, '').trim();
          const fecha = nextMondayDate();

          await client.sendText(from, `Buen día, ${st.nombre}. El reto de 21 días inicia el próximo lunes ${fecha}. El valor del programa es 35 Bs.`);
          await new Promise(r => setTimeout(r, 700));
          await client.sendText(from, 'Si te inscribes hoy, recibes de regalo el curso de 12 días: "Aprende a meditar desde cero".');

          // Enviar QR
          const imgPath = path.join(__dirname, 'qr.jpg');
          try {
            await client.sendImage(from, imgPath, 'qr.jpg', 'Escanea este QR para inscribirte ✅');
          } catch (e) {
            console.error('Error enviando QR:', e?.message);
            await client.sendText(from, `No pude adjuntar el QR ahora. Aquí tienes el enlace de pago: ${LINK_PAGO}`);
          }

          st.stage = 'quoted';
          state.set(from, st);

          // Recordatorio en X minutos
          setTimeout(async () => {
            const u = state.get(from);
            if (u && Date.now() - u.lastMsg >= REMINDER_MINUTES * 60 * 1000) {
              await client.sendText(from, `Hola ${u.nombre || 'amigo'}, ¿sigues interesado en el reto? 😊`);
            }
          }, REMINDER_MINUTES * 60 * 1000);

          return;
        } else {
          await client.sendText(from, '¿Podrías escribirme tu *nombre completo* para continuar? 🙌');
          return;
        }
      }

      // 3) PAGO
      if (isImage || said(/pagu[eé]|comprobante|transferencia|pago/)) {
        await client.sendText(
          from,
          '🌟 ¡Bienvenido al Reto de 21 Días de Gratitud y Abundancia! 🌟\n\n' +
          `🔗 Grupo: ${LINK_GRUPO}\n` +
          `🎁 Bono:  ${LINK_BONO}`
        );
        st.stage = 'enrolled';
        state.set(from, st);
        return;
      }

      // 4) Fallback
      if (st.stage === 'start') {
        await client.sendText(from, '¡Hola! 🙌 Escribe *hola* para comenzar.');
      } else if (st.stage === 'askedName') {
        await client.sendText(from, 'Gracias 🙌 ¿Podrías confirmarme tu *nombre completo*?');
      } else {
        await client.sendText(from, '¿Te ayudo con algo más?');
      }

    } catch (err) {
      console.error('Error al responder:', err?.message);
    }
  });
})
.catch(err => console.error('Error WPP:', err));