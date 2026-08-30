/* Source PROXY : pluie + météo via Open-Meteo (modèle ~9-11 km).
 * Bouche-trou tant que la lame d'eau radar ANTILOPE n'est pas complète, et
 * fournit dans tous les cas T° air / ET0 (pour la T° sol et l'humidité).
 *
 * Deux API selon l'ancienneté :
 *   - archive ERA5      pour l'histoire au-delà de ~90 j
 *   - forecast (past_days + forecast_days) pour les ~90 derniers jours + prévision
 * Une fenêtre longue déclenche les deux appels, fusionnés par date.
 */
import { todayISO, isoAdd, daysBetween } from './lib.mjs';

const DAILY = 'precipitation_sum,et0_fao_evapotranspiration,temperature_2m_mean,temperature_2m_min,temperature_2m_max';
const BATCH = 80;
const PAUSE = 1500;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getJSON(url) {
  for (let a = 0; a < 4; a++) {
    try {
      const r = await fetch(url);
      const j = await r.json();
      if (j && j.error) {
        if (/limit/i.test(j.reason || '')) { await sleep(62000); continue; }
        throw new Error(j.reason);
      }
      return Array.isArray(j) ? j : [j];
    } catch (e) { if (a === 3) throw e; await sleep(5000); }
  }
}

const D = ['precip', 'et0', 'tmean', 'tmin', 'tmax'];
const KEYS = ['precipitation_sum', 'et0_fao_evapotranspiration',
  'temperature_2m_mean', 'temperature_2m_min', 'temperature_2m_max'];

/** @returns {Promise<Map<string,{time,precip,et0,tmean,tmin,tmax,elev}>>} */
export async function fetchProxy(grid, startISO, endISO, { onProgress } = {}) {
  const today = todayISO();
  const histDays = daysBetween(startISO, today);
  const splitISO = histDays > 90 ? isoAdd(today, -88) : startISO;   // archive avant, forecast après
  const useArchive = splitISO > startISO;

  const out = new Map();
  for (let i = 0; i < grid.length; i += BATCH) {
    const chunk = grid.slice(i, i + BATCH);
    const lat = chunk.map(p => p.lat).join(',');
    const lon = chunk.map(p => p.lon).join(',');
    const merged = chunk.map(() => ({ rows: {}, elev: null }));

    const absorb = (arr, from, to) => arr?.forEach((o, idx) => {
      if (!o?.daily) return;
      merged[idx].elev ??= Math.round(o.elevation);
      o.daily.time.forEach((day, di) => {
        if (day < from || day > to) return;
        merged[idx].rows[day] = KEYS.map(kk => o.daily[kk]?.[di] ?? null);
      });
    });

    if (useArchive) {
      const u = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}` +
        `&daily=${DAILY}&start_date=${startISO}&end_date=${isoAdd(splitISO, -1)}&timezone=Europe%2FParis`;
      absorb(await getJSON(u), startISO, isoAdd(splitISO, -1));
    }
    const past = Math.min(92, Math.max(0, daysBetween(splitISO, today)) + 1);
    const fc = Math.min(16, Math.max(1, daysBetween(today, endISO) + 1));
    const u2 = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&daily=${DAILY}&past_days=${past}&forecast_days=${fc}&timezone=Europe%2FParis`;
    absorb(await getJSON(u2), splitISO, endISO);

    chunk.forEach((p, idx) => {
      const days = Object.keys(merged[idx].rows).sort();
      if (!days.length) return;
      const rec = { time: days, elev: merged[idx].elev };
      D.forEach((v, vi) => rec[v] = days.map(d => merged[idx].rows[d][vi]));
      out.set(p.id, rec);
    });
    onProgress?.(Math.min(i + BATCH, grid.length), grid.length);
    if (i + BATCH < grid.length) await sleep(PAUSE);
  }
  return out;
}
