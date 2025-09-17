const { LINKS } = require("./config");

function buildMensajePago() {
  return `🌟 ¡Te doy la bienvenida al Reto de 21 Días de Gratitud y de Abundancia! 🌟

Prepárate para iniciar un viaje transformador hacia una vida más plena, consciente y conectada con la energía de la gratitud y la abundancia 💖✨

🔗 Ingresa al grupo aquí:
${LINKS.GRUPO}

🎁 BONO ESPECIAL POR INSCRIBIRTE
Al unirte, también recibes totalmente gratis el taller de 12 clases para aprender a meditar 🧘‍♀️🌿

📺 Accede al taller aquí:
${LINKS.BONO}

✨ ¡Gracias por ser parte de este hermoso camino! Nos vemos dentro.`;
}

function buildBienvenida(fechaLunes) {
  return `Hola 🌟 ¡Gracias por tu interés en el Reto de 21 Días de Gratitud y Abundancia! 🙏✨

Este hermoso reto se realizará por WhatsApp y empieza este lunes ${fechaLunes} 🗓️

📌 Incluye:
✔️ Reflexión + ejercicio diario
✔️ Videos explicativos
✔️ Libro digital al finalizar

💛 Este es un bonito regalo para ti, date la oportunidad.

Las clases se envían vía WhatsApp por la mañana y puedes verlas cuando gustes.

Si deseas inscribirte, por favor respóndeme tu *nombre completo (nombre y apellido)* ✅`;
}

module.exports = { buildMensajePago, buildBienvenida };

