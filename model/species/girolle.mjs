import { clamp, trap, sumSlice } from '../lib.mjs';

export default {
  id: 'girolle',
  nom: 'Girolle',
  groupe: 'Cantharellus cibarius',
  saison: [6, 7, 8, 9, 10, 11],
  fenetreJours: 45,
  habitat: {
    essences: { feuillu: 1, mixte: 0.95, conifere: 0.9, autre: 0.35 },
    substrats: { acide: 1, neutre: 0.8, calcaire: 0.25 },
    altitude: [200, 1650],
    penteMax: 32,
    exposition: true,
  },
  params: {
    p30Lo: 40, p30Hi: 110, p15Lo: 15, p15Hi: 50, dryLo: 12, dryHi: 25,
    tA: 10, tB: 13, tC: 20, tD: 24,
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
    const dpen = clamp((dry - p.dryLo) / (p.dryHi - p.dryLo), 0, 1);
    const band = trap(Tsol, p.tA, p.tB, p.tC, p.tD);
    let gpen = Tmin7 < 0 ? 0.4 : 0;

    const raw = (0.5 * gm + 0.5 * topup) * band * (0.4 + 0.6 * SM) * (1 - 0.7 * dpen);
    const value = clamp(100 * raw * (1 - Math.min(gpen, 0.9)), 0, 100);
    return { value, detail: { P7, P15, P21, P30, Pevent: 0, Devent: 0, Tsol, dTsol, SM, ET7: 0, Tmin7, dry } };
  },

  criteres: [
    ['Humidité de fond', 'pluie des 30 j (40 → 110 mm)'],
    ['Relance récente', 'pluie des 15 j (15 → 50 mm)'],
    ['Série sèche', 'pénalisée dès 12 j sans pluie, forte à 25 j'],
    ['Température du sol', 'bande large et chaude (12–20 °C) — sort dès l\'été'],
    ['Gel', '−40 % si T° min < 0 °C'],
  ],
};
