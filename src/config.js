module.exports = {
  // === CONFIG EDITABLE ===
  OWNER_PHONE: "59177441414",        // tu número con prefijo
  COUNTRY_PREFIXES: ["591"],         // puedes agregar "52" cuando actives MX
  LINKS: {
    GRUPO: "https://chat.whatsapp.com/IWA2ae5podREHVFzoUSvxI?mode=ems_copy_t",
    BONO:  "https://www.youtube.com/watch?v=XkjFZY30vHc&list=PLnT-PzQPCplvsx4c-vAvLyk5frp_nHTGx&index=1",
    PAGO:  "https://tu-link-de-pago" // fallback si no hay QR
  },
  REMINDER_WELCOME_MIN: 10,
  REMINDER_QR_MIN: 10,
  // === CONSTANTES DE SISTEMA (no toques) ===
  HISTORY_GRACE_SEC: 30
};

