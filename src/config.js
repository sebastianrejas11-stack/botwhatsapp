// src/config.js
module.exports = {
  // Dueño
  OWNER_PHONE: '59177441414',
  COUNTRY_PREFIX: '591', // filtra solo números que empiezan con este prefijo

  // Links del reto
  LINK_GRUPO: 'https://chat.whatsapp.com/IWA2ae5podREHVFzoUSvxI?mode=ems_copy_t',
  LINK_BONO:  'https://www.youtube.com/watch?v=XkjFZY30vHc&list=PLnT-PzQPCplvsx4c-vAvLyk5frp_nHTGx&index=1',
  LINK_PAGO:  'https://tu-link-de-pago', // fallback si no hay qr.jpg

  // Recordatorios (minutos)
  REMINDER_WELCOME_MIN: 10, // tras bienvenida si no responde
  REMINDER_QR_MIN:      10, // tras enviar QR si no responde/paga
};
