// src/bootstrap.js (versión debug: muestra QR ASCII + LINK y logea el motivo del cierre)
const path = require("path");
const fs = require("fs");
const pino = require("pino");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");

const { onMessage } = require("./handlers");

async function connectToWhatsApp() {
  const AUTH_DIR = path.join(__dirname, "..", "auth");

  // crea carpeta si no existe (a veces el borrado previo deja la ruta sin crear)
  if (!fs.existsSync(AUTH_DIR)) {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
  }

  // Forzar reset si seteas la variable en Railway
  if (process.env.RESET_AUTH === "1" || process.env.RESET_AUTH === "true") {
    try {
      fs.rmSync(AUTH_DIR, { recursive: true, force: true });
      fs.mkdirSync(AUTH_DIR, { recursive: true });
      console.log("🧹 Auth borrado. Se generará un nuevo QR.");
    } catch (e) {
      console.log("No se pudo borrar auth:", e?.message);
    }
  }

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: "info" }),
    // Mostramos ambos: ASCII en logs y link “clickeable”
    printQRInTerminal: true
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { qr, connection, lastDisconnect } = update;

    // QR como LINK (además del ASCII que imprime Baileys)
    if (qr) {
      const url =
        "https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=" +
        encodeURIComponent(qr);
      console.log("🔗 QR directo (clic y escanear):", url);
    }

    if (connection === "open") {
      console.log("✅ Conectado a WhatsApp. Escuchando mensajes…");
    }

    if (connection === "close") {
      // Log detallado del motivo
      const err = lastDisconnect?.error;
      const msg = err?.message || err?.toString?.() || "desconocido";
      const code =
        err?.output?.statusCode || err?.statusCode || err?.code || "s/código";

      console.log("❌ Conexión cerrada. Motivo:", msg, "| Código:", code);

      // Si es sesión inválida, borra auth para forzar nuevo QR
      const isAuthIssue =
        String(code) === "401" ||
        /logged out|bad session|restart required|invalid/i.test(msg);

      if (isAuthIssue) {
        try {
          fs.rmSync(AUTH_DIR, { recursive: true, force: true });
          fs.mkdirSync(AUTH_DIR, { recursive: true });
          console.log("🔐 Sesión inválida. Auth borrado → se pedirá QR de nuevo.");
        } catch (e) {
          console.log("Error borrando auth tras logout:", e?.message);
        }
      }

      setTimeout(() => {
        console.log("🔁 Reintentando conexión…");
        connectToWhatsApp().catch((e) =>
          console.error("Reinicio falló:", e?.message)
        );
      }, 1500);
    }
  });

  sock.ev.on("messages.upsert", async ({ type, messages }) => {
    if (type !== "notify") return;
    for (const m of messages) {
      try {
        await onMessage(sock, m);
      } catch (e) {
        console.error("Error al responder:", e?.message);
      }
    }
  });

  return sock;
}

module.exports = { connectToWhatsApp };

