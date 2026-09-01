import { clamp, trap, sumSlice, bestBurst } from '../lib.mjs';

/* Pied-de-mouton — Hydnum repandum / rufescens.
 * Espèce d'ARRIÈRE-SAISON, la plus tolérante à la sécheresse et au froid :
 * sort quand cèpes et girolles sont finis, tient jusqu'aux gelées. Mycorhizien
 * de feuillus comme de conifères (hêtraies, chênaies, pinèdes). Peu exigeant.
 */
export default {
  id: 'pdm',
  nom: 'Pied-de-mouton',
  groupe: 'Hydnum repandum / rufescens',
  saison: [9, 10, 11, 12],
  fenetreJours: 40,
  habitat: {
    essences: { feuillu: 1, mixte: 1, conifere: 0.9, autre: 0.3 },
    substrats: { acide: 1, neutre: 0.9, calcaire: 0.7 },
    altitude: [150, 1650],
    penteMax: 32,
    exposition: true,
  },
  params: {
    trigLo: 15, trigHi: 55, lagPeak: 16, lagSigma: 11,
    p30Lo: 35, p30Hi: 100, dryLo: 18, dryHi: 36,
    tA: 3, tB: 7, tC: 14, tD: 19,
  },

  score(s, k, p = this.params) {
    const P = s.precip;
    const P7 = sumSlice(P, k - 6, k), P15 = sumSlice(P, k - 14, k);
    const P21 = sumSlice(P, k - 20, k), P30 = sumSlice(P, k - 29, k);
    const ev = bestBurst(P, k, 28, 2);
    const Tsol = s.tsol[k];
    const dTsol = Tsol - s.tsol[Math.max(0, k - 10)];
    const SM = s.smm[k] / 80;
    let Tmin7 = Infinity;
    for (let i = Math.max(0, k - 6); i <= k; i++) Tmin7 = Math.min(Tmin7, s.tmin[i]);
    let dry = 0, run = 0;
    for (let i = Math.max(0, k - 29); i <= k; i++) { if ((P[i] || 0) < 1) { run++; dry = Math.max(dry, run); } else run = 0; }

    const trig = clamp((ev.mm - p.trigLo) / (p.trigHi - p.trigLo), 0, 1);
    const lag = ev.daysAgo <= 4 ? 0.35 : clamp(1 - Math.abs(ev.daysAgo - p.lagPeak) / p.lagSigma / 2, 0.15, 1);
    const moist = clamp((P30 - p.p30Lo) / (p.p30Hi - p.p30Lo), 0, 1);
    const band = trap(Tsol, p.tA, p.tB, p.tC, p.tD);
    const dpen = clamp((dry - p.dryLo) / (p.dryHi - p.dryLo), 0, 1);
    const frost = Tmin7 < -5 ? 0.4 : Tmin7 < -1 ? 0.15 : 0;

    const raw = (0.35 + 0.65 * trig) * lag * band * (0.4 + 0.6 * moist) * (0.5 + 0.5 * SM) * (1 - 0.55 * dpen);
    const value = clamp(100 * raw * (1 - frost), 0, 100);
    return { value, detail: { P7, P15, P21, P30, Pevent: ev.mm, Devent: ev.daysAgo, Tsol, dTsol, SM, ET7: 0, Tmin7, dry } };
  },

  criteres: [
    ['Pluie déclenchante', 'meilleur cumul 48 h des 4 dernières semaines — nul sous 15 mm, plein à 55'],
    ['Délai', 'large : 10–25 j après l\'épisode (pic ~16 j)'],
    ['Humidité de fond', 'pluie des 30 j (35 → 100 mm)'],
    ['Série sèche', 'très tolérant — pénalité seulement au-delà de 18 j sans pluie'],
    ['Température du sol', 'bande fraîche 7–14 °C (sort après les cèpes)'],
    ['Gel', 'résistant : −15 % sous −1 °C, −40 % sous −5 °C'],
  ],
};
