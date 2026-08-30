/* ================================================================== *
 *  API du modèle — utilisée par le collecteur Node ET par la carte web.
 *  Le détail par espèce est dans model/species/.
 * ================================================================== */
import { clamp } from './lib.mjs';
import { SPECIES, SPECIES_LIST } from './species/index.mjs';

export * from './lib.mjs';                        // clamp, trap, bell, deriveSeries, colorFor, …
export { SPECIES, SPECIES_LIST } from './species/index.mjs';
export { speciesById, enSaison, fenetreMax } from './species/index.mjs';

/** score météo 0..100 d'une espèce, au jour d'index k. → { value, detail[, conf] } */
export function scoreSpecies(id, s, k) {
  const sp = SPECIES[id];
  if (!sp) throw new Error('espèce inconnue : ' + id);
  return sp.score(s, k);
}

/** facteur habitat (0..1) d'une espèce pour une maille/forêt enrichie
 *  h = { essence, substrat, elev, slopeDeg, aspect }
 *  opts = { essence, substrat, mnt } — quelles couches appliquer                */
export function habitatFactor(id, h, opts = {}) {
  const sp = SPECIES[id];
  if (!sp || !h) return 1;
  const H = sp.habitat;
  let f = 1;
  if (opts.essence && h.essence && H.essences) f *= H.essences[h.essence] ?? 0.7;
  if (opts.substrat && h.substrat && H.substrats) f *= H.substrats[h.substrat] ?? 0.7;
  if (opts.mnt) {
    if (h.elev != null && H.altitude) {
      const [lo, hi] = H.altitude;
      if (h.elev < lo || h.elev > hi) f *= 0.5;
      else if (h.elev < lo * 1.3) f *= 0.85;
    }
    if (h.slopeDeg != null && H.penteMax && h.slopeDeg > H.penteMax) f *= 0.7;
  }
  return clamp(f, 0, 1);
}

/** bonus/malus exposition ubac/adret, d'autant plus fort que c'est sec */
export function expositionFactor(id, aspect, dryDays) {
  const sp = SPECIES[id];
  if (!sp?.habitat?.exposition || aspect == null) return 1;
  const ubac = Math.cos(aspect * Math.PI / 180);         // +1 Nord … −1 Sud
  const dryness = clamp(((dryDays ?? 0) - 8) / 15, 0, 1);
  return 1 + 0.18 * ubac * dryness;
}

/* -------- compat rétro : ancien scoreAt(s, k) -------- */
export function scoreAt(s, k) {
  const c = SPECIES.cepe.score(s, k), g = SPECIES.girolle.score(s, k);
  return { cepe: c.value, girolle: g.value, combine: Math.max(c.value, g.value), detail: c.detail };
}
