const { connectToWhatsApp } = require("./src/bootstrap");

connectToWhatsApp().catch(err => {
  console.error("Error general:", err?.message);
});
