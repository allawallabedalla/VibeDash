// Board Woche: Wetterkacheln 3 Tage zurück · heute · 3 voraus. IC = {bedeutung: zeichen} setzt der Generator.
// Abfragen: A wetter_tag art=gemessen, B wetter_tag art=prognose (aktuell), C /entwurf/energie/tage2 (PV-Ertrag),
// D pv_prognose_tag (Stundenmodell, aktuell), E auto_plan (geplante Ladung heute/morgen/übermorgen). Fehlt ein Wert: „–“.
const w = htmlNode.querySelector(".wk");
const TZ = "Europe/Berlin";
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const de = (x, nd = 0) => x == null || isNaN(x) ? "–" : Number(x).toLocaleString("de-DE", { minimumFractionDigits: nd, maximumFractionDigits: nd });
const iso = ms => new Intl.DateTimeFormat("sv-SE", { timeZone: TZ }).format(new Date(ms));
const werte = f => f.values.toArray ? f.values.toArray() : Array.from(f.values);
const frames = (data && data.series) || [];
function tabelle(ref) {                       // {iso-Tag: {feld: wert}} aus allen Frames einer Abfrage
  const rows = {};
  frames.filter(s => s.refId === ref).forEach(s => {
    const t = s.fields.find(f => f.type === "time") || s.fields.find(f => f.name === "zeit");
    if (!t) return;
    const tv = werte(t);
    s.fields.forEach(f => {
      if (f === t) return;
      const v = werte(f), name = (f.config && f.config.displayNameFromDS) || f.name;
      tv.forEach((ms, i) => { if (v[i] != null) (rows[iso(Number(ms))] = rows[iso(Number(ms))] || {})[name] = v[i]; });
    });
  });
  return rows;
}
const A = tabelle("A"), B = tabelle("B"), C = tabelle("C"), D = tabelle("D");
let E = {};
frames.filter(s => s.refId === "E").forEach(s => s.fields.forEach(f => { if (f.type !== "time") { const v = werte(f); E[f.name] = v[v.length - 1]; } }));
const T = htmlGraphics && htmlGraphics.theme2;
if (T) { w.style.setProperty("--t1", T.colors.text.primary); w.style.setProperty("--t2", T.colors.text.secondary);
  w.style.setProperty("--fl", T.colors.background.secondary); w.style.setProperty("--rand", T.colors.border.medium); }
const symbol = t => t.regen_mm >= 2 && (t.sonne_h == null || t.sonne_h < 4) ? [IC.regen, "Regen"]
  : t.regen_mm >= 0.5 ? [IC.schauer || IC.regen, "Schauer"] : t.sonne_h == null ? [IC.unbekannt, "?"]
  : t.sonne_h >= 6 ? [`<span style="color:#E0A100">${IC.sonne}</span>`, "sonnig"] : t.sonne_h >= 2 ? [IC.sonne_wolke, "wechselhaft"] : [IC.wolke, "bewölkt"];
const heute = iso(Date.now());
const tagMs = d => new Date(heute + "T12:00:00").getTime() + d * 86400e3;
const name = (i, d) => d === 0 ? "Heute" : new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "2-digit", timeZone: TZ })
  .format(new Date(tagMs(d))).replace(",", "");
const laden = { 0: E.heute_kwh, 1: E.morgen_kwh, 2: E.uebermorgen_kwh };
let html = "";
for (let d = -3; d <= 3; d++) {
  const t = iso(tagMs(d)), g = A[t], p = B[t], vergangen = d < 0, x = vergangen ? (g || {}) : (p || {});
  const [ic, wort] = symbol(x);
  const pvIst = (C[t] || {}).ertrag_ganz, pvProg = (D[t] || {}).kwh, pvHeute = (C[t] || {}).heute_ertrag;
  const pv = vergangen ? (pvIst != null ? `PV ${de(pvIst)} kWh` : "PV –")
    : `PV ≈ ${de(pvProg)} kWh` + (d === 0 && pvHeute != null ? ` · bisher ${de(pvHeute)}` : "");
  const tip = `${name(0, d)}: ${vergangen ? "gemessen" : "Prognose"} – ${wort}, ${de(x.tmin)} bis ${de(x.tmax)} °C, `
    + `${de(x.sonne_h, 1)} h Sonne, ${de(x.regen_mm, 1)} mm Regen. ${pv}.`;
  html += `<div class="tag${vergangen ? "" : " prog"}${d === 0 ? " heute" : ""}" title="${esc(tip)}">
    <div class="kopf"><b>${esc(name(0, d))}</b><span class="art">${vergangen ? "gemessen" : "Prognose"}</span></div>
    <div class="mitte"><span class="wi">${ic}</span><span class="temp"><b>${de(x.tmax)}°</b><small>${de(x.tmin)}°</small></span></div>
    <div class="zeile">${de(x.sonne_h)} h Sonne · ${de(x.regen_mm, 1)} mm</div>
    <div class="pv"><span class="si">${IC.solar}</span> <span class="lang">${esc(pv)}</span><span class="kurz">${vergangen ? de(pvIst) : "≈" + de(pvProg)}</span></div>
    ${d >= 0 && laden[d] != null && laden[d] >= 0.5 ? `<span class="laden">${IC.auto} <span class="lang">Laden ≈ ${de(laden[d])} kWh</span><span class="kurz">${de(laden[d])} kWh</span></span>` : ""}</div>`;
}
w.innerHTML = `<div class="tage">${html}</div>`;
