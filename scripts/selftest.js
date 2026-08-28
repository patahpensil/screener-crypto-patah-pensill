#!/usr/bin/env node
/**
 * Self-test untuk scripts/check.js.
 *
 * Pemeriksa yang selalu lulus itu tidak ada gunanya. Script ini menyuntikkan satu
 * cacat nyata ke salinan repo (di folder sementara), menjalankan check.js di sana,
 * dan memastikan check.js MENOLAKNYA. Lalu memastikan repo yang asli tetap lulus.
 *
 * Jalankan: node scripts/selftest.js
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const ORIG_HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const ORIG_SW = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');

// Titik sisip yang stabil: baris pembuka blok <script>.
const SCRIPT_OPEN = ORIG_HTML.indexOf('>', ORIG_HTML.indexOf('<script')) + 1;
const injectJs = (snippet) =>
  ORIG_HTML.slice(0, SCRIPT_OPEN) + '\n' + snippet + '\n' + ORIG_HTML.slice(SCRIPT_OPEN);

const CASES = [
  {
    nama: 'fungsi dipanggil tapi tidak terdefinisi',
    harapkan: 'fungsi-hilang',
    html: injectJs('function __ujiPemanggil(){ return fungsiYangTidakPernahAda(1, 2); }'),
  },
  {
    nama: 'fungsi tak terdefinisi di dalam template literal bersarang',
    harapkan: 'fungsi-hilang',
    // Justru bentuk inilah yang bikin versi regex meleset.
    html: injectJs('function __ujiTpl(x){ return `<div>${x ? `<b>${fungsiHilangDiTemplate(x)}</b>` : ""}</div>`; }'),
  },
  {
    nama: 'syntax error di index.html',
    harapkan: 'syntax',
    html: injectJs('function __ujiRusak( { '),
  },
  {
    nama: 'syntax error di sw.js',
    harapkan: 'syntax',
    sw: ORIG_SW + '\nfunction __rusak( {\n',
  },
  {
    nama: 'id elemen dobel',
    harapkan: 'id-dobel',
    html: ORIG_HTML.replace('<body>', '<body>\n<div id="tbody"></div>'),
  },
  {
    nama: 'getElementById ke id yang tidak ada',
    harapkan: 'id-hilang',
    html: injectJs('function __ujiId(){ return document.getElementById("idYangTidakPernahAda"); }'),
  },
  {
    nama: 'handler inline ke fungsi yang tidak ada',
    harapkan: 'handler-hilang',
    html: ORIG_HTML.replace('<body>', '<body>\n<button onclick="handlerYangHilang()">x</button>'),
  },
];

function jalankan(html, sw) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-selftest-'));
  fs.mkdirSync(path.join(dir, 'scripts'));
  fs.writeFileSync(path.join(dir, 'index.html'), html);
  fs.writeFileSync(path.join(dir, 'sw.js'), sw);
  fs.copyFileSync(path.join(ROOT, 'scripts', 'check.js'), path.join(dir, 'scripts', 'check.js'));
  try {
    const out = execFileSync(process.execPath, [path.join(dir, 'scripts', 'check.js')], { encoding: 'utf8' });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status === undefined ? 1 : e.status, out: (e.stdout || '') + (e.stderr || '') };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

console.log('Self-test scripts/check.js\n');
let gagal = 0;

// 1. repo apa adanya harus LULUS (tidak ada false positive)
const bersih = jalankan(ORIG_HTML, ORIG_SW);
if (bersih.code === 0) {
  console.log('  LULUS  repo apa adanya lolos semua pemeriksaan');
} else {
  gagal++;
  console.log('  GAGAL  repo apa adanya seharusnya lulus, tapi ditolak:');
  console.log(bersih.out.split('\n').map((l) => '           ' + l).join('\n'));
}

// 2. tiap cacat yang disuntik harus DITOLAK, oleh pemeriksaan yang tepat
for (const c of CASES) {
  const r = jalankan(c.html || ORIG_HTML, c.sw || ORIG_SW);
  const kena = r.code !== 0 && r.out.includes(c.harapkan === 'syntax' ? 'Parse JavaScript' : labelDari(c.harapkan));
  if (kena) {
    console.log('  LULUS  tertangkap: ' + c.nama);
  } else {
    gagal++;
    console.log('  GAGAL  TIDAK tertangkap: ' + c.nama + ' (exit=' + r.code + ')');
  }
}

function labelDari(key) {
  return {
    'fungsi-hilang': 'Fungsi dipanggil tapi tidak terdefinisi',
    'id-dobel': 'id elemen dobel',
    'id-hilang': 'getElementById menunjuk id yang tidak ada',
    'handler-hilang': 'Handler inline menunjuk fungsi yang tidak ada',
    'syntax': 'Parse JavaScript',
  }[key];
}

if (gagal > 0) {
  console.log('\n' + gagal + ' self-test gagal — check.js tidak bisa dipercaya.');
  process.exit(1);
}
console.log('\nSemua self-test lulus.');
