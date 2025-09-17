const path = require("path");
const AUTH_DIR = path.join(__dirname, "..", "auth"); // <-- local

const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } =
  require("@whiskeysockets/baileys");

const pino = require("pino");
const { onMessage } = require("./handlers");

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: "silent" }),
    printQRInTerminal: false
  });

  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("connection.update", (u) => {
    const { qr, connection } = u;
    if (qr) {
      const url = "https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=" + encodeURIComponent(qr);
      console.log("🔗 QR directo (clic y escanea):", url);
    }
    if (connection === "open")  console.log("✅ Conectado a WhatsApp. Escuchando mensajes…");
    if (connection === "close") {
      console.log("❌ Conexión cerrada. Reintentando…");
      connectToWhatsApp().catch(e => console.error("Reinicio falló:", e?.message));
    }
  });

  sock.ev.on("messages.upsert", async ({ type, messages }) => {
    if (type !== "notify") return;
    for (const m of messages) {
      try { await onMessage(sock, m); }
      catch (e) { console.error("Error al responder:", e?.message); }
    }
  });

  return sock;
}

module.exports = { connectToWhatsApp };


