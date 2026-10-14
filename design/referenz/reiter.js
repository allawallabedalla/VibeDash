// Reiterleiste der 6 Hauptbereiche + einzeiliger Pfad

const H = htmlGraphics || {}, TS = getTemplateSrv(), K = codeData || {};
const ESC = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
const zeit = () => { const q = new URLSearchParams(location.search), f = q.get("from"), t = q.get("to");
  return f && t ? "from=" + encodeURIComponent(f) + "&to=" + encodeURIComponent(t) : ""; };
const ziel = u => { let s = TS.replace(String(u).split("${__url_time_range}").join(zeit()));
  return s.replace("?&", "?").replace(/[?&]$/, ""); };
const txt = t => ESC(TS.replace(String(t)));
const md = s => ESC(TS.replace(s)).replace(/\\*\\*([^*]+)\\*\\*/g, "<b>$1</b>")
  .replace(/\\[([^\\]]+)\\]\\(([^)\\s]+)\\)/g, (m, t, u) => `<a data-u="${u}" href="${u}">${t}</a>`);
const zeichne = () => {
  const el = htmlNode.querySelector(".krume"); if (!el) return;
  const T = H.theme2 && H.theme2.colors;
  if (T) { el.style.setProperty("--k-text", T.text.primary); el.style.setProperty("--k-text2", T.text.secondary);
    el.style.setProperty("--k-link", T.text.link); }
  const s = (K.teile || []).map(([t, u]) => u ? `<a class="weg" data-u="${ESC(u)}" href="${ESC(ziel(u))}">${txt(t)}</a>` : `<b>${txt(t)}</b>`);
  // Tab-Leiste der Hauptbereiche (Nutzer 13.10.2026: kompakt statt Grafana-Knopfreihen): eine wischbare Zeile, aktiver
  // Bereich hervorgehoben (Detailseiten zählen zu ihrem Bereich, K.bereich); Tabs öffnen den Bereich mit seinem eigenen Zeitraum
  const pfad = location.pathname, akt = (K.tabs || []).find(([u]) => pfad.indexOf("/d/" + u) >= 0);
  const bereich = akt ? akt[0] : (K.bereich || "");
  const tabs = (K.tabs || []).map(([u, t, i]) =>
    `<a class="tab${u === bereich ? " aktiv" : ""}" data-tab="/d/${u}" href="/d/${u}"><i>${i}</i>${ESC(t)}</a>`).join("");
  const weg = s.length > 1 && !akt ? s.join(" › ") : "";       // Hauptseite: der aktive Tab sagt schon, wo man ist
  el.innerHTML = `<div class="tabs">${tabs}</div>` + ((weg || K.rechts) ? `<div class="pfad">${weg}${weg && K.rechts ? '<span class="trenner">·</span>' : ""}${K.rechts ? md(K.rechts) : ""}</div>` : "");
  el.querySelectorAll("a[data-u]").forEach(a => a.setAttribute("href", ziel(a.getAttribute("data-u"))));
  const a = el.querySelector(".tab.aktiv"); if (a && a.scrollIntoView && !htmlNode._tabGescrollt) { htmlNode._tabGescrollt = true;
    try { a.parentNode.scrollLeft = a.offsetLeft - 8; } catch (e) { /* egal */ } }
};
htmlNode._krume = zeichne;
zeichne();
// Legende: Maus auf einen Eintrag = nur diese Reihe zeigen, Maus weg = wieder alle (Nutzer 11.10.2026: „beim Hovern
// nur den Graph davon einblenden“). Nutzt Grafanas eigenen Klick auf den Legenden-Namen (isolieren / zurücksetzen).
// Einmal je Browserfenster an document gehängt (gilt für alle Seiten der Sitzung). Eigener Klick des Nutzers beendet das.
if (!window.__hausLegende) {
  window.__hausLegende = true;
  const SEL = '[data-testid^="data-testid VizLegend series"]';
  let aktiv = null, timer = null;
  const eintrag = el => el && el.closest ? el.closest(SEL) : null;
  const schluessel = it => { const p = it.closest("section") || document; return { p, id: it.getAttribute("data-testid") }; };
  const knopf = k => { const it = [...k.p.querySelectorAll(SEL)].find(x => x.getAttribute("data-testid") === k.id);
    return it && it.querySelector("button"); };
  const zurueck = () => { if (!aktiv) return; const b = knopf(aktiv); aktiv = null; if (b) b.click(); };
  document.addEventListener("mouseover", ev => {
    const it = eintrag(ev.target); if (!it) return;
    const k = schluessel(it);
    if (aktiv && aktiv.p === k.p && aktiv.id === k.id) return;
    clearTimeout(timer);
    timer = setTimeout(() => { zurueck(); const b = knopf(k); if (b) { b.click(); aktiv = k; } }, 180);
  }, true);
  document.addEventListener("mouseout", ev => {
    if (!eintrag(ev.target)) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const unter = [...document.querySelectorAll(":hover")].pop(), it = eintrag(unter);
      if (it && aktiv) { const k = schluessel(it); if (k.p === aktiv.p && k.id === aktiv.id) return; }
      if (!it) zurueck();
    }, 200);
  }, true);
  document.addEventListener("click", ev => { if (ev.isTrusted && eintrag(ev.target)) { clearTimeout(timer); aktiv = null; } }, true);
}
if (!htmlNode._krumeKlick) {
  htmlNode._krumeKlick = true;
  htmlNode.addEventListener("mouseover", zeichne, {passive: true});
  htmlNode.addEventListener("click", ev => {
    const a = ev.target.closest && ev.target.closest("a[data-u], a[data-tab]"); if (!a) return;
    const href = a.hasAttribute("data-tab") ? a.getAttribute("data-tab") : ziel(a.getAttribute("data-u")); a.setAttribute("href", href);
    if (!href.startsWith("/") || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button !== 0) return;
    const ls = H.locationService; if (!ls || !ls.push) return;
    ev.preventDefault(); ls.push(href);
  });
  try { const h = H.locationService && H.locationService.getHistory && H.locationService.getHistory();
        if (h && h.listen) h.listen(() => setTimeout(zeichne, 0)); } catch (e) { /* nur Komfort */ }
}
