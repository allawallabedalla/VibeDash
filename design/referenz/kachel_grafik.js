// Aus der Haus-Vorlage: gemeinsame Hilfen + Kachel-Reihe mit Mini-Grafik (ring, skala, anteil, punkte, spark, vgl)

const root = htmlNode.querySelector(".hw");
const K = (typeof codeData !== "undefined" && codeData) || {};
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const werte = f => f.values.toArray ? f.values.toArray() : Array.from(f.values);
const T = htmlGraphics && htmlGraphics.theme2;
if (T) { root.style.setProperty("--t1", T.colors.text.primary); root.style.setProperty("--t2", T.colors.text.secondary);
  root.style.setProperty("--fl", T.colors.action ? T.colors.action.hover : T.colors.background.secondary);
  root.style.setProperty("--rand", T.colors.border.weak); root.style.setProperty("--link", T.colors.text.link);
  root.style.setProperty("--hg", T.colors.background.canvas || T.colors.background.primary); }
function zeilen() {
  const s = ((data && data.series) || [])[0];
  if (!s || !s.fields.length) return [];
  const sp = s.fields.map(x => [x.name, werte(x)]), n = sp[0][1].length, out = [];
  for (let i = 0; i < n; i++) { const o = {}; sp.forEach(([k, v]) => { o[k] = v[i]; }); out.push(o); }
  return out;
}
const ST = K.stufen || {};
const farbe = s => (ST[s] || [])[0] || "";
const icon = s => { const n = (ST[s] || [])[1]; return n && IC[n] ? IC[n] : ""; };
const zeitQ = () => { const q = new URLSearchParams(location.search), f = q.get("from"), t = q.get("to");
  return f && t ? "from=" + encodeURIComponent(f) + "&to=" + encodeURIComponent(t) : ""; };
const ziel = (u, r) => { let s = String(u).replace(/\{(\w+)\}/g, (m, k) => encodeURIComponent(r && r[k] != null ? r[k] : ""));
  s = s.split("${__url_time_range}").join(zeitQ());
  try { s = getTemplateSrv().replace(s); } catch (e) {}
  return s.replace("?&", "?").replace(/[?&]$/, ""); };
function klicks() {
  root.querySelectorAll("a[data-u]").forEach(a => { a.onclick = e => {
    const ls = htmlGraphics && htmlGraphics.locationService;
    if (ls && ls.push) { e.preventDefault(); ls.push(a.getAttribute("href")); } }; });
}


// ── Mini-Infografik je Kachel (13.10.2026): weich, rund, Farbe = Stufe der Kachel (sonst ruhiges Blau) ──
const zahl = t => { const m = String(t || "").replace(/\./g, "").match(/-?\d+(?:,\d+)?/g); return m ? m.map(x => Number(x.replace(",", "."))) : []; };
function grafik(g, r, f) {
  if (!g) return "";
  const c = f || "#5B8DEF", w = r.kachel_wert || "", z = zahl(w);
  const pz = (v, a, b) => Math.max(0, Math.min(100, 100 * (v - a) / (b - a)));
  if (g.art === "skala" && z.length) {
    const v = z[0], s = w.includes("±") && z.length > 1 ? z[1] : null;
    const zone = g.gut ? `<span class="gz" style="left:${pz(g.gut[0], g.min, g.max)}%;width:${pz(g.gut[1], g.min, g.max) - pz(g.gut[0], g.min, g.max)}%"></span>` : "";
    const band = s != null ? `<span class="gb" style="left:${pz(v - s, g.min, g.max)}%;width:${Math.max(1.5, pz(v + s, g.min, g.max) - pz(v - s, g.min, g.max))}%;background:${c}"></span>` : "";
    return `<div class="g gs" title="Skala ${g.min}–${g.max}${g.gut ? ", grün = üblich" : ""}">${zone}${band}<span class="gp" style="left:${pz(v, g.min, g.max)}%;border-color:${c}"></span></div>`;
  }
  if (g.art === "anteil" && /\d+\s*\/\s*\d+/.test(w)) {
    const [a, b] = w.match(/(\d+)\s*\/\s*(\d+)/).slice(1).map(Number);
    if (b <= 12) return `<div class="g gd">${Array.from({ length: b }, (_, i) => `<i style="${i < a ? `background:${c};border-color:${c}` : ""}"></i>`).join("")}</div>`;
    return `<div class="g gl"><span style="width:${100 * a / b}%;background:${c}"></span></div>`;
  }
  if (g.art === "ring" && z.length) {
    const v = Math.max(0, Math.min(100, z[0]));
    return `<div class="g gr" style="background:conic-gradient(${c} ${v * 3.6}deg, rgba(127,127,127,.18) 0)"></div>`;
  }
  if (g.art === "punkte") {
    const n = z.length ? Math.round(z[0]) : 0, m = Math.max(g.max || 10, n);
    return `<div class="g gd">${Array.from({ length: m }, (_, i) => `<i style="${i < n ? `background:${f || "#E8A317"};border-color:${f || "#E8A317"}` : ""}"></i>`).join("")}</div>`;
  }
  if (g.art === "spark" && r.verlauf) {
    // Infinity liefert die Liste teils schon als Array/Objekt statt als JSON-Text
    let v = r.verlauf;
    if (typeof v === "string") { try { v = JSON.parse(v); } catch (e) { return ""; } }
    if (v && !Array.isArray(v) && typeof v === "object") v = Object.values(v);
    if (!Array.isArray(v)) return "";
    v = v.map(Number);
    v = v.filter(x => x != null); if (v.length < 2) return "";
    const hi = Math.max(...v) || 1, B = 100, Hh = 28, x = i => B * i / (v.length - 1), y = q => Hh - 2 - (Hh - 6) * q / hi;
    const d = v.map((q, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(q).toFixed(1)}`).join("");
    return `<svg class="g gk" viewBox="0 0 ${B} ${Hh}" preserveAspectRatio="none"><path d="${d}L${B},${Hh}L0,${Hh}Z" fill="${c}" opacity=".15"/>` +
      `<path d="${d}" fill="none" stroke="${c}" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`;
  }
  if (g.art === "vgl" && z.length) {
    const m = String(r.kachel_kurz || "").match(/([▲▼])\s*(\d+)/), jetzt = z[0];
    const davor = m ? (m[1] === "▲" ? jetzt - Number(m[2]) : jetzt + Number(m[2])) : null;
    if (davor == null) return "";
    const hi = Math.max(jetzt, davor) || 1;
    return `<div class="g gv"><span style="width:${100 * jetzt / hi}%;background:${c}"></span><span class="dv" style="width:${100 * davor / hi}%"></span></div>`;
  }
  return "";
}
const L = K.kacheln || [], by = {};
zeilen().forEach(r => { by[r[K.feld]] = r; });
root.style.setProperty("--n", L.length || 1);
root.style.setProperty("--handy", K.handy || 2);
if ((K.handy || 2) <= 2) root.classList.add("h2");      // 2 je Reihe: Unterzeile einzeilig (passt in die Panelhöhe)
root.innerHTML = L.map(k => {
  const r = by[k.key] || {}, f = farbe(r.stufe_neu);
  const inner = `<div class="kn">${esc(k.titel)}</div><div class="kw"${f ? ` style="color:${f}"` : ""}>${esc(r.kachel_wert || "–")}</div>` +
    grafik(k.grafik, r, f) + `<div class="ku">${esc(r.kachel_kurz || "")}</div>`;
  return k.url ? `<a class="k" data-u="1" href="${esc(ziel(k.url, r))}" title="${esc(k.tip || "")}">${inner}</a>`
               : `<div class="k" title="${esc(k.tip || "")}">${inner}</div>`;
}).join("");
klicks();
