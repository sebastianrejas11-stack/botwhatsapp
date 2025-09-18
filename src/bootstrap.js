// src/bootstrap.js
// Baileys es ESM. En CJS debemos cargarlo con dynamic import() dentro de una función async.
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const { handleMessage } = require('./handlers');

async function connectToWhatsApp() {
  // 👇 Carga dinámica de Baileys (ESM) desde CommonJS
  const {
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion
  } = await import('@whiskeysockets/baileys');

  // ====== USAR VOLUMEN /data ======
  const DATA_DIR = process.env.DATA_DIR || './data';
  const AUTH_DIR = path.join(DATA_DIR, 'auth');
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  // 🔍 Logs de diagnóstico (útiles para Railway → Deploy Logs)
  console.log('🧭 process.env.DATA_DIR:', process.env.DATA_DIR);
  console.log('🟩 USANDO DIRECTORIO DE AUTENTICACIÓN:', AUTH_DIR);

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false
  });

  sock.ev.on('connection.update', (update) => {
    const { qr, connection } = update;
    if (qr) {
      const url =
        'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' +
        encodeURIComponent(qr);
      console.log('🔗 QR directo (clic y escanear):', url);
    }
    if (connection === 'open') {
      console.log('✅ Conectado a WhatsApp. Escuchando mensajes...');
    }
    if (connection === 'close') {
      console.log('❌ Conexión cerrada. Reintentando...');
      connectToWhatsApp().catch((err) =>
        console.error('Reinicio falló:', err?.message)
      );
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

module.exports = { connectToWhatsApp };
