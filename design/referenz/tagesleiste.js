// Tagesleiste wie Apple Wetter (Tief–Hoch-Balken mit Temperaturfarbe, Regen, Sonne, kWh)

const n = htmlNode, s = data.series && data.series[0], el = n.getElementById('liste');
if (!s || !s.fields || !s.fields.length) { el.textContent = '❓ keine Daten'; return; }
const f = nm => { const x = s.fields.find(q => q.name === nm || (q.config && q.config.displayName === nm));
  return x ? Array.from(x.values.toArray ? x.values.toArray() : x.values) : []; };
const tag = f('tag'), art = f('art'), lo = f('tmin'), hi = f('tmax'), qu = f('quelle'), so = f('sonne_h'), re = f('regen_mm'),
      kwh = f('kwh'), kart = f('kwh_art'), ksd = f('kwh_sd'), sym = f('symbol');
const de = (x, nd) => (x === null || x === undefined || isNaN(x)) ? '–' :
  (Number(x).toLocaleString('de-DE', { minimumFractionDigits: nd, maximumFractionDigits: nd }).replace(/^-(0(,0*)?)$/, '$1'));
const ok = v => v !== null && v !== undefined && !isNaN(v);
const alle = lo.concat(hi).filter(ok);
if (!alle.length) { el.textContent = '❓ keine Daten'; return; }
let a = Math.floor(Math.min(...alle) - 1), b = Math.ceil(Math.max(...alle) + 1);
// Farbe nach Temperatur (Apple-Wetter-Stil): kalt blau -> grün -> gelb -> orange -> rot
const STOPS = [[-5, '#2a78d6'], [3, '#5fb3e8'], [10, '#5cc28a'], [16, '#e9c43b'], [22, '#f08a2c'], [28, '#d03b3b']];
const farbe = t => { let c = STOPS[0][1]; for (const [g, col] of STOPS) { if (t >= g) c = col; } return c; };
const pos = t => 100 * (t - a) / (b - a);
const esc = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let h = `<div class="z kopf"><span>Tag</span><span></span><span>🌧</span><span class="t">Tief</span><span></span>` +
        `<span class="t">Hoch</span><span class="so">☀️</span><span class="kwh">⚡ kWh</span></div>`;
let vorher = null;
for (let i = 0; i < tag.length; i++) {
  if (art[i] === 'heute' && vorher === 'vergangen') h += '<div class="trenner">Heute und Vorhersage</div>';
  if (i === 0 && art[i] === 'vergangen') h += '<div class="trenner">Vergangen · Hof gemessen (≈ Lücke, Wettermodell)</div>';
  vorher = art[i];
  const t1 = ok(lo[i]) ? lo[i] : null, t2 = ok(hi[i]) ? hi[i] : null;
  let bahn = '';
  if (t1 !== null && t2 !== null) {
    bahn = `<span class="bal" style="left:${pos(t1)}%;width:${Math.max(2, pos(t2) - pos(t1))}%;` +
           `background:linear-gradient(90deg, ${farbe(t1)}, ${farbe(t2)})"></span>`;
    if (a < 0 && b > 0 && t1 < 3) bahn += `<span class="null" style="left:${pos(0)}%" title="0 °C"></span>`;
  }
  const regen = ok(re[i]) && re[i] >= 0.5 ? de(re[i], re[i] < 10 ? 1 : 0) : '';
  const ist = kart[i] === 'Ist';
  const kw = ok(kwh[i]) ? (ist ? '' : '≈ ') + de(kwh[i], 0) : '–';
  const kwt = ok(kwh[i]) ? (ist ? 'Sonnenstrom gemessen (Zähler)' : 'Prognose' + (ok(ksd[i]) ? ' ± ' + de(ksd[i], 0) + ' kWh (1σ)' : '')) : 'keine Prognose';
  const tg = tag[i].split(' ');
  const tgh = tg.length > 1 ? `${esc(tg[0])} <span class="dat">${esc(tg[1])}</span>` : esc(tag[i]);
  const quelle = qu[i] === 'Hof' ? 'Hof gemessen' : (qu[i] === 'Modell' ? 'Wettermodell' : 'keine Daten');
  // BL-186: vergangener Tag mit Fühlerlücke (< 12 h Werte) -> Wettermodell, sichtbar markiert statt „gemessen“
  const mod = art[i] === 'vergangen' && qu[i] !== 'Hof';
  const ca = mod ? '≈' : '';
  h += `<div class="z ${esc(art[i])}${mod ? ' mod' : ''}" title="${esc(tag[i])}: ${mod ? 'Hof-Fühler mit Lücke – Temperatur laut ' : ''}${quelle}">` +
       `<span class="tg">${tgh}${mod ? '<span class="q">Modell</span>' : ''}</span><span class="sym${SONNE.includes(String(sym[i] || '').trim()) && sym[i] ? ' voll' : ''}">${esc(sym[i] || '')}</span><span class="re">${regen ? '🌧 ' + regen : ''}</span>` +
       `<span class="t lo${t1 !== null && t1 < 0 ? ' frost' : ''}">${t1 !== null ? ca + (t1 < 0 ? '❄️' : '') + de(t1, 0) + '°' : '–'}</span>` +
       `<span class="bahn">${bahn}</span><span class="t">${t2 !== null ? ca + de(t2, 0) + '°' : '–'}</span>` +
       `<span class="so">${ok(so[i]) ? de(so[i], 0) + ' h' : '–'}</span><span class="kwh" title="${kwt}">${kw}</span></div>`;
}
el.innerHTML = h;
