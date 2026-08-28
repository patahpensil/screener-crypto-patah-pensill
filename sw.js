const CACHE_NAME = "pp-screener-v70";
const SHELL_FILES = [
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-512-maskable.png",
];

// index.html sekarang 1 file utuh lagi (CSS+JS digabung balik) — network-first, biar begitu kamu
// upload versi baru, HP langsung ambil yang terbaru tanpa perlu clear cache manual.
const NETWORK_FIRST_FILES = ["index.html", "manifest.json"];

// Origin lintas-domain yang tetap boleh di-cache karena memang bagian dari shell app (font UI).
// Selain ini + origin sendiri, TIDAK ADA yang boleh disentuh cache — lihat catatan di handler fetch.
const CACHEABLE_CROSS_ORIGIN = ["https://fonts.googleapis.com/", "https://fonts.gstatic.com/"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = req.url;

  // Cache cuma ngerti GET. Request POST — mis. notifikasi Telegram ke api.telegram.org — dulu jatuh ke
  // cabang cache-first di bawah, dan cache.put() menolak request POST, jadi tiap kirim notif ninggalin
  // unhandled rejection di console (pesannya sendiri tetap terkirim). Sekarang non-GET nggak diintersepsi.
  if (req.method !== "GET") return;

  // Data live Binance (REST + WebSocket): jangan pernah disentuh cache. Dilewatkan tanpa respondWith
  // sekalian, biar nggak ada perjalanan bolak-balik lewat service worker yang nggak ada gunanya.
  if (url.includes("fapi.binance.com") || url.includes("fstream.binance.com")) return;

  let sameOrigin = false;
  try { sameOrigin = new URL(url).origin === self.location.origin; } catch (e) { /* URL aneh — anggap bukan */ }

  const isNetworkFirst =
    sameOrigin && (NETWORK_FIRST_FILES.some((f) => url.endsWith(f)) || url.endsWith("/"));

  if (isNetworkFirst) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // Cache-first CUMA buat aset shell app sendiri + font Google yang dipakai shell-nya.
  // FIX: sebelumnya cabang ini nangkep SEMUA request non-Binance, termasuk lintas-origin, sehingga:
  //   - `${TV_BRIDGE_URL}/open?symbol=...&tf=...` dilayani dari cache setelah panggilan pertama, jadi
  //     perintah "buka simbol ini di TradingView" nggak pernah nyampe lagi ke bridge lokalnya — status
  //     di layar tetap sukses padahal chart-nya nggak ganti;
  //   - URL screenshot bridge yang ber-timestamp (`&t=Date.now()`) bikin entry cache BARU tiap dipakai,
  //     numpuk terus dan nggak pernah kebuang selama versi cache-nya belum naik.
  if (!sameOrigin && !CACHEABLE_CROSS_ORIGIN.some((o) => url.startsWith(o))) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      return (
        cached ||
        fetch(req).then((res) => {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
          return res;
        }).catch(() => cached)
      );
    })
  );
});
