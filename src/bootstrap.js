// src/bootstrap.js
const path = require("path");
const fs = require("fs");
const pino = require("pino");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason
} = require("@whiskeysockets/baileys");

const { onMessage } = require("./handlers");

async function connectToWhatsApp() {
  // ✅ En Railway el FS es efímero, pero escribible; guardamos aquí
  const AUTH_DIR = path.join(__dirname, "..", "auth");

  // 👉 Reset opcional: agrega RESET_AUTH=1 en Railway → Redeploy (solo 1 vez)
  if (process.env.RESET_AUTH) {
    try {
      fs.rmSync(AUTH_DIR, { recursive: true, force: true });
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
    logger: pino({ level: "silent" }),
    // ⛔️ NO ASCII en consola (Railway), solo link bonito:
    printQRInTerminal: false
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { qr, connection, lastDisconnect } = update;

    // ✅ Como “antes”: si hay QR, imprimimos el LINK para escanear
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
      const statusCode =
        lastDisconnect?.error?.output?.statusCode ||
        lastDisconnect?.error?.statusCode;

      // 🔒 Si las credenciales están inválidas/expiraron → borra auth y pide QR nuevo
      const isAuthIssue =
        statusCode === 401 ||
        lastDisconnect?.error?.message?.includes("bad session") ||
        lastDisconnect?.error?.message?.includes("logged out") ||
        lastDisconnect?.error?.toString?.().includes("401");

      if (isAuthIssue) {
        try {
          fs.rmSync(AUTH_DIR, { recursive: true, force: true });
          console.log("🔐 Sesión inválida. Auth borrado → se requerirá nuevo QR.");
        } catch (e) {
          console.log("Error borrando auth tras logout:", e?.message);
        }
      }

      console.log("❌ Conexión cerrada. Reintentando…");
      // Reintenta SIEMPRE (si se borró auth, el próximo ciclo mostrará QR)
      setTimeout(() => {
        connectToWhatsApp().catch((e) =>
          console.error("Reinicio falló:", e?.message)
        );
      }, 1500);
    }
  });

  // 🚚 Mensajes entrantes → lógica modular
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
