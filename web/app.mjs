/* Carte V1 — lit web/data.js (généré par le collecteur), aucun appel d'API. */
import { deriveSeries, scoreAt, colorFor, habitatFactor, clamp, DEFAULTS } from './model.mjs';

const D = window.CHAMPI;
const $ = id => document.getElementById(id);

if (!D) {
  $('status').textContent =
    "Pas de données : lance le collecteur (node collect/run.mjs) puis recharge.";
  throw new Error('window.CHAMPI absent');
}

for (const c of D.cells) {
  c.s = { time: D.days, ...c.series };
  deriveSeries(c.s, DEFAULTS);
}
const today = () => new Date().toLocaleDateString('sv-SE');
const kToday = Math.max(0, D.days.indexOf(today()));
const STATE = { layer: 'combine', k: kToday, habitat: true, forets: true };

/* --- grille : retrouver la maille d'un point --- */
const half = D.gridStep / 2;
function cellAt(lat, lon) {
  let best = null, bd = Infinity;
  for (const c of D.cells) {
    if (Math.abs(c.lat - lat) <= half && Math.abs(c.lon - lon) <= half) return c;
    const d = (c.lat - lat) ** 2 + (c.lon - lon) ** 2;
    if (d < bd) { bd = d; best = c; }
  }
  return bd < (2 * D.gridStep) ** 2 ? best : null;
}
function cellScore(c, k) {
  const sc = scoreAt(c.s, k, DEFAULTS);
  const hf = STATE.habitat ? habitatFactor(c.habitat, D.habitatOpts) : 1;
  return { ...sc, hf, shown: sc[STATE.layer] * hf };
}

/* --- carte --- */
const map = L.map('map').setView([44.1, 3.5], 8);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  { attribution: '&copy; OpenStreetMap', maxZoom: 18, opacity: 0.5 }).addTo(map);
addEventListener('resize', () => map.invalidateSize());
setTimeout(() => map.invalidateSize(), 200);

Promise.all(['07', '12', '30', '34', '48', '81'].map(c =>
  fetch(`assets/data/dep-${c}.geojson`).then(r => r.json()).catch(() => null)
)).then(fs => {
  L.geoJSON({ type: 'FeatureCollection', features: fs.filter(Boolean).map(f => ({ type: 'Feature', geometry: f.geometry })) },
    { style: { color: '#444', weight: 1.2, fill: false } }).addTo(map);
});

const gridLayer = L.layerGroup().addTo(map);
let foretLayer = null;

fetch('assets/data/forets-domaniales.geojson').then(r => r.ok ? r.json() : null).then(fc => {
  if (!fc) { $('foretsRow').style.display = 'none'; return; }
  for (const f of fc.features) {
    const b = L.geoJSON(f).getBounds();
    f._cell = cellAt(b.getCenter().lat, b.getCenter().lng);
  }
  foretLayer = L.geoJSON(fc, {
    style: { color: '#1b5e20', weight: 1, fillOpacity: 0.75 },
    onEachFeature: (f, lyr) => lyr.bindPopup(`<b>${f.properties.nom}</b> (${f.properties.dep})`),
  });
  render();
});

function render() {
  const k = STATE.k;

  gridLayer.clearLayers();
  const foretsOn = STATE.forets && foretLayer;
  const gridOp = foretsOn ? 0.18 : 1;
  for (const c of D.cells) {
    const s = cellScore(c, k), d = s.detail;
    L.rectangle([[c.lat - half, c.lon - half], [c.lat + half, c.lon + half]], {
      stroke: false, interactive: !foretsOn, fillColor: colorFor(s.shown),
      fillOpacity: (0.4 + 0.35 * Math.abs(s.shown - 50) / 50) * gridOp,
    }).bindPopup(
      `<b>${c.dep} — ${c.lat.toFixed(2)}, ${c.lon.toFixed(2)}</b> · ${c.elev} m` +
      `<br><b>Cèpe ${s.cepe.toFixed(0)} · Girolle ${s.girolle.toFixed(0)}</b>` +
      (STATE.habitat ? `<br>habitat ×${s.hf.toFixed(2)} → ${s.shown.toFixed(0)}` : '') +
      `<hr style="margin:4px 0">` +
      `Pluie 7/15/21/30 j : ${d.P7.toFixed(0)}/${d.P15.toFixed(0)}/${d.P21.toFixed(0)}/${d.P30.toFixed(0)} mm` +
      `<br>Épisode 48 h (21 j) : ${d.Pevent.toFixed(0)} mm il y a ${d.Devent} j` +
      `<br>T° sol ≈ ${d.Tsol.toFixed(1)} °C (Δ10j ${d.dTsol >= 0 ? '+' : ''}${d.dTsol.toFixed(1)})` +
      `<br>Humidité sol ${(d.SM * 100).toFixed(0)} % · série sèche ${d.dry} j`
    ).addTo(gridLayer);
  }

  if (foretLayer) {
    if (STATE.forets) foretLayer.addTo(map); else map.removeLayer(foretLayer);
    const ESS = { feuillu: 'feuillus (chêne/châtaignier/hêtre)', conifere: 'conifères (pins, sapin…)', mixte: 'mixte', autre: 'lande / forêt ouverte' };
    const SUB = { acide: 'acide (schiste, granite…)', neutre: 'neutre', calcaire: 'calcaire (causse)' };
    const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
    foretLayer.eachLayer(lyr => {
      const p = lyr.feature.properties, c = lyr.feature._cell;
      const sc = c ? cellScore(c, k) : null;
      let hf = STATE.habitat
        ? habitatFactor({ essence: p.essence, substrat: p.substrat, elev: p.elev, slopeDeg: p.slopeDeg },
          { useForet: true, useSubstrat: true, useMnt: true }) : 1;
      // exposition : en période sèche l'ubac (versant Nord) garde l'humidité
      let af = 1;
      if (STATE.habitat && p.aspect != null && sc) {
        const ubac = Math.cos(p.aspect * Math.PI / 180);          // +1 Nord … -1 Sud
        const dryness = clamp((sc.detail.dry - 8) / 15, 0, 1);
        af = 1 + 0.18 * ubac * dryness;
        hf *= af;
      }
      const v = sc ? sc[STATE.layer] * hf : 0;
      lyr.setStyle({ fillColor: colorFor(v), fillOpacity: 0.82 });
      lyr.setPopupContent(`<b>${p.nom}</b> (${p.dep})` +
        `<br>${p.elev} m · pente ${p.slopeDeg ?? '?'}° · expo ${p.aspect != null ? DIRS[Math.round(p.aspect / 45) % 8] : '?'}` +
        `<br>peuplement : ${ESS[p.essence] || '—'} · substrat : ${SUB[p.substrat] || '—'}` +
        (sc ? `<br><b>Cèpe ${(sc.cepe * hf).toFixed(0)} · Girolle ${(sc.girolle * hf).toFixed(0)}</b>` +
          (hf !== 1 ? ` (habitat ×${hf.toFixed(2)}${af !== 1 ? `, expo ×${af.toFixed(2)}` : ''})` : '') : '<br>hors grille météo'));
    });
  }

  const t = D.days[k];
  $('dateLbl').textContent = `${t}${t > today() ? ' (prévision)' : ''}`;
}

/* --- UI --- */
const sl = $('dateSlider');
sl.min = 20; sl.max = D.days.length - 1; sl.value = STATE.k;
sl.addEventListener('input', e => { STATE.k = +e.target.value; render(); });
document.querySelectorAll('input[name=layer]').forEach(el =>
  el.addEventListener('change', e => { STATE.layer = e.target.value; render(); }));
$('habitat').addEventListener('change', e => { STATE.habitat = e.target.checked; render(); });
$('forets').addEventListener('change', e => { STATE.forets = e.target.checked; render(); });

const help = $('help');
$('helpBtn').addEventListener('click', () => help.hidden = false);
$('helpClose').addEventListener('click', () => help.hidden = true);
help.addEventListener('click', e => { if (e.target === help) help.hidden = true; });
addEventListener('keydown', e => { if (e.key === 'Escape') help.hidden = true; });

$('status').textContent =
  `${D.cells.length} mailles · source ${D.source} · généré ${new Date(D.generated).toLocaleString('fr-FR')}`;
render();
