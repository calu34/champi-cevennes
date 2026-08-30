/* ------------------------------------------------------------------ *
 *  Carte "conditions de pousse" — cèpes & girolles — 6 départements
 *  Modèle v0.  Données : Open-Meteo (forecast API, past_days=61).
 *  Pluie = proxy modèle ~9 km en attendant la lame d'eau radar ANTILOPE.
 * ------------------------------------------------------------------ */

const CFG = {
  bbox: { latMin: 43.21, latMax: 45.37, lonMin: 1.51, lonMax: 4.87 },
  step: 0.13,                 // ~13 km (proxy modèle ~9 km — inutile de descendre plus bas ;
                              //  la finesse viendra de la lame d'eau radar)
  win: 74,                    // jours d'historique chargés avant la date d'ancrage
  batch: 90,                  // Open-Meteo compte chaque point comme un appel (~600/min en gratuit)
  groupSize: 1,               // lots séquentiels (évite la limite Open-Meteo)
  groupPause: 900,            // ms entre lots
  // seuils du modèle (ajustables — voir README)
  cepe:   { trigLo: 20, trigHi: 60, lagPeak: 14, lagSigma: 7,
            tA: 8, tB: 13, tC: 19, tD: 22 },
  girolle:{ p30Lo: 40, p30Hi: 110, p15Lo: 15, p15Hi: 50,
            dryLo: 12, dryHi: 25, tA: 10, tB: 13, tC: 20, tD: 24 },
  bucketCap: 80,             // mm — réserve utile du "seau" sol
};

/* ---------- géométrie : point dans polygone (Polygon + MultiPolygon) ---------- */
function pointInRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    const hit = ((yi > pt[1]) !== (yj > pt[1])) &&
      (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi);
    if (hit) inside = !inside;
  }
  return inside;
}
function pointInPolygon(pt, poly) {           // poly = array of rings
  if (!pointInRing(pt, poly[0])) return false;
  for (let k = 1; k < poly.length; k++) if (pointInRing(pt, poly[k])) return false;
  return true;
}
function pointInFeature(pt, geom) {
  if (geom.type === 'Polygon') return pointInPolygon(pt, geom.coordinates);
  if (geom.type === 'MultiPolygon')
    return geom.coordinates.some(p => pointInPolygon(pt, p));
  return false;
}
function whichDep(lon, lat) {
  for (const code of Object.keys(DEPS)) {
    if (pointInFeature([lon, lat], DEPS[code].geometry)) return code;
  }
  return null;
}

/* ---------- petites fonctions numériques ---------- */
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
function trap(x, a, b, c, d) {
  if (x <= a || x >= d) return 0;
  if (x < b) return (x - a) / (b - a);
  if (x <= c) return 1;
  return (d - x) / (d - c);
}
function sumSlice(arr, from, to) {            // inclusive indices, clamped
  let s = 0;
  for (let i = Math.max(0, from); i <= to && i < arr.length; i++) s += (arr[i] || 0);
  return s;
}

/* ---------- modèle ---------- */
function computeSeries(pt) {
  // séries alignées sur pt.time
  const n = pt.time.length;
  const tmean = pt.tmean;
  // proxy température du sol ~18 cm : EMA (~12 j) de la T° moyenne de l'air
  const alpha = 2 / (12 + 1);
  const tsol = new Array(n);
  let seed = 0, ns = 0;
  for (let i = 0; i < Math.min(5, n); i++) { seed += tmean[i]; ns++; }
  seed = ns ? seed / ns : tmean[0];
  tsol[0] = seed;
  for (let i = 1; i < n; i++) tsol[i] = alpha * tmean[i] + (1 - alpha) * tsol[i - 1];
  // proxy humidité du sol : bilan P - ET0 dans un seau borné
  const cap = CFG.bucketCap;
  const smm = new Array(n);
  let s = cap * 0.5;
  for (let i = 0; i < n; i++) {
    s = clamp(s + (pt.precip[i] || 0) - (pt.et0[i] || 0), 0, cap);
    smm[i] = s;
  }
  pt.tsol = tsol; pt.smm = smm;
}

function scoreAt(pt, k) {
  const P = pt.precip, ET = pt.et0, TMIN = pt.tmin, TMAX = pt.tmax;
  const P7  = sumSlice(P, k - 6,  k);
  const P15 = sumSlice(P, k - 14, k);
  const P21 = sumSlice(P, k - 20, k);
  const P30 = sumSlice(P, k - 29, k);
  // épisode déclencheur : meilleur cumul sur 48 h dans les 21 derniers jours
  let Pevent = 0, eventEnd = k;
  for (let i = Math.max(1, k - 20); i <= k; i++) {
    const v = (P[i] || 0) + (P[i - 1] || 0);
    if (v > Pevent) { Pevent = v; eventEnd = i; }
  }
  const Devent = k - eventEnd;
  const Tsol   = pt.tsol[k];
  const dTsol  = Tsol - pt.tsol[Math.max(0, k - 10)];
  const SM     = pt.smm[k] / CFG.bucketCap;                       // 0..1
  const ET7    = sumSlice(ET, k - 6, k);
  let Tmin7 = Infinity;
  for (let i = Math.max(0, k - 6); i <= k; i++) Tmin7 = Math.min(Tmin7, TMIN[i]);
  // plus longue série sèche (<1 mm) sur 30 j
  let dry = 0, run = 0;
  for (let i = Math.max(0, k - 29); i <= k; i++) {
    if ((P[i] || 0) < 1) { run++; dry = Math.max(dry, run); } else run = 0;
  }
  // chaleur préalable (J-20 à J-10)
  let heatPrior = -Infinity;
  for (let i = Math.max(0, k - 20); i <= k - 10; i++) heatPrior = Math.max(heatPrior, TMAX[i] || -Infinity);

  /* --- indice cèpe --- */
  const c = CFG.cepe;
  const trig = clamp((Pevent - c.trigLo) / (c.trigHi - c.trigLo), 0, 1);
  let lag = Math.exp(-((Devent - c.lagPeak) ** 2) / (2 * c.lagSigma ** 2));
  if (Devent <= 3) lag *= 0.2;              // trop tôt
  if (Devent > 32) lag *= 0.4;              // flush probablement passée
  const moist = clamp((P15 - 30) / (80 - 30), 0, 1);
  const band  = trap(Tsol, c.tA, c.tB, c.tC, c.tD);
  const shock = clamp(-dTsol / 5, 0, 1) * 0.25;
  let pen = 0;
  if (Tmin7 < 0)  pen += 0.5;
  if (Tmin7 < -3) pen += 0.3;
  pen += 0.35 * clamp((ET7 - P7) / 25, 0, 1);
  if (heatPrior > 34) pen += 0.15;
  const cepeRaw = Math.pow(trig, 0.8) * lag * band * (0.35 + 0.65 * moist) * (0.4 + 0.6 * SM) * (1 + shock) / 1.25;
  const cepe = clamp(100 * cepeRaw * (1 - Math.min(pen, 0.9)), 0, 100);

  /* --- indice girolle --- */
  const g = CFG.girolle;
  const gm    = clamp((P30 - g.p30Lo) / (g.p30Hi - g.p30Lo), 0, 1);
  const topup = clamp((P15 - g.p15Lo) / (g.p15Hi - g.p15Lo), 0, 1);
  const dpen  = clamp((dry - g.dryLo) / (g.dryHi - g.dryLo), 0, 1);
  const gband = trap(Tsol, g.tA, g.tB, g.tC, g.tD);
  let gpen = 0;
  if (Tmin7 < 0) gpen += 0.4;
  const girRaw = (0.5 * gm + 0.5 * topup) * gband * (0.4 + 0.6 * SM) * (1 - 0.7 * dpen);
  const girolle = clamp(100 * girRaw * (1 - Math.min(gpen, 0.9)), 0, 100);

  return {
    cepe, girolle, combine: Math.max(cepe, girolle),
    detail: { P7, P15, P21, P30, Pevent, Devent, Tsol, dTsol, SM, ET7, Tmin7, dry, heatPrior }
  };
}

/* ---------- habitat (placeholder altitude — à remplacer par BD Forêt) ---------- */
function habitatFactor(elev) {
  if (elev == null) return 1;
  if (elev < 120)  return 0.45;   // plaine / vignoble / garrigue
  if (elev > 1650) return 0.55;   // subalpin
  if (elev < 200)  return 0.7;
  return 1;
}

/* ---------- couleurs ---------- */
// échelle inversée : rouge = défavorable, vert = favorable
const RAMP = [
  [0, [128, 0, 20]], [10, [215, 48, 39]], [25, [252, 141, 89]], [40, [254, 224, 139]],
  [55, [217, 239, 139]], [75, [145, 207, 96]], [100, [26, 152, 80]],
];
function colorFor(v) {
  v = clamp(v, 0, 100);
  for (let i = 1; i < RAMP.length; i++) {
    if (v <= RAMP[i][0]) {
      const [x0, c0] = RAMP[i - 1], [x1, c1] = RAMP[i];
      const t = (v - x0) / (x1 - x0);
      const c = c0.map((ch, j) => Math.round(ch + t * (c1[j] - ch)));
      return `rgb(${c[0]},${c[1]},${c[2]})`;
    }
  }
  return 'rgb(26,152,80)';
}

/* ---------- carte ---------- */
let map, cellLayer, POINTS = [], STATE = { layer: 'combine', k: null, habitat: true };

function initMap() {
  map = L.map('map', { preferCanvas: true }).setView([44.2, 3.4], 8);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap', maxZoom: 18, opacity: 0.55,
  }).addTo(map);
  const dep = {
    type: 'FeatureCollection',
    features: Object.entries(DEPS).map(([code, f]) => ({
      type: 'Feature', properties: { code }, geometry: f.geometry,
    })),
  };
  L.geoJSON(dep, { style: { color: '#444', weight: 1.2, fill: false } }).addTo(map);
  cellLayer = L.layerGroup().addTo(map);
}

function render() {
  cellLayer.clearLayers();
  const k = STATE.k;
  const half = CFG.step / 2;
  let shown = 0;
  for (const pt of POINTS) {
    if (!pt.time) continue;
    const sc = scoreAt(pt, k);
    let v = sc[STATE.layer];
    const hf = STATE.habitat ? habitatFactor(pt.elev) : 1;
    v = v * hf;
    const rect = L.rectangle(
      [[pt.lat - half, pt.lon - half], [pt.lat + half, pt.lon + half]],
      { stroke: false, fillColor: colorFor(v), fillOpacity: 0.4 + 0.35 * Math.abs(v - 50) / 50 }
    );
    const d = sc.detail;
    rect.bindPopup(
      `<b>${pt.dep} — ${pt.lat.toFixed(2)}, ${pt.lon.toFixed(2)}</b> · ${pt.elev} m` +
      `<br><b>Cèpe ${sc.cepe.toFixed(0)} · Girolle ${sc.girolle.toFixed(0)}</b>` +
      (STATE.habitat ? `<br>facteur habitat ×${hf.toFixed(2)} → affiché ${v.toFixed(0)}` : '') +
      `<hr style="margin:4px 0">` +
      `Pluie 7/15/21/30 j : ${d.P7.toFixed(0)} / ${d.P15.toFixed(0)} / ${d.P21.toFixed(0)} / ${d.P30.toFixed(0)} mm` +
      `<br>Épisode 48 h max (21 j) : ${d.Pevent.toFixed(0)} mm, il y a ${d.Devent} j` +
      `<br>T° sol ≈ ${d.Tsol.toFixed(1)} °C (Δ10j ${d.dTsol >= 0 ? '+' : ''}${d.dTsol.toFixed(1)})` +
      `<br>Humidité sol ${(d.SM * 100).toFixed(0)} % · ET0 7j ${d.ET7.toFixed(0)} mm` +
      `<br>T° min 7 j ${d.Tmin7.toFixed(1)} °C · série sèche max ${d.dry} j`
    );
    rect.addTo(cellLayer);
    shown++;
  }
  const t = POINTS.find(p => p.time)?.time[k];
  const future = t && t > todayISO();
  document.getElementById('dateLbl').textContent =
    t ? `${t}${future ? ' — prévision' : ''}` : '—';
  document.getElementById('count').textContent = `${shown} mailles`;
}

/* ---------- données ---------- */
const DAY = 86400000;
function todayISO() { return new Date().toISOString().slice(0, 10); }
function isoAdd(iso, n) { return new Date(Date.parse(iso) + n * DAY).toISOString().slice(0, 10); }

const CACHE_KEYS = ['time', 'precip', 'et0', 'tmean', 'tmin', 'tmax', 'elev'];

function finalize(pts, anchor, live, note) {
  POINTS = pts.filter(p => p.time);
  if (!POINTS.length) return false;
  const ref = POINTS[0];
  const anchorIdx = Math.max(0, ref.time.indexOf(anchor));
  const slider = document.getElementById('dateSlider');
  slider.min = 25;
  slider.max = ref.time.length - 1;
  slider.value = anchorIdx || ref.time.length - 1;
  STATE.k = +slider.value;
  document.getElementById('status').textContent =
    `${POINTS.length} mailles — ${live ? 'temps réel, ' : ''}fenêtre ${ref.time[0]} → ${ref.time[slider.value]}${note || ''}`;
  document.getElementById('updated').textContent = 'chargé le ' + new Date().toLocaleString('fr-FR');
  render();
  return true;
}

async function fetchGrid(force) {
  const st = document.getElementById('status');
  st.textContent = 'construction de la grille…';
  const pts = [];
  for (let la = CFG.bbox.latMin; la <= CFG.bbox.latMax; la += CFG.step)
    for (let lo = CFG.bbox.lonMin; lo <= CFG.bbox.lonMax; lo += CFG.step) {
      const dep = whichDep(lo, la);
      if (dep) pts.push({ lat: +la.toFixed(4), lon: +lo.toFixed(4), dep });
    }

  // fenêtre : WIN jours d'historique se terminant à la date d'ancrage
  const anchor = document.getElementById('anchorDate').value || todayISO();
  const daysBack = Math.round((Date.parse(todayISO()) - Date.parse(anchor)) / DAY);
  const live = daysBack <= 5;

  // cache local (évite de retaper l'API Open-Meteo à chaque ouverture)
  const ck = `champi:${CFG.step}:${anchor}:${live ? todayISO() : 'archive'}`;
  if (!force) {
    try {
      const c = JSON.parse(localStorage.getItem(ck) || 'null');
      if (c && c.length === pts.length) {
        pts.forEach((p, i) => { CACHE_KEYS.forEach(k => p[k] = c[i][k]); computeSeries(p); });
        if (finalize(pts, anchor, live, ' — cache local')) return;
      }
    } catch (e) { /* pas de localStorage */ }
  }
  const qWindow = live
    ? `&past_days=${CFG.win}&forecast_days=3`
    : `&start_date=${isoAdd(anchor, -CFG.win)}&end_date=${anchor}`;
  const api = live
    ? 'https://api.open-meteo.com/v1/forecast'
    : 'https://archive-api.open-meteo.com/v1/archive';

  st.textContent = `${pts.length} points — téléchargement Open-Meteo (${live ? 'temps réel' : 'archive ' + anchor})…`;
  const chunks = [];
  for (let i = 0; i < pts.length; i += CFG.batch) chunks.push(pts.slice(i, i + CFG.batch));
  const daily = 'precipitation_sum,et0_fao_evapotranspiration,temperature_2m_mean,temperature_2m_min,temperature_2m_max';
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let done = 0, rateLimited = false;

  const doChunk = async chunk => {
    const url = `${api}?latitude=${chunk.map(p => p.lat).join(',')}` +
      `&longitude=${chunk.map(p => p.lon).join(',')}&daily=${daily}${qWindow}&timezone=Europe%2FParis`;
    let arr;
    try {
      const r = await fetch(url);
      const j = await r.json();
      if (j && j.error) { if (/limit/i.test(j.reason || '')) rateLimited = true; return; }
      arr = Array.isArray(j) ? j : [j];
    } catch (e) { console.warn('lot échoué', e); return; }
    chunk.forEach((p, idx) => {
      const o = arr[idx];
      if (!o || !o.daily) return;
      p.time   = o.daily.time;
      p.precip = o.daily.precipitation_sum;
      p.et0    = o.daily.et0_fao_evapotranspiration;
      p.tmean  = o.daily.temperature_2m_mean;
      p.tmin   = o.daily.temperature_2m_min;
      p.tmax   = o.daily.temperature_2m_max;
      p.elev   = Math.round(o.elevation);
      computeSeries(p);
    });
    done += chunk.length;
    st.textContent = `téléchargement… ${done}/${pts.length}`;
  };

  for (let i = 0; i < chunks.length; i += CFG.groupSize) {
    await Promise.all(chunks.slice(i, i + CFG.groupSize).map(doChunk));
    if (i + CFG.groupSize < chunks.length) await sleep(CFG.groupPause);
  }
  const full = pts.filter(p => p.time).length === pts.length;
  if (!finalize(pts, anchor, live,
    rateLimited || !full ? '  ⚠ partielles (limite Open-Meteo — Recharger dans 1 min)' : '')) {
    st.textContent = rateLimited
      ? 'limite Open-Meteo atteinte — réessayez dans 1 min (bouton Recharger)'
      : 'échec du téléchargement des données';
    return;
  }
  if (full && !rateLimited) {
    try {
      Object.keys(localStorage).forEach(k => k.startsWith('champi:') && localStorage.removeItem(k));
      localStorage.setItem(ck, JSON.stringify(
        pts.map(p => Object.fromEntries(CACHE_KEYS.map(k => [k, p[k]])))));
    } catch (e) { /* quota / pas de localStorage */ }
  }
}

/* ---------- UI ---------- */
function initUI() {
  const ad = document.getElementById('anchorDate');
  ad.max = todayISO();
  ad.value = todayISO();
  ad.addEventListener('change', () => fetchGrid());
  document.querySelectorAll('input[name=layer]').forEach(el =>
    el.addEventListener('change', e => { STATE.layer = e.target.value; render(); }));
  document.getElementById('habitat').addEventListener('change', e => {
    STATE.habitat = e.target.checked; render();
  });
  document.getElementById('dateSlider').addEventListener('input', e => {
    STATE.k = +e.target.value; render();
  });
  document.getElementById('reload').addEventListener('click', () => fetchGrid(true));
}

initMap();
initUI();
fetchGrid().catch(err => {
  document.getElementById('status').textContent = 'erreur : ' + err.message;
  console.error(err);
});
