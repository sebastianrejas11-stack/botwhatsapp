const { HISTORY_GRACE_SEC } = require("./config");

// START_EPOCH: evita reprocesar historial viejo
const START_EPOCH = Math.floor(Date.now() / 1000);

// memoria por usuario en RAM
// { stage, nombre, lastMsg, welcomeReminderSent, qrReminderSent, paid }
const users = new Map();

function getUser(jid) {
  return users.get(jid) || null;
}
function upsertUser(jid, patch) {
  const prev = users.get(jid) || {
    stage: "start",
    nombre: "",
    lastMsg: 0,
    welcomeReminderSent: false,
    qrReminderSent: false,
    paid: false
  };
  const next = { ...prev, ...patch };
  users.set(jid, next);
  return next;
}

module.exports = {
  START_EPOCH,
  HISTORY_GRACE_SEC,
  getUser,
  upsertUser
};

