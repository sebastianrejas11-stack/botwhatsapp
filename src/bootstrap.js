// src/bootstrap.js
const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const { handleMessage } = require('./handlers');

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth');
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
      const url = 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(qr);
      console.log('🔗 QR directo (clic y escanear):', url);
    }
    if (connection === 'open') {
      console.log('✅ Conectado a WhatsApp. Escuchando mensajes...');
    }
    if (connection === 'close') {
      console.log('❌ Conexión cerrada. Reintentando...');
      connectToWhatsApp().catch(err => console.error('Reinicio falló:', err?.message));
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async ({ type, messages }) => {
    if (type !== 'notify') return;
    const m = messages && messages[0];
    try { await handleMessage(sock, m); }
    catch (e) { console.error('Error al responder:', e?.message); }
  });
}

module.exports = { connectToWhatsApp };

