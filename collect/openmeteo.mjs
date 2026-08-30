/* Source PROXY : pluie + météo via Open-Meteo (modèle ~9-11 km).
 * Sert de bouche-trou tant que la lame d'eau radar ANTILOPE n'est pas branchée,
 * et fournit dans tous les cas T° air / ET0 (pour la T° sol et l'humidité).      */
import { CFG } from './config.mjs';
import { todayISO, isoAdd, daysBetween } from './lib.mjs';

const DAILY = 'precipitation_sum,et0_fao_evapotranspiration,temperature_2m_mean,temperature_2m_min,temperature_2m_max';
const BATCH = 80;
const PAUSE = 1500;
const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * @param {{id,lat,lon}[]} grid
 * @param {string} startISO @param {string} endISO  (endISO peut être dans le futur → prévision)
 * @returns {Promise<Map<string,object>>}  id -> { time, precip, et0, tmean, tmin, tmax, elev }
 */
export async function fetchProxy(grid, startISO, endISO, { onProgress } = {}) {
  const today = todayISO();
  const wantsFuture = daysBetween(today, endISO) > 0;
  const wantsPast = daysBetween(startISO, today) > 0;
  const out = new Map();

  for (let i = 0; i < grid.length; i += BATCH) {
    const chunk = grid.slice(i, i + BATCH);
    const lat = chunk.map(p => p.lat).join(',');
    const lon = chunk.map(p => p.lon).join(',');
    let url;
    if (daysBetween(endISO, today) >= 6) {
      // fenêtre entièrement passée (>= 6 j) → archive ERA5
      url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}` +
            `&daily=${DAILY}&start_date=${startISO}&end_date=${endISO}&timezone=Europe%2FParis`;
    } else {
      // fenêtre récente / future → forecast API
      const past = Math.min(92, Math.max(0, daysBetween(startISO, today)) + 1);
      const fc = Math.min(16, Math.max(1, daysBetween(today, endISO) + 1));
      url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
            `&daily=${DAILY}&past_days=${past}&forecast_days=${fc}&timezone=Europe%2FParis`;
    }

    let arr;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const r = await fetch(url);
        const j = await r.json();
        if (j && j.error) {
          if (/limit/i.test(j.reason || '')) { await sleep(62000); continue; }
          throw new Error(j.reason);
        }
        arr = Array.isArray(j) ? j : [j];
        break;
      } catch (e) {
        if (attempt === 3) throw e;
        await sleep(5000);
      }
    }

    chunk.forEach((p, idx) => {
      const o = arr[idx];
      if (!o || !o.daily) return;
      // découper à [startISO, endISO]
      const t = o.daily.time;
      const lo = t.findIndex(d => d >= startISO);
      let hi = t.length - 1;
      while (hi > 0 && t[hi] > endISO) hi--;
      const sl = a => a.slice(lo, hi + 1);
      out.set(p.id, {
        time: sl(t),
        precip: sl(o.daily.precipitation_sum),
        et0: sl(o.daily.et0_fao_evapotranspiration),
        tmean: sl(o.daily.temperature_2m_mean),
        tmin: sl(o.daily.temperature_2m_min),
        tmax: sl(o.daily.temperature_2m_max),
        elev: Math.round(o.elevation),
      });
    });
    onProgress?.(Math.min(i + BATCH, grid.length), grid.length);
    if (i + BATCH < grid.length) await sleep(PAUSE);
  }
  return out;
}
