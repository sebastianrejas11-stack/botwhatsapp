// Polyfills para Baileys en entornos donde no existe globalThis.crypto
if (!globalThis.crypto) globalThis.crypto = require("crypto").webcrypto;
if (!globalThis.Buffer) globalThis.Buffer = require("buffer").Buffer;

const { connectToWhatsApp } = require("./src/bootstrap");
connectToWhatsApp().catch(e => console.error("Error general:", e?.message));
