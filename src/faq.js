// src/faq.js
// Carga un TSV (Google Sheets export) y ofrece: initFaq, reloadFaq, answerFromFaq

const FAQ_URL = process.env.FAQ_CSV_URL || "";
const REFRESH_MIN = Number(process.env.FAQ_REFRESH_MIN || 15);

// Estado en memoria
let FAQ = [];
let lastLoad = 0;

function norm(s = "") {
  return (s || "")
    .normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseTSV(tsv) {
  const lines = (tsv || "").replace(/\r/g, "").split("\n");
  if (!lines.length) return [];

  const header = lines[0].split("\t").map(h => h.trim().toUpperCase());
  const iPat = header.indexOf("PATRON");
  const iRes = header.indexOf("RESPUESTA");
  const iTag = header.indexOf("TAG");

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split("\t");
    if (!cols || cols.length < 2) continue;

    const patron = (cols[iPat] || "").trim();
    const resp   = (cols[iRes] || "").trim();
    const tag    = iTag >= 0 ? (cols[iTag] || "").trim() : "";

    if (!patron || !resp) continue;

    const tokens = patron
      .split("|")
      .map(s => norm(s))
      .filter(Boolean);

    rows.push({ tokens, resp, tag });
  }
  return rows;
}

async function loadFaq() {
  if (!FAQ_URL) throw new Error("FAQ_CSV_URL no está definido");
  const res = await fetch(FAQ_URL, { redirect: "follow" }); // evita HTTP 307
  if (!res.ok) throw new Error(`FAQ TSV HTTP ${res.status}`);
  const tsv = await res.text();
  FAQ = parseTSV(tsv);
  lastLoad = Date.now();
  console.log(`✅ FAQ cargada: ${FAQ.length} filas.`);
  return FAQ.length;
}

function initFaq() {
  loadFaq().catch(err => console.warn("⚠️ No se pudo cargar FAQ TSV:", err.message));
  if (REFRESH_MIN > 0) {
    setInterval(() => {
      loadFaq().catch(err => console.warn("⚠️ No se pudo recargar FAQ TSV:", err.message));
    }, REFRESH_MIN * 60 * 1000);
  }
}

async function reloadFaq() {
  return loadFaq();
}

function answerFromFaq(userText = "") {
  if (!userText) return null;
  const n = norm(userText);

  for (const row of FAQ) {
    for (const token of row.tokens) {
      if (!token) continue;
      const words = token.split(" ").filter(Boolean);
      const allIn = words.every(w => n.includes(w));
      if (allIn) return row.resp;
    }
  }
  return null;
}

module.exports = { initFaq, reloadFaq, answerFromFaq };