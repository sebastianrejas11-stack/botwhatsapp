// src/state.js
const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd());
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}

const DB_FILE = path.join(DATA_DIR, "db.json");

let users = {};
try {
  if (fs.existsSync(DB_FILE)) {
    const raw = fs.readFileSync(DB_FILE, "utf8") || "{}";
    users = JSON.parse(raw);
  } else {
    fs.writeFileSync(DB_FILE, "{}");
  }
} catch (e) {
  console.error("DB load error:", e?.message);
  users = {};
}

function save() {
  try { fs.writeFileSync(DB_FILE, JSON.stringify(users, null, 2)); }
  catch (e) { console.error("DB write error:", e?.message); }
}

function getUser(jid) { return users[jid]; }
function upsertUser(jid, data) { users[jid] = { ...users[jid], ...data }; save(); return users[jid]; }

module.exports = { getUser, upsertUser };
