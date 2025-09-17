const fs = require("fs");
const path = require("path");
const { LINKS } = require("./config");

function ownerJidFrom(phone) {
  return String(phone).replace(/\D/g, "") + "@s.whatsapp.net";
}

function extractText(m) {
  if (!m || !m.message) return "";
  const msg = m.message;
  return (
    msg.conversation ||
    msg.extendedTextMessage?.text ||
    msg.imageMessage?.caption ||
    msg.videoMessage?.caption ||
    msg.documentMessage?.caption ||
    ""
  ).trim();
}

function isFullName(s) {
  if (!s) return false;
  if (!/^[\p{L} .'\-]+$/u.test(s)) return false;
  const parts = s.trim().split(/\s+/);
  return parts.length >= 2;
}

function nextMondayDate() {
  const now = new Date();
  const day = now.getDay(); // 0=Dom, 1=Lun...
  const add = (1 - day + 7) % 7 || 7;
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + add);
  return d.toLocaleDateString("es-BO", { day: "numeric", month: "long" });
}

async function sendQR(sock, to) {
  try {
    // busca primero BO; si luego activas MX puedes poner lógica por prefijo
    const file = path.join(__dirname, "..", "assets", "qr-BO.jpg");
    if (fs.existsSync(file)) {
      const buffer = fs.readFileSync(file);
      await sock.sendMessage(to, {
        image: buffer,
        caption: "Escanea este QR para inscribirte ✅",
      });
    } else {
      await sock.sendMessage(to, { text: `Escanea aquí: ${LINKS.PAGO}` });
    }
  } catch (e) {
    console.error("Error enviando QR:", e?.message);
  }
}

async function notifyOwner(sock, ownerJid, customerJid, title, body) {
  const human = String(customerJid).replace("@s.whatsapp.net", "");
  const text = `*${title}*\nDe: ${human}\n${body ? body + "\n" : ""}`;
  try { await sock.sendMessage(ownerJid, { text }); } catch {}
}

module.exports = {
  ownerJidFrom,
  extractText,
  isFullName,
  nextMondayDate,
  sendQR,
  notifyOwner
};

