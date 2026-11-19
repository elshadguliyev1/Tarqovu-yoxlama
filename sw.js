// Offline support. The page and the app code are fetched network-first, bypassing the browser's HTTP cache
// (GitHub Pages lets it keep a page for 10 minutes), so a new version arrives at once; libraries and the catalogue
// are cache-first. A new cache name per release replaces everything.
const CACHE = "tarqovu-v12";
const SDK = /^https:\/\/www\.gstatic\.com\/firebasejs\/10\.14\.1\//;
const LIBS = /^((zxing|jspdf|html2canvas|exceljs)\.min\.js|catalog\.js)$/;
const PRE = ["./", "sections.js", "zxing.min.js", "jspdf.min.js", "html2canvas.min.js", "catalog.js", "exceljs.min.js"];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all([
    ...PRE.map(f => fetch(new Request(f, {cache: "reload"})).then(res => res.ok && c.put(f, res)).catch(() => {})),
    c.addAll(["https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js", "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js"]).catch(() => {})])));
  self.skipWaiting();
});
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
const cacheFirst = r => caches.match(r).then(m => m || fetch(r).then(res => { if (res.ok) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(r, cp)); } return res; }));
const networkFirst = (url, key) => fetch(url, {cache: "no-cache", credentials: "same-origin"}).then(res => { if (res.ok) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(key, cp)); } return res; }).catch(() => caches.match(key));
self.addEventListener("fetch", e => {
  const r = e.request; if (r.method !== "GET") return;
  const u = new URL(r.url);
  if (SDK.test(r.url)) { e.respondWith(cacheFirst(r)); return; }
  if (u.origin !== location.origin) return;
  const root = new URL("./", self.registration.scope).pathname, rel = u.pathname.slice(root.length); // only the checklist, not sub-pages like futbol/
  if (!u.pathname.startsWith(root)) return;
  if (LIBS.test(rel)) { e.respondWith(cacheFirst(r)); return; }
  if (rel === "sections.js") { e.respondWith(networkFirst(u.href, "sections.js")); return; }
  if (rel === "" || rel === "index.html") e.respondWith(networkFirst(u.href, "./"));
});
