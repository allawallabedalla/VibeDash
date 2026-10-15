// Hauptbereich Garten (seite-garten,  13.10.2026). IC = {bedeutung: zeichen} setzt der Generator davor.
// Teil steht im HTML: <div class="gw" data-teil="tipp|wetter|frueher">.
//   tipp:   A = /garten (Zeitraum der Seite, neueste zuerst) -> der jüngste Tipp groß, als Liste (ein Punkt je Zeile)
//   wetter: A wetter_tag art=gemessen (3 Tage zurück), B wetter_tag art=prognose (heute + 3) -> je Tag eine Karte;
//           Frost = Tiefstwert ≤ 2 °C (Bodenfrost möglich), Regen ab 1 mm, oben die Gartenaussage in 1–2 Wörtern.
//           Am iPhone 4 Karten je Reihe, Heute zuerst (CSS order), dann die Prognose, dann die gemessenen Tage.
//   frueher: A = /garten -> die früheren Tipps (ohne den oben gezeigten): oben Themen-Balken (Zahl der Tipps je Thema),
//           darunter je Tag Themen-Symbole + Stichworte (Teil vor „:“ bzw. „–“), ganzer Tipp im Tooltip (Audit 13.10.2026:
//           Fließtext, doppelt zu „Heute“, abgeschnitten).
const w = htmlNode.querySelector(".gw");
const TZ = "Europe/Berlin";
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const de = (x, nd = 0) => x == null || isNaN(x) ? "–" : Number(x).toLocaleString("de-DE", { minimumFractionDigits: nd, maximumFractionDigits: nd });
const iso = ms => new Intl.DateTimeFormat("sv-SE", { timeZone: TZ }).format(new Date(ms));
const werte = f => f.values.toArray ? f.values.toArray() : Array.from(f.values);
const frames = (data && data.series) || [];
const T = htmlGraphics && htmlGraphics.theme2;
if (T) { w.style.setProperty("--t1", T.colors.text.primary); w.style.setProperty("--t2", T.colors.text.secondary);
  w.style.setProperty("--fl", T.colors.background.secondary); w.style.setProperty("--rand", T.colors.border.medium); }
const FROST = 2;          // °C Tiefstwert: darunter Bodenfrost möglich (Luft 2 m über dem Boden misst wärmer)

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

function tipp() {
  const f = frames.find(s => s.refId === "A");
  const feld = n => f && f.fields.find(x => x.name === n);
  const tage = feld("tag") ? werte(feld("tag")) : [], tipps = feld("tipps") ? werte(feld("tipps")) : [];
  if (!tipps.length) { w.innerHTML = `<div class="leer">${IC.unbekannt} Noch kein Tipp im Zeitraum</div>`; return; }
  const punkte = String(tipps[0]).split(/\n+/).map(z => z.replace(/^\s*[-•*]\s*/, "").trim()).filter(Boolean);
  const d = new Date(tage[0] + "T12:00:00");
  const wann = iso(Date.now()) === tage[0] ? "Heute"
    : new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long", timeZone: TZ }).format(d);
  w.innerHTML = `<section class="karte">
    <div class="k-kopf"><h2><span class="ic">${IC.garten}</span>${esc(wann)}</h2></div>
    <ul class="tipps">${punkte.map(p => {
      // Kopf = Infografik (Nutzer 13.10.2026): Themen-Symbol im weichen Kreis + Thema + Kurztitel; Details per Antippen/Klick
      const m = p.match(/^(.{3,120}?)(?::|\s[–-]\s)\s*(.+)$/), th = thema(p);
      return `<li title="${esc(p)}"><span class="ti" style="background:${th[3]}22;color:${th[3]}">${IC[th[2]] || ""}</span>` +
        `<span class="tt"><small style="color:${th[3]}">${esc(th[1])}</small><b>${esc(m ? m[1] : p)}</b>` +
        (m ? `<span class="td">${esc(m[2])}</span>` : "") + `</span></li>`;
    }).join("")}</ul></section>`;
  // Details eingeklappt (Mac und iPhone), Klick/Antippen zeigt sie
  w.querySelectorAll(".tipps li").forEach(li => li.addEventListener("click", () => li.classList.toggle("offen")));
}

// Themen der Tipps (Reihenfolge = Vorrang): Symbol aus der Icon-Schrift, Farbe ruhig
const THEMEN = [
  ["tiere", "Tiere", "katze", "#B07CC6", /igel|vög|vogel|biene|insekt|nisthilf|meisen|nützling|bestäub|futter/],
  ["ernte", "Ernte", "kueche", "#E0A100", /ernt|lager|einkoch|sirup|saft|gelee|trockn|vorrat/],
  ["pflanzen", "Säen & Pflanzen", "garten", "#2E8B57", /steckling|absenker|teilen|säen|aussä|stecken|pflanz|setzen|keim/],
  ["schnitt", "Schnitt", "werkzeug", "#8E8E93", /schneid|schnitt|auslicht|kürz|ausgeiz/],
  ["schutz", "Winterschutz", "frost", "#0A6FCC", /frost|schütz|vlies|winterfest|abdeck|einpack|kübel/],
  ["boden", "Boden & Laub", "baum", "#8B6B4A", /laub|mulch|kompost|düng|boden|beet/],
  ["wasser", "Gießen", "feuchte", "#2BB3E0", /gieß|wässer|wasser/],
];
const thema = t => THEMEN.find(x => x[4].test(t.toLowerCase())) || ["sonst", "Sonstiges", "liste", "#AEAEB2"];

function frueher() {
  const f = frames.find(s => s.refId === "A");
  const feld = n => f && f.fields.find(x => x.name === n);
  const tage = feld("tag") ? werte(feld("tag")) : [], tipps = feld("tipps") ? werte(feld("tipps")) : [];
  // der jüngste Tipp steht oben unter „Heute“ -> hier erst ab dem zweiten (nicht doppelt)
  const liste = tage.map((t, i) => ({ t, punkte: String(tipps[i] || "").split(/\n+/)
    .map(z => z.replace(/^\s*[-•*]\s*/, "").trim()).filter(Boolean) })).slice(1);
  if (!liste.length) { w.innerHTML = `<div class="leer">Keine früheren Tipps im Zeitraum</div>`; return; }
  const zahl = {};
  liste.forEach(d => d.punkte.forEach(p => { const k = thema(p)[0]; zahl[k] = (zahl[k] || 0) + 1; }));
  const max = Math.max(...Object.values(zahl));
  const balken = [...THEMEN, ["sonst", "Sonstiges", "liste", "#AEAEB2"]].filter(x => zahl[x[0]]).map(x =>
    `<div class="tb" title="${esc(x[1])}: ${zahl[x[0]]} Tipps"><span class="tb-n"><i style="color:${x[3]}">${IC[x[2]] || ""}</i>${esc(x[1])}</span>
      <span class="tb-s"><span style="width:${(100 * zahl[x[0]] / max).toFixed(0)}%;background:${x[3]}"></span></span><b>${zahl[x[0]]}</b></div>`).join("");
  const zeilen = liste.map(d => {
    const dt = new Date(d.t + "T12:00:00");
    const wann = new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: TZ }).format(dt).replace(",", "");
    const chips = d.punkte.map(p => {
      const m = p.match(/^(.{3,120}?)(?::|\s[–-]\s)\s*(.+)$/), th = thema(p);
      return `<span class="st" title="${esc(p)}" data-voll="${esc(p)}" data-kurz="${esc(m ? m[1] : p)}"><i style="color:${th[3]}">${IC[th[2]] || ""}</i><span>${esc(m ? m[1] : p)}</span></span>`;
    }).join("");
    return `<div class="fz"><span class="fz-tag">${esc(wann)}</span><span class="fz-st">${chips}</span></div>`;
  }).join("");
  w.innerHTML = `<div class="tb-reihe">${balken}</div><div class="fz-liste">${zeilen}</div>`;
  w.querySelectorAll(".st").forEach(st => st.addEventListener("click", () => {      // iPhone: Antippen = ganzer Tipp
    const t = st.querySelector("span"), voll = st.classList.toggle("voll");
    t.textContent = voll ? st.dataset.voll : st.dataset.kurz;
  }));
}

function wetter() {
  const A = tabelle("A"), B = tabelle("B");
  const heute = iso(Date.now());
  const tagMs = d => new Date(heute + "T12:00:00").getTime() + d * 86400e3;
  const name = d => d === 0 ? "Heute" : d === 1 ? "Morgen" : new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "2-digit", timeZone: TZ })
    .format(new Date(tagMs(d))).replace(",", "");
  const tage = [];
  for (let d = -3; d <= 3; d++) {
    const t = iso(tagMs(d)), x = (d < 0 ? A[t] : B[t]) || {};
    tage.push({ d, t, x, frost: x.tmin != null && x.tmin <= FROST, regen: x.regen_mm != null && x.regen_mm >= 1 });
  }
  // Aussage: Frost in den nächsten Tagen? Sonst Regen/trocken der letzten 3 Tage
  const vor = tage.filter(z => z.d >= 0), zur = tage.filter(z => z.d < 0);
  const frostTag = vor.find(z => z.frost);
  const regenZur = zur.reduce((s, z) => s + (z.x.regen_mm || 0), 0), regenVor = vor.slice(0, 3).reduce((s, z) => s + (z.x.regen_mm || 0), 0);
  const aussage = frostTag
    ? `<span class="chip frost"><i>${IC.frost}</i>Frost ${esc(name(frostTag.d))}</span><span class="neben">bis ${de(frostTag.x.tmin)} °C – Kübel schützen</span>`
    : regenZur < 2 && regenVor < 2
      ? `<span class="chip trocken"><i>${IC.feuchte}</i>Gießen</span><span class="neben">${de(regenZur, 1)} mm in 3 Tagen, ${de(regenVor, 1)} mm in Sicht</span>`
      : `<span class="chip ok"><i>${IC.ok}</i>Kein Frost</span><span class="neben">${de(regenZur, 1)} mm Regen in 3 Tagen</span>`;
  const karten = tage.map(z => {
    const x = z.x, prog = z.d >= 0;
    const ic = z.frost ? IC.frost : z.regen ? IC.regen : x.sonne_h >= 6 ? IC.sonne : x.sonne_h >= 2 ? IC.sonne_wolke : x.sonne_h != null ? IC.wolke : IC.unbekannt;
    const tip = `${name(z.d)}: ${prog ? "Prognose" : "gemessen"} – ${de(x.tmin)} bis ${de(x.tmax)} °C, ${de(x.sonne_h, 1)} h Sonne, ${de(x.regen_mm, 1)} mm Regen`
      + (z.frost ? ` · Tiefstwert ≤ ${FROST} °C: Bodenfrost möglich` : "");
    return `<div class="tag${prog ? " prog" : ""}${z.d === 0 ? " heute" : ""}${z.frost ? " frost" : ""}" title="${esc(tip)}">
      <div class="kopf"><b>${esc(name(z.d))}</b></div>
      <div class="wi">${ic}</div>
      <div class="temp"><b>${de(x.tmax)}°</b><small>${de(x.tmin)}°</small></div>
      <div class="zeile">${de(x.regen_mm, 1)} mm</div></div>`;
  }).join("");
  w.innerHTML = `<div class="aussage">${aussage}</div><div class="tage">${karten}</div>`;
}

try { ({ tipp, wetter, frueher }[w.dataset.teil] || wetter)(); }
catch (e) { w.innerHTML = `<div class="leer">Anzeige gerade nicht möglich (${esc(e.message)})</div>`; }
