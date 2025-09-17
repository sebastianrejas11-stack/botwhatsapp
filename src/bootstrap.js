// src/bootstrap.js — versión “como antes”: link de QR en logs
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

  // 👉 Opción para “forzar QR nuevo” si la sesión quedó corrupta:
  //    En Railway agrega (temporalmente) la env var RESET_AUTH=1 y redeploy.
  if (process.env.RESET_AUTH) {
    try {
      fs.rmSync(AUTH_DIR, { recursive: true, force: true });
      console.log("🧹 Auth borrado. Se generará un nuevo QR.");
    } catch (e) {
      console.log("Error al borrar auth:", e?.message);
    }
  }

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: "silent" }),
    // ✅ Como antes: NO imprime ASCII en consola
    printQRInTerminal: false
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { qr, connection } = update;

    // ✅ Como antes: si hay QR, logueamos un LINK para abrir/escANEAR
    if (qr) {
      const url =
        "https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=" +
        encodeURIComponent(qr);
      console.log("🔗 QR directo (clic y escanear):", url);
    }

    if (connection === "open") {
      console.log("✅ Conectado a WhatsApp. Escuchando mensajes...");
    }

    if (connection === "close") {
      console.log("❌ Conexión cerrada. Reintentando...");
      // Reintenta con la MISMA sesión (no borra auth)
      connectToWhatsApp().catch((e) =>
        console.error("Reinicio falló:", e?.message)
      );
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
