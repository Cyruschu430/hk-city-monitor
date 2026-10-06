/* sw.js — HK City Monitor service worker.
 *
 * Deliberately small and honest:
 *  - /assets/* are content-hashed by Vite → cache-first forever (immutable).
 *  - /data/*.json are live snapshots pushed by cron → NEVER cached (network
 *    only); serving a stale ai_summary.json would be a lie.
 *  - everything else same-origin (navigation, config) → network-first with a
 *    cache fallback so the shell still opens offline.
 * No pre-cache list to maintain: the only pre-cache is the shell itself.
 */
const SHELL = ["/", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open("hkcm-shell").then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return; // let the browser handle cross-origin
  const path = url.pathname;

  // Live snapshots must never come from the cache.
  if (path.startsWith("/data/")) return;

  // Hashed build assets are immutable — cache-first.
  if (path.startsWith("/assets/")) {
    event.respondWith(
      caches.match(event.request).then(
        (hit) =>
          hit ||
          fetch(event.request).then((res) => {
            const copy = res.clone();
            caches.open("hkcm-assets").then((c) => c.put(event.request, copy));
            return res;
          }),
      ),
    );
    return;
  }

  // Navigation and config: fresh first, cached shell as fallback.
  if (event.request.mode === "navigate" || path === "/manifest.webmanifest") {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const copy = res.clone();
          caches.open("hkcm-shell").then((c) => c.put(event.request, copy));
          return res;
        })
        .catch(() => caches.match(event.request).then((hit) => hit || caches.match("/"))),
    );
  }
});
