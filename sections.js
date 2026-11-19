/* Three sections on one page:
   1) Franke qəbul        – the existing receiving checklist (index.html)
   2) Restoran təhvili    – handover count of the restaurant, based on the same Franke list (what was received)
   3) Sifariş             – an order from the AzTürk catalogue (catalog.js) or the Franke list, with colours and
                            quantities per colour, exported as an Excel file with pictures or a PDF.
   The new sections keep their data in their own shared documents (yoxlama/tehvil, yoxlama/sifaris),
   offline-first like the main checklist. */
"use strict";

// ---------- a small shared store: one Firestore document, a local copy, unsent changes kept until confirmed ----------
function makeStore(docId, lsKey, onChange) {
  const S = { data: {}, unsent: new Set(), remote: null };
  try { S.data = JSON.parse(localStorage.getItem(lsKey) || "{}") || {}; S.unsent = new Set(JSON.parse(localStorage.getItem(lsKey + "-unsent") || "[]")); } catch (e) {}
  const saveLocal = () => { try { localStorage.setItem(lsKey, JSON.stringify(S.data)); localStorage.setItem(lsKey + "-unsent", JSON.stringify([...S.unsent])); } catch (e) {} };
  const send = k => {
    if (!S.remote) return; const v = S.data[k] ?? null;
    S.remote(k, v).then(() => { if (JSON.stringify(S.data[k] ?? null) === JSON.stringify(v)) { S.unsent.delete(k); saveLocal(); } }).catch(() => {});
  };
  S.set = (k, v) => { if (v == null) delete S.data[k]; else S.data[k] = v; S.unsent.add(k); saveLocal(); send(k); };
  S.patch = (k, p) => {
    const cur = Object.assign({}, S.data[k] || {}, p);
    for (const f of Object.keys(cur)) if (cur[f] == null || cur[f] === "" || (Array.isArray(cur[f]) && !cur[f].length)) delete cur[f];
    S.set(k, Object.keys(cur).length ? cur : null);
  };
  const connect = () => {
    const F = window.FS; if (!F || S.remote) return;
    const ref = F.fs.doc(F.db, "yoxlama", docId);
    S.remote = (k, v) => F.fs.setDoc(ref, { items: { [k]: v === null ? F.fs.deleteField() : v }, updatedAt: F.fs.serverTimestamp() }, { merge: true });
    [...S.unsent].forEach(send);
    F.fs.onSnapshot(ref, snap => {
      const d = snap.exists() ? JSON.parse(JSON.stringify(snap.data().items || {})) : {};
      for (const k of S.unsent) { if (S.data[k] !== undefined) d[k] = S.data[k]; else delete d[k]; } // this phone's unconfirmed edits win locally
      if (JSON.stringify(d) !== JSON.stringify(S.data)) { S.data = d; saveLocal(); onChange(); }
    }, () => { S.remote = null; });
  };
  if (window.FS) connect(); else addEventListener("fs-ready", connect);
  addEventListener("online", () => [...S.unsent].forEach(send));
  return S;
}
const esc2 = s => String(s ?? "").replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
const azn = v => { const s = Math.abs(v).toFixed(2).split("."); return (v < 0 ? "−" : "") + s[0].replace(/\B(?=(\d{3})+(?!\d))/g, " ") + "," + s[1] + " ₼"; };
const today = () => { const d = new Date(), p = n => String(n).padStart(2, "0"); return p(d.getDate()) + "." + p(d.getMonth() + 1) + "." + d.getFullYear(); };
const equipment = () => DATA.filter(it => !isFee(it));
// hand a finished file to the person: share sheet on phones, a download elsewhere
async function deliverFile(blob, name) { offerFile(blob, name); } // share / download / open, each from a fresh tap (index.html)

// a small form in the page's own dialog (prompt() is blocked in home-screen apps and in WhatsApp/Telegram browsers)
function formDialog(title, fields) {
  return new Promise(done => {
    const d = document.createElement("dialog"); d.className = "fdlg";
    d.innerHTML = `<form method="dialog"><b class="fdt"></b>${fields.map((f, i) => `<label><span></span><input data-i="${i}" autocomplete="off"></label>`).join("")}<div class="fdb"><button class="tool" value="x" type="button">Ləğv et</button><button class="tool primary" value="ok">Yadda saxla</button></div></form>`;
    d.querySelector(".fdt").textContent = title;
    d.querySelectorAll("label").forEach((l, i) => { l.querySelector("span").textContent = fields[i].label; const inp = l.querySelector("input"); inp.value = fields[i].value || ""; inp.placeholder = fields[i].ph || ""; });
    d.querySelector('[value="x"]').onclick = () => d.close("x");
    d.addEventListener("close", () => { const ok = d.returnValue === "ok"; const vals = ok ? [...d.querySelectorAll("input")].map(x => x.value.trim()) : null; d.remove(); done(vals); });
    document.body.append(d); d.showModal(); setTimeout(() => d.querySelector("input").focus(), 50);
  });
}

// ---------- section switch ----------
const SECTIONS = { qebul: "📦 Franke qəbul", tehvil: "🏪 Restoran təhvili", sifaris: "🧾 Sifariş", novbe: "🗓️ Növbə" };
let section = (() => { try { return localStorage.getItem("tarqovu-section") || "qebul"; } catch (e) { return "qebul"; } })();
function showSection(s) {
  section = SECTIONS[s] ? s : "qebul"; document.body.dataset.view = section;
  try { localStorage.setItem("tarqovu-section", section); } catch (e) {}
  [...$("mainNav").children].forEach(b => b.setAttribute("aria-pressed", b.dataset.s === section));
  $("pageTitle").textContent = { qebul: "Franke avadanlığının qəbulu", tehvil: "Restoranın təhvil sayımı", sifaris: "Sifariş", novbe: "Gecə növbəsi cədvəli" }[section];
  $("pageSub").innerHTML = {
    qebul: "Franke layihəsi 693107. <b>Sifariş 9152632</b> və <b>Təklif 9150395</b>. Hər sətri yoxlayıb statusunu qeyd edin.",
    tehvil: "Franke-dən qəbul edilmiş avadanlıq restorana təhvil verilərkən yerində sayılır. Say, vəziyyət və qeyd yazın, sonda təhvil-təslim aktı çıxarın.",
    sifaris: "AzTürk kataloqundan və ya Franke siyahısından məhsul seçin, hər rəngdən neçə ədəd lazım olduğunu yazın, Excel və ya PDF kimi göndərin.",
    novbe: "İşçilərin adlarını yazın: həftəlik gecə növbəsi özü bölünür, hər gecəyə bir nəfər. İstənilən günü əl ilə dəyişmək olar."
  }[section];
  if (section === "tehvil") renderTehvil();
  if (section === "sifaris") renderOrder();
  if (section === "novbe") renderRota();
  scrollTo({ top: 0 });
}
$("mainNav").onclick = e => { const b = e.target.closest("button[data-s]"); if (b) showSection(b.dataset.s); };

// =====================================================================================
// 2) RESTORAN TƏHVİLİ
// =====================================================================================
const T = makeStore("tehvil", "tarqovu-tehvil", () => { if (section === "tehvil") renderTehvil(); });
let tview = { st: "all", sec: "all", q: "" };
const received = it => { const s = status(it.k); return s === "none" ? 0 : gotCount(it); }; // what Franke actually delivered
function tStatus(it) {
  const r = T.data[it.k]; if (!r || r.n == null) return "none";
  if (r.dmg) return "dmg";
  return r.n >= received(it) ? "ok" : "miss";
}
const T_ST = { none: ["Sayılmayıb", "var(--line)"], ok: ["Tam", "var(--ok)"], miss: ["Çatışmır", "var(--warn)"], dmg: ["Zədəli", "var(--bad)"] };
function tSet(it, p) { askName(); T.patch(it.k, Object.assign({}, p, { by: me || null, at: Date.now() })); }
function tMatches(it) {
  if (tview.sec !== "all" && it.sec !== tview.sec) return false;
  if (tview.st !== "all" && tStatus(it) !== tview.st) return false;
  if (tview.q) { const h = (it.az + " " + it.en + " " + it.part + " " + (SEC_AZ[it.sec] || "")).toLowerCase(); if (!tview.q.toLowerCase().split(/\s+/).every(w => h.includes(w))) return false; }
  return true;
}
function renderTehvil() {
  const box = $("tehvilView"), eq = equipment();
  const c = { none: 0, ok: 0, miss: 0, dmg: 0 }; eq.forEach(it => c[tStatus(it)]++);
  const meta = T.data._meta || {};
  box.innerHTML = `
  <div class="sbar"><div class="wrap">
    <div class="stats"><div class="prog"><div class="lbl"><span>Sayılıb: <b>${eq.length - c.none}</b> / <b>${eq.length}</b> sətir</span><span>Qəbulda gəlib: <b>${eq.filter(it => received(it) > 0).length}</b> sətir</span></div>
      <div class="track"><i class="s-ok" style="width:${c.ok / eq.length * 100}%"></i><i class="s-miss" style="width:${c.miss / eq.length * 100}%"></i><i class="s-dmg" style="width:${c.dmg / eq.length * 100}%"></i></div></div>
      <div class="counts">${[["all", "Hamısı", eq.length, "var(--fg)"], ...Object.entries(T_ST).map(([k, [t, col]]) => [k, t, c[k], col])].map(([v, t, n, col]) => `<button class="chip" type="button" data-tst="${v}" aria-pressed="${tview.st === v}"><span class="dot" style="background:${col}"></span>${t} ${n}</button>`).join("")}</div></div>
    <div class="filters">
      <select id="tSec" aria-label="Bölmə"><option value="all">Bütün bölmələr</option>${[...new Set(eq.map(i => i.sec))].map(s => `<option value="${esc2(s)}" ${tview.sec === s ? "selected" : ""}>${esc2(SEC_AZ[s] || s)}</option>`).join("")}</select>
      <input type="search" id="tQ" placeholder="Axtar: ad, kod…" value="${esc2(tview.q)}" aria-label="Axtar">
      <div class="tools"><button class="tool primary" id="tScan" type="button">📷 Barkodla say</button><button class="tool primary" id="tXls" type="button">Excel-ə yüklə</button><button class="tool" id="tAct" type="button">📄 Təhvil aktı</button><button class="tool" id="tMeta" type="button">✏️ Tərəflər</button></div>
      <span class="saveinfo">${meta.from || meta.to ? `Təhvil verən: <b>${esc2(meta.from || "—")}</b> · Qəbul edən: <b>${esc2(meta.to || "—")}</b>` : "Tərəfləri yazmaq üçün “✏️ Tərəflər”"}</span>
    </div></div></div>
  <div class="wrap" id="tList"></div>`;
  box.querySelectorAll("[data-tst]").forEach(b => b.onclick = () => { tview.st = tview.st === b.dataset.tst ? "all" : b.dataset.tst; renderTehvil(); });
  $("tSec").onchange = e => { tview.sec = e.target.value; tList(); };
  let qt; $("tQ").oninput = e => { clearTimeout(qt); qt = setTimeout(() => { tview.q = e.target.value.trim(); tList(); }, 150); };
  $("tScan").onclick = () => scanStart();
  $("tXls").onclick = tehvilExcel; $("tAct").onclick = tehvilAct; $("tMeta").onclick = tehvilMeta;
  tList();
}
function tList() {
  const list = $("tList"); list.textContent = ""; const rows = equipment().filter(tMatches);
  if (!rows.length) { list.innerHTML = '<p class="empty">Bu filtrə uyğun sətir yoxdur.</p>'; return; }
  let lastSec = null;
  for (const it of rows) {
    if (it.sec !== lastSec) { lastSec = it.sec; const h = document.createElement("div"); h.className = "sec-h"; h.innerHTML = `<h3>${esc2(SEC_AZ[it.sec] || it.sec)}</h3>`; list.append(h); }
    list.append(tRow(it));
  }
}
function tRow(it) {
  const r = T.data[it.k] || {}, st = tStatus(it), rec = received(it), n = r.n ?? null;
  const el = document.createElement("article"); el.className = "item"; el.dataset.k = it.k; el.dataset.s = st === "none" ? "" : st;
  el.innerHTML = `<div class="thumb ${IMG[it.k] ? "" : "none"}">${IMG[it.k] ? `<img src="${IMG[it.k]}" alt="" loading="lazy">` : "Şəkil yoxdur"}</div>
    <div class="info"><p class="az"></p><p class="en"></p><div class="ids"><span>${it.src === "order" ? "Sifariş" : "Təklif"} · sətir <b>${it.line}</b></span><span>Kod <b>${esc2(it.part)}</b></span><span>Qəbulda: <b>${num(rec)} / ${num(it.qty)}</b></span>${r.at ? `<span class="who">👤 ${esc2(r.by || "")} · ${fmtAt(r.at)}</span>` : ""}</div></div>
    <div class="right"><div class="cnt2"><button class="tool" data-a="minus" type="button" ${!n ? "disabled" : ""}>−</button><span><b>${n ?? "—"}</b> / ${num(rec)}</span><button class="tool" data-a="plus" type="button">+1</button></div>
      <div class="st"><button type="button" data-a="full" aria-pressed="${st === "ok"}">✓ Tam</button><button type="button" data-a="dmg" data-v="dmg" aria-pressed="${st === "dmg"}">Zədəli</button></div>
      <span class="tstat" style="color:${T_ST[st][1]}">${T_ST[st][0]}${st === "miss" ? ` (${num(rec - n)} çatışmır)` : ""}</span></div>
    <div class="extra"></div>`;
  el.querySelector(".az").textContent = it.az; el.querySelector(".en").textContent = it.en;
  if (IMG[it.k]) el.querySelector(".thumb").onclick = () => openImg(it);
  let gone = false; // replacing the row blurs its fields, which can fire another change: draw once
  const redraw = () => { if (gone || !el.isConnected) return; gone = true; el.replaceWith(tRow(it)); };
  el.querySelector('[data-a="minus"]').onclick = () => { tSet(it, { n: Math.max(0, (n || 0) - 1) }); redraw(); renderTehvilStats(); };
  el.querySelector('[data-a="plus"]').onclick = () => { tSet(it, { n: (n || 0) + 1 }); redraw(); renderTehvilStats(); };
  el.querySelector('[data-a="full"]').onclick = () => { tSet(it, st === "ok" ? { n: null, dmg: null } : { n: rec, dmg: null }); redraw(); renderTehvilStats(); };
  el.querySelector('[data-a="dmg"]').onclick = () => { tSet(it, { dmg: st === "dmg" ? null : true, n: n ?? rec }); redraw(); renderTehvilStats(); };
  const ex = el.querySelector(".extra"), ta = document.createElement("textarea");
  ta.rows = 1; ta.placeholder = "Qeyd: harada qoyulub, nə çatışmır, hansı zədə…"; ta.value = r.note || "";
  ta.onchange = () => tSet(it, { note: ta.value.trim() || null });
  if (r.note || st === "miss" || st === "dmg") ex.append(ta);
  else { const nb = document.createElement("button"); nb.className = "notebtn"; nb.type = "button"; nb.textContent = "+ Qeyd əlavə et"; nb.onclick = () => { nb.replaceWith(ta); ta.focus(); }; ex.append(nb); }
  return el;
}
// cheap refresh of the counters only (the row itself was redrawn)
function renderTehvilStats() { clearTimeout(renderTehvilStats.t); renderTehvilStats.t = setTimeout(() => { const y = scrollY; renderTehvil(); scrollTo(0, y); }, 600); }
async function tehvilMeta() {
  const m = T.data._meta || {};
  const v = await formDialog("Təhvil tərəfləri", [{ label: "Təhvil verən (təşkilat, ad, vəzifə)", value: m.from || "MOK Group LLC" }, { label: "Qəbul edən (restoran müdiri: ad, vəzifə)", value: m.to || "", ph: "Məs.: Restoran müdiri Əli Məmmədov" }]);
  if (!v) return; T.patch("_meta", { from: v[0], to: v[1] }); renderTehvil();
}
function tehvilRows() {
  return equipment().map(it => { const r = T.data[it.k] || {}, st = tStatus(it), rec = received(it);
    return { "Sənəd": it.src === "order" ? "Sifariş 9152632" : "Təklif 9150395", "Bölmə": SEC_AZ[it.sec] || it.sec, "Sətir": it.line, "Kod": it.part, "Ad (AZ)": it.az, "Ad (EN)": it.en,
      "Sifariş sayı": it.qty, "Qəbulda gəlib": rec, "Təhvildə sayılıb": r.n ?? "", "Fərq": r.n == null ? "" : r.n - rec, "Status": T_ST[st][0], "Qeyd": r.note || "", "Sayan": r.by || "", "Vaxt": r.at ? fmtAt(r.at) : "" }; });
}
function tehvilExcel() {
  if (!window.XLSX) return toast("Excel modulu yüklənmədi");
  const rows = tehvilRows(), wb = XLSX.utils.book_new(), cols = [16, 22, 7, 14, 42, 36, 9, 9, 10, 7, 12, 40, 16, 13].map(w => ({ wch: w }));
  const add = (name, list) => { if (!list.length) return; const ws = XLSX.utils.json_to_sheet(list); ws["!cols"] = cols; ws["!autofilter"] = { ref: ws["!ref"] }; XLSX.utils.book_append_sheet(wb, ws, name); };
  const m = T.data._meta || {};
  const sum = XLSX.utils.aoa_to_sheet([["Restoranın təhvil sayımı"], ["Popeyes, Tarqovu filialı, Nizami küç. 62A"], ["Tarix", today()], ["Təhvil verən", m.from || ""], ["Qəbul edən", m.to || ""], [],
    ["Göstərici", "Say"], ["Avadanlıq sətri", rows.length], ...Object.entries(T_ST).map(([k, [t]]) => [t, rows.filter(r => r.Status === t).length])]);
  sum["!cols"] = [{ wch: 26 }, { wch: 40 }]; XLSX.utils.book_append_sheet(wb, sum, "Xülasə");
  add("Bütün sətirlər", rows); add("Problemlər", rows.filter(r => r.Status === "Çatışmır" || r.Status === "Zədəli")); add("Sayılmayanlar", rows.filter(r => r.Status === "Sayılmayıb"));
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  deliverFile(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "Tarqovu_restoran_tehvili_" + new Date().toISOString().slice(0, 10) + ".xlsx");
}
async function tehvilAct() {
  if (!me) { askName(true); return; }
  const eq = equipment(), m = T.data._meta || {}, c = { none: 0, ok: 0, miss: 0, dmg: 0 }; eq.forEach(it => c[tStatus(it)]++);
  const d = new Date(), p2 = n => String(n).padStart(2, "0"), no = "RT-" + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate());
  actPdfName = "Tarqovu_restoran_tehvil_akti_" + d.toISOString().slice(0, 10) + ".pdf";
  const prob = eq.filter(it => ["miss", "dmg"].includes(tStatus(it)));
  const B = [];
  B.push({ html: `<div class="a-head"><div><div class="a-k">Popeyes · Tarqovu filialı</div><h1>Restoranın təhvil-təslim aktı</h1><div class="a-no">№ ${no}</div></div><div class="a-date">${today()}<br>${hhmm()}</div></div>
    <table class="a-meta"><tr><th>Obyekt</th><td>Popeyes, Tarqovu filialı, Bakı, Nizami küç. 62A</td></tr><tr><th>Avadanlıq</th><td>Franke, layihə 693107 (sifariş 9152632, təklif 9150395)</td></tr>
    <tr><th>Təhvil verən</th><td>${esc2(m.from || "—")}</td></tr><tr><th>Qəbul edən</th><td>${esc2(m.to || "—")}</td></tr><tr><th>Sayımı aparan</th><td>${esc2([...new Set(eq.map(it => (T.data[it.k] || {}).by).filter(Boolean))].join(", ") || me)}</td></tr></table>` });
  B.push({ html: `<h2>1. Yekun</h2><table class="a-sum"><tr><th>Avadanlıq sətri</th><th>Tam</th><th>Çatışmır</th><th>Zədəli</th><th>Sayılmayıb</th></tr><tr><td>${eq.length}</td><td>${c.ok}</td><td>${c.miss}</td><td>${c.dmg}</td><td>${c.none}</td></tr></table>` });
  if (prob.length) B.push({ h2: "2. Çatışmayan və zədəli avadanlıq", cols: [5, 13, 11, 33, 9, 9, 9, 11], head: "<th>№</th><th>Sətir</th><th>Kod</th><th>Ad</th><th>Qəbulda</th><th>Sayılıb</th><th>Status</th><th>Qeyd</th>",
    rows: prob.map((it, i) => { const r = T.data[it.k] || {}; return `<tr><td>${i + 1}</td><td>${it.src === "order" ? "Sif." : "Təkl."} ${it.line}</td><td>${esc2(it.part)}</td><td>${esc2(it.az)}</td><td>${num(received(it))}</td><td>${r.n ?? "—"}</td><td><b>${T_ST[tStatus(it)][0]}</b></td><td>${esc2(r.note || "")}</td></tr>`; }) });
  else B.push({ html: "<h2>2. Çatışmayan və zədəli avadanlıq</h2><p>Qeyd olunmayıb.</p>" });
  B.push({ html: `<h2>İmzalar</h2><p>Yuxarıda göstərilən avadanlıq restoranda sayılmış, qeyd olunan çatışmazlıq və zədələrlə təhvil verilmiş və qəbul edilmişdir.</p><div class="a-sign">
    <div><b>Təhvil verdi</b><p>${esc2(m.from || "Ad, soyad: ____________________")}</p><p>İmza: __________  Tarix: __________</p></div>
    <div><b>Qəbul etdi</b> (restoran)<p>${esc2(m.to || "Ad, soyad: ____________________")}</p><p>İmza: __________  Tarix: __________</p></div></div>` });
  B.push({ brk: true });
  B.push({ h2: "Əlavə: bütün avadanlıq", small: true, cols: [12, 11, 43, 8, 8, 8, 10], head: "<th>Sətir</th><th>Kod</th><th>Ad</th><th>Sifariş</th><th>Qəbulda</th><th>Sayılıb</th><th>Status</th>",
    rows: eq.map(it => { const r = T.data[it.k] || {}; return `<tr><td>${it.src === "order" ? "Sif." : "Təkl."} ${it.line}</td><td>${esc2(it.part)}</td><td>${esc2(it.az)}</td><td>${num(it.qty)}</td><td>${num(received(it))}</td><td>${r.n ?? "—"}</td><td>${T_ST[tStatus(it)][0]}</td></tr>`; }) });
  paginate(B, no); await Promise.all([...$("actSrc").querySelectorAll("img")].map(i => i.decode().catch(() => {})));
  showActView("Restoranın təhvil-təslim aktı");
}
// the barcode scanner counts for the handover while this section is open
window.scanHook = (code) => {
  if (section !== "tehvil") return false;
  const hits = findByCode(code), res = $("scanRes"); res.textContent = "";
  const cd = document.createElement("div"); cd.className = "scan-code"; cd.textContent = "Oxunan kod: " + code + " · təhvil sayımı"; res.append(cd);
  if (!hits.length) { scanBeep("bad"); const p = document.createElement("p"); p.style.margin = "0"; p.textContent = "Bu kod Franke siyahısında tapılmadı."; res.append(p); return true; }
  const it = hits.find(h => ((T.data[h.k] || {}).n || 0) < received(h));
  if (!it) { scanBeep("bad"); toast("Bu kodla bütün sətirlər artıq tam sayılıb (qəbulda gələn qədər)"); const p = document.createElement("p"); p.style.margin = "0"; p.textContent = "Artıq tam sayılıb. Artıq ədəd varsa, siyahıda əl ilə +1 edin."; res.append(p); return true; }
  const n = ((T.data[it.k] || {}).n || 0) + 1; tSet(it, { n });
  scanBeep(n >= received(it) ? "done" : "ok"); toast(`${it.az}: ${n} / ${num(received(it))}`);
  const p = document.createElement("div"); p.className = "scan-hit"; p.innerHTML = `<img alt="" ${IMG[it.k] ? `src="${IMG[it.k]}"` : ""}><div><div class="t"></div><div class="m">Təhvildə sayıldı: <b>${n}</b> / ${num(received(it))}</div></div>`;
  p.querySelector(".t").textContent = it.az; res.append(p);
  const row = document.querySelector(`#tList .item[data-k="${it.k}"]`); if (row) row.replaceWith(tRow(it));
  return true;
};

// =====================================================================================
// 3) SİFARİŞ
// =====================================================================================
const O = makeStore("sifaris", "tarqovu-sifaris", () => { if (section === "sifaris") renderOrder(); });
const COLORS = ["Standart", "Ağ", "Qara", "Qırmızı", "Mavi", "Yaşıl", "Sarı", "Boz", "Narıncı", "Çəhrayı", "Bənövşəyi", "Qəhvəyi", "Şəffaf"];
const TR_COL = { beyaz: "Ağ", ag: "Ağ", ağ: "Ağ", siyah: "Qara", qara: "Qara", kırmızı: "Qırmızı", kirmizi: "Qırmızı", qırmızı: "Qırmızı", mavi: "Mavi", yeşil: "Yaşıl", yaşıl: "Yaşıl", sarı: "Sarı", gri: "Boz", boz: "Boz", turuncu: "Narıncı", pembe: "Çəhrayı", mor: "Bənövşəyi" };
const SUPPLIERS = {
  az: { t: "AzTürk Package", sub: "Bakı şəh. Təbriz küç. 2 · +994 10 250 57 52 · corp.sales@azturkpackage.az", cur: azn },
  fr: { t: "Franke Foodservice", sub: "Franke layihəsi 693107 · FS-SALES.EU@FRANKE.COM", cur: v => money(v) }
};
let oview = { sup: "az", q: "", only: false };
let catalogReady = null;
const loadCatalog = () => catalogReady = catalogReady || (window.CATALOG ? Promise.resolve() : loadScript("catalog.js"));
// one product list for both suppliers: {key, sup, code, t, sub, price, img}
function products(sup) {
  if (sup === "az") return (window.CATALOG || []).map(c => ({ key: "az:" + c.id, sup, code: "№ " + c.id, t: c.t, sub: "", price: c.price, img: c.img }));
  return equipment().map(it => ({ key: "fr:" + it.k, sup, code: it.part, t: it.az, sub: it.en, price: it.unit, img: IMG[it.k] || null }));
}
const productByKey = key => products(key.slice(0, 2)).find(p => p.key === key);
// colours suggested by the product name: "(ağ - qırmızı - qara)", "Mavi Beyaz", "rəngli"
function colorHints(t) {
  const low = t.toLowerCase(), found = [];
  for (const [w, c] of Object.entries(TR_COL)) if (new RegExp("(^|[^a-zəıöüğşç])" + w + "($|[^a-zəıöüğşç])").test(low) && !found.includes(c)) found.push(c);
  if (/rəngli|renkli|rengli/.test(low)) for (const c of ["Qırmızı", "Mavi", "Yaşıl", "Sarı"]) if (!found.includes(c)) found.push(c);
  return found;
}
const lineQty = r => (r && r.lines || []).reduce((a, l) => a + (Number(l.q) || 0), 0);
function orderSummary(sup) {
  const keys = Object.keys(O.data).filter(k => k.startsWith(sup + ":") && lineQty(O.data[k]) > 0);
  let qty = 0, sum = 0; for (const k of keys) { const p = productByKey(k), q = lineQty(O.data[k]); qty += q; sum += (p ? p.price || 0 : 0) * q; }
  return { keys, qty, sum };
}
async function renderOrder() {
  const box = $("orderView");
  if (oview.sup === "az" && !window.CATALOG) { box.innerHTML = '<p class="empty">Kataloq yüklənir…</p>'; try { await loadCatalog(); } catch (e) { box.innerHTML = '<p class="empty">Kataloq yüklənmədi. İnternetlə səhifəni yeniləyin.</p>'; return; } }
  const S = SUPPLIERS[oview.sup], sm = orderSummary(oview.sup);
  box.innerHTML = `
  <div class="sbar"><div class="wrap">
    <div class="filters">
      <div class="seg" id="oSup">${Object.entries(SUPPLIERS).map(([k, s]) => { const n = orderSummary(k).keys.length; return `<button type="button" data-v="${k}" aria-pressed="${oview.sup === k}">${k === "az" ? "AzTürk kataloqu" : "Franke siyahısı"}${n ? ` · ${n}` : ""}</button>`; }).join("")}</div>
      <input type="search" id="oQ" placeholder="Axtar məhsul…" value="${esc2(oview.q)}" aria-label="Axtar">
      <label class="chip" style="cursor:pointer"><input type="checkbox" id="oOnly" ${oview.only ? "checked" : ""} style="margin:0 4px 0 0">Yalnız sifarişdəkilər</label>
    </div>
    <div class="ocart"><span>🧾 <b>${esc2(S.t)}</b>: ${sm.keys.length} məhsul · ${sm.qty} ədəd · <b>${S.cur(sm.sum)}</b></span>
      <span class="tools" style="display:flex;gap:6px;flex-wrap:wrap"><button class="tool" id="oMeta" type="button">✏️ Sifariş məlumatı</button><button class="tool primary" id="oXls" type="button" ${sm.keys.length ? "" : "disabled"}>Excel (şəkilli)</button><button class="tool primary" id="oPdf" type="button" ${sm.keys.length ? "" : "disabled"}>PDF</button><button class="tool" id="oClear" type="button" ${sm.keys.length ? "" : "disabled"}>Təmizlə</button></span></div>
  </div></div>
  <div class="wrap ogrid" id="oList"></div>
  <datalist id="colorList">${COLORS.map(c => `<option value="${c}">`).join("")}</datalist>`;
  $("oSup").onclick = e => { const b = e.target.closest("button"); if (!b) return; oview.sup = b.dataset.v; renderOrder(); };
  let qt; $("oQ").oninput = e => { clearTimeout(qt); qt = setTimeout(() => { oview.q = e.target.value.trim(); oList(); }, 150); };
  $("oOnly").onchange = e => { oview.only = e.target.checked; oList(); };
  $("oMeta").onclick = orderMeta; $("oXls").onclick = orderExcel; $("oPdf").onclick = orderPdf;
  $("oClear").onclick = () => { if (!confirm(`${S.t} sifarişindəki bütün məhsullar silinsin?`)) return; for (const k of orderSummary(oview.sup).keys) O.set(k, null); renderOrder(); };
  oList();
}
function oList() {
  const list = $("oList"); list.textContent = "";
  const q = oview.q.toLowerCase().split(/\s+/).filter(Boolean);
  const rows = products(oview.sup).filter(p => (!oview.only || lineQty(O.data[p.key]) > 0) && q.every(w => (p.t + " " + p.sub + " " + p.code).toLowerCase().includes(w)));
  if (!rows.length) { list.innerHTML = '<p class="empty">Uyğun məhsul yoxdur.</p>'; return; }
  for (const p of rows) list.append(oCard(p));
}
function oCard(p) {
  const r = O.data[p.key] || {}, lines = r.lines || [], q = lineQty(r), S = SUPPLIERS[p.sup];
  const el = document.createElement("article"); el.className = "ocard" + (q ? " in" : "");
  el.innerHTML = `<div class="oimg">${p.img ? `<img src="${p.img}" alt="" loading="lazy">` : "<span>Şəkil yoxdur</span>"}</div>
    <div class="obody"><div class="ot"></div>${p.sub ? '<div class="osub"></div>' : ""}<div class="ometa"><span>${esc2(p.code)}</span><b>${p.price != null ? S.cur(p.price) : ""}</b></div>
    <div class="olines"></div>
    <div class="oacts"><button class="tool" type="button" data-a="add">${lines.length ? "+ Rəng" : "+ Sifarişə əlavə et"}</button>${q ? `<span class="oq">Cəmi: <b>${q}</b> ədəd · ${S.cur((p.price || 0) * q)}</span>` : ""}</div></div>`;
  el.querySelector(".ot").textContent = p.t; if (p.sub) el.querySelector(".osub").textContent = p.sub;
  const save = nl => { askName(); O.patch(p.key, { lines: nl.filter(l => l.c || l.q), by: me || null, at: Date.now() }); };
  const cur = () => ((O.data[p.key] || {}).lines || []).map(l => Object.assign({}, l)); // the stored lines, not the copy from render time
  let gone = false; // replacing the card blurs its fields, which can fire another change: draw once
  const redraw = () => { if (!gone && el.isConnected) { gone = true; el.replaceWith(oCard(p)); } refreshCart(); };
  const box = el.querySelector(".olines");
  lines.forEach((l, i) => {
    const row = document.createElement("div"); row.className = "oline";
    row.innerHTML = `<input list="colorList" placeholder="Rəng" aria-label="Rəng"><input type="number" min="0" step="1" inputmode="numeric" placeholder="Say" aria-label="Say"><button type="button" class="tool" aria-label="Sil">✕</button>`;
    const [ci, qi, del] = row.children; ci.value = l.c || ""; qi.value = l.q || "";
    ci.onchange = () => { const nl = cur(); nl[i] = { c: ci.value.trim(), q: Number(qi.value) || 0 }; save(nl); refreshCart(); };
    qi.onchange = () => { const nl = cur(); nl[i] = { c: ci.value.trim(), q: Math.max(0, Math.round(Number(qi.value) || 0)) }; save(nl); redraw(); };
    del.onclick = () => { const nl = cur(); nl.splice(i, 1); save(nl); redraw(); };
    box.append(row);
  });
  if (r.note || lines.length) { const ta = document.createElement("input"); ta.className = "onote"; ta.placeholder = "Qeyd (ölçü, model, istəniləcək tarix…)"; ta.value = r.note || ""; ta.onchange = () => { O.patch(p.key, { note: ta.value.trim() || null }); }; box.append(ta); }
  el.querySelector('[data-a="add"]').onclick = () => {
    const now = cur(), hints = colorHints(p.t), used = now.map(l => l.c);
    const next = hints.find(h => !used.includes(h)) || (now.length ? "" : "Standart");
    save([...now, { c: next, q: 1 }]); redraw();
  };
  if (p.img) el.querySelector(".oimg").onclick = () => { $("dlgDel").hidden = true; $("dlgImg").src = p.img; $("dlgAz").textContent = p.t; $("dlgEn").textContent = p.code; $("dlg").showModal(); };
  return el;
}
function refreshCart() { clearTimeout(refreshCart.t); refreshCart.t = setTimeout(() => { const y = scrollY, f = document.activeElement && document.activeElement.closest(".ocard"); if (f) return; renderOrder().then(() => scrollTo(0, y)); }, 900); }
async function orderMeta() {
  const k = "_meta:" + oview.sup, m = O.data[k] || {};
  const v = await formDialog("Sifariş məlumatı: " + SUPPLIERS[oview.sup].t, [
    { label: "Sifariş nömrəsi", value: m.no || "TQ-" + new Date().toISOString().slice(0, 10).replace(/-/g, "") },
    { label: "Sifariş verən (ad, telefon)", value: m.who || me || "" },
    { label: "Çatdırılma ünvanı", value: m.addr || "Popeyes, Tarqovu filialı, Bakı, Nizami küç. 62A" },
    { label: "Qeyd (istəniləcək tarix, ödəniş və s.)", value: m.note || "" }]);
  if (!v) return; O.patch(k, { no: v[0], who: v[1], addr: v[2], note: v[3] }); toast("Sifariş məlumatı yadda saxlanıldı"); renderOrder();
}
function orderLines(sup) {
  const out = [];
  for (const k of orderSummary(sup).keys) { const p = productByKey(k), r = O.data[k]; if (!p) continue; out.push({ p, lines: r.lines.filter(l => Number(l.q) > 0), note: r.note || "", q: lineQty(r) }); }
  return out;
}
// pictures go into Excel as white squares with the photo centred, so a square cell never stretches them
function squareImg(src, size = 240) {
  return new Promise(ok => { const im = new Image(); im.onload = () => { const c = document.createElement("canvas"); c.width = c.height = size; const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, size, size);
    const k = Math.min((size - 16) / im.width, (size - 16) / im.height), w = im.width * k, h = im.height * k; x.drawImage(im, (size - w) / 2, (size - h) / 2, w, h); ok(c.toDataURL("image/jpeg", .88)); }; im.onerror = () => ok(null); im.src = src; });
}
async function orderExcel() {
  const sup = oview.sup, S = SUPPLIERS[sup], m = O.data["_meta:" + sup] || {}, L = orderLines(sup); if (!L.length) return;
  const btn = $("oXls"); btn.disabled = true; btn.textContent = "Hazırlanır…";
  try {
    await loadScript("exceljs.min.js");
    const wb = new ExcelJS.Workbook(); wb.creator = "Tarqovu"; const ws = wb.addWorksheet("Sifariş", { pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
    ws.columns = [{ width: 5 }, { width: 14.5 }, { width: 44 }, { width: 13 }, { width: 16 }, { width: 8 }, { width: 13 }, { width: 14 }, { width: 28 }];
    const gold = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8590C" } }, thin = { style: "thin", color: { argb: "FFBBBBBB" } }, border = { top: thin, left: thin, bottom: thin, right: thin };
    ws.mergeCells("A1:I1"); ws.getCell("A1").value = "Sifariş: " + S.t; ws.getCell("A1").font = { size: 16, bold: true };
    const info = [["Sifariş №", m.no || "—"], ["Tarix", today()], ["Sifariş verən", m.who || me || "—"], ["Çatdırılma ünvanı", m.addr || "Popeyes, Tarqovu filialı, Bakı, Nizami küç. 62A"], ["Təchizatçı", S.t + " · " + S.sub], ["Qeyd", m.note || ""]];
    info.forEach(([a, b], i) => { const r = ws.getRow(2 + i); r.getCell(1).value = a; ws.mergeCells(2 + i, 1, 2 + i, 2); r.getCell(3).value = b; ws.mergeCells(2 + i, 3, 2 + i, 9); r.getCell(1).font = { bold: true }; });
    const hr = ws.getRow(9); ["№", "Şəkil", "Məhsul", "Kod", "Rəng", "Say", "Vahid qiymət", "Cəmi", "Qeyd"].forEach((h, i) => { const c = hr.getCell(i + 1); c.value = h; c.font = { bold: true, color: { argb: "FFFFFFFF" } }; c.fill = gold; c.border = border; c.alignment = { vertical: "middle", horizontal: "center" }; });
    hr.height = 22;
    let r = 10, total = 0;
    const pics = await Promise.all(L.map(x => x.p.img ? squareImg(x.p.img) : null));
    L.forEach((x, i) => {
      const start = r, cur = sup === "az" ? '#,##0.00 "₼"' : '#,##0.00 "€"';
      for (const l of x.lines) {
        const row = ws.getRow(r); row.height = Math.max(30, 78 / x.lines.length + 6);
        row.getCell(5).value = l.c || "Standart"; row.getCell(6).value = Number(l.q); row.getCell(7).value = x.p.price || 0; row.getCell(8).value = { formula: `F${r}*G${r}`, result: (x.p.price || 0) * l.q };
        row.getCell(7).numFmt = cur; row.getCell(8).numFmt = cur; total += (x.p.price || 0) * l.q; r++;
      }
      const end = r - 1;
      for (const col of [1, 2, 3, 4, 9]) if (end > start) ws.mergeCells(start, col, end, col);
      ws.getCell(start, 1).value = i + 1; ws.getCell(start, 3).value = x.p.t + (x.p.sub ? "\n" + x.p.sub : ""); ws.getCell(start, 4).value = x.p.code; ws.getCell(start, 9).value = x.note;
      if (end - start + 1 < 2) ws.getRow(start).height = 78;
      for (let rr = start; rr <= end; rr++) for (let cc = 1; cc <= 9; cc++) { const c = ws.getCell(rr, cc); c.border = border; c.alignment = { vertical: "middle", wrapText: true, horizontal: cc === 3 || cc === 9 ? "left" : "center" }; }
      // anchored to both corners of the (merged) picture cell: phone viewers and Google Sheets show these too
      if (pics[i]) { const id = wb.addImage({ base64: pics[i], extension: "jpeg" }); ws.addImage(id, { tl: { col: 1, row: start - 1 }, br: { col: 2, row: end }, editAs: "oneCell" }); }
    });
    const tr = ws.getRow(r); tr.getCell(5).value = "Cəmi"; tr.getCell(6).value = { formula: `SUM(F10:F${r - 1})`, result: L.reduce((a, x) => a + x.q, 0) }; tr.getCell(8).value = { formula: `SUM(H10:H${r - 1})`, result: total };
    tr.getCell(8).numFmt = sup === "az" ? '#,##0.00 "₼"' : '#,##0.00 "€"'; [5, 6, 8].forEach(c => { tr.getCell(c).font = { bold: true }; tr.getCell(c).border = border; });
    if (sup === "az") ws.getCell(r + 1, 3).value = "Qiymətlər AzTürk Package qiymət kataloqu (07.02.2026) üzrədir, ƏDV daxil.";
    const buf = await wb.xlsx.writeBuffer();
    await deliverFile(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `Sifaris_${sup === "az" ? "AzTurk" : "Franke"}_${(m.no || today()).replace(/[^\w.-]+/g, "_")}.xlsx`);
  } catch (e) { toast("Excel hazırlamaq olmadı: " + (e && e.message || e)); }
  btn.disabled = false; btn.textContent = "Excel (şəkilli)";
}
async function orderPdf() {
  const sup = oview.sup, S = SUPPLIERS[sup], m = O.data["_meta:" + sup] || {}, L = orderLines(sup); if (!L.length) return;
  const no = m.no || "TQ-" + new Date().toISOString().slice(0, 10).replace(/-/g, "");
  actPdfName = `Sifaris_${sup === "az" ? "AzTurk" : "Franke"}_${no.replace(/[^\w.-]+/g, "_")}.pdf`;
  let total = 0; L.forEach(x => total += (x.p.price || 0) * x.q);
  const B = [{ html: `<div class="a-head"><div><div class="a-k">Popeyes · Tarqovu filialı</div><h1>Sifariş: ${esc2(S.t)}</h1><div class="a-no">№ ${esc2(no)}</div></div><div class="a-date">${today()}</div></div>
    <table class="a-meta"><tr><th>Təchizatçı</th><td>${esc2(S.t)}<br><small>${esc2(S.sub)}</small></td></tr><tr><th>Sifariş verən</th><td>${esc2(m.who || me || "—")}</td></tr><tr><th>Çatdırılma ünvanı</th><td>${esc2(m.addr || "Popeyes, Tarqovu filialı, Bakı, Nizami küç. 62A")}</td></tr>${m.note ? `<tr><th>Qeyd</th><td>${esc2(m.note)}</td></tr>` : ""}</table>` },
    { h2: "Məhsullar", cols: [5, 14, 33, 18, 8, 11, 11], head: "<th>№</th><th>Şəkil</th><th>Məhsul</th><th>Rəng və say</th><th>Cəmi say</th><th>Qiymət</th><th>Məbləğ</th>",
      rows: L.map((x, i) => `<tr><td>${i + 1}</td><td>${x.p.img ? `<img src="${x.p.img}" style="width:86px;height:70px;object-fit:contain">` : ""}</td><td><b>${esc2(x.p.t)}</b><div class="a-en">${esc2(x.p.code)}${x.p.sub ? " · " + esc2(x.p.sub) : ""}</div>${x.note ? `<div class="a-en">Qeyd: ${esc2(x.note)}</div>` : ""}</td><td>${x.lines.map(l => `${esc2(l.c || "Standart")}: <b>${l.q}</b>`).join("<br>")}</td><td><b>${x.q}</b></td><td class="r">${x.p.price != null ? S.cur(x.p.price) : ""}</td><td class="r">${S.cur((x.p.price || 0) * x.q)}</td></tr>`) },
    { html: `<p style="text-align:right;font-size:14px;margin-top:10px">Cəmi: <b>${L.reduce((a, x) => a + x.q, 0)} ədəd</b> · <b>${S.cur(total)}</b>${sup === "az" ? "<br><small>Qiymətlər AzTürk Package kataloqu (07.02.2026) üzrə, ƏDV daxil.</small>" : ""}</p>
      <div class="a-sign" style="margin-top:30px"><div><b>Sifariş verdi</b><p>${esc2(m.who || me || "____________________")}</p><p>İmza: __________</p></div><div><b>Qəbul etdi</b> (${esc2(S.t)})<p>Ad, soyad: ____________________</p><p>İmza: __________  Tarix: __________</p></div></div>` }];
  paginate(B, no); await Promise.all([...$("actSrc").querySelectorAll("img")].map(i => i.decode().catch(() => {})));
  showActView("Sifariş: " + S.t);
}

// =====================================================================================
// 4) NÖVBƏ – a weekly night-shift rota: one person per night, a continuous round robin (fair over the weeks,
//    nobody works two nights in a row); any night can be changed by hand.
// =====================================================================================
const N = makeStore("novbe", "tarqovu-novbe", () => { if (section === "novbe") renderRota(); });
const WD = ["Bazar ertəsi", "Çərşənbə axşamı", "Çərşənbə", "Cümə axşamı", "Cümə", "Şənbə", "Bazar"];
const WD_SHORT = ["B.e.", "Ç.a.", "Ç.", "C.a.", "C.", "Ş.", "B."];
const DAY = 864e5, ANCHOR = new Date(2026, 0, 5, 12); // a Monday: the round robin counts from here
const p2n = n => String(n).padStart(2, "0");
const dmy = d => p2n(d.getDate()) + "." + p2n(d.getMonth() + 1) + "." + d.getFullYear();
const dm = d => p2n(d.getDate()) + "." + p2n(d.getMonth() + 1);
const isoDay = d => d.getFullYear() + "-" + p2n(d.getMonth() + 1) + "-" + p2n(d.getDate());
function mondayOf(d) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12); x.setDate(x.getDate() - (x.getDay() + 6) % 7); return x; }
let rotaMonday = mondayOf(new Date());
const rotaCfg = () => Object.assign({ names: [], start: "23:00", end: "07:30" }, N.data._cfg || {});
const rotaNames = () => rotaCfg().names.map(s => (s || "").trim()).filter(Boolean);
function rotaWeek(monday) {
  const names = rotaNames(), key = "w:" + isoDay(monday), over = (N.data[key] || {}).days || [];
  const idx = Math.round((monday - ANCHOR) / (7 * DAY));
  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(monday.getTime() + i * DAY), next = new Date(date.getTime() + DAY);
    const auto = names.length ? names[(((idx * 7 + i) % names.length) + names.length) % names.length] : "";
    return { i, date, next, auto, who: over[i] || auto, manual: !!over[i] && over[i] !== auto };
  });
}
// redrawing replaces the fields; a focused field then blurs and fires its change again: draw once, then catch up
let rotaDrawing = false;
function renderRota() {
  if (rotaDrawing) { setTimeout(renderRota, 0); return; }
  rotaDrawing = true; try { drawRota(); } finally { rotaDrawing = false; }
}
function drawRota() {
  const box = $("rotaView"), cfg = rotaCfg(), names = rotaNames(), wk = rotaWeek(rotaMonday), today = isoDay(new Date());
  const count = {}; names.forEach(n => count[n] = 0); wk.forEach(d => { if (d.who) count[d.who] = (count[d.who] || 0) + 1; });
  const sunday = new Date(rotaMonday.getTime() + 6 * DAY);
  box.innerHTML = `<div class="wrap">
    <div class="card rcfg"><h3>👥 İşçilər</h3>
      <div class="rnames">${[...cfg.names, ...Array(Math.max(0, 4 - cfg.names.length)).fill("")].map((n, i) => `<input data-n="${i}" value="${esc2(n)}" placeholder="${i + 1}-ci işçinin adı" autocomplete="off">`).join("")}</div>
      <div class="rtime"><label>Növbə başlayır <input type="time" id="rStart" value="${esc2(cfg.start)}"></label><label>bitir <input type="time" id="rEnd" value="${esc2(cfg.end)}"></label><button class="tool" id="rAdd" type="button">+ İşçi</button></div>
      <p class="muted small">Adlar və saatlar hamı üçün ortaq saxlanılır. Bölgü fasiləsiz növbə ilə gedir: hər həftə əvvəlkinin davamıdır, ona görə uzun müddətdə hər kəs bərabər növbə alır və heç kim iki gecə ardıcıl işləmir.</p></div>
    <div class="rweek"><button class="tool" id="rPrev" type="button">←</button><div><b>${dmy(rotaMonday)} – ${dmy(sunday)}</b><br><button class="notebtn" id="rNow" type="button">Bu həftə</button></div><button class="tool" id="rNext" type="button">→</button></div>
    ${names.length ? `<div class="rtable">${wk.map(d => `<div class="rrow${isoDay(d.date) === today ? " now" : ""}"><div class="rday"><b>${WD[d.i]}</b><span>${dmy(d.date)} ${esc2(cfg.start)} → ${dm(d.next)} ${esc2(cfg.end)}</span></div>
      <select data-d="${d.i}" aria-label="${WD[d.i]}">${names.map(n => `<option ${n === d.who ? "selected" : ""}>${esc2(n)}</option>`).join("")}${d.who && !names.includes(d.who) ? `<option selected>${esc2(d.who)}</option>` : ""}</select>${d.manual ? '<span class="rman" title="Əl ilə dəyişdirilib">✋</span>' : '<span class="rman"></span>'}</div>`).join("")}</div>
      <p class="rcount">${Object.entries(count).map(([n, c]) => `<span><b>${esc2(n)}</b>: ${c} gecə</span>`).join("")}</p>
      <div class="tools rtools"><button class="tool primary" id="rShare" type="button">📤 WhatsApp mətni</button><button class="tool primary" id="rPdf" type="button">📄 PDF / Çap</button><button class="tool" id="rPdf4" type="button">📄 4 həftə</button><button class="tool" id="rXls" type="button">Excel</button><button class="tool" id="rAuto" type="button">↺ Avtomatik bölgüyə qaytar</button></div>`
    : '<p class="empty">Növbə cədvəli üçün yuxarıda işçilərin adlarını yazın.</p>'}
  </div>`;
  const saveCfg = p => { N.patch("_cfg", Object.assign(rotaCfg(), p)); };
  box.querySelectorAll("[data-n]").forEach(inp => inp.onchange = () => { const list = [...box.querySelectorAll("[data-n]")].map(x => x.value.trim()); while (list.length > 1 && !list[list.length - 1]) list.pop(); saveCfg({ names: list }); renderRota(); });
  $("rStart").onchange = e => { saveCfg({ start: e.target.value || "23:00" }); renderRota(); };
  $("rEnd").onchange = e => { saveCfg({ end: e.target.value || "07:30" }); renderRota(); };
  $("rAdd").onclick = () => { saveCfg({ names: [...[...box.querySelectorAll("[data-n]")].map(x => x.value.trim()), ""] }); renderRota(); setTimeout(() => { const ins = box.querySelectorAll("[data-n]"); ins[ins.length - 1].focus(); }, 50); };
  $("rPrev").onclick = () => { rotaMonday = new Date(rotaMonday.getTime() - 7 * DAY); renderRota(); };
  $("rNext").onclick = () => { rotaMonday = new Date(rotaMonday.getTime() + 7 * DAY); renderRota(); };
  $("rNow").onclick = () => { rotaMonday = mondayOf(new Date()); renderRota(); };
  if (!names.length) return;
  box.querySelectorAll("select[data-d]").forEach(sel => sel.onchange = () => {
    const key = "w:" + isoDay(rotaMonday), days = ((N.data[key] || {}).days || Array(7).fill(null)).slice(); while (days.length < 7) days.push(null);
    const i = +sel.dataset.d; days[i] = sel.value === wk[i].auto ? null : sel.value;
    N.set(key, days.some(Boolean) ? { days, by: me || null, at: Date.now() } : null); renderRota();
  });
  $("rAuto").onclick = () => { N.set("w:" + isoDay(rotaMonday), null); renderRota(); toast("Bu həftə avtomatik bölgüyə qaytarıldı"); };
  $("rShare").onclick = rotaShare; $("rPdf").onclick = () => rotaPdf(1); $("rPdf4").onclick = () => rotaPdf(4); $("rXls").onclick = rotaExcel;
}
function rotaText(monday) {
  const cfg = rotaCfg(), wk = rotaWeek(monday);
  return `🗓️ Gecə növbəsi (${cfg.start}–${cfg.end})\n${dmy(monday)} – ${dmy(new Date(monday.getTime() + 6 * DAY))}\n\n` + wk.map(d => `${WD_SHORT[d.i]} ${dm(d.date)} → ${dm(d.next)}: ${d.who}`).join("\n") + "\n\nPopeyes, Tarqovu filialı";
}
async function rotaShare() {
  const t = rotaText(rotaMonday);
  if (navigator.share) { try { await navigator.share({ text: t }); return; } catch (e) { if (e.name === "AbortError") return; } }
  try { await navigator.clipboard.writeText(t); toast("Mətn kopyalandı: WhatsApp-a yapışdırın"); }
  catch (e) { const ta = document.createElement("textarea"); ta.value = t; document.body.append(ta); ta.select(); try { document.execCommand("copy"); toast("Mətn kopyalandı"); } catch (x) { toast("Kopyalamaq olmadı"); } ta.remove(); }
}
async function rotaPdf(weeks) {
  const cfg = rotaCfg(), B = [];
  const last = new Date(rotaMonday.getTime() + (weeks * 7 - 1) * DAY), no = "NV-" + isoDay(rotaMonday).replace(/-/g, "");
  actPdfName = `Novbe_${isoDay(rotaMonday)}${weeks > 1 ? "_" + weeks + "hefte" : ""}.pdf`;
  B.push({ html: `<div class="a-head"><div><div class="a-k">Popeyes · Tarqovu filialı</div><h1>Gecə növbəsi cədvəli</h1><div class="a-no">${dmy(rotaMonday)} – ${dmy(last)}</div></div><div class="a-date">Növbə<br>${esc2(cfg.start)} – ${esc2(cfg.end)}</div></div>` });
  const all = {};
  for (let w = 0; w < weeks; w++) {
    const mon = new Date(rotaMonday.getTime() + w * 7 * DAY), wk = rotaWeek(mon);
    wk.forEach(d => all[d.who] = (all[d.who] || 0) + 1);
    B.push({ h2: weeks > 1 ? `${w + 1}-ci həftə: ${dmy(mon)} – ${dmy(new Date(mon.getTime() + 6 * DAY))}` : "Növbələr", cols: [24, 32, 30, 14], head: "<th>Gün</th><th>Növbə</th><th>İşçi</th><th>İmza</th>",
      rows: wk.map(d => `<tr><td><b>${WD[d.i]}</b><br>${dmy(d.date)}</td><td>${dm(d.date)} ${esc2(cfg.start)} → ${dm(d.next)} ${esc2(cfg.end)}</td><td style="font-size:13px"><b>${esc2(d.who)}</b>${d.manual ? " ✋" : ""}</td><td></td></tr>`) });
  }
  B.push({ html: `<h2>Yekun</h2><table class="a-sum"><tr>${Object.keys(all).map(n => `<th>${esc2(n)}</th>`).join("")}</tr><tr>${Object.values(all).map(c => `<td>${c}</td>`).join("")}</tr></table><p class="a-note">Gecə sayı. ✋: əl ilə dəyişdirilmiş növbə.</p>
    <div class="a-sign" style="margin-top:24px"><div><b>Tərtib etdi</b><p>${esc2(me || "____________________")}</p><p>İmza: __________</p></div><div><b>Təsdiq etdi</b> (restoran müdiri)<p>Ad, soyad: ____________________</p><p>İmza: __________</p></div></div>` });
  paginate(B, no); showActView("Gecə növbəsi cədvəli");
}
function rotaExcel() {
  if (!window.XLSX) return toast("Excel modulu yüklənmədi");
  const cfg = rotaCfg(), rows = [];
  for (let w = 0; w < 4; w++) { const mon = new Date(rotaMonday.getTime() + w * 7 * DAY); rotaWeek(mon).forEach(d => rows.push({ "Həftə": `${dmy(mon)} – ${dmy(new Date(mon.getTime() + 6 * DAY))}`, "Gün": WD[d.i], "Tarix": dmy(d.date), "Başlayır": `${dmy(d.date)} ${cfg.start}`, "Bitir": `${dmy(d.next)} ${cfg.end}`, "İşçi": d.who, "Qeyd": d.manual ? "əl ilə dəyişdirilib" : "" })); }
  const ws = XLSX.utils.json_to_sheet(rows); ws["!cols"] = [24, 16, 12, 18, 18, 22, 20].map(w => ({ wch: w }));
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Növbə (4 həftə)");
  deliverFile(new Blob([XLSX.write(wb, { bookType: "xlsx", type: "array" })], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `Novbe_${isoDay(rotaMonday)}.xlsx`);
}

showSection(section);
