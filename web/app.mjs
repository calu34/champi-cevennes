/* Carte V1 — lit web/data.js (généré par le collecteur), aucun appel d'API. */
import { deriveSeries, scoreAt, colorFor, habitatFactor, DEFAULTS } from './model.mjs';

const D = window.CHAMPI;
const $ = id => document.getElementById(id);

if (!D) {
  $('status').textContent =
    "Pas de données : lance le collecteur (node collect/run.mjs) puis recharge.";
  throw new Error('window.CHAMPI absent');
}

/* --- préparer les séries + dériver T° sol / humidité une fois --- */
for (const c of D.cells) {
  c.s = { time: D.days, ...c.series };
  deriveSeries(c.s, DEFAULTS);
}
const kToday = Math.max(0, D.days.indexOf(new Date().toLocaleDateString('sv-SE')));
const STATE = { layer: 'combine', k: kToday, habitat: true };

/* --- carte --- */
const map = L.map('map').setView([44.2, 3.4], 8);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  { attribution: '&copy; OpenStreetMap', maxZoom: 18, opacity: 0.55 }).addTo(map);

Promise.all(['07', '12', '30', '34', '48', '81'].map(c =>
  fetch(`assets/data/dep-${c}.geojson`).then(r => r.json()).catch(() => null)
)).then(fs => {
  const feats = fs.filter(Boolean).map(f => ({ type: 'Feature', geometry: f.geometry }));
  L.geoJSON({ type: 'FeatureCollection', features: feats },
    { style: { color: '#444', weight: 1.2, fill: false } }).addTo(map);
});

const cellLayer = L.layerGroup().addTo(map);
const half = D.gridStep / 2;

function render() {
  cellLayer.clearLayers();
  const k = STATE.k;
  for (const c of D.cells) {
    const sc = scoreAt(c.s, k, DEFAULTS);
    let v = sc[STATE.layer];
    const hf = STATE.habitat ? habitatFactor(c.habitat, D.habitatOpts) : 1;
    v *= hf;
    const d = sc.detail;
    L.rectangle([[c.lat - half, c.lon - half], [c.lat + half, c.lon + half]], {
      stroke: false, fillColor: colorFor(v), fillOpacity: 0.4 + 0.35 * Math.abs(v - 50) / 50,
    }).bindPopup(
      `<b>${c.dep} — ${c.lat.toFixed(2)}, ${c.lon.toFixed(2)}</b> · ${c.elev} m` +
      `<br><b>Cèpe ${sc.cepe.toFixed(0)} · Girolle ${sc.girolle.toFixed(0)}</b>` +
      (STATE.habitat ? `<br>habitat ×${hf.toFixed(2)} → ${v.toFixed(0)}` : '') +
      `<hr style="margin:4px 0">` +
      `Pluie 7/15/21/30 j : ${d.P7.toFixed(0)}/${d.P15.toFixed(0)}/${d.P21.toFixed(0)}/${d.P30.toFixed(0)} mm` +
      `<br>Épisode 48 h (21 j) : ${d.Pevent.toFixed(0)} mm il y a ${d.Devent} j` +
      `<br>T° sol ≈ ${d.Tsol.toFixed(1)} °C (Δ10j ${d.dTsol >= 0 ? '+' : ''}${d.dTsol.toFixed(1)})` +
      `<br>Humidité sol ${(d.SM * 100).toFixed(0)} % · série sèche ${d.dry} j`
    ).addTo(cellLayer);
  }
  const t = D.days[k];
  $('dateLbl').textContent = `${t}${t > new Date().toLocaleDateString('sv-SE') ? ' (prévision)' : ''}`;
}

/* --- UI --- */
const sl = $('dateSlider');
sl.min = 20; sl.max = D.days.length - 1; sl.value = STATE.k;
sl.addEventListener('input', e => { STATE.k = +e.target.value; render(); });
document.querySelectorAll('input[name=layer]').forEach(el =>
  el.addEventListener('change', e => { STATE.layer = e.target.value; render(); }));
$('habitat').addEventListener('change', e => { STATE.habitat = e.target.checked; render(); });

$('status').textContent =
  `${D.cells.length} mailles · source ${D.source} · généré ${new Date(D.generated).toLocaleString('fr-FR')}`;
render();
