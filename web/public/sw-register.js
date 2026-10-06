/* PWA service worker registration. Kept OUT of index.html so the
   Content-Security-Policy never needs an inline-script hash for it.
   Registered on load; guarded so it never throws on environments
   without SW support. The worker itself never caches /data/*. */
if ("serviceWorker" in navigator && location.protocol === "https:") {
  addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
