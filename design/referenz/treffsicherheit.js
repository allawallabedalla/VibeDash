// Treffsicherheit (seite-treffsicherheit): Infografik über der Tabelle (Nutzer 13.10.2026: „datentabellen immer mit
// infografiken“, „eine progressbar und eine Sparkline mit dem historischen verlauf des progress, um zu sehen, ob sich das
// modell entwickelt“). IC = {bedeutung: zeichen} setzt der Generator davor.
// Daten: /ml/treffer/grafik = EINE Zeile {json: [Programm, …]}; je Programm korrekt_pct (0–100 %, dieselbe Regel wie die
// Stufe, das schlechtere von zwei Maßen zählt), korrekt_text (Rechnung), korrekt_verlauf [{tag, pct, nachgerechnet}]
// (gespeicherte Tagesstände ml_korrekt; davor aus den Tageswerten nachgerechnet).
//   Oben: Ampelleiste (Anzahl gut / mäßig / schlecht / offen).
//   Je Programm eine Kachel: Stufe · Name · große Zahl + Fortschrittsbalken · Sparkline des Fortschritts mit Trend.
const w = htmlNode.querySelector(".tg");
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const de = (x, nd = 0) => x == null || isNaN(x) ? "–" : Number(x).toLocaleString("de-DE", { minimumFractionDigits: nd, maximumFractionDigits: nd });
const werte = f => f.values.toArray ? f.values.toArray() : Array.from(f.values);
const T = htmlGraphics && htmlGraphics.theme2;
if (T) { w.style.setProperty("--t1", T.colors.text.primary); w.style.setProperty("--t2", T.colors.text.secondary);
  w.style.setProperty("--fl", T.colors.background.secondary); w.style.setProperty("--rand", T.colors.border.medium); }
const ST = {
  gut: { f: "#2E9E5B", wort: "gut", ic: IC.ok },
  maessig: { f: "#E8A317", wort: "mäßig", ic: IC.pruefen },
  schlecht: { f: "#D64545", wort: "schlecht", ic: IC.stoerung },
  offen: { f: "#8E8E93", wort: "offen", ic: IC.lernt },
};
const stufe = p => ST[p.stufe] ? p.stufe : "offen";
const datum = t => t ? `${t.slice(8, 10)}.${t.slice(5, 7)}.` : "";

function daten() {
  const s = ((data && data.series) || [])[0];
  const f = s && s.fields.find(x => x.name === "json");
  if (!f) return null;
  try { return JSON.parse(werte(f)[0]); } catch (e) { return null; }
}

// Trend: letzter Wert gegen den Wert 14 Tage davor (bzw. den ältesten); unter 3 Punkten Unterschied „≈ gleich“
function trend(v) {
  if (v.length < 2) return { text: "ab heute gespeichert", cls: "" };
  const letzt = v[v.length - 1], ziel = new Date(letzt.tag); ziel.setDate(ziel.getDate() - 14);
  const iso = ziel.toISOString().slice(0, 10);
  const alt = v.find(x => x.tag >= iso) || v[0];
  const d = letzt.pct - alt.pct;
  if (Math.abs(d) < 3) return { text: "≈ gleich", cls: "" };
  return d > 0 ? { text: `${IC.hoch || "▲"} ${de(d)} Pkt. besser`, cls: "auf" }
               : { text: `${IC.runter || "▼"} ${de(-d)} Pkt. schlechter`, cls: "ab" };
}

// Sparkline (0–100 %) als Fläche: nachgerechnete Tage hell, gespeicherte kräftig; links „100 %“/„0“, darunter Zeitraum + Trend
function sparkline(v, farbe, tr) {
  // Audit 13.10.2026: unter 2 Tagesständen keine leeren Achsen, nur der Hinweis
  if (v.length < 2) return `<div class="ohne">Verlauf ab ${v.length ? datum(v[0].tag) : "heute"}</div>`;
  const B = 240, H = 40, n = v.length;
  const x = i => n === 1 ? B : B * i / (n - 1);
  const y = p => H - H * Math.max(0, Math.min(100, p)) / 100;
  const flaeche = (von, bis) => {
    const t = v.slice(von, bis);
    if (t.length < 2) return "";
    return `M${x(von).toFixed(1)},${H}` + t.map((z, i) => `L${x(von + i).toFixed(1)},${y(z.pct).toFixed(1)}`).join("") + `L${x(bis - 1).toFixed(1)},${H}Z`;
  };
  const linie = (von, bis) => v.slice(von, bis).map((z, i) => `${i ? "L" : "M"}${x(von + i).toFixed(1)},${y(z.pct).toFixed(1)}`).join("");
  const k = v.findIndex(z => !z.nachgerechnet), e = k === -1 ? n : k;   // 0..e-1 nachgerechnet, e.. gespeichert
  let s = "";
  if (e > 1) s += `<path d="${flaeche(0, Math.min(n, e + 1))}" fill="${farbe}" opacity=".12"/><path d="${linie(0, Math.min(n, e + 1))}" class="nach" stroke="${farbe}"/>`;
  if (n - e > 1) s += `<path d="${flaeche(e, n)}" fill="${farbe}" opacity=".3"/><path d="${linie(e, n)}" class="live" stroke="${farbe}"/>`;
  const tip = v.map(z => `${datum(z.tag)} ${de(z.pct)} %${z.nachgerechnet ? " (nachgerechnet)" : ""}`).join("\n");
  return `<div class="sp"><div class="achse"><span>100 %</span><span>0</span></div>
      <svg viewBox="0 0 ${B} ${H}" preserveAspectRatio="none" class="spark"><title>${esc(tip)}</title>${s}</svg></div>
    <div class="sp-fuss"><span>Verlauf ${datum(v[0].tag)}${n > 1 ? "–" + datum(v[n - 1].tag) : ""}</span><span class="trend ${tr.cls}">${tr.text}</span></div>`;
}

function zeichnen() {
  const L = daten();
  if (!L) { w.innerHTML = `<div class="leer">${IC.unbekannt} Keine Daten von /ml/treffer</div>`; return; }
  const z = { gut: 0, maessig: 0, schlecht: 0, offen: 0 };
  L.forEach(p => z[stufe(p)]++);
  const leiste = ["gut", "maessig", "schlecht", "offen"].filter(k => z[k]).map(k =>
    `<span style="flex:${z[k]};background:${ST[k].f}" title="${z[k]} ${ST[k].wort}"></span>`).join("");
  const zahlen = ["gut", "maessig", "schlecht", "offen"].map(k =>
    `<div class="zahl"><b style="color:${ST[k].f}"><i>${ST[k].ic}</i>${z[k]}</b><small>${ST[k].wort}</small></div>`).join("");
  const kacheln = L.map(p => {
    const k = stufe(p), f = ST[k].f, v = p.korrekt_verlauf || [];
    const pctOk = p.korrekt_pct != null && p.zeige_pct !== false;   // n < 10 / offen: keine große Prozentzahl
    const tr = trend(v);
    const kz = String(p.kennzahl_kurz || p.kennzahl_n || "").split("\n")[0];
    const vorl = "";
    return `<a class="kachel ${k}" ${p.ziel_url ? `href="${esc(p.ziel_url)}"` : ""} title="${esc((p.korrekt_text ? "korrekt: " + p.korrekt_text + "\n\n" : "") + (p.info_text || "").slice(0, 500))}">
      <div class="kk"><span class="chip" style="color:${f}"><i>${ST[k].ic}</i>${ST[k].wort}</span><span class="n">${p.n != null && pctOk ? "n = " + esc(p.n) : ""}</span></div>
      <div class="name">${esc(p.name)}</div><div class="frage">${esc(p.frage || "")}</div>
      ${pctOk ? `<div class="pz"><b>${de(p.korrekt_pct)}<small> %</small></b><span>korrekt${vorl}</span></div>
      <div class="balken"><span style="width:${Math.max(1, Math.min(100, p.korrekt_pct))}%;background:${f}"></span></div>`
              : `<div class="pz leer2"><span class="haupt">${esc(p.haupt || "offen")}</span></div>`}
      ${pctOk ? sparkline(v, f, tr) : `<div class="ohne leer3"></div>`}
      <div class="kz">${esc(kz)}</div></a>`;
  }).join("");
  w.innerHTML = `<div class="kopf"><div class="zahlen">${zahlen}</div><div class="leiste">${leiste}</div>
    <div class="hinweis">${L.length} lernende Programme</div></div>
    <div class="raster">${kacheln}</div>`;
  // Nur die Reihen mit bewerteten Programmen (Balken + Verlauf) wachsen in die Panelhöhe; „offen“-Reihen bleiben so hoch
  // wie ihr Inhalt (sonst große leere Kacheln am Mac, Audit 13.10.2026)
  const r = w.querySelector(".raster"), spalten = getComputedStyle(r).gridTemplateColumns.split(" ").filter(Boolean).length || 4;
  const bewertet = L.filter(p => p.korrekt_pct != null && p.zeige_pct !== false).length;
  if (bewertet) r.style.gridTemplateRows = `repeat(${Math.ceil(bewertet / spalten)}, minmax(min-content, 1fr))`;
}

try { zeichnen(); } catch (e) { w.innerHTML = `<div class="leer">Anzeige gerade nicht möglich (${esc(e.message)})</div>`; }
