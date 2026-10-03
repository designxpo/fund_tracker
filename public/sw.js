// Minimal offline support: cache the app shell + static assets, fall back to cache when offline.
// Spend data itself is queued in localStorage by the app and synced when back online.
const CACHE = "spends-v1";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/auth/")) return;

  const immutable = url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/");

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      if (immutable) {
        const hit = await cache.match(req);
        if (hit) return hit;
      }
      try {
        const res = await fetch(req);
        if (res.ok && !res.redirected) cache.put(req, res.clone());
        return res;
      } catch (err) {
        const hit = (await cache.match(req)) || (req.mode === "navigate" ? await cache.match("/") : undefined);
        if (hit) return hit;
        throw err;
      }
    })(),
  );
});
