// src/handlers.js
const {
  COUNTRY_PREFIXES,
  REMINDER_WELCOME_MIN,
  REMINDER_QR_MIN,
  OWNER_PHONE,
} = require("./config");
const {
  extractText,
  isFullName,
  nextMondayDate,
  sendQR,
  notifyOwner,
  ownerJidFrom,
} = require("./utils");
const {
  START_EPOCH,
  HISTORY_GRACE_SEC,
  getUser,
  upsertUser,
} = require("./state");
const { buildMensajePago, buildBienvenida } = require("./messages");

const OWNER_JID = ownerJidFrom(OWNER_PHONE);

function isAllowedCountry(num) {
  return COUNTRY_PREFIXES.some((p) => num.startsWith(p));
}

async function onMessage(sock, m) {
  const from = m.key?.remoteJid || "";
  if (!from || from.endsWith("@g.us")) return; // ignora grupos
  if (m.key.fromMe) return; // ignora mis propios mensajes

  const ts = Number(m.messageTimestamp || 0);
  if (ts && ts < START_EPOCH - HISTORY_GRACE_SEC) return; // ignora historial viejo

  const num = from.replace("@s.whatsapp.net", "");
  if (!isAllowedCountry(num)) {
    await notifyOwner(
      sock,
      OWNER_JID,
      from,
      "Contacto fuera de país",
      "No se respondió (bloqueado por prefijo)."
    );
    return;
  }

  // Siempre garantizamos estado del usuario
  let st = getUser(from) || upsertUser(from, {});
  st = upsertUser(from, { lastMsg: Date.now() });

  // Texto (si lo hay)
  const textRaw = extractText(m);
  const text = (textRaw || "").trim();
  const lowered = text.toLowerCase();

  // ---- Detectores de pago/comprobante ----
  const hasImage = !!m.message?.imageMessage;
  const hasDoc = !!m.message?.documentMessage;
  const isPdf = (m.message?.documentMessage?.mimetype || "").includes("pdf");
  const saidPayment = /\b(pagu[eé]|pague|pago|comprobante|transferencia)\b/.test(
    lowered
  );

  // ✅ RESPUESTA POST-PAGO: imagen, PDF o texto que indique pago
  if (hasImage || hasDoc || isPdf || saidPayment) {
    await sock.sendMessage(from, { text: buildMensajePago() });

    upsertUser(from, { paid: true, stage: "enrolled" });

    await notifyOwner(
      sock,
      OWNER_JID,
      from,
      "Pago/Comprobante recibido",
      "(Imagen, PDF o texto de pago detectado)"
    );
    return;
  }

  // ---- Comandos y flujo general ----
  const said = (re) => re.test(lowered);

  // ping
  if (said(/^ping$/i)) {
    await sock.sendMessage(from, { text: "¡Estoy vivo! 🤖" });
    return;
  }

  // saludo o inicio
  if (said(/\b(hola|buen dia|buen día|buenas)\b/i) || st.stage === "start") {
    const fecha = nextMondayDate();
    await sock.sendMessage(from, { text: buildBienvenida(fecha) });

    upsertUser(from, { stage: "askedName", welcomeReminderSent: false });

    // Recordatorio si no responde con nombre
    setTimeout(async () => {
      const u = getUser(from);
      if (!u) return;
      const noRespuesta =
        Date.now() - u.lastMsg >= REMINDER_WELCOME_MIN * 60 * 1000;
      if (u.stage === "askedName" && !u.welcomeReminderSent && !u.paid && noRespuesta) {
        await sock.sendMessage(from, {
          text:
            "¿Aún tienes interés en el reto? Envíame tu *nombre completo* por favor para anotarte 🙌",
        });
        upsertUser(from, { welcomeReminderSent: true });
      }
    }, REMINDER_WELCOME_MIN * 60 * 1000);

    return;
  }

  // nombre completo
  if (st.stage === "askedName") {
    if (!isFullName(text)) {
      await sock.sendMessage(from, {
        text:
          "🙏 Para continuar, envíame tu *nombre completo* (nombre y apellido).",
      });
      return;
    }

    const nombre = text.replace(/[^\p{L}\s'.-]/gu, "").trim();
    const fecha = nextMondayDate();

    await sock.sendMessage(from, {
      text: `Buen día, ${nombre}. El reto de 21 días inicia el próximo lunes ${fecha}. El valor del programa es 35 Bs.`,
    });
    await sock.sendMessage(from, {
      text:
        'Si te inscribes hoy, recibes de regalo el curso de 12 días: "Aprende a meditar desde cero".',
    });
    await sendQR(sock, from);

    upsertUser(from, { stage: "quoted", qrReminderSent: false, nombre });

    // Recordatorio de pago tras enviar QR
    setTimeout(async () => {
      const u = getUser(from);
      if (!u) return;
      const noRespuesta =
        Date.now() - u.lastMsg >= REMINDER_QR_MIN * 60 * 1000;
      if ((u.stage === "quoted" || u.stage === "askedName") && !u.qrReminderSent && !u.paid && noRespuesta) {
        await sock.sendMessage(from, {
          text:
            "Hola, ¿me confirmas el pago para enviarte el *curso de 12 días* y el *acceso al reto*? 🙌",
        });
        upsertUser(from, { qrReminderSent: true });
      }
    }, REMINDER_QR_MIN * 60 * 1000);

    return;
  }

  // fallback → avisa al dueño para dar soporte
  if (text) {
    await notifyOwner(
      sock,
      OWNER_JID,
      from,
      "Duda detectada",
      `Mensaje: "${text}"`
    );
  }
}

module.exports = { onMessage };
