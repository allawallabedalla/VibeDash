// Startseite haus-start (Health-Stil 08.10.2026, ADHS-Umbau 09.10.2026: Symbol + 1–2 Wörter, Gründe ins ⓘ) –
// Icons seit 09.10.2026 nur Font Awesome (IC = {bedeutung: zeichen} aus der Icon-Tabelle, von haus.py vor diesen Code
// gesetzt, ebenso die Injektion der Icon-Schrift); keine Emojis. Native Tooltips (title=) ohne Icons (tt()).
// onInit aller HTML-graphics-Panels (gleicher Code, Teil steht im HTML: <div class="wurzel" data-teil="…">).
// Daten: EINE Infinity-Abfrage /entwurf/haus/start im Panel "Kopf", die anderen Panels lesen sie ueber die Datenquelle
// "-- Dashboard --". onRender ruft htmlNode._h.render(data, htmlGraphics).
// Teile: kopf (Symbolzeile ✓/!/✕/⏳ + Gute Nacht) · tun („Im Blick“, 📋 Empfehlungen, 🧠 Lernen x/13) · heute („7 Tage“:
// ☀️ selbst versorgt, ✋ Handgriffe/Tag, ⚡ Netzbezug – eine Zeitbasis; darunter „Jetzt“) · raum · bereiche · mehr.
// Gute Nacht (nur Panel "Kopf"): POST <host>:<API-PORT>/aktion/gute-nacht, Antwort wird geprueft (200/409/429/5xx/Netz),
// danach GET …/aktion/gute-nacht/status; 60 s Sperre. Ein Klick, keine Rueckfrage (Nutzerentscheidung).
const n = htmlNode;
const H = (n._h = {});
const TZ = "Europe/Berlin";
// Zeitraum (11.10.2026): der Rückblick hat eine eigene Wahl 7 Tage · 30 Tage · Jahr · Gesamt; sie steht in der URL
// (from/to) und gilt für alle Rückblick-Kacheln und für die Links auf die Unterseiten. „Jetzt“ ist davon unabhängig.
const ZR = [{ k: "7", from: "now-6d/d", t: "7 Tage" }, { k: "30", from: "now-29d/d", t: "30 Tage" },
            { k: "jahr", from: "now/y", t: "Jahr" }, { k: "alles", from: "now-399d/d", t: "Gesamt" }];
const zrJetzt = () => { const q = new URLSearchParams(location.search); const f = q.get("from") || ZR[0].from;
  return ZR.find(z => z.from === f) || { k: "frei", from: f, t: "Zeitraum" }; };
const zeitQ = () => { const q = new URLSearchParams(location.search);
  return "from=" + encodeURIComponent(q.get("from") || ZR[0].from) + "&to=" + encodeURIComponent(q.get("to") || "now"); };
H.zrJetzt = zrJetzt;
const API = location.protocol + "//" + location.hostname + ":<API-PORT>";
H.hg = htmlGraphics;
// Grafana-Hinweis „Unterstützt von Grafana“ (klebt im Kiosk-Modus mitten über den Kacheln, Nutzer 11.10.2026) ausblenden
if (!document.getElementById("haus-ohne-fuss")) {
  const st = document.createElement("style");
  st.id = "haus-ohne-fuss";
  st.textContent = 'div:has(> a[href*="cnt=kiosk"]) { display: none !important; }';
  document.head.appendChild(st);
}

/* ── Hilfen ─────────────────────────────────────────────────────────── */
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const de = (x, nd = 0) => x == null || isNaN(x) ? "–" : Number(x).toLocaleString("de-DE", { minimumFractionDigits: nd, maximumFractionDigits: nd });
const uhr = ms => new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: TZ }).format(new Date(ms));
const tagKurz = ms => new Intl.DateTimeFormat("de-DE", { weekday: "short", timeZone: TZ }).format(new Date(ms)).replace(".", "");
const datumKurz = iso => iso ? iso.slice(8, 10) + "." + iso.slice(5, 7) + "." : "";
const link = p => !p ? "#" : /^https?:/.test(p) ? p : p.replace(/[?&]$/, "") + (p.includes("?") && !/[?&]$/.test(p) ? "&" : "?") + zeitQ();
H.link = link;
// Einheitliche Status-Symbole (REGELN.md): ✓ ok · ! prüfen · ✕ Störung · ? keine Daten · ⏳ lernt
const STUFE = { io: [IC.ok, "ok"], beobachten: [IC.pruefen, "prüfen"], nio: [IC.stoerung, "Störung"], unbekannt: [IC.unbekannt, "keine Daten"],
                lernt: [IC.lernt, "lernt"], laeuft: ["…", "rechnet"], info: [IC.info, "Info"] };
const stOf = b => b.info ? "info" : b.laeuft ? "laeuft" : b.lernt ? "lernt" : (STUFE[b.stufe] ? b.stufe : "unbekannt");
const status = (st, mitWort = true) => `<span class="st ${st}"><i>${(STUFE[st] || STUFE.unbekannt)[0]}</i>${mitWort ? esc((STUFE[st] || STUFE.unbekannt)[1]) : ""}</span>`;
// Themen-Symbole (REGELN.md)
const EMO = { sonne: IC.solar, akku: IC.akku, netz: IC.netz, wartung: IC.werkzeug, waerme: IC.heizen, himmel: IC.temperatur,
              licht: IC.licht, qualitaet: IC.signal, rhythmus: IC.uhr, geld: IC.geld, plan: IC.grundriss, wuerfel: IC.wuerfel,
              liste: IC.liste, ordner: IC.ordner, archiv: IC.archiv, lernen: IC.lernen };
// Text fuer native Tooltips (title=): die zeigen keine Web-Schrift -> Icon-Zeichen weglassen
const tt = s => String(s == null ? "" : s).replace(/[\uE000-\uF8FF]\s?/g, "");
const KURZ = { 1: "Sonnenstrom", 2: "Akku", 3: "Netz", 4: "Wartung", 5: "Heizung", 6: "Außen", 7: "Licht", 8: "Sensoren", 9: "Alltag" };
// Was die Zahl bedeutet – in Worten, je Bereich (Nutzer 11.10.: „vieles ist nicht selbsterklärend“)
const BEDEUTUNG = { 1: "erzeugt", 2: "Akku-Gesundheit", 3: "ins Netz verkauft", 4: "Nächte gesammelt", 5: "Ø Raumtemperatur",
                    6: "Ø draußen", 7: "Ideen: weniger schalten", 8: "Sensoren liefern" };
const LABEL = { "Sonnenstrom": "Sonne", "Speicherfähigkeit": "Gesundheit", "Ideen für weniger Handgriffe": "Ideen",
                "Nächte gelernt": "Nächte gesammelt", "Ø am Hof": "Ø Hof", "eingespeist": "eingespeist" };
const zweiWorte = s => { const w = String(s || "").split(/\s+/).filter(Boolean); return w.length <= 2 ? w.join(" ") : w.slice(0, 2).join(" ") + " …"; };
const labelKurz = l => l == null ? "" : (LABEL[l] || zweiWorte(l));
const wertKurz = b => String(b.wert_text == null ? "–" : b.wert_text);
const trendKurz = b => {                       // "▼ 13 %" / "▲ 3,3°" aus vergleich_text
  if (b.trend !== "ab" && b.trend !== "auf") return "";
  const m = /(\d+(?:,\d+)?)\s*(%|Grad)/.exec(b.vergleich_text || "") || /(\d+(?:,\d+)?)()/.exec(b.vergleich_text || "");
  return `${b.trend === "ab" ? "▼" : "▲"}${m ? " " + m[1] + (m[2] === "Grad" ? "°" : m[2] ? " %" : "") : ""}`;
};
// Grund in ≤ 3 Wörtern (Rest ins ⓘ): Teil vor ":" bzw. die ersten Wörter
const grundKurz = t => {
  if (!t) return "";
  t = String(t).replace(/\s*–\s*Soll (so )?gewollt\?$/, "");
  const vor = t.split(/:\s/)[0];
  const w = (vor.length < t.length && vor.split(/\s+/).length <= 3 ? vor : t).split(/\s+/);
  return w.length <= 3 ? w.join(" ") : w.slice(0, 3).join(" ") + " …";
};
const ibox = text => text ? `<span class="i-knopf" role="button" tabindex="0" aria-label="Erklärung" data-i="${esc(text)}">${IC.info}</span>` : "";
const chev = '<svg class="chev" viewBox="0 0 8 13" aria-hidden="true"><path d="M1.5 1.5l5 5-5 5"/></svg>';
const MOND = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 13.2A8.5 8.5 0 1 1 10.8 3.5a6.6 6.6 0 0 0 9.7 9.7z"/></svg>';
const HAKEN = '<svg viewBox="0 0 24 24" aria-hidden="true" style="fill:none;stroke:#fff;stroke-width:2.8;stroke-linecap:round;stroke-linejoin:round"><path d="M5.5 12.5l4.2 4.2L18.5 8"/></svg>';
const FARBE = { sonne: "#E0A100", akku: "#1AA6B7", netz: "#5E5CE6", wartung: "#E0A100", waerme: "#AF52DE", himmel: "#2E9BD6",
                licht: "#E0A100", qualitaet: "#636366", rhythmus: "#5E5CE6", geld: "#636366" };

/* ── Daten aus data.series (eine Zeile, Feld "json") ─────────────────── */
H.daten = function (data) {
  const s = data && data.series && data.series[0];
  if (!s || !s.fields) return null;
  const f = s.fields.find(x => x.name === "json" || (x.config && x.config.displayName === "json"));
  if (!f) return null;
  const v = f.values;
  const roh = Array.isArray(v) ? v[0] : (v && v.get ? v.get(0) : (v && v.toArray ? v.toArray()[0] : null));
  try { return roh ? JSON.parse(roh) : null; } catch (e) { return null; }
};

/* ── Mini-Grafiken (SVG, Breite = Platz im Container) ─────────────────── */
const svgOf = (w, h, inner, titel) => `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(titel)}">${inner}</svg>`;
const txt = (x, y, t, o = {}) => `<text x="${x}" y="${y}" font-size="${o.fs || 10.5}" fill="${o.fill || "#86868B"}" text-anchor="${o.a || "middle"}" font-weight="${o.fw || 400}">${esc(t)}</text>`;
const balkenPfad = (x, y, w, h, r = 3.5) => { if (h <= 0.5) return ""; r = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`; };
function saeulen(w, tage, o) {
  const h = o.h || 74, unten = 15, oben = 3, ph = h - unten - oben;
  const max = Math.max(1e-9, ...tage.map(t => Math.max(t.wert || 0, t.ziel || 0)));
  const slot = w / tage.length, bw = Math.min(14, slot * .5);
  let s = `<line x1="0" x2="${w}" y1="${h - unten + .5}" y2="${h - unten + .5}" stroke="#E8E8ED"/>`;
  tage.forEach((t, i) => {
    const x = i * slot + (slot - bw) / 2, y0 = h - unten;
    if (t.ziel) { const hz = t.ziel / max * ph; s += `<path d="${balkenPfad(x, y0 - hz, bw, hz)}" fill="${o.farbe}" opacity=".16"/>`; }
    if (t.wert != null) { const hw = t.wert / max * ph; s += `<path d="${balkenPfad(x, y0 - hw, bw, hw)}" fill="${o.farbe}" opacity="${t.teil ? .6 : 1}"/>`; }
    if (!t.wert && !t.ziel) s += `<rect x="${x}" y="${y0 - 2}" width="${bw}" height="2" rx="1" fill="#C7C7CC"/>`;
    s += `<title>${esc(t.tip || "")}</title>`;
    s += txt(i * slot + slot / 2, h - 2, slot < 24 && t.tag.length > 2 ? t.tag[0] : t.tag, { fill: t.teil ? "#1D1D1F" : "#86868B", fw: t.teil ? 600 : 400 });
  });
  return svgOf(w, h, s, o.titel);
}
function spannen(w, tage, o) {
  const h = o.h || 74, unten = 15, oben = 3, ph = h - unten - oben, ok = tage.filter(t => t.min != null && t.max != null);
  if (!ok.length) return "";
  const lo = Math.floor(Math.min(...ok.map(t => t.min))), hi = Math.ceil(Math.max(...ok.map(t => t.max)));
  const Y = v => oben + (hi - v) / Math.max(1, hi - lo) * ph, slot = w / tage.length, bw = 7;
  let s = "";
  tage.forEach((t, i) => {
    const x = i * slot + slot / 2;
    if (t.min != null) { const y1 = Y(t.max), y2 = Y(t.min), r = bw / 2;
      s += `<path d="M${x - r},${y2 - r}V${y1 + r}A${r},${r} 0 0 1 ${x + r},${y1 + r}V${y2 - r}A${r},${r} 0 0 1 ${x - r},${y2 - r}Z" fill="${o.farbe}" opacity="${t.teil ? .55 : 1}"><title>${esc(t.tip)}</title></path>`; }
    s += txt(x, h - 2, slot < 24 && t.tag.length > 2 ? t.tag[0] : t.tag, { fill: t.teil ? "#1D1D1F" : "#86868B", fw: t.teil ? 600 : 400 });
  });
  const iMax = tage.reduce((a, t, i) => (t.max != null && (a < 0 || t.max > tage[a].max)) ? i : a, -1);
  const iMin = tage.reduce((a, t, i) => (t.min != null && (a < 0 || t.min < tage[a].min)) ? i : a, -1);
  if (iMax >= 0) s += txt(iMax * slot + slot / 2 + 7, Y(tage[iMax].max) + 7, `${de(tage[iMax].max)}°`, { a: "start", fill: "#424245", fs: 10 });
  if (iMin >= 0) s += txt(iMin * slot + slot / 2 + 7, Y(tage[iMin].min), `${de(tage[iMin].min)}°`, { a: "start", fill: "#424245", fs: 10 });
  return svgOf(w, h, s, o.titel);
}
function zeilenBalken(w, zeilen, o) {
  const zh = 22, h = zeilen.length * zh, nameW = Math.min(104, w * .5), wertW = 36, bw = Math.max(20, w - nameW - wertW - 4);
  let s = "";
  zeilen.forEach((z, i) => {
    const y = i * zh + 6;
    s += txt(0, y + 8, z.name.length > 11 && nameW < 100 ? z.name.slice(0, 10) + "." : z.name, { a: "start", fill: "#424245", fs: 11 });
    s += `<rect x="${nameW}" y="${y}" width="${bw}" height="7" rx="3.5" fill="#F2F2F5"/>`;
    s += `<rect x="${nameW}" y="${y}" width="${Math.max(7, bw * Math.min(100, z.wert) / 100)}" height="7" rx="3.5" fill="${o.farbe}"><title>${esc(z.tip)}</title></rect>`;
    s += txt(w, y + 8, `${de(z.wert)} %`, { a: "end", fill: "#424245", fs: 11, fw: 600 });
  });
  return svgOf(w, h, s, o.titel);
}
function punkte(w, n_, auff, o) {
  const r = 4.5, ab = 12.5, jeZ = Math.max(1, Math.floor((w + ab - 2 * r) / ab)), zeilen = Math.ceil(n_ / jeZ), h = zeilen * ab;
  let s = "";
  for (let i = 0; i < n_; i++) {
    const x = w - r - (i % jeZ) * ab, y = r + Math.floor(i / jeZ) * ab;
    s += `<circle cx="${x}" cy="${y}" r="${r}" fill="${i < auff ? "#FF9F0A" : "#C7C7CC"}"/>`;
  }
  return svgOf(w, h, s, o.titel);
}
function fortschritt(w, wert, max, o) {
  const h = 30, f = Math.max(0, Math.min(1, wert / max));
  let s = `<rect x="0" y="6" width="${w}" height="8" rx="4" fill="#F2F2F5"/><rect x="0" y="6" width="${Math.max(8, w * f)}" height="8" rx="4" fill="${o.farbe}"/>`;
  s += txt(0, 28, "0", { a: "start", fs: 10 }) + txt(w, 28, `${max} Nächte`, { a: "end", fs: 10 });
  return svgOf(w, h, s, o.titel);
}
function band(w, o) {
  const h = 46, X = v => 6 + (v - o.von) / (o.bis - o.von) * (w - 12), y = 16;
  let s = `<rect x="6" y="${y - 3}" width="${w - 12}" height="6" rx="3" fill="#F2F2F5"/>`;
  s += `<rect x="${X(o.band[0])}" y="${y - 5}" width="${Math.max(4, X(o.band[1]) - X(o.band[0]))}" height="10" rx="5" fill="${o.farbe}" opacity=".22"/>`;
  s += `<circle cx="${X(o.wert)}" cy="${y}" r="6.5" fill="#fff"/><circle cx="${X(o.wert)}" cy="${y}" r="4.6" fill="${o.farbe}"/>`;
  o.marken.forEach(m => { s += txt(X(m.v), y + 22, m.t, { a: m.a || "middle", fill: m.stark ? "#424245" : "#86868B", fw: m.stark ? 600 : 400 }); });
  return svgOf(w, h, s, o.titel);
}

/* ── Teile ───────────────────────────────────────────────────────────── */
const T = {};

// Kopf: Datum, „Haus“, Stand; rechts Gute Nacht. Die Symbolzeile (! 3 prüfen · ⏳ 1 lernt · ✓ 4 ok) ist seit 11.10.2026
// weg (Nutzer: „erklären sich nicht“) – was zu prüfen ist, steht in „Bitte ansehen“ und an den Kacheln.
const chips = k => {
  const c = [];
  const z = (st, anz, wort) => { if (anz) c.push(`<span class="chip ${st}"><i>${STUFE[st][0]}</i><b>${anz}</b>${esc(wort)}</span>`); };
  z("nio", k.n_nio, "Störung"); z("beobachten", k.n_blick, "prüfen"); z("lernt", k.n_lernt, "lernt");
  z("unbekannt", k.n_unbekannt, "keine Daten"); z("laeuft", k.n_laeuft, "rechnet"); z("io", k.n_io, "ok");
  if (!k.n_nio && !k.n_blick && !k.n_unbekannt && !k.n_laeuft) c.unshift(`<span class="chip gross io"><i>${IC.ok}</i>Alles ok</span>`);
  return c.join("");
};
H.chips = chips;
T.kopf = function (w, D) {
  const k = D.kopf, jetzt = D.berechnet_ms || Date.now();
  const datum = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long", timeZone: TZ }).format(new Date());
  const st = k.stand || {};
  const info = [k.satz, ...(k.neben || []), st.vorher_n ? `${st.vorher_n} Bereich(e) zeigen noch den letzten Stand, neu wird gerechnet` : "",
    `Zahlen der letzten 7 Tage (${st.zeitraum_text || ""}) gegen die 7 Tage davor. Zustand berechnet ${uhr(st.berechnet_ms || jetzt)}.`,
    `${IC.ok} ok · ${IC.pruefen} prüfen · ${IC.stoerung} Störung · ${IC.unbekannt} keine Daten · ${IC.lernt} lernt noch (kein Befund)`].filter(Boolean).join("\n");
  w.innerHTML = `<header class="kopf">
    <div class="datum">${esc(datum)}</div>
    <h1>Jetzt</h1>
    <div class="gn"><button class="gn-knopf" id="gn" type="button" aria-label="Gute Nacht senden (Szene der Home-App)"></button>
      <div class="gn-info" id="gn-info" aria-live="polite"></div></div>
  </header>`;
  H.gnZeigen(D.gute_nacht || {});
};

// Lernfortschritt als EINE Zeile: fertig = Stufe "bereit"; gezählt nur Programme mit Ziel (prozent nicht null)
H.lernStand = function (M) {
  const l = (M && M.liste) || [], mit = l.filter(p => p.prozent != null), fertig = mit.filter(p => p.stufe === "bereit");
  const offen = mit.filter(p => p.stufe !== "bereit" && p.eta_datum).sort((a, b) => a.eta_datum < b.eta_datum ? -1 : 1);
  const pl = p => p.prozent_langsamst != null ? p.prozent_langsamst : p.prozent;
  const tip = ["Lernende Programme – fertig = alle Teilziele erreicht. % = langsamstes Teilziel.",
    ...mit.map(p => `${p.stufe === "bereit" ? IC.ok : IC.lernt} ${p.name}: ${pl(p)} %${p.stufe !== "bereit" && p.eta_datum ? " · ~" + datumKurz(p.eta_datum) : ""}${p.langsamst_name ? " (" + p.langsamst_name + ")" : ""}`)].join("\n");
  return { fertig: fertig.length, gesamt: mit.length, naechstes: offen[0] || null, tip };
};

// Treffsicherheit (11.10.2026, Nutzer: „nur die retrospektive selbstbewertung wie gut es vorhergesagt hat“) statt
// Lernfortschritt: je Programm Stufe gut/mäßig/schlecht/keine Bewertung aus /ml/treffer (Teil ml.treffer).
const TR = { gut: [IC.ok, "gut", "io"], maessig: [IC.pruefen, "mäßig", "beobachten"], schlecht: [IC.stoerung, "schlecht", "nio"],
             "keine Bewertung": [IC.lernt, "offen", "lernt"] };
H.trefferStand = function (M) {
  const l = (M && M.treffer) || [];
  const z = { gut: 0, maessig: 0, schlecht: 0, "keine Bewertung": 0 };
  l.forEach(p => { z[p.stufe in z ? p.stufe : "keine Bewertung"]++; });
  const L = H.lernStand(M);
  const tip = ["Vorhersagen – wie gut? Rückblick: echte, vorher gespeicherte Vorhersagen gegen das, was dann war (meist letzte 30 Tage).",
    ...l.map(p => `${(TR[p.stufe] || TR["keine Bewertung"])[0]} ${p.name}: ${p.stufe === "keine Bewertung" ? (p.bewertbar === false ? "sagt nichts vorher" : (p.ab_text || p.kennzahl_kurz || "noch offen")) : p.kennzahl_kurz}${p.n != null && p.stufe !== "keine Bewertung" ? " (n = " + p.n + ")" : ""}`),
    L.gesamt ? `Datenstand (nicht Treffsicherheit): ${L.fertig} von ${L.gesamt} Programmen mit genug Daten.` : ""].filter(Boolean).join("\n");
  return { z, gesamt: l.length, tip };
};

T.tun = function (w, D) {
  const k = D.kopf, e = k.empfehlungen, B = D.bereiche || [];
  const nrVon = name => (B.find(b => b.bereich === name) || {}).nr;
  const zeilen = k.punkte.map(p => {
    const nr = nrVon(p.bereich), emo = EMO[p.icon] || "•";
    const was = p.art === "klaeren" ? "Soll gewollt?" : grundKurz(p.text_kurz);
    const st = p.stufe === "nio" ? "nio" : "beobachten";
    return `<a class="zeile" href="${esc(link(p.ziel_url))}" title="${esc(tt(p.titel + ": " + (p.text_kurz || "")))}">
      <span class="emo">${emo}</span>
      <span class="z-mitte"><span class="z-titel">${esc(KURZ[nr] || p.bereich)}</span><span class="z-was">${esc(was)}</span></span>
      <span class="st-kreis ${st}" aria-label="${STUFE[st][1]}">${STUFE[st][0]}</span>${chev}</a>`;
  }).join("");
  let leer = "";
  if (!k.punkte.length) leer = k.laeuft
    ? `<div class="zeile"><span class="emo">${IC.lernt}</span><span class="z-mitte"><span class="z-titel">Wird berechnet</span></span></div>`
    : `<div class="zeile"><span class="emo" style="color:var(--io)">${IC.ok}</span><span class="z-mitte"><span class="z-titel">Alles in Ordnung</span></span></div>`;
  const mehr = k.weitere ? `<div class="zeile leise"><span class="emo">${IC.plus}</span><span class="z-mitte"><span class="z-was">${k.weitere} weitere – siehe Bereiche</span></span></div>` : "";
  // Empfehlungen: offen + Fragen groß; ⓘ = alle Status-Zähler, Summe = gesamt (W4)
  let emp = "";
  if (e) {
    const zl = e.zaehler || {}, WORT = { offen: "offen", frage: "Frage", optional: "optional", vorschlag: "Vorschlag", info: "Info",
      erledigt: "erledigt", verworfen: "verworfen", unbekannt: "ohne Status" };
    const summe = Object.values(zl).reduce((a, b) => a + (b || 0), 0);
    const tip = `Empfehlungen: ${Object.keys(WORT).filter(s => zl[s]).map(s => `${zl[s]} ${WORT[s]}`).join(" + ")} = ${summe || e.gesamt} gesamt`;
    emp = `<a class="zeile grau" href="${esc(link(e.ziel_url))}" title="${esc(tt(tip))}"><span class="emo">${IC.liste}</span>
      <span class="z-mitte"><span class="z-titel">Empfehlungen</span><span class="z-was">${de(e.offen)} offen${e.frage ? ` · ${de(e.frage)} ${e.frage === 1 ? "Frage" : "Fragen"}` : ""}</span></span>${ibox(tip)}${chev}</a>`;
  }
  // Vorhersagen (Treffsicherheit) statt „Lernen x von 14 fertig“ (11.10.2026); ohne Treffer-Daten die alte Zeile
  const Q = H.trefferStand(D.ml), L = H.lernStand(D.ml);
  // schlecht zuerst; nur Icon (Statusfarbe) + Anzahl – „2 gut · 3 mäßig · 2 schlecht“ passt am Mac nicht (Wörter im ⓘ)
  const teile = ["schlecht", "maessig", "gut"].filter(s => Q.z[s]).map(s =>
    `<span class="tr ${TR[s][2]}" title="${Q.z[s]} ${TR[s][1]}"><i>${TR[s][0]}</i>${Q.z[s]}</span>`).join("");
  const lern = Q.gesamt ? `<a class="zeile grau" href="${esc(link("/bereich?"))}" title="${esc(tt(Q.tip))}"><span class="emo">${IC.ziel}</span>
      <span class="z-mitte"><span class="z-titel">Vorhersagen</span><span class="z-was">${teile || `${Q.z["keine Bewertung"]} noch offen`}</span></span>${ibox(Q.tip)}${chev}</a>`
    : L.gesamt ? `<a class="zeile grau" href="${esc(link("/bereich?"))}" title="${esc(tt(L.tip))}"><span class="emo">${IC.lernen}</span>
      <span class="z-mitte"><span class="z-titel">Datenstand</span><span class="z-was">${L.fertig} von ${L.gesamt} genug Daten</span></span>${ibox(L.tip)}${chev}</a>` : "";
  const anzahl = k.punkte.length + k.weitere;
  w.innerHTML = `<section class="karte tun"><div class="k-kopf"><h2>Bitte ansehen</h2><span class="k-neben">${anzahl ? anzahl + (anzahl === 1 ? " Punkt" : " Punkte") : ""}</span></div>
    <div class="zeilen">${zeilen}${leer}${mehr}<div class="unten">${emp}${lern}</div></div></section>`;
};

// „7 Tage“: drei Zahlen mit EINER Zeitbasis (gleicher Zeitraum wie die Bereiche); darunter „Jetzt“ (Mittel 2 min)
T.heute = function (w, D) {
  const wo = D.woche || {}, l = D.licht || {}, j = D.jetzt || {}, st = (D.kopf || {}).stand || {};
  const kW = x => de(Math.abs(x || 0) / 1000, 1);
  const hg = l.handgriffe_pro_tag != null ? l.handgriffe_pro_tag : (l.mit_handgriff != null && l.span_tage ? l.mit_handgriff / l.span_tage : null);
  const hgTrend = l.handgriffe_trend === "ab" ? "▼" : l.handgriffe_trend === "auf" ? "▲" : l.handgriffe_trend === "gleich" ? "≈" : "";
  const hgTip = `${IC.hand} Handgriffe = Licht per Taster eingeschaltet: ${de(l.mit_handgriff)} in ${de(l.span_tage, 1)} Tagen ≈ ${de(hg, 1)} je Tag`
    + (l.handgriffe_pro_tag_sd != null ? ` (± ${de(l.handgriffe_pro_tag_sd, 1)} je Tag, 1σ über ${l.handgriffe_tage_n} ganze Tage)` : "")
    + `. Ziel 0.` + (l.handgriffe_vorwoche_pro_tag != null ? ` Vorwoche ${de(l.handgriffe_vorwoche_pro_tag, 1)} je Tag.` : ` ${l.vergleich_text || ""}`)
    + ` ${l.n != null ? `${de(l.quote_pct)} % von ${de(l.n)} Einschaltungen ohne Handgriff.` : ""} ${l.hinweis || ""}`;
  const autTip = `${IC.sonne} Selbst versorgt: Anteil des Hausstroms aus Sonne und Akku, letzte 7 Tage (${st.zeitraum_text || ""}). `
    + (wo.verbrauch_kwh != null ? `Haus ${de(wo.verbrauch_kwh)} kWh, davon ${de(wo.bezug_haus_kwh, 1)} kWh aus dem Netz.` : "")
    + (D.heute && D.heute.autarkie_pct != null ? ` Heute bisher ${de(D.heute.autarkie_pct)} %.` : "");
  const netzTip = `${IC.netz} Netzbezug: Strom aus dem Netz, letzte 7 Tage (Zähler des Wechselrichters${wo.abdeckung_pct != null && wo.abdeckung_pct < 100 ? `, ${de(wo.abdeckung_pct)} % gemessen` : ""}).`;
  const zahl = (href, emo, wert, einheit, wort, tip, extra = "") => `<a class="z3" href="${esc(link(href))}" title="${esc(tt(tip))}">
      <span class="z3-wert"><span class="emo">${emo}</span><b>${wert}</b><small>${einheit}</small>${extra}</span>
      <span class="z3-wort">${wort}</span></a>`;
  const akkuWort = j.akku_w >= 100 ? "lädt" : j.akku_w <= -100 ? "gibt ab" : "ruht";
  const netzWort = j.netz_w >= 100 ? "Einspeisung" : j.netz_w <= -100 ? "Bezug" : "Netz";
  const v = (x, roh) => j.verfuegbar ? (Math.abs(x) < 100 && roh ? "0,0" : kW(x)) : "–";
  const jetztTip = `Jetzt = Mittel der letzten 2 min${j.zeit_ms ? " bis " + uhr(j.zeit_ms) : ""}. ${j.satz || ""} ${IC.akku} = Ladestand jetzt (nicht die Gesundheit des Akkus).`;
  w.innerHTML = `<section class="karte heute"><div class="k-kopf"><h2>7 Tage</h2><span class="k-neben">${esc(st.zeitraum_text || "")}</span></div>
    <div class="z3-reihe">
      ${zahl("/bereich?", IC.sonne, wo.autarkie_pct != null ? de(wo.autarkie_pct) : "–", "%", "selbst versorgt", autTip)}
      ${zahl("/bereich?", IC.hand, hg != null ? de(hg, 1) : "–", "/Tag", `Handgriffe<br><span class="ziel">Ziel 0</span>`, hgTip, hgTrend ? `<span class="trend">${hgTrend}</span>` : "")}
      ${zahl("/bereich?", IC.netz, wo.bezug_kwh != null ? de(wo.bezug_kwh, 1) : "–", "kWh", "Netzbezug", netzTip)}
    </div>
    <a class="jetzt-block" href="${esc(link("/bereich?"))}" title="${esc(tt(jetztTip))}">
      <div class="jetzt-kopf"><span>Jetzt</span><span>${j.zeit_ms ? `<span class="emo">${IC.uhr}</span> ` + uhr(j.zeit_ms) : ""}</span></div>
      <div class="jetzt">
        <div><b><span class="emo">${IC.sonne}</span>${v(j.sonne_w)}</b><small>kW Sonne</small></div>
        <div><b><span class="emo">${IC.haus}</span>${v(j.haus_w)}</b><small>kW Haus</small></div>
        <div><b><span class="emo">${IC.akku}</span>${j.soc != null ? de(j.soc) + " %" : "–"}</b><small>Akku ${akkuWort}</small></div>
        <div><b><span class="emo">${IC.netz}</span>${v(j.netz_w, true)}</b><small>kW ${netzWort}</small></div>
      </div></a></section>`;
};
/* „Jetzt“ (11.10.2026, zuerst sichtbar): IST-Werte als 6 große Kacheln – Symbol + Wort + Zahl + was gerade passiert */
/* ── Infografiken der Messwerte (Nutzer 13.10.2026: „geeignete infografiken zu jedem wert … kreativ … weich“) ──
   Alles SVG/CSS in der Kachel, weiche Verläufe, runde Enden, sanfte Bewegung (prefers-reduced-motion: aus).
   Sonne: Halbbogen 0 bis Wechselrichter-Nennleistung · Haus: woher der Strom kommt (Sonne/Akku/Netz) · Akku: Batterie mit
   Füllstand und Welle (steigt beim Laden, sinkt beim Entladen) · Netz: Pendel ab der Mitte (links Bezug, rechts Einspeisung,
   ± Netzgrenze) · Innen: Skala 16–28 °C mit Wohlfühlzone 20–23 °C und Spanne kühlster–wärmster Raum · Außen: Skala −10…35 °C mit
   heutigem Tief–Hoch-Band und dem Wert jetzt. */
const VZ = {
  bogen(anteil, aus) {                               // Halbbogen, anteil 0..1
    const a = Math.max(0, Math.min(1, anteil || 0)), r = 34, cx = 44, cy = 40, L = Math.PI * r;
    return `<svg class="vz-bogen" viewBox="0 0 88 46" aria-hidden="true"><defs><linearGradient id="vzS" x1="0" x2="1">
        <stop offset="0" stop-color="#FFD66B"/><stop offset="1" stop-color="#FF9F0A"/></linearGradient></defs>
      <path d="M${cx - r},${cy} A${r},${r} 0 0 1 ${cx + r},${cy}" class="vz-spur"/>
      ${a > 0.005 ? `<path d="M${cx - r},${cy} A${r},${r} 0 0 1 ${cx + r},${cy}" stroke="url(#vzS)" class="vz-fuell"
        stroke-dasharray="${(a * L).toFixed(1)} ${L.toFixed(1)}"/>` : ""}
      ${aus ? `<circle cx="${cx}" cy="${cy - 6}" r="5" class="vz-mond"/>` : `<circle cx="${(cx - r * Math.cos(Math.PI * a)).toFixed(1)}" cy="${(cy - r * Math.sin(Math.PI * a)).toFixed(1)}" r="4.5" fill="#FF9F0A" class="vz-glut"/>`}
    </svg>`;
  },
  herkunft(teile) {                                  // [[wert, farbe, name], …] -> weiche Leiste + Punkte
    const sum = teile.reduce((x, t) => x + Math.max(0, t[0]), 0);
    if (!sum) return `<div class="vz-leiste leer"></div>`;
    const seg = teile.filter(t => t[0] > 0).map(t => `<span style="flex:${t[0]};background:${t[1]}" title="${t[2]} ${Math.round(100 * t[0] / sum)} %"></span>`).join("");
    const leg = teile.filter(t => t[0] > 0).map(t => `<span><i style="background:${t[1]}"></i>${t[2]} ${Math.round(100 * t[0] / sum)} %</span>`).join("");
    return `<div class="vz-leiste">${seg}</div><div class="vz-leg">${leg}</div>`;
  },
  akku(soc, w) {
    const f = Math.max(0, Math.min(100, soc || 0)), richtung = w >= 100 ? "auf" : w <= -100 ? "ab" : "";
    const farbe = f < 20 ? "#FF6B5E" : f < 50 ? "#FFC24B" : "#34C77B";
    return `<div class="vz-akku ${richtung}"><div class="vz-akku-fuell" style="width:${f}%;--fa:${farbe}"><span class="vz-welle"></span></div><span class="vz-akku-pol"></span></div>`;
  },
  pendel(w) {                                        // w > 0 Einspeisung (rechts), < 0 Bezug (links), ±10 kW
    const a = Math.max(-1, Math.min(1, (w || 0) / 10000)), breite = Math.abs(a) * 50;
    const links = a < 0, farbe = links ? "#AF52DE" : "#8E8E93";
    return `<div class="vz-pendel"><span class="vz-mitte"></span>${Math.abs(w || 0) >= 50
      ? `<span class="vz-pendel-wert" style="${links ? "right" : "left"}:50%;width:${breite}%;background:${farbe}"></span>` : `<span class="vz-ruhe"></span>`}</div>
      <div class="vz-leg zwei"><span>Bezug</span><span>Einspeisung</span></div>`;
  },
  skala(lo, hi, wert, von, bis, zone) {              // Temperaturskala mit Band lo–hi, Punkt wert, optional Wohlfühlzone
    const p = x => Math.max(0, Math.min(100, 100 * (x - von) / (bis - von)));
    const z = zone ? `<span class="vz-zone" style="left:${p(zone[0])}%;width:${p(zone[1]) - p(zone[0])}%"></span>` : "";
    const band = lo != null && hi != null ? `<span class="vz-band" style="left:${p(lo)}%;width:${Math.max(2, p(hi) - p(lo))}%"></span>` : "";
    const punkt = wert != null ? `<span class="vz-punkt" style="left:${p(wert)}%"></span>` : "";
    return `<div class="vz-skala">${z}${band}${punkt}</div><div class="vz-leg zwei"><span>${von}°</span><span>${bis}°</span></div>`;
  },
};

T.jetzt = function (w, D) {
  const j = D.jetzt || {}, R = D.raum || {}, A = D.aussen || {};
  const kW = x => j.verfuegbar && x != null ? de(Math.abs(x) / 1000, 1) : "–";
  const eing = (R.raeume || []).find(r => r.id === "eingang");
  const aussen = eing && eing.temp_c != null ? eing.temp_c : A.jetzt;
  const aussenWo = eing && eing.temp_c != null ? "Hof" : (A.jetzt_quelle || "");
  const lo = R.innen_min, hi = R.innen_max;
  const akkuWort = j.akku_w >= 100 ? "wird geladen" : j.akku_w <= -100 ? "liefert Strom" : "ruht";
  // Netz wie auf allen Seiten (E-33, 13.10.2026): Einspeisung +, Bezug −; unter 50 W „ausgeglichen“ (Regelrauschen um 0)
  const netzRuhig = j.netz_w == null || Math.abs(j.netz_w) < 50;
  const netzWort = netzRuhig ? "ausgeglichen" : j.netz_w > 0 ? "Einspeisung" : "Bezug";
  const netzZahl = !j.verfuegbar || j.netz_w == null ? "–" : netzRuhig ? "0,0" : (j.netz_w > 0 ? "+" : "−") + kW(j.netz_w);
  const sonneWort = (j.sonne_w || 0) >= 50 ? "erzeugt" : "keine Sonne";
  // Herkunft des Hausstroms: Sonne direkt (höchstens der Verbrauch), Akku beim Entladen, Netz beim Bezug
  const haus = Math.max(0, j.haus_w || 0), ausAkku = Math.max(0, -(j.akku_w || 0)), ausNetz = netzRuhig ? 0 : Math.max(0, -(j.netz_w || 0));
  const ausSonne = Math.max(0, haus - ausAkku - ausNetz);
  const k = (href, ic, name, wert, einheit, wort, viz, ton = "") => `<a class="jk ${ton}" href="${esc(link(href))}">
      <span class="jk-name"><span class="emo">${ic}</span>${name}</span>
      <span class="jk-wert"><b>${wert}</b><small>${einheit}</small></span>
      <span class="jk-wort">${wort}</span><span class="vz">${viz || ""}</span></a>`;
  // Abschnitt „Messwerte“: Kacheln mit Infografik je Wert, darunter die Auto-Karte
  w.innerHTML = `<section class="abschnitt"><div class="abschnitt-kopf"><h2>Messwerte</h2><span>${j.zeit_ms ? uhr(j.zeit_ms) + " Uhr" : ""}</span></div>
    <div class="jk-reihe">
      ${k("/bereich?", IC.solar, "Sonne", kW(j.sonne_w), "kW", sonneWort, VZ.bogen((j.sonne_w || 0) / PV_NENN_W, (j.sonne_w || 0) < 50))}
      ${k("/bereich?", IC.haus, "Haus", kW(j.haus_w), "kW", "Verbrauch",
          VZ.herkunft([[ausSonne, "#FFB340", "aus Sonne"], [ausAkku, "#34C77B", "aus Akku"], [ausNetz, "#AF52DE", "aus Netz"]]))}
      ${k("/bereich?", IC.akku, "Akku", j.soc != null ? de(j.soc) : "–", "%", akkuWort, VZ.akku(j.soc, j.akku_w))}
      ${k("/bereich?", IC.netz, "Netz", netzZahl, "kW", netzWort, VZ.pendel(netzRuhig ? 0 : j.netz_w), j.netz_w <= -300 ? "ton-bezug" : "")}
      ${k("/bereich?", IC.temperatur, "Innen", lo && hi ? `${de(lo.c)}–${de(hi.c)}` : "–", "°C", lo && hi ? "alle Räume" : "",
          VZ.skala(lo && lo.c, hi && hi.c, null, 16, 28, [20, 23]))}
      ${k("/bereich?", IC.baum, "Außen", aussen != null ? de(aussen, 1) : "–", "°C", aussen == null ? "kein Messwert" : aussenWo === "Terrasse" ? "Terrasse (Hof still)" : A.heute_min != null ? `heute ${de(A.heute_min)} bis ${de(A.heute_max)}°` : "Hof",
          VZ.skala(A.heute_min, A.heute_max, aussen, -10, 35))}
    </div></section>`;
};

/* „Rückblick“: Zeitraumwahl (gilt für alles darunter) + drei Kernzahlen in Worten */
T.rueckblick = function (w, D) {
  const wo = D.woche || {}, l = D.licht || {}, st = (D.kopf || {}).stand || {}, z = zrJetzt();
  const hg = l.handgriffe_pro_tag != null ? l.handgriffe_pro_tag : (l.mit_handgriff != null && l.span_tage ? l.mit_handgriff / l.span_tage : null);
  const knopf = x => `<button type="button" data-zr="${x.k}" aria-pressed="${x.k === z.k}">${x.t}</button>`;
  const zahl = (href, ic, wert, einheit, wort) => `<a class="rb" href="${esc(link(href))}">
      <span class="rb-wert"><span class="emo">${ic}</span><b>${wert}</b><small>${einheit}</small></span><span class="rb-wort">${wort}</span></a>`;
  // „wird geladen“, bis Daten mit dem neuen Zeitraum da sind (Anfang weicht vom bisherigen ab), höchstens 90 s
  const rechnet = n._zrWechsel && Date.now() - n._zrWechsel < 90000 && wo.von_ms === n._zrAltVon && wo.bis_ms === n._zrAltBis;
  const ab = wo.abdeckung_pct != null && wo.abdeckung_pct < 90 && wo.von_ms && wo.bis_ms
    ? " · gemessen erst ab " + new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", timeZone: TZ })
        .format(new Date(wo.bis_ms - wo.abdeckung_pct / 100 * (wo.bis_ms - wo.von_ms))) : "";
  w.innerHTML = `<div class="abschnitt-kopf rb-kopf"><h2>Rückblick</h2>
      <div class="segment gross" role="group" aria-label="Zeitraum">${ZR.map(knopf).join("")}</div>
      <span class="rb-zeit">${rechnet ? "wird geladen …" : esc(st.zeitraum_text || "")}</span></div>
    <div class="rb-reihe">
      ${zahl("/bereich?", IC.solar, wo.autarkie_pct != null ? de(wo.autarkie_pct) : "–", "%", "eigener Strom (Sonne + Akku)" + ab)}
      ${zahl("/bereich?", IC.netz, wo.bezug_kwh != null ? de(wo.bezug_kwh, 1) : "–", "kWh", "aus dem Netz gekauft" + ab)}
      ${zahl("/bereich?", IC.hand, hg != null ? de(hg, 1) : "–", "× / Tag", "Licht von Hand geschaltet · Ziel 0")}
    </div>`;
  w.querySelectorAll("[data-zr]").forEach(b => b.addEventListener("click", ev => {
    ev.preventDefault(); ev.stopPropagation();
    const x = ZR.find(y => y.k === b.dataset.zr), ls = H.hg && H.hg.locationService;
    if (!x || !ls || !ls.partial) return;
    if (x.k === z.k) return;
    n._zrWechsel = Date.now(); n._zrAltVon = wo.von_ms; n._zrAltBis = wo.bis_ms;
    ls.partial({ from: x.from, to: "now" }, true);
    T.rueckblick(w, D);
  }));
};
/* Raumkarte: EG + OG nebeneinander, Pastell aus den Grundriss-Farben; Umschalter Temperatur · Anwesenheit */
const mischen = (hex, anteil) => {          // Farbe mit Weiss mischen (anteil = Weissanteil 0..1)
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return "#EDEDF0";
  const c = [1, 3, 5].map(i => parseInt(hex.substr(i, 2), 16)).map(v => Math.round(v + (255 - v) * anteil));
  return "#" + c.map(v => v.toString(16).padStart(2, "0")).join("");
};
T.raum = function (w, D) {
  const R = D.raum || {}, ansicht = n._ansicht || "temp", raeume = R.raeume || [], bew = new Set(D.praesenz_jetzt || []);
  if (!raeume.length) {
    w.innerHTML = `<section class="karte raum"><div class="k-kopf"><h2><span class="emo">${IC.haus}</span> Räume</h2><a class="k-link" href="${esc(link("/bereich?"))}">Grundriss${chev}</a></div>
      <div class="raum-leer">Raumwerte werden geladen …</div></section>`;
    return;
  }
  const schmal = w.clientWidth < 560;
  const dach = raeume.find(r => r.art === "dach"), eing = raeume.find(r => r.id === "eingang");
  const lo = R.innen_min, hi = R.innen_max;
  let text;
  const tipT = `Innen ${lo && hi ? `${de(lo.c, 1)}–${de(hi.c, 1)} °C: am kühlsten ${lo.raum}, am wärmsten ${hi.raum}` : "–"}. Hof = Fühler am Eingang`
    + `${dach && dach.temp_c != null ? `; Dachboden ${de(dach.temp_c, 1)} °C` : ""}. Punkt = Bewegung in den letzten 15 min (Räume mit Melder).`;
  if (ansicht === "temp") {
    const aussen = [eing && eing.temp_c != null ? `<span class="emo">${IC.temperatur}</span> Hof <b>${de(eing.temp_c, 1)}°</b>` : "",
                    dach && dach.temp_c != null ? `Dach <b>${de(dach.temp_c, 1)}°</b>` : ""].filter(Boolean).join('<span class="tz">·</span>');
    text = `<div class="raum-gross" title="${esc(tt(tipT))}">${lo && hi ? `${de(lo.c)}–${de(hi.c)}<small>°C</small>` : "–"}<small class="innen">innen</small>${ibox(tipT)}</div>
      <div class="raum-aussen">${aussen}</div>
      <div class="leg"><span><i style="background:${mischen("#2c7bb6", .5)}"></i>kühl</span><span><i style="background:${mischen("#e8553a", .5)}"></i>warm</span><span><i class="punkt" style="background:#8E6CC9"></i><span class="emo">${IC.person}</span> jetzt${bew.size ? "" : ": –"}</span></div>`;
  } else {
    const tipA = "Präsenz (Räume mit Melder): Anteil der Zeit mit Bewegung, 7 Tage. Aktivität (übrige Räume): Licht-Einschaltungen je Tag. "
      + "Aktivität ≠ Anwesenheit: „0“ heißt nur, dass kein Licht anging. Katzen lösen Melder mit aus.";
    text = `<div class="raum-gross" style="font-size:${schmal ? 19 : 22}px" title="${esc(tt(tipA))}"><span class="emo">${IC.person}</span> Anwesenheit <small>7 Tage</small>${ibox(tipA)}</div>
      <div class="leg"><span><i style="background:${mischen("#7e5bbd", .25)}"></i>% der Zeit</span>
      <span><i style="background:${mischen("#36a386", .35)}"></i><span class="emo">${IC.licht}</span> ×/Tag</span></div>`;
  }
  const schild = "";
  w.innerHTML = `<section class="karte raum"><div class="k-kopf"><h2><span class="emo">${IC.haus}</span> Räume</h2>
      <div class="segment" role="group" aria-label="Ansicht"><button type="button" data-ansicht="temp" aria-pressed="${ansicht === "temp"}">Temperatur</button><button type="button" data-ansicht="anw" aria-pressed="${ansicht !== "temp"}">Anwesenheit</button></div>
      <a class="k-link" href="${esc(link("/bereich?"))}" aria-label="Räume – Grundriss öffnen">${schmal ? "" : "Grundriss"}${chev}</a></div>
    <div class="raum-koerper"><div class="raum-text">${text}</div>
      <div class="plaene"><figure data-g="EG"></figure><figure data-g="OG"></figure></div></div></section>`;
  // Plaene in den Platz einpassen, der nach dem Text bleibt (Mac: rechts daneben, iPhone: darunter)
  const karte = w.querySelector(".karte"), pl = w.querySelector(".plaene"), kr = karte.getBoundingClientRect(), pr = pl.getBoundingClientRect();
  const innenR = raeume.filter(r => r.art !== "dach");
  const alle = innenR.flatMap(r => r.p);
  const x0 = Math.min(...alle.map(p => p[0])) - .1, x1 = Math.max(...alle.map(p => p[0])) + .1;
  const y0 = Math.min(...innenR.filter(r => r.art !== "aussen").flatMap(r => r.p).map(p => p[1])) - .1, y1 = Math.max(...alle.map(p => p[1])) + .1;
  const hoch = Math.max(90, kr.bottom - 16 - (schmal ? pr.top : kr.top + 52) - 22);
  const breitJe = schmal ? (kr.width - 40 - 12) / 2 : Math.min(250, (kr.width - 40 - 250 - 18 - 12) / 2);
  const k = Math.max(4, Math.min(hoch / (y1 - y0), breitJe / (x1 - x0)));
  const W = (x1 - x0) * k, Hh = (y1 - y0) * k;
  const xy = p => `${((p[0] - x0) * k).toFixed(1)},${((p[1] - y0) * k).toFixed(1)}`;
  const geschoss = g => {
    let s = "";
    raeume.filter(r => r.geschoss === g && r.art !== "dach").forEach(r => {
      const pts = r.p.map(xy).join(" ");
      if (r.art === "aussen") {
        s += `<polygon class="aussen" points="${pts}"><title>${esc(r.name)}: ${esc(r.temp_t || "–")}</title></polygon>`;
        if (ansicht === "temp" && r.temp_c != null) s += `<text x="${((r.z[0] - x0) * k).toFixed(1)}" y="${((r.z[1] - y0) * k + 3.5).toFixed(1)}" text-anchor="middle" class="klein">Hof ${de(r.temp_c, 1)}°</text>`;
        return;
      }
      const leer = r.art === "luftraum";
      let fill = "#EDEDF0", wert = null;
      if (leer) fill = "#FAFAFC";
      else if (ansicht === "temp") { if (r.temp_c != null) { fill = mischen(r.temp_f, .5); wert = de(r.temp_c, 1); } }
      else if (r.anw_t) { fill = mischen(r.anw_f, r.anw_art === "praesenz" ? .25 : .35); wert = r.anw_t.replace("×/Tag", "×"); }
      const xs = r.p.map(p => p[0]), yy = r.p.map(p => p[1]);
      const bw = (Math.max(...xs) - Math.min(...xs)) * k, bh = (Math.max(...yy) - Math.min(...yy)) * k;
      const cx = (r.z[0] - x0) * k, cy = (r.z[1] - y0) * k;
      const ziel = r.raumseite ? `/bereich?var-raum=${encodeURIComponent(r.raumseite)}` : "/bereich?";
      const titel = `${r.name}${ansicht === "temp" ? (r.temp_t ? ": " + r.temp_t : "") : (r.anw_t ? ": " + r.anw_t + (r.anw_art === "praesenz" ? " der Zeit mit Bewegung" : " Licht-Einschaltungen") : "")}`;
      let t = "";
      if (wert && bw >= 22 && bh >= 13) t = `<text x="${cx.toFixed(1)}" y="${(cy + 3.5).toFixed(1)}" text-anchor="middle" class="${bw < 30 ? "klein" : ""}">${esc(wert)}</text>`;
      let punkt = "";
      if (ansicht === "temp" && r.melder && bew.has(r.id)) {
        const px = Math.min(cx + bw / 2 - 7, cx + 18), py = cy - 9;
        punkt = `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="3.6" fill="#8E6CC9" stroke="#fff" stroke-width="1.5"><title>Bewegung in den letzten 15 min</title></circle>`;
      }
      s += leer ? `<polygon class="r" points="${pts}" fill="${fill}"/>`
        : `<a href="${esc(link(ziel))}" aria-label="${esc(titel)}"><polygon class="r" points="${pts}" fill="${fill}"><title>${esc(titel)}</title></polygon>${t}${punkt}</a>`;
    });
    return svgOf(W.toFixed(0), Hh.toFixed(0), s, g === "EG" ? "Erdgeschoss" : "Obergeschoss");
  };
  w.querySelector('[data-g="EG"]').innerHTML = `${geschoss("EG")}<figcaption>EG</figcaption>`;
  w.querySelector('[data-g="OG"]').innerHTML = `${geschoss("OG")}<figcaption>OG${schild ? " " + schild : ""}</figcaption>`;
  w.querySelectorAll(".segment button").forEach(b => b.addEventListener("click", ev => {
    ev.preventDefault(); ev.stopPropagation();
    n._ansicht = b.dataset.ansicht;
    try { localStorage.setItem("haus-start-ansicht", n._ansicht); } catch (e) { /* egal */ }
    T.raum(w, D);
  }));
};

/* Bereiche: 9 gleich große Kacheln in fester Reihenfolge (Mac 3×3 mit Mini-Grafik, iPhone 2 Spalten ohne Grafik).
   Je Kachel: Symbol + Name + Status (✓/!/✕/⏳), Zahl + Pfeil, 1–2 Wörter; nicht-✓ getönt mit Grund in ≤ 3 Wörtern.
   Vergleichstext, Zusatz und Grund stehen im ⓘ. Alltag & Rhythmus (nur Info) steht unter „Mehr“. */
const REIHE = [1, 2, 3, 5, 6, "strom", 7, 4, 8];
// Lange Zeiträume (30 Tage, Jahr, Gesamt) zu Wochen bzw. Monaten bündeln, damit die Säulen lesbar bleiben
const kw = ms => { const d = new Date(ms); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  const j = new Date(d.getFullYear(), 0, 4); return 1 + Math.round(((d - j) / 864e5 - 3 + (j.getDay() + 6) % 7) / 7); };
const MON = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
function buendeln(tage) {
  if (tage.length <= 10) return { art: "Tag", tage: tage.map(t => ({ ...t, tag: tagKurz(t.zeit).slice(0, 2) })) };
  const monat = tage.length > 70, g = new Map();
  tage.forEach(t => { const d = new Date(t.zeit), key = monat ? d.getFullYear() * 12 + d.getMonth() : d.getFullYear() * 100 + kw(t.zeit);
    if (!g.has(key)) g.set(key, { tag: monat ? MON[d.getMonth()] : "KW" + kw(t.zeit), zeit: t.zeit, n: 0 });
    const x = g.get(key); x.n++; x.teil = x.teil || t.teil;
    ["sonne", "einspeisung", "bezug"].forEach(f => { if (t[f] != null) x[f] = (x[f] || 0) + t[f]; });
    if (t.min != null) x.min = x.min == null ? t.min : Math.min(x.min, t.min);
    if (t.max != null) x.max = x.max == null ? t.max : Math.max(x.max, t.max); });
  // leere Wochen/Monate vorne (vor Messbeginn) weglassen
  const w = [...g.values()];
  w.forEach((x, i) => { x.teil = i === w.length - 1 && x.teil; });   // nur der laufende Monat/die laufende Woche ist „angefangen“
  const i0 = w.findIndex(x => x.sonne != null || x.einspeisung != null || x.min != null);
  return { art: monat ? "Monat" : "Woche", tage: i0 > 0 ? w.slice(i0) : w };
}
function grafik(b, D, breite) {
  const h = 52, E = buendeln(D.energie_tage || []), tage = E.tage, je = E.art;
  if (b.nr === 1 && tage.length) return saeulen(breite, tage.map(t => ({ tag: t.tag, wert: t.sonne, teil: t.teil,
      ziel: t.teil && je === "Tag" ? t.prognose : 0, tip: t.teil && je === "Tag" ? `heute bis jetzt ${de(t.sonne, 1)} kWh · erwartet ${de(t.prognose)} kWh` : `${t.tag}: ${de(t.sonne, 1)} kWh` })),
    { farbe: FARBE.sonne, titel: `Sonnenstrom je ${je} (kWh)`, h });
  if (b.nr === 3 && tage.length) return saeulen(breite, tage.map(t => ({ tag: t.tag, wert: t.einspeisung, teil: t.teil,
      tip: `${t.tag}: ${de(t.einspeisung, 1)} kWh verkauft · ${de(t.bezug, 1)} kWh gekauft` })), { farbe: FARBE.netz, titel: `Einspeisung je ${je} (kWh)`, h });
  if (b.nr === 6 && D.aussen) {
    const a = D.aussen, roh = (a.tage || []).map(x => ({ zeit: x.zeit, min: x.min, max: x.max }));
    if (roh.length <= 10) roh.push({ zeit: Date.now(), min: a.heute_min, max: a.heute_max, teil: true });
    const t = buendeln(roh).tage.map(x => ({ ...x, tip: `${x.tag}: ${de(x.min, 1)} bis ${de(x.max, 1)} °C` }));
    return spannen(breite, t.slice(-12), { farbe: FARBE.himmel, titel: "Tiefst- und Höchstwert (°C)", h });
  }
  if (b.nr === 5 && b.beleg && b.beleg.length) return zeilenBalken(breite, b.beleg.slice(0, 3).map(z => ({ name: z.raum, wert: z.pct,
      tip: `${z.raum}: ${z.pct} % der Heizzeit unter Soll (${z.h} von ${z.heiz_h} h, Soll ${z.soll})` })), { farbe: FARBE.waerme, titel: "Heizzeit unter Soll" });
  if (b.nr === 8 && b.wert != null) { const m = /(\d+) von (\d+)/.exec(b.wert_text || ""); if (m) return punkte(Math.min(breite, 110), +m[2], +m[2] - +m[1], { titel: "Datenquellen (orange = prüfen)" })
      .replace("<svg ", '<svg style="margin-left:auto" '); }
  if (b.nr === 4 && b.lernt && b.wert != null) return fortschritt(breite, b.wert, 14, { farbe: "#8E8E93", titel: "Nächte gesammelt (Datenstand, keine Treffsicherheit)" });
  if (b.nr === 2 && b.wert != null) return band(breite, { von: 90, bis: 102, wert: b.wert, band: [b.wert - .5, b.wert + .5], farbe: FARBE.akku,
      titel: "Gesundheit (Speicherfähigkeit)", marken: [{ v: 90, t: "90 %", a: "start" }, { v: 100, t: "neu", stark: true, a: "end" }] });
  return "";
}
function bkKarte(b) {
  const st = stOf(b), nichtIO = st !== "io" && st !== "info";
  const tip = [`${b.bereich}: ${b.wert_text || "–"} ${b.einheit || ""} ${b.label || ""}`.trim(), b.vergleich_text, b.zusatz, b.grund_kurz,
               b.vorher ? "(letzter Stand – wird gerade neu berechnet)" : ""].filter(Boolean).map(gross1).join("\n");
  const tr = trendKurz(b);
  const unten = nichtIO && b.grund_kurz && st !== "laeuft" && st !== "lernt"
    ? `<div class="grund"><span class="emo">${STUFE[st][0]}</span> ${esc(grundKurz(b.grund_kurz))}</div>`
    : `<div class="label">${esc(BEDEUTUNG[b.nr] && !(b.nr === 4 && !b.lernt) ? BEDEUTUNG[b.nr] : labelKurz(b.label))}</div>`;
  return `<a class="karte bk klick ${nichtIO ? "ton-" + st : ""}" href="${esc(link(b.ziel_url))}" data-nr="${b.nr}" title="${esc(tt(tip))}">
    <div class="k-kopf"><span class="emo">${EMO[b.icon] || "•"}</span><span class="k-titel">${esc(KURZ[b.nr] || b.bereich)}</span>${ibox(tip)}${status(st)}</div>
    <div class="bk-koerper"><div class="bk-text">
      <div class="zahl"><b>${esc(wertKurz(b))}</b><small>${esc(b.einheit || "")}</small>${tr ? `<span class="trend">${esc(tr)}</span>` : ""}</div>
      ${unten}
    </div><div class="grafik" data-grafik="${b.nr}"></div></div></a>`;
}
const gross1 = s => s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : s;
function stromKarte(r) {
  if (!r || !r.verfuegbar) return `<div class="karte bk"><div class="k-kopf"><span class="emo">${IC.geld}</span><span class="k-titel">Rechnung</span>${status("unbekannt")}</div><div class="label">keine Prognose</div></div>`;
  const tip = `Stromrechnung ${r.jahr} (Prognose): ≈ ${de(r.rechnung_eur)} € fürs ganze Jahr (80 % sicher: ${de(r.rechnung_p10)}–${de(r.rechnung_p90)} €). `
    + `Rückzahlung ≈ ${de(r.rueckzahlung_eur)} € (${de(r.rueckzahlung_p10)}–${de(r.rueckzahlung_p90)} €), angenommen ${de(r.abschlaege_angenommen)} Abschläge.`;
  return `<a class="karte bk klick" href="${esc(link("/bereich?"))}" data-nr="strom" title="${esc(tt(tip))}">
    <div class="k-kopf"><span class="emo">${IC.geld}</span><span class="k-titel">Stromrechnung ${esc(r.jahr)}</span>${ibox(tip)}<span class="st info"><i>≈</i>Prognose</span></div>
    <div class="bk-koerper"><div class="bk-text">
      <div class="zahl"><b>≈ ${de(r.rechnung_eur)}</b><small>€ im Jahr</small></div>
      <div class="label">≈ ${de(r.rueckzahlung_eur)} € Rückzahlung</div>
    </div><div class="grafik" data-grafik="strom"></div></div></a>`;
}
T.bereiche = function (w, D) {
  const B = D.bereiche || [];
  const karten = REIHE.map(nr => nr === "strom" ? stromKarte(D.rechnung) : (b => b ? bkKarte(b) : "")(B.find(x => x.nr === nr))).join("");
  const zr = D.kopf && D.kopf.stand ? D.kopf.stand.zeitraum_text : "";
  w.innerHTML = `<div class="raster">${karten}</div>`;
  if (w.clientWidth < 641) return;                  // iPhone: keine Mini-Grafiken
  w.querySelectorAll("[data-grafik]").forEach(el => {
    const nr = el.dataset.grafik, breite = Math.floor(el.clientWidth);
    if (!breite) return;
    if (nr === "strom") {
      const r = D.rechnung;
      el.innerHTML = r && r.verfuegbar ? band(breite, { von: 400, bis: 800, wert: r.rechnung_eur, band: [r.rechnung_p10, r.rechnung_p90], farbe: FARBE.geld, titel: "Prognose Stromrechnung (80-%-Spanne)",
        marken: [{ v: r.rechnung_p10, t: `${de(r.rechnung_p10)}` }, { v: r.rechnung_p90, t: `${de(r.rechnung_p90)} €` }] }) : "";
      return;
    }
    const b = B.find(x => String(x.nr) === nr);
    el.innerHTML = b ? grafik(b, D, breite) : "";
  });
};

T.mehr = function (w, D) {
  const k = (href, emo, t) => `<a class="kachel" href="${esc(href)}" aria-label="${esc(t)}"><span class="emo">${emo}</span><b>${esc(t)}</b>${chev}</a>`;
  w.innerHTML = `<nav class="mehr" aria-label="Weitere Seiten">
      ${k("/bereich", IC.kalender, "Woche")}
      ${k(link("/bereich?"), IC.grundriss, "Grundriss")}
      ${k(API + "/grundriss/3d/", IC.wuerfel, "3D")}
      ${k(link("/bereich?"), IC.uhr, "Alltag")}
      ${k(API + "/backlog", IC.liste, "Backlog")}
      ${k("/dashboards/f/haus/", IC.ordner, "Alle Seiten")}
    </nav>`;
};
/* ── Gute Nacht (nur Kopf) ───────────────────────────────────────────── */
// Zustand ueberlebt das Neuzeichnen (Refresh jede Minute): n._gn = {art, bis, text, info}
H.gnZeigen = function (gn) {
  const knopf = n.querySelector("#gn"), info = n.querySelector("#gn-info");
  if (!knopf) return;
  if (gn) H.gnStatus = gn;
  const s = n._gn || {}, jetzt = Date.now(), g = H.gnStatus || {};
  let sperreRest = Math.ceil(((s.bis || 0) - jetzt) / 1000);
  if (!(sperreRest > 0) && g.naechste_in_s > 0 && (!s.art || s.art === "bereit")) { s.bis = jetzt + g.naechste_in_s * 1000; n._gn = s; sperreRest = g.naechste_in_s; }
  const zuletzt = g.letzte_wann ? `zuletzt ${g.letzte_wann}${g.letzte_ergebnis && g.letzte_ergebnis !== "ok" ? " (Fehler)" : ""}` : "noch nie gesendet";
  knopf.classList.remove("sendet", "fertig", "fehler");
  knopf.removeAttribute("aria-disabled");
  if (s.art === "sendet") {
    knopf.classList.add("sendet"); knopf.setAttribute("aria-disabled", "true");
    knopf.innerHTML = `<span class="dreher"></span>Wird gesendet …`;
    info.innerHTML = "&nbsp;";
  } else if (s.art === "fertig" && jetzt < (s.zeigeBis || 0)) {
    knopf.classList.add("fertig"); knopf.setAttribute("aria-disabled", "true");
    knopf.innerHTML = `${HAKEN}${esc(s.knopf || "Gesendet")}`;
    info.innerHTML = `<b>${esc(s.text)}</b><br>${esc(s.info || "")}`;
  } else if (s.art === "fehler" && jetzt < (s.zeigeBis || 0)) {
    knopf.classList.add("fehler");
    knopf.innerHTML = `${MOND}Gute Nacht`;
    info.innerHTML = `<b>${esc(s.text)}</b><br>${esc(s.info || zuletzt)}`;
  } else if (sperreRest > 0) {
    knopf.setAttribute("aria-disabled", "true");
    knopf.innerHTML = `${MOND}Gute Nacht`;
    info.innerHTML = `${s.text ? `<b>${esc(s.text)}</b><br>` : ""}wieder möglich in ${sperreRest} s · ${esc(zuletzt)}`;
  } else {
    if (s.art) n._gn = {};
    knopf.innerHTML = `${MOND}Gute Nacht`;
    info.innerHTML = `${esc(zuletzt)}<span class="nur-breit"><br>Szene der Home-App</span>${g.scharf === false ? "<br>Probebetrieb (sendet nichts)" : ""}`;
  }
  info.className = "gn-info" + (s.art === "fehler" && jetzt < (s.zeigeBis || 0) ? " fehler" : "");
  clearTimeout(n._gnTimer);
  if (sperreRest > 0 || s.art === "fertig" || s.art === "fehler") n._gnTimer = setTimeout(() => H.gnZeigen(), 1000);
};
H.gnStatusLaden = async function () {
  try {
    const r = await fetch(API + "/aktion/gute-nacht/status", { cache: "no-store" });
    if (r.ok) { const j = await r.json(); H.gnStatus = Array.isArray(j) ? j[0] : j; }
  } catch (e) { /* Rueckmeldung bleibt, naechster Refresh holt den Stand */ }
  H.gnZeigen();
};
H.gnKlick = async function () {
  const s = n._gn || {};
  if (s.art === "sendet" || (s.bis && Date.now() < s.bis) || (s.art === "fertig" && Date.now() < (s.zeigeBis || 0))) return;
  n._gn = { art: "sendet" }; H.gnZeigen();
  const ac = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = setTimeout(() => ac && ac.abort(), 45000);
  let r = null, j = {};
  try {
    r = await fetch(API + "/aktion/gute-nacht", { method: "POST", cache: "no-store", signal: ac ? ac.signal : undefined,
      headers: { "Content-Type": "application/json", "X-Haus-Aktion": "1" }, body: JSON.stringify({ quelle: "grafana" }) });
    j = await r.json().catch(() => ({}));
  } catch (e) {
    r = null;
  } finally { clearTimeout(timer); }
  const jetzt = Date.now(), sperre = ((H.gnStatus || {}).sperre_s || 60) * 1000;
  if (r && r.ok && j.ok) {
    const trocken = j.modus === "trocken";
    n._gn = { art: "fertig", knopf: trocken ? "Probelauf" : "Gesendet", text: trocken ? "Probelauf – nichts gesendet" : "Gute Nacht gesendet",
              info: trocken ? "Trockenmodus der Haus-API" : "Was die Szene schaltet, legt die Home-App fest", zeigeBis: jetzt + 6000, bis: jetzt + sperre };
    H.gnStatus = Object.assign({}, H.gnStatus, { letzte_wann: "heute " + uhr(jetzt), letzte_ergebnis: "ok" });
  } else if (r && r.status === 429) {
    const rest = j.naechste_in_s || parseInt(r.headers.get("Retry-After") || "60", 10);
    n._gn = { art: "bereit", text: "Gerade erst gesendet", bis: jetzt + rest * 1000 };
  } else if (r && r.status === 409) {
    n._gn = { art: "bereit", text: "Läuft bereits – bitte kurz warten", bis: jetzt + 5000 };
  } else if (r && (r.status === 400 || r.status === 403)) {
    n._gn = { art: "fehler", text: "Nicht gesendet – nicht erlaubt", info: j.fehler || `HTTP ${r.status}`, zeigeBis: jetzt + 8000 };
  } else if (r) {
    n._gn = { art: "fehler", text: "Nicht gesendet – Fehler im Haus-Dienst", info: (j.text || j.fehler || `HTTP ${r.status}`).replace(/^Fehler:\s*/, "").slice(0, 90), zeigeBis: jetzt + 8000 };
  } else {
    n._gn = { art: "fehler", text: "Keine Antwort vom Haus-Dienst", info: "Ob gesendet wurde, ist unklar – Stand wird geprüft.", zeigeBis: jetzt + 8000 };
  }
  H.gnZeigen();
  H.gnStatusLaden();
};
// Nur zum Pruefen der Rueckmeldungen im Test (zeigt Zustaende, sendet nichts)
n._gnVorschau = art => { const j = Date.now();
  n._gn = art === "sendet" ? { art } : art === "fertig" ? { art, knopf: "Gesendet", text: "Gute Nacht gesendet", info: "Was die Szene schaltet, legt die Home-App fest", zeigeBis: j + 6e4, bis: j + 6e4 }
    : art === "sperre" ? { art: "bereit", text: "Gerade erst gesendet", bis: j + 52000 } : { art: "fehler", text: "Keine Antwort vom Haus-Dienst", info: "Ob gesendet wurde, ist unklar – Stand wird geprüft.", zeigeBis: j + 6e4 };
  H.gnZeigen(); };

/* ── Kiosk: die Startseite zeigt sich ohne Grafana-Kopfleiste (wie Grafana-Home /bereich?kiosk), auch wenn man
   ueber Brotkrumen/Zurueck kommt; beim Weg auf eine Unterseite wird der Kiosk-Modus verlassen (dort bleiben Kopfleiste
   und Zeitraumwahl). Grafana verlaesst Kiosk nur ueber seine Esc-Taste – genau die wird hier ausgeloest. ── */
const KIOSK_RE = /(^|[?&])kiosk(=|&|$)/;
H.kioskAn = function () {
  const ls = H.hg && H.hg.locationService;
  if (!ls || !ls.getSearchObject || !ls.partial) return;
  const q = ls.getSearchObject();
  if (q.kiosk === undefined && !q.editview && !q.editPanel && !q.viewPanel && !q.inspect) ls.partial({ kiosk: true }, true);
};
H.kioskAus = function () {          // -> true, wenn Grafana dafuer einen Verlaufseintrag angelegt hat
  if (!KIOSK_RE.test(location.search.slice(1))) return false;
  const vorher = history.length;
  const ev = new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true });
  try { Object.defineProperty(ev, "keyCode", { get: () => 27 }); Object.defineProperty(ev, "which", { get: () => 27 }); } catch (e) { /* alt */ }
  document.dispatchEvent(ev);
  return history.length > vorher && !KIOSK_RE.test(location.search.slice(1));
};
// Seit 13.10.2026 (E-30) kein Kiosk mehr: die Seite „Jetzt“ zeigt wie alle Seiten die Tab-Leiste der Hauptbereiche
// (Grafana-Kopfleiste). H.kioskAn bleibt für einen Aufruf von Hand.

/* ── ⓘ: Erklärung als kleines Feld im Panel (Mac: auch als Tooltip über title; iPhone: Antippen) ── */
H.iZu = function () { const p = n.querySelector(".i-pop"); if (p) p.remove(); };
H.iZeigen = function (k) {
  const w = n.querySelector(".wurzel"), alt = n.querySelector(".i-pop");
  if (alt) { const gleich = alt._k === k; alt.remove(); if (gleich) return; }
  const p = document.createElement("div");
  p.className = "i-pop"; p.textContent = k.dataset.i || ""; p._k = k;
  w.appendChild(p);
  const wr = w.getBoundingClientRect(), kr = k.getBoundingClientRect();
  const breite = Math.min(320, wr.width - 16);
  p.style.width = breite + "px";
  p.style.left = Math.max(8, Math.min(wr.width - breite - 8, kr.left - wr.left - breite / 2)) + "px";
  const unten = kr.bottom - wr.top + 6;
  p.style.top = (unten + p.offsetHeight > wr.height - 4 ? Math.max(4, kr.top - wr.top - p.offsetHeight - 6) : unten) + "px";
};

/* ── Klicks: Gute Nacht, Links innerhalb Grafana ohne Neuladen (Zeitraum bleibt) ── */
if (!n._klicks) {
  n._klicks = true;
  n.addEventListener("click", ev => {
    const pfad = ev.composedPath ? ev.composedPath() : [];
    if (pfad.find(x => x && x.id === "gn")) { ev.preventDefault(); H.gnKlick(); return; }
    const ik = pfad.find(x => x && x.classList && x.classList.contains("i-knopf"));
    if (ik) { ev.preventDefault(); ev.stopPropagation(); H.iZeigen(ik); return; }
    if (pfad.find(x => x && x.classList && x.classList.contains("i-pop"))) { H.iZu(); ev.preventDefault(); return; }
    H.iZu();
    const a = pfad.find(x => x && x.tagName && x.tagName.toLowerCase() === "a");
    if (!a) return;
    const href = a.getAttribute("href") || a.getAttribute("xlink:href");
    if (!href || href === "#") { ev.preventDefault(); return; }
    if (href.startsWith("/") && !ev.metaKey && !ev.ctrlKey && !ev.shiftKey && ev.button === 0) {
      const ls = H.hg && H.hg.locationService;
      if (ls && ls.push) {
        ev.preventDefault();
        let neu = false;
        try { neu = H.kioskAus(); } catch (e) { /* egal */ }
        // Grafana legt beim Verlassen des Kiosk einen Verlaufseintrag an – den ersetzen, damit „Zurück“ direkt wieder
        // auf die Startseite (mit Kiosk) fuehrt
        if (neu && ls.replace) ls.replace(href); else ls.push(href);
      }
    }
  });
}

/* ── Zeichnen ────────────────────────────────────────────────────────── */
H.render = function (data, hg) {
  if (hg) H.hg = hg;
  const w = n.querySelector(".wurzel");
  if (!w) return;
  const teil = w.dataset.teil;
  if (n._ansicht == null) { try { n._ansicht = localStorage.getItem("haus-start-ansicht") || "temp"; } catch (e) { n._ansicht = "temp"; } }
  const D = H.daten(data);
  if (!D) {
    const fehler = data && (data.error || (data.errors && data.errors.length));
    if (fehler && !H.D) w.innerHTML = teil === "kopf"
      ? `<div class="fehler-karte"><span class="emo">${IC.netz}</span><span><b>${IC.stoerung} Keine Verbindung</b><br>neuer Versuch jede Minute</span></div>` : `<div class="laden" style="animation:none"></div>`;
    else if (!H.D) w.innerHTML = `<div class="laden"></div>`;
    if (!H.D) return;
  }
  H.D = D || H.D;
  try { (T[teil] || (() => {}))(w, H.D); } catch (e) {
    console.error("haus-start " + teil, e);
    w.innerHTML = `<div class="fehler-karte">Anzeige gerade nicht möglich (${esc(e.message)}).</div>`;
  }
};
