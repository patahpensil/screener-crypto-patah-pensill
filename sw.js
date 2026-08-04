const CACHE_NAME = "pp-screener-v64";
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
  const url = event.request.url;

  if (url.includes("fapi.binance.com") || url.includes("fstream.binance.com")) {
    event.respondWith(fetch(event.request));
    return;
  }

  const isNetworkFirst = NETWORK_FIRST_FILES.some((f) => url.endsWith(f)) || url.endsWith("/");

  if (isNetworkFirst) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resClone));
          return res;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      return (
        cached ||
        fetch(event.request).then((res) => {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resClone));
          return res;
        }).catch(() => cached)
      );
    })
  );
});
