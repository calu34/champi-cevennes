/* Carte — lit web/data.js (généré par le collecteur), aucun appel d'API.
 * Multi-espèces : voir model/species/. */
import {
  deriveSeries, scoreSpecies, habitatFactor, expositionFactor, colorFor,
  SPECIES, SPECIES_LIST, enSaison,
} from './model/model.mjs';
import { initPoints } from './points.mjs';

const D = window.CHAMPI;
const $ = id => document.getElementById(id);
if (!D) { $('status').textContent = "Pas de données : lance node collect/run.mjs puis recharge."; throw new Error('window.CHAMPI absent'); }

for (const c of D.cells) { c.s = { time: D.days, ...c.series }; deriveSeries(c.s); }

const DEPS = D.departements || ['07', '12', '30', '34', '48', '81'];
const HAB = D.habitatOpts || { essence: true, substrat: true, mnt: true };
const today = () => new Date().toLocaleDateString('sv-SE');
const kToday = Math.max(0, D.days.indexOf(today()));
const STATE = { species: 'auto', k: kToday, habitat: true, forets: true, brulis: true, domOnly: true };
const monthAt = k => +D.days[k].slice(5, 7);

/* espèce effective : 'auto' → meilleure espèce en saison au jour affiché */
function speciesFor(k) {
  if (STATE.species !== 'auto') return STATE.species;
  const m = monthAt(k);
  const inSeason = SPECIES_LIST.filter(sp => sp.saison.includes(m));
  return (inSeason.length ? inSeason : SPECIES_LIST).map(s => s.id);
}
function bestScore(ids, s, k) {
  let best = { value: 0, id: null, r: null };
  for (const id of [].concat(ids)) {
    const r = scoreSpecies(id, s, k);
    if ((r.value ?? 0) >= best.value) best = { value: r.value ?? 0, id, r };
  }
  return best;
}

/* --- grille --- */
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
/* score affiché d'une maille (météo × altitude) */
function cellShown(c, k) {
  const b = bestScore(speciesFor(k), c.s, k);
  const hf = STATE.habitat && b.id ? habitatFactor(b.id, { elev: c.elev }, { mnt: true }) : 1;
  return { ...b, hf, v: b.value * hf };
}

/* --- carte --- */
const map = L.map('map').setView([44.1, 3.5], 8);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  { attribution: '&copy; OpenStreetMap', maxZoom: 18, opacity: 0.5 }).addTo(map);
addEventListener('resize', () => map.invalidateSize());
setTimeout(() => map.invalidateSize(), 200);

Promise.all(DEPS.map(c => fetch(`assets/data/dep-${c}.geojson`).then(r => r.json()).catch(() => null)))
  .then(fs => L.geoJSON(
    { type: 'FeatureCollection', features: fs.filter(Boolean).map(f => ({ type: 'Feature', geometry: f.geometry })) },
    { style: { color: '#444', weight: 1.2, fill: false } }).addTo(map));

const gridLayer = L.layerGroup().addTo(map);
let foretLayer = null;

fetch('assets/data/forets-publiques.geojson').then(r => r.ok ? r.json() : null).then(fc => {
  if (!fc) { $('foretsRow').style.display = 'none'; return; }
  for (const f of fc.features) {
    const b = L.geoJSON(f).getBounds();
    f._c = b.getCenter();
    f._cell = cellAt(b.getCenter().lat, b.getCenter().lng);
  }
  foretLayer = L.geoJSON(fc, { style: { color: '#1b5e20', weight: 1, fillOpacity: 0.8 } });
  loadBrulis();
  render();
});

/* --- brûlis (morilles) : bonus si une forêt recoupe un incendie récent --- */
let brulisLayer = null, brulisPolys = [];
const pir = (pt, ring) => {
  let ins = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi)) ins = !ins;
  }
  return ins;
};
const inGeom = (pt, g) => g.type === 'Polygon' ? g.coordinates.some((r, i) => i === 0 ? pir(pt, r) : false)
  : g.type === 'MultiPolygon' ? g.coordinates.some(p => pir(pt, p[0])) : false;
function loadBrulis() {
  fetch('assets/data/brulis.geojson').then(r => r.ok ? r.json() : null).then(fc => {
    if (!fc || !fc.features.length) { $('brulisRow').style.display = 'none'; return; }
    const yr = new Date().getFullYear();
    brulisPolys = fc.features.filter(f => (f.properties?.annee ?? yr) >= yr - 2);
    brulisLayer = L.geoJSON(fc, { style: { color: '#b71c1c', weight: 1, fillColor: '#ff7043', fillOpacity: 0.4, dashArray: '3' } });
    render();
  });
}
const brulisBonus = f => (f._c && brulisPolys.some(b => inGeom([f._c.lng, f._c.lat], b.geometry))) ? 2.2 : 1;

/* --- rendu --- */
const ESS = { feuillu: 'feuillus (chêne/châtaignier/hêtre)', conifere: 'conifères', mixte: 'mixte', autre: 'lande / ouvert' };
const SUB = { acide: 'acide', neutre: 'neutre', calcaire: 'calcaire (causse)' };
const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
const LBL = {
  P7: 'pluie 7 j', P15: 'pluie 15 j', P21: 'pluie 21 j', P30: 'pluie 30 j',
  Pevent: 'épisode 48 h', Devent: 'il y a (j)', Tsol: 'T° sol', dTsol: 'Δ T° sol 10 j',
  SM: 'humidité sol', ET7: 'ET0 7 j', Tmin7: 'T° min 7 j', dry: 'série sèche (j)',
  Psummer: 'pluie été (mm)', nOrages: 'orages été', nEvents: 'orages été', trouSec: 'trou sec (j)',
  joursChauds: 'jours > 33 °C', couverture: 'couverture (j)',
  rechauffement: 'réchauffement 14 j (°C)', amplitude: 'amplitude j/nuit (°C)',
};
const fmtDetail = d => Object.entries(d).filter(([k]) => LBL[k])
  .map(([k, v]) => `${LBL[k]} : ${typeof v === 'number' ? (Math.abs(v) < 2 && k === 'SM' ? (v * 100).toFixed(0) + ' %' : v.toFixed(v % 1 ? 1 : 0)) : v}`)
  .join(' · ');

function render() {
  const k = STATE.k, m = monthAt(k), ids = speciesFor(k);
  const spLabel = STATE.species === 'auto'
    ? 'meilleur du moment' + (SPECIES_LIST.some(s => s.saison.includes(m)) ? '' : ' (hors saison)')
    : SPECIES[STATE.species].nom + (enSaison(STATE.species, m) ? '' : ' — hors saison');

  gridLayer.clearLayers();
  const foretsOn = STATE.forets && foretLayer;
  const gridOp = foretsOn ? 0.16 : 1;
  for (const c of D.cells) {
    const r = cellShown(c, k);
    L.rectangle([[c.lat - half, c.lon - half], [c.lat + half, c.lon + half]], {
      stroke: false, interactive: !foretsOn, fillColor: colorFor(r.v),
      fillOpacity: (0.4 + 0.35 * Math.abs(r.v - 50) / 50) * gridOp,
    }).bindPopup(
      `<b>${c.dep} — ${c.lat.toFixed(2)}, ${c.lon.toFixed(2)}</b> · ${c.elev} m` +
      `<br><b>${r.id ? SPECIES[r.id].nom : '—'} : ${r.v.toFixed(0)}</b>` +
      (r.hf !== 1 ? ` (altitude ×${r.hf.toFixed(2)})` : '') +
      (r.r?.detail ? `<hr style="margin:4px 0">${fmtDetail(r.r.detail)}` : '')
    ).addTo(gridLayer);
  }

  if (brulisLayer) {
    const on = STATE.brulis && (STATE.species === 'morille' || (STATE.species === 'auto' && monthAt(k) <= 6));
    if (on) brulisLayer.addTo(map); else map.removeLayer(brulisLayer);
  }

  if (foretLayer) {
    if (STATE.forets) foretLayer.addTo(map); else map.removeLayer(foretLayer);
    foretLayer.eachLayer(lyr => {
      const p = lyr.feature.properties, c = lyr.feature._cell;
      if (STATE.domOnly && !p.dom) { lyr.setStyle({ fillOpacity: 0, opacity: 0 }); lyr.closePopup?.(); return; }
      lyr.setStyle({ opacity: 1 });
      const b = c ? bestScore(ids, c.s, k) : null;
      let hf = 1, af = 1, bru = 1;
      if (STATE.habitat && b?.id) {
        hf = habitatFactor(b.id, p, HAB);
        af = expositionFactor(b.id, p.aspect, b.r?.detail?.dry);
        hf *= af;
        if (b.id === 'morille' && STATE.brulis) { bru = brulisBonus(lyr.feature); hf *= bru; }
      }
      const v = b ? b.value * hf : 0;
      lyr.setStyle({ fillColor: colorFor(v), fillOpacity: 0.82 });
      lyr.setPopupContent(
        `<b>${p.nom}</b> (${p.dep}${p.dom ? ', domaniale' : ', communale'})` +
        `<br>${p.elev ?? '?'} m · pente ${p.slopeDeg ?? '?'}° · expo ${p.aspect != null ? DIRS[Math.round(p.aspect / 45) % 8] : '?'}` +
        `<br>${ESS[p.essence] || '—'} · substrat ${SUB[p.substrat] || '—'}` +
        (b ? `<br><b>${b.id ? SPECIES[b.id].nom : '—'} : ${v.toFixed(0)}</b>` +
          (hf !== 1 ? ` (habitat ×${hf.toFixed(2)}${af !== 1 ? `, expo ×${af.toFixed(2)}` : ''}${bru !== 1 ? ', brûlis ×2.2' : ''})` : '')
          : '<br>hors grille météo'));
    });
  }

  const t = D.days[k];
  $('dateLbl').textContent = `${t}${t > today() ? ' (prév.)' : ''} — ${spLabel}`;
}

/* --- UI --- */
const sel = $('species');
sel.innerHTML = `<option value="auto">Auto (meilleur du moment)</option>` +
  SPECIES_LIST.map(s => `<option value="${s.id}">${s.nom}</option>`).join('');
sel.value = STATE.species;
sel.addEventListener('change', e => { STATE.species = e.target.value; buildHelp(); render(); });

const sl = $('dateSlider');
sl.min = 20; sl.max = D.days.length - 1; sl.value = STATE.k;
sl.addEventListener('input', e => { STATE.k = +e.target.value; render(); });
$('habitat').addEventListener('change', e => { STATE.habitat = e.target.checked; render(); });
$('forets').addEventListener('change', e => { STATE.forets = e.target.checked; render(); });
$('domOnly').addEventListener('change', e => { STATE.domOnly = e.target.checked; render(); });
$('brulis').addEventListener('change', e => { STATE.brulis = e.target.checked; render(); });

const help = $('help');
function buildHelp() {
  const list = STATE.species === 'auto' ? SPECIES_LIST : [SPECIES[STATE.species]];
  $('helpBody').innerHTML = list.map(sp =>
    `<h3>${sp.nom} <span class="sub">— ${sp.groupe} · saison ${sp.saison.join('·')}</span></h3>` +
    `<ul>${sp.criteres.map(([n, t]) => `<li><b>${n}</b> : ${t}</li>`).join('')}</ul>`
  ).join('') +
    `<h3>Filtre habitat <span class="sub">(couche forêts)</span></h3>` +
    `<p class="sub">essence × substrat × altitude/pente × exposition (ubac +18 % en période sèche). ` +
    `Facteurs propres à chaque espèce — voir <code>model/species/</code>.</p>` +
    `<p class="sub">Pluie : lame d'eau radar Météo-France 1 km (+ proxy Open-Meteo ~9 km pour les jours incomplets). ` +
    `Modèle v1, seuils à caler sur observations réelles (GBIF / iNaturalist).</p>` +
    `<h3>Mes points <span class="sub">(coins perso)</span></h3>` +
    `<p class="sub">Boutons en bas à droite : 📍 marquer ma position GPS · 📌 poser un point en touchant la carte · ` +
    `🖼️ importer une photo géolocalisée (choisir depuis la galerie — les photos prises dans l'app perdent souvent le GPS) · ` +
    `⇅ exporter / importer un fichier <code>.geojson</code>. Les points restent sur ton téléphone (aucun envoi).</p>`;
}
$('helpBtn').addEventListener('click', () => { buildHelp(); help.hidden = false; });
$('helpClose').addEventListener('click', () => help.hidden = true);
help.addEventListener('click', e => { if (e.target === help) help.hidden = true; });
addEventListener('keydown', e => { if (e.key === 'Escape') help.hidden = true; });

$('status').textContent = `${D.cells.length} mailles · ${D.source} · ${new Date(D.generated).toLocaleString('fr-FR')}`;
buildHelp();
render();

/* points personnels (coins) — stockés sur l'appareil */
function scoreAtLatLon(lat, lon) {
  const c = cellAt(lat, lon);
  if (!c) return null;
  const b = bestScore(speciesFor(STATE.k), c.s, STATE.k);
  return b.id ? `${SPECIES[b.id].nom} ${Math.round(b.value)}` : null;
}
initPoints(map, { scoreAt: scoreAtLatLon });
