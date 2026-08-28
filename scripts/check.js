#!/usr/bin/env node
/**
 * Pemeriksaan statis untuk Patah Pensill Screener.
 *
 * App ini satu file HTML tanpa build step, tanpa package manager, tanpa test runner —
 * jadi tidak ada yang menangkap kesalahan sepele sampai dibuka di browser. Script ini
 * mengisi celah itu. Nol dependensi, cukup `node scripts/check.js` dari root repo.
 *
 * Yang diperiksa:
 *   1. index.html punya tepat satu blok <script>, dan isinya lolos parse JavaScript
 *   2. sw.js lolos parse JavaScript
 *   3. Tidak ada fungsi yang dipanggil tapi tidak pernah didefinisikan
 *      (persis kelas bug `mkComputeFeatures()` yang diam-diam mati bertahun-tahun,
 *      tertelan blok catch di sekitarnya)
 *   4. Tidak ada id elemen yang dobel di HTML
 *   5. Semua getElementById('x') menunjuk id yang benar-benar ada
 *   6. Semua handler inline (atribut onclick di HTML maupun yang dirakit di dalam
 *      template literal JS) menunjuk fungsi yang terdefinisi
 *
 * Keluar dengan kode 1 kalau ada yang gagal.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const INDEX = path.join(ROOT, 'index.html');
const SW = path.join(ROOT, 'sw.js');

const problems = [];
const notes = [];
function fail(check, msg) { problems.push({ check, msg }); }

/* ------------------------------------------------------------------ *
 * Pemindai: kosongkan komentar, string, regex literal, dan isi template
 * literal — tapi PERTAHANKAN posisi & jumlah baris, supaya nomor baris
 * yang dilaporkan tetap menunjuk ke tempat yang benar di file asli.
 *
 * Ditulis sebagai state machine per karakter, bukan regex, karena dua hal
 * yang bikin regex salah baca di file ini:
 *   - template literal bersarang: `${cond ? `<div>..` : ''}` di dalam template lain
 *   - regex literal yang memuat tanda kutip, mis. /[&<>"']/g — kalau tidak dikenali
 *     sebagai regex, tanda kutipnya membuka "string" palsu dan menelan kode asli
 * ------------------------------------------------------------------ */
const REGEX_PRECEDING_KEYWORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'case', 'do', 'else', 'yield', 'await', 'throw',
]);

function regexCanFollow(src, i) {
  // Mundur melewati whitespace untuk menemukan token bermakna terakhir.
  let j = i - 1;
  while (j >= 0 && /\s/.test(src[j])) j--;
  if (j < 0) return true;
  const c = src[j];
  if (/[)\]]/.test(c)) return false;               // (a+b)/2, arr[i]/2
  if (/[\w$]/.test(c)) {                            // identifier/angka: bisa pembagian,
    let k = j;                                      // kecuali kalau itu keyword.
    while (k >= 0 && /[\w$]/.test(src[k])) k--;
    return REGEX_PRECEDING_KEYWORDS.has(src.slice(k + 1, j + 1));
  }
  return true;                                      // ( , = : [ ! & | ? { } ; operator dll
}

function blankNonCode(src) {
  const n = src.length;
  const out = new Array(n);
  let i = 0;
  const blank = () => { out[i] = src[i] === '\n' ? '\n' : ' '; i++; };
  const keep = () => { out[i] = src[i]; i++; };

  // stack mode: 'code' (dengan kedalaman kurung kurawal) atau 'template'
  const stack = [{ mode: 'code', depth: 0 }];

  while (i < n) {
    const top = stack[stack.length - 1];
    const c = src[i];
    const c2 = src[i + 1];

    if (top.mode === 'template') {
      if (c === '\\') { blank(); if (i < n) blank(); continue; }
      if (c === '`') { blank(); stack.pop(); continue; }
      if (c === '$' && c2 === '{') { blank(); blank(); stack.push({ mode: 'code', depth: 0 }); continue; }
      blank();
      continue;
    }

    // --- mode code ---
    if (c === '/' && c2 === '/') { while (i < n && src[i] !== '\n') blank(); continue; }
    if (c === '/' && c2 === '*') {
      const e = src.indexOf('*/', i + 2);
      const stop = e < 0 ? n : e + 2;
      while (i < stop) blank();
      continue;
    }
    if (c === '"' || c === "'") {
      blank();
      while (i < n && src[i] !== c && src[i] !== '\n') {
        if (src[i] === '\\') { blank(); if (i < n) blank(); continue; }
        blank();
      }
      if (i < n && src[i] === c) blank();
      continue;
    }
    if (c === '`') { blank(); stack.push({ mode: 'template' }); continue; }
    if (c === '/' && regexCanFollow(src, i)) {
      let j = i + 1, inClass = false, closed = false;
      while (j < n) {
        const d = src[j];
        if (d === '\\') { j += 2; continue; }
        if (d === '\n') break;
        if (inClass) { if (d === ']') inClass = false; }
        else if (d === '[') inClass = true;
        else if (d === '/') { closed = true; break; }
        j++;
      }
      if (closed) {
        j++;
        while (j < n && /[a-z]/.test(src[j])) j++;   // flags
        while (i < j) blank();
        continue;
      }
      // bukan regex — perlakukan sebagai pembagian biasa
    }
    if (c === '{') { top.depth++; keep(); continue; }
    if (c === '}') {
      if (top.depth === 0 && stack.length > 1) { blank(); stack.pop(); continue; } // penutup ${...}
      if (top.depth > 0) top.depth--;
      keep();
      continue;
    }
    keep();
  }
  return out.join('');
}

const lineOf = (src, idx) => src.slice(0, idx).split('\n').length;

/* ------------------------------------------------------------------ *
 * Muat sumber
 * ------------------------------------------------------------------ */
if (!fs.existsSync(INDEX)) { console.error('index.html tidak ditemukan di ' + ROOT); process.exit(1); }
const html = fs.readFileSync(INDEX, 'utf8').replace(/\r\n/g, '\n');
const swSrc = fs.readFileSync(SW, 'utf8').replace(/\r\n/g, '\n');

const openTags = [...html.matchAll(/<script(?:\s[^>]*)?>/g)];
const closeTags = [...html.matchAll(/<\/script>/g)];
if (openTags.length !== 1 || closeTags.length !== 1) {
  fail('struktur', `index.html harus punya tepat 1 blok <script> (ditemukan ${openTags.length} pembuka, ${closeTags.length} penutup)`);
}
const jsStart = openTags.length ? openTags[0].index + openTags[0][0].length : 0;
const jsEnd = closeTags.length ? closeTags[0].index : html.length;
const js = html.slice(jsStart, jsEnd);
const jsLineOffset = lineOf(html, jsStart) - 1;   // app line 1 == html line (offset + 1)
const htmlLine = (jsIdx) => lineOf(js, jsIdx) + jsLineOffset;

/* --- 1 & 2. syntax --- */
for (const [label, src] of [['index.html <script>', js], ['sw.js', swSrc]]) {
  try { new vm.Script(src, { filename: label }); }
  catch (e) { fail('syntax', `${label}: ${e.message}`); }
}

const code = blankNonCode(js);

/* ------------------------------------------------------------------ *
 * 3. Fungsi dipanggil tapi tidak terdefinisi
 * ------------------------------------------------------------------ */
const GLOBALS = new Set([
  // keyword & sintaks yang bisa diikuti '('
  'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'function', 'new', 'await',
  'async', 'of', 'in', 'do', 'else', 'try', 'void', 'delete', 'instanceof', 'yield', 'case', 'throw',
  // global browser & bahasa
  'JSON', 'Math', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Date', 'Set', 'Map', 'WeakMap',
  'Promise', 'console', 'document', 'window', 'localStorage', 'sessionStorage', 'navigator', 'location',
  'parseFloat', 'parseInt', 'isNaN', 'isFinite', 'setTimeout', 'setInterval', 'clearTimeout',
  'clearInterval', 'fetch', 'alert', 'confirm', 'prompt', 'encodeURIComponent', 'decodeURIComponent',
  'Notification', 'WebSocket', 'IntersectionObserver', 'MutationObserver', 'FileReader', 'Blob', 'URL',
  'URLSearchParams', 'AudioContext', 'webkitAudioContext', 'performance', 'requestAnimationFrame',
  'Error', 'TypeError', 'RangeError', 'RegExp', 'Symbol', 'Intl', 'structuredClone', 'queueMicrotask',
  'atob', 'btoa', 'FormData', 'AbortController', 'CustomEvent', 'Event', 'Image', 'self',
]);

const defined = new Set();
const addPattern = (text) => {
  // ambil identifier dari daftar parameter / pola destructuring
  for (const m of String(text).matchAll(/[A-Za-z_$][\w$]*/g)) defined.add(m[0]);
};
for (const m of code.matchAll(/\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)/g)) defined.add(m[1]);
for (const m of code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) defined.add(m[1]);
for (const m of code.matchAll(/\b(?:const|let|var)\s*([[{][^;=]*?[\]}])\s*=/g)) addPattern(m[1]);
for (const m of code.matchAll(/\bfunction\s*\*?\s*[A-Za-z_$][\w$]*\s*\(([^()]*)\)/g)) addPattern(m[1]);
for (const m of code.matchAll(/\bfunction\s*\*?\s*\(([^()]*)\)/g)) addPattern(m[1]);
for (const m of code.matchAll(/\(([^()]*)\)\s*=>/g)) addPattern(m[1]);
for (const m of code.matchAll(/([A-Za-z_$][\w$]*)\s*=>/g)) defined.add(m[1]);
for (const m of code.matchAll(/\bcatch\s*\(([^()]*)\)/g)) addPattern(m[1]);
for (const m of code.matchAll(/\bfor\s*\(\s*(?:const|let|var)\s*([[{][^;)]*?[\]}])/g)) addPattern(m[1]);

const undefinedCalls = new Map();
for (const m of code.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
  const name = m[1];
  if (GLOBALS.has(name) || defined.has(name)) continue;
  if (!undefinedCalls.has(name)) undefinedCalls.set(name, htmlLine(m.index));
}
for (const [name, line] of undefinedCalls) {
  fail('fungsi-hilang', `index.html:${line} — ${name}() dipanggil tapi tidak pernah didefinisikan`);
}

/* ------------------------------------------------------------------ *
 * 4 & 5. id elemen
 * ------------------------------------------------------------------ */
const ids = new Map();
for (const m of html.matchAll(/\sid\s*=\s*"([^"]+)"/g)) ids.set(m[1], (ids.get(m[1]) || 0) + 1);
for (const [id, count] of ids) {
  if (count > 1) fail('id-dobel', `id "${id}" dipakai ${count}x di index.html — getElementById cuma akan menemukan yang pertama`);
}
const missingIds = new Map();
// Literal string sudah dikosongkan pemindai, jadi id-nya dicari di sumber asli (js), bukan `code`.
for (const m of js.matchAll(/getElementById\(\s*(['"])([^'"]+)\1\s*\)/g)) {
  if (!ids.has(m[2]) && !missingIds.has(m[2])) missingIds.set(m[2], htmlLine(m.index));
}
for (const [id, line] of missingIds) {
  fail('id-hilang', `index.html:${line} — getElementById('${id}') menunjuk id yang tidak ada di HTML`);
}

/* ------------------------------------------------------------------ *
 * 6. handler inline
 * ------------------------------------------------------------------ */
const HANDLER_OK = new Set(['event', 'this', 'return', 'if', 'alert', 'confirm']);
const badHandlers = new Map();
const scanHandlers = (text, mapLine, sourceLabel) => {
  for (const m of text.matchAll(/\bon(?:click|change|input|submit|load|error)\s*=\s*(\\?["'])([\s\S]*?)\1/g)) {
    for (const c of m[2].matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
      const name = c[1];
      if (defined.has(name) || GLOBALS.has(name) || HANDLER_OK.has(name)) continue;
      const key = sourceLabel + '|' + name;
      if (!badHandlers.has(key)) badHandlers.set(key, { name, line: mapLine(m.index), sourceLabel });
    }
  }
};
// atribut di markup statis (di luar blok <script>)
const markup = html.slice(0, jsStart) + html.slice(jsEnd);
scanHandlers(markup, (idx) => lineOf(html, idx <= jsStart ? idx : idx + (jsEnd - jsStart)), 'markup');
// handler yang dirakit di dalam template literal JS
scanHandlers(js, (idx) => htmlLine(idx), 'template');
for (const { name, line, sourceLabel } of badHandlers.values()) {
  fail('handler-hilang', `index.html:${line} (${sourceLabel}) — handler memanggil ${name}() yang tidak terdefinisi`);
}

/* ------------------------------------------------------------------ *
 * Laporan
 * ------------------------------------------------------------------ */
const CHECKS = [
  ['syntax', 'Parse JavaScript (index.html + sw.js)'],
  ['struktur', 'Struktur blok <script>'],
  ['fungsi-hilang', 'Fungsi dipanggil tapi tidak terdefinisi'],
  ['id-dobel', 'id elemen dobel'],
  ['id-hilang', 'getElementById menunjuk id yang tidak ada'],
  ['handler-hilang', 'Handler inline menunjuk fungsi yang tidak ada'],
];

console.log('Pemeriksaan statis Patah Pensill Screener\n');
let failed = 0;
for (const [key, label] of CHECKS) {
  const hits = problems.filter((p) => p.check === key);
  if (hits.length === 0) {
    console.log('  LULUS  ' + label);
  } else {
    failed += hits.length;
    console.log('  GAGAL  ' + label);
    hits.forEach((h) => console.log('           ' + h.msg));
  }
}
notes.forEach((n) => console.log('\n  catatan: ' + n));

if (failed > 0) {
  console.log('\n' + failed + ' masalah ditemukan.');
  process.exit(1);
}
console.log('\nSemua pemeriksaan lulus.');
