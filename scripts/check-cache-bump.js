#!/usr/bin/env node
/**
 * Menegakkan aturan wajib di CLAUDE.md:
 * setiap kali index.html atau sw.js berubah, CACHE_NAME di baris pertama sw.js
 * HARUS ikut naik.
 *
 * Kalau tidak, service worker di HP pengguna tetap menyajikan shell lama dari cache
 * tanpa batas waktu — persis mode kegagalan yang diperingatkan README untuk deploy
 * GitHub Pages. Ini kesalahan yang mudah terlewat karena aplikasinya tetap jalan
 * normal di mesin sendiri; yang kena cuma pengguna yang sudah pernah membuka app.
 *
 * Pembanding diambil dari env BASE_SHA (diisi workflow CI), atau HEAD~1 kalau kosong.
 * Kalau pembanding tidak bisa ditentukan (mis. commit pertama), pemeriksaan dilewati
 * dengan catatan, bukan digagalkan.
 *
 * Jalankan: node scripts/check-cache-bump.js
 */
'use strict';

const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const WATCHED = ['index.html', 'sw.js'];

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}
function gitOrNull(args) {
  try { return git(args); } catch (e) { return null; }
}

function cacheNameAt(ref) {
  const src = gitOrNull(['show', `${ref}:sw.js`]);
  if (src === null) return null;
  const m = src.match(/CACHE_NAME\s*=\s*["']([^"']+)["']/);
  return m ? m[1] : null;
}

const base = process.env.BASE_SHA && process.env.BASE_SHA.replace(/^0+$/, '')
  ? process.env.BASE_SHA
  : 'HEAD~1';

console.log('Pemeriksaan bump CACHE_NAME\n');

if (gitOrNull(['rev-parse', '--verify', `${base}^{commit}`]) === null) {
  console.log('  DILEWATI  pembanding "' + base + '" tidak bisa dipakai (mungkin commit pertama).');
  process.exit(0);
}

const changed = (gitOrNull(['diff', '--name-only', base, 'HEAD']) || '').split('\n').filter(Boolean);
const touched = WATCHED.filter((f) => changed.includes(f));

if (touched.length === 0) {
  console.log('  LULUS  index.html & sw.js tidak berubah sejak ' + base + ' — bump tidak diperlukan.');
  process.exit(0);
}

const before = cacheNameAt(base);
const after = cacheNameAt('HEAD');

if (after === null) {
  console.log('  GAGAL  CACHE_NAME tidak ditemukan di sw.js.');
  process.exit(1);
}
if (before === null) {
  console.log('  DILEWATI  sw.js belum ada di ' + base + '.');
  process.exit(0);
}

console.log('  berubah : ' + touched.join(', '));
console.log('  sebelum : ' + before);
console.log('  sesudah : ' + after);

if (before === after) {
  console.log('\n  GAGAL  ' + touched.join(' dan ') + ' berubah tapi CACHE_NAME masih "' + after + '".');
  console.log('         Naikkan CACHE_NAME di baris pertama sw.js (mis. pp-screener-v68 -> v69),');
  console.log('         kalau tidak browser pengguna akan terus menyajikan shell lama dari cache.');
  process.exit(1);
}

console.log('\n  LULUS  CACHE_NAME naik dari ' + before + ' ke ' + after + '.');
