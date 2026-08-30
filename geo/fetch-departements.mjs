/* Récupère les contours de TOUS les départements métropolitains dans
 * web/assets/data/dep-XX.geojson (un fichier Feature par département).
 *
 *   node geo/fetch-departements.mjs           # tous
 *   node geo/fetch-departements.mjs 07 12 30  # seulement ceux-là
 *
 * Source : france-geojson (gregoiredavid, Licence Ouverte).
 * Pour étendre la couverture : lancer ceci, ajouter les codes dans
 * collect/config.mjs → departements, relancer les couches habitat.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const DIR = path.join(ROOT, 'web/assets/data');
const want = process.argv.slice(2);

const url = 'https://raw.githubusercontent.com/gregoiredavid/france-geojson/master/departements-version-simplifiee.geojson';
const fc = await (await fetch(url)).json();
fs.mkdirSync(DIR, { recursive: true });

let n = 0;
for (const f of fc.features) {
  const code = f.properties.code;
  if (want.length && !want.includes(code)) continue;
  const out = path.join(DIR, `dep-${code}.geojson`);
  // ne pas écraser un fichier haute résolution déjà présent, sauf si demandé explicitement
  if (fs.existsSync(out) && !want.length) continue;
  fs.writeFileSync(out, JSON.stringify({ type: 'Feature', properties: { code, nom: f.properties.nom }, geometry: f.geometry }));
  n++;
}
console.log(`${n} départements écrits dans web/assets/data/ (${fc.features.length} disponibles)`);
