// src/state.js
const fs = require("fs");
const path = require("path");

// Usar /data si está montado, o el directorio actual como fallback
const DATA_DIR = process.env.DATA_DIR || ".";
const DB_FILE = path.join(DATA_DIR, "db.json");

// Cargar usuarios desde archivo (si existe)
let users = {};
if (fs.existsSync(DB_FILE)) {
  try {
    users = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch {
    users = {};
  }
}

// Guardar usuarios en el archivo
function saveUsers() {
  fs.writeFileSync(DB_FILE, JSON.stringify(users, null, 2));
}

// Obtener un usuario
function getUser(jid) {
  return users[jid];
}

// Crear/actualizar un usuario
function upsertUser(jid, data) {
  users[jid] = { ...users[jid], ...data };
  saveUsers();
  return users[jid];
}

module.exports = {
  getUser,
  upsertUser,
};
