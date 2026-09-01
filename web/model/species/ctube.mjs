import { clamp, trap, sumSlice } from '../lib.mjs';

/* Chanterelle en tube — Craterellus tubaeformis (girolle grise / jaunissante).
 * La plus TARDIVE et la plus résistante au froid : pousse d'octobre à janvier,
 * traverse les premières gelées. Conifères (épicéa, pin) et mixtes, sur sols
 * acides moussus et frais, souvent en montagne.
 */
export default {
  id: 'ctube',
  nom: 'Chanterelle en tube',
  groupe: 'Craterellus tubaeformis',
  saison: [10, 11, 12, 1],
  fenetreJours: 45,
  habitat: {
    essences: { conifere: 1, mixte: 0.9, feuillu: 0.55, autre: 0.3 },
    substrats: { acide: 1, neutre: 0.7, calcaire: 0.3 },
    altitude: [300, 1750],
    penteMax: 34,
    exposition: false,
  },
  params: {
    p30Lo: 40, p30Hi: 115, p15Lo: 12, p15Hi: 45,
    dryLo: 16, dryHi: 32, tA: 0, tB: 4, tC: 11, tD: 16,
  },

  score(s, k, p = this.params) {
    const P = s.precip;
    const P7 = sumSlice(P, k - 6, k), P15 = sumSlice(P, k - 14, k);
    const P21 = sumSlice(P, k - 20, k), P30 = sumSlice(P, k - 29, k);
    const Tsol = s.tsol[k];
    const dTsol = Tsol - s.tsol[Math.max(0, k - 10)];
    const SM = s.smm[k] / 80;
    let Tmin7 = Infinity;
    for (let i = Math.max(0, k - 6); i <= k; i++) Tmin7 = Math.min(Tmin7, s.tmin[i]);
    let dry = 0, run = 0;
    for (let i = Math.max(0, k - 29); i <= k; i++) { if ((P[i] || 0) < 1) { run++; dry = Math.max(dry, run); } else run = 0; }

    const gm = clamp((P30 - p.p30Lo) / (p.p30Hi - p.p30Lo), 0, 1);
    const topup = clamp((P15 - p.p15Lo) / (p.p15Hi - p.p15Lo), 0, 1);
    const band = trap(Tsol, p.tA, p.tB, p.tC, p.tD);
    const dpen = clamp((dry - p.dryLo) / (p.dryHi - p.dryLo), 0, 1);
    const frost = Tmin7 < -9 ? 0.5 : Tmin7 < -5 ? 0.2 : 0;   // très rustique

    const raw = (0.6 * gm + 0.4 * topup) * band * (0.4 + 0.6 * SM) * (1 - 0.5 * dpen);
    const value = clamp(100 * raw * (1 - frost), 0, 100);
    return { value, detail: { P7, P15, P21, P30, Pevent: 0, Devent: 0, Tsol, dTsol, SM, ET7: 0, Tmin7, dry } };
  },

  criteres: [
    ['Humidité de fond', 'pluie des 30 j (40 → 115 mm)'],
    ['Relance récente', 'pluie des 15 j (12 → 45 mm)'],
    ['Série sèche', 'assez tolérant — pénalité au-delà de 16 j'],
    ['Température du sol', 'froide : 4–11 °C, plafond 16 °C'],
    ['Gel', 'très rustique : rien avant −5 °C, −50 % sous −9 °C'],
  ],
};
