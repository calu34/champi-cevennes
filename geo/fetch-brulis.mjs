/* Couche BRÛLIS pour les morilles — périmètres d'incendies des ~18 derniers mois.
 * Le printemps qui suit un feu, un brûlis produit massivement des morilles.
 *
 * ⚠ Pas de source API stable identifiée pour l'instant :
 *   - EFFIS / GWIS (Copernicus) : WMS/WFS instables depuis ce script
 *   - BDIFF (bdiff.agriculture.gouv.fr) : site à formulaire (CSRF), pas d'API ;
 *     export CSV manuel possible (commune + date + surface, pas de polygone)
 *
 * En attendant, ce script :
 *   1. tente l'EFFIS WFS (à compléter avec le bon endpoint/couche)
 *   2. sinon, fusionne un fichier manuel  geo/brulis-manuel.geojson  s'il existe
 *      (une Feature par incendie, propriété `annee`)
 *   → écrit  web/assets/data/brulis.geojson
 *
 * La carte affiche la couche « Brûlis » et booste la morille sur les forêts
 * qui la recoupent (voir web/app.mjs).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const OUT = path.join(ROOT, 'web/assets/data/brulis.geojson');
const MANUAL = path.join(ROOT, 'geo/brulis-manuel.geojson');

// TODO — EFFIS/GWIS : renseigner endpoint + couche + filtre date + bbox
async function fromEffis() {
  return [];
}

const feats = [];
try { feats.push(...await fromEffis()); } catch (e) { console.warn('EFFIS indisponible :', e.message); }
if (fs.existsSync(MANUAL)) {
  const m = JSON.parse(fs.readFileSync(MANUAL, 'utf8'));
  feats.push(...(m.features || []));
  console.log(`+ ${m.features?.length || 0} incendies depuis geo/brulis-manuel.geojson`);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ type: 'FeatureCollection', features: feats }));
console.log(`${feats.length} périmètres de brûlis → ${path.relative(ROOT, OUT)}`);
if (!feats.length) console.log('(couche vide — la carte masque le calque « Brûlis »)');
