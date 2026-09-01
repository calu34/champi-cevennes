/* Couche BRÛLIS pour les morilles — périmètres d'incendies récents.
 * Le printemps qui suit un feu, un brûlis produit massivement des morilles
 * (Morchella elata surtout). Fenêtre utile : le feu de l'année n−1, parfois n−2.
 *
 * Source automatique : EFFIS / GWIS (Copernicus) — polygones de surfaces brûlées
 * dérivés MODIS (~depuis 2000) et VIIRS (375 m, plus fin, ~depuis 2012), mis à
 * jour quotidiennement. Service GeoServer :
 *   https://maps.effis.emergency.copernicus.eu/gwis
 *   couches  nasa_geo.viirs_ba_poly  /  nasa_geo.modis_ba_poly
 * Repli : couche EFFIS « current »  modis.ba.poly.
 *
 * Complément manuel : geo/brulis-manuel.geojson (une Feature/incendie, prop `annee`)
 * — utile pour les petits feux sous le seuil de détection satellite (~30–40 ha) ou
 * les zones où EFFIS a un trou. Fusionné s'il existe.
 *
 * Sortie : web/assets/data/brulis.geojson  (Features, prop `annee`, `source`,
 * `surface_ha`, `commune`). La carte affiche le calque « Brûlis » et multiplie
 * l'indice morille par 2.2 sur les forêts qui recoupent un feu < 2 ans.
 *
 *   node geo/fetch-brulis.mjs            # 20 derniers mois
 *   CHAMPI_BRULIS_MONTHS=32 node geo/fetch-brulis.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDeps, depsBbox, pointInGeom } from '../collect/lib.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const OUT = path.join(ROOT, 'web/assets/data/brulis.geojson');
const MANUAL = path.join(ROOT, 'geo/brulis-manuel.geojson');
const MONTHS = +(process.env.CHAMPI_BRULIS_MONTHS || 20);

const deps = loadDeps(ROOT);
const bb = depsBbox(deps);
const since = new Date(Date.now() - MONTHS * 30.5 * 86400000).toISOString().slice(0, 10);
const round = c => Array.isArray(c[0]) ? c.map(round) : [+c[0].toFixed(5), +c[1].toFixed(5)];

/* --- EFFIS / GWIS : essaie plusieurs endpoints/couches jusqu'à une réponse exploitable --- */
const SERVERS = [
  { url: 'https://maps.effis.emergency.copernicus.eu/gwis', layers: ['nasa_geo.viirs_ba_poly', 'nasa_geo.modis_ba_poly'] },
  { url: 'https://maps.effis.emergency.copernicus.eu/effis', layers: ['modis.ba.poly'] },
];
const DATE_FIELDS = ['finaldate', 'initialdate', 'firedate', 'lastupdate', 'date'];
const AREA_FIELDS = ['area_ha', 'area_ht', 'gross_ha', 'area'];
const COMMUNE_FIELDS = ['commune', 'nom_com', 'municipal', 'place'];

const pick = (o, keys) => { for (const k of keys) if (o[k] != null && o[k] !== '') return o[k]; return null; };
const yearOf = s => { const m = String(s).match(/(\d{4})/); return m ? +m[1] : null; };
let feats0Logged = false;

async function wfsGet(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(45000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const txt = await r.text();
  if (txt[0] !== '{' && txt[0] !== '[') throw new Error(txt.slice(0, 120).replace(/\s+/g, ' '));
  return JSON.parse(txt);
}

async function fromEffis() {
  // deux ordres d'axes possibles selon le serveur (lon,lat vs lat,lon)
  const boxes = [
    `${bb.lonMin - 0.2},${bb.latMin - 0.2},${bb.lonMax + 0.2},${bb.latMax + 0.2}`,
    `${bb.latMin - 0.2},${bb.lonMin - 0.2},${bb.latMax + 0.2},${bb.lonMax + 0.2}`,
  ];
  for (const srv of SERVERS) {
    for (const layer of srv.layers) {
      let raw = null;
      for (const box of boxes) {
        const u = `${srv.url}?service=WFS&version=2.0.0&request=GetFeature&typeNames=${layer}` +
          `&outputFormat=application/json&srsName=EPSG:4326&count=5000&bbox=${box},EPSG:4326`;
        try { const j = await wfsGet(u); if (j?.features?.length) { raw = j.features; break; } }
        catch (e) { console.warn(`  ${layer} : ${e.message}`); }
      }
      if (!raw) { console.warn(`  ${layer} : pas de données`); continue; }
      if (raw.length && !feats0Logged) {   // aide au calage : montrer les champs dispo
        console.log(`  ${layer} : ${raw.length} entités · champs = ${Object.keys(raw[0].properties || {}).join(', ')}`);
        feats0Logged = true;
      }

      const feats = [];
      for (const f of raw) {
        const pr = f.properties || {};
        const d = pick(pr, DATE_FIELDS);
        const day = d && String(d).slice(0, 10);
        if (day && day < since) continue;                       // trop ancien
        const annee = yearOf(d) ?? new Date().getFullYear();
        if (!f.geometry) continue;
        // garder le feu s'il touche un de nos départements (test sur 1er anneau)
        const g = f.geometry;
        const rings = g.type === 'Polygon' ? [g.coordinates[0]]
          : g.type === 'MultiPolygon' ? g.coordinates.map(p => p[0]) : [];
        const touche = rings.some(r => r.some(pt =>
          Object.values(deps).some(dp => pointInGeom(pt, dp.geometry))));
        if (!touche) continue;
        feats.push({
          type: 'Feature',
          geometry: { type: g.type, coordinates: round(g.coordinates) },
          properties: {
            annee,
            source: `EFFIS/${layer.includes('viirs') ? 'VIIRS' : 'MODIS'}`,
            surface_ha: Math.round(+pick(pr, AREA_FIELDS) || 0),
            commune: pick(pr, COMMUNE_FIELDS) || null,
            date: day || null,
          },
        });
      }
      if (feats.length) { console.log(`  ${layer} : ${feats.length} feux retenus (depuis ${since})`); return feats; }
      console.warn(`  ${layer} : aucun feu récent dans la zone`);
    }
  }
  return [];
}

/* --- fusion --- */
const feats = [];
console.log(`EFFIS — emprise ${bb.lonMin.toFixed(1)},${bb.latMin.toFixed(1)} → ${bb.lonMax.toFixed(1)},${bb.latMax.toFixed(1)} · depuis ${since}`);
try { feats.push(...await fromEffis()); }
catch (e) { console.warn('EFFIS indisponible :', e.message); }

if (fs.existsSync(MANUAL)) {
  const m = JSON.parse(fs.readFileSync(MANUAL, 'utf8'));
  for (const f of m.features || []) {
    f.properties = { source: 'manuel', ...f.properties };
    f.properties.annee ??= yearOf(f.properties.date) ?? new Date().getFullYear();
    feats.push(f);
  }
  console.log(`+ ${m.features?.length || 0} incendies depuis geo/brulis-manuel.geojson`);
}

/* dédoublonnage grossier : même année + centroïdes proches (< ~1 km) */
const cx = f => { const r = (f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry.coordinates[0][0]); let x = 0, y = 0; for (const p of r) { x += p[0]; y += p[1]; } return [x / r.length, y / r.length]; };
const uniq = [];
for (const f of feats) {
  const [fx, fy] = cx(f);
  if (uniq.some(g => g.properties.annee === f.properties.annee && Math.hypot(...cx(g).map((v, i) => v - [fx, fy][i])) < 0.01)) continue;
  uniq.push(f);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ type: 'FeatureCollection', features: uniq }));
const byYear = {};
for (const f of uniq) byYear[f.properties.annee] = (byYear[f.properties.annee] || 0) + 1;
console.log(`${uniq.length} périmètres de brûlis → ${path.relative(ROOT, OUT)}  ${JSON.stringify(byYear)}`);
if (!uniq.length) console.log('(couche vide — la carte masque le calque « Brûlis »)');
