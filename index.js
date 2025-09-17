// ✅ Polyfills ANTES de cargar nada (Railway puede no exponer WebCrypto)
if (!globalThis.crypto) globalThis.crypto = require("crypto").webcrypto;
if (!globalThis.Buffer) globalThis.Buffer = require("buffer").Buffer;

const { connectToWhatsApp } = require("./src/bootstrap");
connectToWhatsApp().catch(e => console.error("Error general:", e?.message));
