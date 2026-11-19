// Offline support: the page itself is fetched network-first (so updates arrive), the pinned Firebase SDK cache-first.
const CACHE = "tarqovu-v11";
const SDK = /^https:\/\/www\.gstatic\.com\/firebasejs\/10\.14\.1\//;
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(["./", "zxing.min.js", "jspdf.min.js", "html2canvas.min.js", "sections.js", "catalog.js", "exceljs.min.js", "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js", "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js"]).catch(() => c.add("./")))); self.skipWaiting(); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const r = e.request; if (r.method !== "GET") return;
  const u = new URL(r.url);
  if (SDK.test(r.url)) { e.respondWith(caches.match(r).then(m => m || fetch(r).then(res => { const cp = res.clone(); caches.open(CACHE).then(c => c.put(r, cp)); return res; }))); return; }
  const root = new URL("./", self.registration.scope).pathname; // only the checklist page, not sub-pages like futbol/
  if (u.origin === location.origin && /^((zxing|jspdf|html2canvas|exceljs)\.min\.js|sections\.js|catalog\.js)$/.test(u.pathname.slice(root.length))) { e.respondWith(caches.match(r).then(m => m || fetch(r).then(res => { const cp = res.clone(); caches.open(CACHE).then(c => c.put(r, cp)); return res; }))); return; }
  if (u.origin === location.origin && (u.pathname === root || u.pathname === root + "index.html")) {
    e.respondWith(fetch(r).then(res => { if (res.ok) { const cp = res.clone(); caches.open(CACHE).then(c => c.put("./", cp)); } return res; }).catch(() => caches.match("./")));
  }
});
