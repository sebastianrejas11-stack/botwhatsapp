// src/faq.js
// Carga y refresca las FAQs desde Google Sheets (TSV) siguiendo redirecciones 307.
// Usa env: FAQ_CSV_URL (obligatorio) y FAQ_REFRESH_MIN (opcional, por defecto 15).

const FAQ_URL = process.env.FAQ_CSV_URL || "";
const REFRESH_MIN = Number(process.env.FAQ_REFRESH_MIN || 15);

let FAQ = []; // [{ pats: ["precio","cuanto"], respuesta:"...", tag:"ventas" }]

function log(...a) { console.log("[FAQ]", ...a); }
function warn(...a) { console.warn("[FAQ]", ...a); }

// Normaliza texto para match simple
function normalize(s = "") {
  return s
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // quita acentos
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Parsea TSV (primera fila es header: PATRON | RESPUESTA | TAG)
function parseTSV(tsv) {
  // quita BOM si existiera
  if (tsv.charCodeAt(0) === 0xFEFF) tsv = tsv.slice(1);

  const lines = tsv.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];

  // descarta encabezado
  lines.shift();

  const rows = [];
  for (const line of lines) {
    const [patron = "", respuesta = "", tag = ""] = line.split("\t");
    const pats = patron
      .split("|")
      .map(s => normalize(s))
      .filter(Boolean);
    if (!pats.length || !respuesta) continue;
    rows.push({ pats, respuesta, tag: tag.trim() });
  }
  return rows;
}

// Descarga el TSV siguiendo redirecciones (clave para evitar HTTP 307)
async function fetchTSV() {
  if (!FAQ_URL) throw new Error("FAQ_CSV_URL no definido");
  const res = await fetch(FAQ_URL, { redirect: "follow" }); // <= lo importante
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} al leer TSV`);
  }
  const text = await res.text();
  return text;
}

async function loadFaqOnce() {
  try {
    const tsv = await fetchTSV();
    FAQ = parseTSV(tsv);
    log(`Cargadas ${FAQ.length} filas FAQ desde Google Sheets.`);
  } catch (e) {
    warn("No se pudo cargar FAQ TSV:", e.message);
  }
}

function startAutoRefresh() {
  if (!FAQ_URL) {
    warn("FAQ_CSV_URL no definido; no se cargará FAQ.");
    return;
  }
  // carga inicial
  loadFaqOnce();
  // refresco periódico
  const ms = Math.max(1, REFRESH_MIN) * 60 * 1000;
  setInterval(loadFaqOnce, ms);
}

function findAnswer(userText = "") {
  const t = normalize(userText);
  if (!t || !FAQ.length) return null;

  for (const row of FAQ) {
    for (const p of row.pats) {
      if (p && t.includes(p)) {
        return row.respuesta;
      }
    }
  }
  return null;
}

module.exports = { startAutoRefresh, findAnswer };
