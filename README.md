# 📟 Patah Pensill — Live Futures Screener

Progressive Web App (PWA) untuk screening Binance USDT-M Futures secara real-time, langsung dari browser HP atau PC — tanpa API key, tanpa backend, tanpa biaya server.

**Live:** https://bunyaxter.github.io/patah-pensill-screener-crypto/

## Navigasi

- **Home** — ringkasan market, Mode Trading (Scalping/Intraday/Swing), Aksi Cepat (Deep Scan Top 20, Decision, Market)
- **Scanner Market** — daftar 400+ pair USDT-M Perpetual, filter & sortir manual (Volume, Gainers/Losers, Funding Ekstrem, dll)
- **Markov Screener** — probabilitas transisi state pasar (Markov Chain) per pair, otomatis langsung tampil begitu dibuka (tanpa perlu filter/search manual)
- **Trading Workspace** — Analysis/Validation/Decision/Trading (posisi terbuka) dalam satu tempat
- **Review** — histori trade, equity curve, jurnal

## Fitur

**Sistem Skor (2 sistem terpisah, beda tujuan)**
- **AI Confluence Score** (Analysis/Validation/Decision Workspace) — **satu-satunya skor resmi** buat keputusan entry. 12 kategori berbobot, total 100: Market Structure (17), Multi Timeframe (15), Momentum (11), Volume (8), Funding (8), Open Interest (8), Orderflow (8), Liquidity (7), Divergence RSI (5), Pattern (5), Risk (5), News (3). Didukung sistem poin SOP (Trend EMA21/30/50, Momentum RSI+arah, MACD+histogram, AVWAP, Struktur Market, Break & Retest, Fibonacci Golden Pocket, ADX Direction+DI Gap, dan lainnya tergantung data yang tersedia) buat nentuin bias Long/Short di tiap kriteria.
- **Momentum (Quick Score)** — badge cepat di list pair Scanner Market, formula ringan dari `|perubahan harga 24H%|` + volatilitas (range 24H). **Bukan** skor resmi, cuma buat sortir cepat 400+ pair.
- **Markov Screener** — pendekatan statistik terpisah: state historis pair (Bearish/Netral/Bullish/Overheated) dibangun dari candle 4H, dihitung Markov Chain Transition Matrix (Laplace smoothing) + confidence Wilson Lower Bound. Murni buat monitoring probabilitas, bukan sinyal entry.

**Indikator (di modal detail, per timeframe 1H–Monthly)**
- EMA21/30/50, MA200
- Anchored VWAP + Band 0.5σ (anchor otomatis ke swing terbaru)
- Fibonacci Retracement
- MACD, StochRSI
- ATR, Bollinger Bands
- ADX (+DI/-DI)
- Struktur Market: swing HH/HL vs LH/LL, deteksi BOS & CHoCH
- Funding Rate & Open Interest
- Konfluensi multi-timeframe (1H/4H/1D): trend + struktur

**Alat Bantu**
- Rencana entry otomatis (Entry/SL/TP/RR) berbasis level struktural
- Watchlist (⭐) dengan alert otomatis: RSI(14) 1H ekstrem, funding rate ekstrem, harga mendekati level struktural 4H, CHoCH
- Notifikasi browser
- Tombol "Copy Ringkasan buat AI" — merangkum semua indikator jadi prompt siap-tempel ke Claude/AI lain
- Tombol "Lihat di TradingView" (di modal detail pair) — buka simbol yang sama di TradingView Desktop kamu dan tampilkan screenshot chart-nya langsung di screener. Butuh [tradingview-mcp](https://github.com/tradesdontlie/tradingview-mcp) jalan di PC yang sama (`npm run bridge`, lihat bagian "HTTP Bridge" di README-nya)
- PWA installable, bisa dipakai offline untuk shell app (data tetap butuh koneksi)

## Struktur File

```
index.html              seluruh app (HTML+CSS+JS, single file)
sw.js                    service worker (cache shell app, data selalu live/no-cache)
manifest.json            metadata PWA
icon-192.png             ikon 192x192
icon-512.png             ikon 512x512
icon-512-maskable.png    ikon maskable 512x512
```

## Deploy ke GitHub Pages

1. Push semua file di atas ke root branch `main` (atau folder `/docs`, sesuaikan setting Pages).
2. Repo → Settings → Pages → Source: pilih branch & folder yang berisi file-file ini.
3. Tunggu build selesai, akses via `https://<username>.github.io/<repo>/`.
4. Setiap update `index.html`/`sw.js`, **naikkan versi `CACHE_NAME`** di `sw.js` (baris pertama) — ini yang memastikan HP pengguna otomatis ambil versi baru, bukan versi lama dari cache.

## Catatan Teknis

- **Tanpa API key**: semua request langsung ke endpoint publik `fapi.binance.com` dari browser pengguna sendiri (client-side). Tidak ada data yang lewat server pihak ketiga.
- **Data pribadi** (watchlist, pengaturan alert, riwayat alert) tersimpan di `localStorage` HP/browser masing-masing pengguna — tidak dikirim ke mana pun.
- **Rate limit**: fitur yang butuh banyak candle per pair (Deep Scan, Markov Screener, alert Watchlist, konfluensi multi-timeframe) sengaja dibatasi jumlah pair/concurrency-nya supaya tidak kena limit Binance.
- Kalau data gagal dimuat, kemungkinan besar ISP/jaringan memblokir domain Binance — coba VPN.
- Ini **bukan rekomendasi finansial**. Semua skor & sinyal murni hasil kalkulasi struktur teknikal/statistik, bukan saran investasi.

## Lisensi / Penggunaan

Proyek pribadi untuk keperluan trading & konten edukasi "Patah Pensill". Silakan modifikasi untuk kebutuhan sendiri.
