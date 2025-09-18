// src/faq.js
const https = require('https');
const { URL } = require('url');

const CSV_URL = process.env.FAQ_CSV_URL || '';
const REFRESH_MIN = Number(process.env.FAQ_REFRESH_MIN || 15);
let rows = []; // [{ patterns: ['precio','cuanto cuesta'], answer:'...', tag:'ventas' }]

function normalize(s='') {
  return s
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .toLowerCase().trim();
}

function fetchTsv(url) {
  return new Promise((resolve, reject) => {
    if (!url) return reject(new Error('FAQ_CSV_URL vacío'));
    const u = new URL(url);
    https.get(u, (res) => {
      if (res.statusCode !== 200) {
        return reject(new Error(`FAQ TSV HTTP ${res.statusCode}`));
      }
      let data = '';
      res.on('data', (d) => data += d);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function parseTsv(tsv) {
  const lines = tsv.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return [];
  const out = [];
  const header = lines[0].toLowerCase();
  const hasHeader = header.includes('patron') || header.includes('patrón');

  for (let i = hasHeader ? 1 : 0; i < lines.length; i++) {
    const parts = lines[i].split('\t');
    const patron = (parts[0] || '').trim();
    const resp = (parts[1] || '').trim();
    const tag  = (parts[2] || '').trim();
    if (!patron || !resp) continue;

    const patterns = patron.split('|').map(p => normalize(p)).filter(Boolean);
    out.push({ patterns, answer: resp, tag });
  }
  return out;
}

async function reloadFaq() {
  try {
    const tsv = await fetchTsv(CSV_URL);
    rows = parseTsv(tsv);
    console.log(`✅ FAQ cargada: ${rows.length} filas`);
    return rows.length;
  } catch (e) {
    console.warn('⚠️ No se pudo cargar FAQ TSV:', e.message);
    return 0;
  }
}

function initFaq() {
  if (!CSV_URL) {
    console.warn('⚠️ FAQ_CSV_URL no definido.');
    return;
  }
  reloadFaq();
  if (REFRESH_MIN > 0) {
    setInterval(reloadFaq, REFRESH_MIN * 60 * 1000);
  }
}

function answerFromFaq(text='') {
  if (!text || rows.length === 0) return null;
  const t = normalize(text);
  let best = null;
  let bestScore = 0;

  for (const r of rows) {
    for (const pat of r.patterns) {
      if (!pat) continue;
      if (t.includes(pat)) {
        const score = pat.length; // patrón más específico gana
        if (score > bestScore) {
          bestScore = score;
          best = r;
        }
      }
    }
  }
  return best ? best.answer : null;
}

module.exports = { initFaq, reloadFaq, answerFromFaq };
