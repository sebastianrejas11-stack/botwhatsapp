const { connectToWhatsApp } = require("./src/bootstrap");
connectToWhatsApp().catch(e => console.error("Error general:", e?.message));
