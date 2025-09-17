const fs = require("fs");
const path = require("path");
const pino = require("pino");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
} = require("@whiskeysockets/baileys");
const { onMessage } = require("./handlers");

// 🔸 Si hay volumen montado, usaremos /data; si no, cae a la carpeta del repo
const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd());
const AUTH_DIR = path.join(DATA_DIR, "auth");
let lastQR = "";

async function connectToWhatsApp() {
  // crea carpeta si no existe
  if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

  // reset opcional (solo cuando tú lo pongas en Variables)
  if (process.env.RESET_AUTH === "1" || process.env.RESET_AUTH === "true") {
    fs.rmSync(AUTH_DIR, { recursive: true, force: true });
    fs.mkdirSync(AUTH_DIR, { recursive: true });
    console.log("🧹 Auth borrado. Se generará un nuevo QR.");
  }

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: "silent" }),
    printQRInTerminal: false,
    browser: ["WARSONX Bot", "Railway", "1.0"], // nombre legible en 'Dispositivos vinculados'
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { qr, connection } = update;
    if (qr && qr !== lastQR) {
      lastQR = qr;
      const url = "https://api.qrserver.com/v1/create-qr-code/?size=512x512&margin=1&data="
        + encodeURIComponent(qr) + "&t=" + Date.now();
      console.log("🔗 QR directo (ábrelo y escanéalo de inmediato):", url);
    }
    if (connection === "open") console.log("✅ Conectado a WhatsApp. Escuchando mensajes...");
    if (connection === "close") {
      console.log("❌ Conexión cerrada. Reintentando...");
      setTimeout(() => connectToWhatsApp().catch(e => console.error("Reinicio falló:", e?.message)), 1500);
    }
  });

  sock.ev.on("messages.upsert", async ({ type, messages }) => {
    if (type !== "notify") return;
    for (const m of messages) {
      try { await onMessage(sock, m); } catch (e) { console.error("Error al responder:", e?.message); }
    }
  });

  return sock;
}

module.exports = { connectToWhatsApp };
