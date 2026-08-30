/* Poller lame d'eau radar — UNE passe par appel (piloté par un timer systemd).
 *   node collect/poller.mjs
 *
 * Télécharge la dernière mosaïque LAME_D_EAU (produit ACRR, 5 min), échantillonne
 * la grille des 6 départements, et cumule dans data/store/radar/<date Paris>.json.
 *
 * Déduplication par TRANCHE DE 5 MIN : Météo-France publie parfois des trames
 * hors grille / révisées ; on ne compte qu'une trame par créneau de 5 min.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CFG } from './config.mjs';
import { loadDeps, buildGrid, readJSON, writeJSON } from './lib.mjs';
import { fetchLatestLameEau } from './antilope.mjs';
import { openOdim } from './odim.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const RADAR_DIR = path.join(ROOT, CFG.paths.store, 'radar');
const LOCK = path.join(RADAR_DIR, '.lock');
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), '[poller]', ...a);

/** "20260829083712" -> { date:"2026-08-29", bucket:"202608290835" } (heure de Paris) */
function slice5(validityUTC) {
  const s = validityUTC;
  const dt = new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12)));
  const p = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(dt).reduce((o, x) => (o[x.type] = x.value, o), {});
  const m5 = String(Math.floor(+p.minute / 5) * 5).padStart(2, '0');
  return { date: `${p.year}-${p.month}-${p.day}`, bucket: `${p.year}${p.month}${p.day}${p.hour}${m5}` };
}

function acquireLock() {
  try { fs.mkdirSync(RADAR_DIR, { recursive: true }); fs.writeFileSync(LOCK, String(process.pid), { flag: 'wx' }); return true; }
  catch {
    try { if (Date.now() - fs.statSync(LOCK).mtimeMs > 180000) { fs.rmSync(LOCK); return acquireLock(); } } catch {}
    return false;
  }
}

async function main() {
  if (!acquireLock()) { log('une autre passe est en cours — abandon'); return; }
  try {
    const grid = buildGrid(loadDeps(ROOT));
    const { bytes, validity } = await fetchLatestLameEau();
    if (!validity) throw new Error('pas d’horodatage dans la réponse');
    const { date, bucket } = slice5(validity);
    const file = path.join(RADAR_DIR, `${date}.json`);

    const acc = readJSON(file, { date, updated: null, buckets: [], slots: [], mm: {}, missing: {} });
    if (acc.buckets.includes(bucket)) {
      log(`créneau ${bucket} déjà cumulé (${acc.buckets.length} créneaux)`);
      return;
    }

    const o = await openOdim(bytes);
    let wet = 0, maxmm = 0, nodataCells = 0;
    for (const p of grid) {
      const s = o.sampleRaw(p.lon, p.lat);
      if (s.mm == null) { acc.missing[p.id] = (acc.missing[p.id] || 0) + 1; nodataCells++; continue; }
      acc.mm[p.id] = +((acc.mm[p.id] || 0) + s.mm).toFixed(2);
      if (s.mm > 0) wet++;
      if (s.mm > maxmm) maxmm = s.mm;
    }
    acc.buckets.push(bucket);
    acc.slots.push(validity);
    acc.updated = new Date().toISOString();
    writeJSON(file, acc);
    log(`${date} ${bucket.slice(8)} · ${acc.buckets.length}/288 créneaux · ${wet} mailles pluie (max ${maxmm.toFixed(2)} mm/5min) · ${nodataCells} sans couverture`);

    const keep = new Date(Date.now() - (CFG.window + 4) * 86400000).toISOString().slice(0, 10);
    for (const f of fs.readdirSync(RADAR_DIR))
      if (f.endsWith('.json') && f.slice(0, 10) < keep) fs.unlinkSync(path.join(RADAR_DIR, f));
  } finally {
    try { fs.rmSync(LOCK); } catch {}
  }
}

main().catch(e => { try { fs.rmSync(LOCK); } catch {} console.error(new Date().toISOString(), '[poller] ÉCHEC:', e.message); process.exit(1); });
