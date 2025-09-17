const fs = require("fs");
const path = require("path");
const pino = require("pino");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
} = require("@whiskeysockets/baileys");
const { onMessage } = require("./handlers");

// ⚠️ Para replicar EXACTO tu index viejo, usamos ./auth relativo al cwd
const AUTH_DIR = path.resolve(process.cwd(), "auth");
let lastQR = "";

async function connectToWhatsApp() {
  // Si pones RESET_AUTH=1 en Variables de Railway, fuerza QR nuevo
  if (process.env.RESET_AUTH === "1" || process.env.RESET_AUTH === "true") {
    try {
      fs.rmSync(AUTH_DIR, { recursive: true, force: true });
      console.log("🧹 Auth borrado. Se generará un nuevo QR.");
    } catch (e) {
      console.log("No se pudo borrar auth:", e?.message);
    }
  }
  if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: "silent" }),
    printQRInTerminal: false, // como tu index viejo
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { qr, connection } = update;

    // Igual que antes, pero QR más grande y sin caché
    if (qr && qr !== lastQR) {
      lastQR = qr;
      const url =
        "https://api.qrserver.com/v1/create-qr-code/?size=512x512&margin=1&data=" +
        encodeURIComponent(qr) +
        "&t=" +
        Date.now();
      console.log("🔗 QR directo (clic y escanear):", url);
    }

    if (connection === "open") {
      console.log("✅ Conectado a WhatsApp. Escuchando mensajes...");
    }

    if (connection === "close") {
      console.log("❌ Conexión cerrada. Reintentando...");
      setTimeout(() => {
        connectToWhatsApp().catch((err) =>
          console.error("Reinicio falló:", err?.message)
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
