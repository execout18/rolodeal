/**
 * Rolodeal service worker.
 *
 * Strategy:
 *   /api/*        never cached. A scan needs the network, full stop.
 *   navigations   network first, fall back to the cached shell so the deck
 *                 opens in an elevator or a conference basement.
 *   assets        cache first, refreshed in the background.
 *
 * Card data itself lives in IndexedDB, so recall and vCard export work
 * offline with no help from this file. Only scanning needs signal.
 */

const VERSION = "rolodeal-v1";
const SHELL = "shell-" + VERSION;
const ASSETS = "assets-" + VERSION;
const OFFLINE_URLS = ["/", "/index.html", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL).then((c) => c.addAll(OFFLINE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => !k.endsWith(VERSION)).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // straight to the network

  // Page loads: try the network, fall back to the shell.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put("/index.html", copy));
          return res;
        })
        .catch(() => caches.match("/index.html"))
    );
    return;
  }

  // Everything else: serve from cache, refresh behind the scenes.
  event.respondWith(
    caches.match(request).then((hit) => {
      const network = fetch(request)
        .then((res) => {
          if (res && res.status === 200 && res.type === "basic") {
            const copy = res.clone();
            caches.open(ASSETS).then((c) => c.put(request, copy));
          }
          return res;
        })
        .catch(() => hit);
      return hit || network;
    })
  );
});
