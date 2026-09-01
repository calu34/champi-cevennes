import { clamp, trap, sumSlice } from '../lib.mjs';

/* Trompette de la mort — Craterellus cornucopioides.
 * Comme la girolle : humidité ENTRETENUE plutôt qu'un épisode brutal. Pousse en
 * troupes dans la litière des feuillus (hêtre, chêne, charme), souvent dans les
 * vallons frais et ombragés. Sols neutres à calcaires. Récolte surtout octobre.
 */
export default {
  id: 'trompette',
  nom: 'Trompette de la mort',
  groupe: 'Craterellus cornucopioides',
  saison: [9, 10, 11],
  fenetreJours: 40,
  habitat: {
    essences: { feuillu: 1, mixte: 0.7, conifere: 0.15, autre: 0.2 },
    substrats: { neutre: 1, calcaire: 0.9, acide: 0.75 },
    altitude: [100, 1350],
    penteMax: 25,
    exposition: true,
  },
  params: {
    p30Lo: 45, p30Hi: 125, p15Lo: 18, p15Hi: 55,
    wetLo: 3, wetHi: 8, dryLo: 9, dryHi: 19,
    tA: 6, tB: 9, tC: 16, tD: 20,
  },

  score(s, k, p = this.params) {
    const P = s.precip;
    const P7 = sumSlice(P, k - 6, k), P15 = sumSlice(P, k - 14, k);
    const P21 = sumSlice(P, k - 20, k), P30 = sumSlice(P, k - 29, k);
    const Tsol = s.tsol[k];
    const dTsol = Tsol - s.tsol[Math.max(0, k - 10)];
    const SM = s.smm[k] / 80;
    let wet = 0, Tmin7 = Infinity;
    for (let i = Math.max(0, k - 19); i <= k; i++) if ((P[i] || 0) >= 3) wet++;
    for (let i = Math.max(0, k - 6); i <= k; i++) Tmin7 = Math.min(Tmin7, s.tmin[i]);
    let dry = 0, run = 0;
    for (let i = Math.max(0, k - 24); i <= k; i++) { if ((P[i] || 0) < 1) { run++; dry = Math.max(dry, run); } else run = 0; }

    const gm = clamp((P30 - p.p30Lo) / (p.p30Hi - p.p30Lo), 0, 1);
    const topup = clamp((P15 - p.p15Lo) / (p.p15Hi - p.p15Lo), 0, 1);
    const spread = clamp((wet - p.wetLo) / (p.wetHi - p.wetLo), 0, 1);
    const band = trap(Tsol, p.tA, p.tB, p.tC, p.tD);
    const dpen = clamp((dry - p.dryLo) / (p.dryHi - p.dryLo), 0, 1);
    const frost = Tmin7 < -1 ? 0.4 : 0;

    const raw = (0.45 * gm + 0.3 * topup + 0.25 * spread) * band * (0.35 + 0.65 * SM) * (1 - 0.75 * dpen);
    const value = clamp(100 * raw * (1 - frost), 0, 100);
    return { value, detail: { P7, P15, P21, P30, Pevent: 0, Devent: 0, Tsol, dTsol, SM, ET7: 0, Tmin7, dry } };
  },

  criteres: [
    ['Humidité de fond', 'pluie des 30 j (45 → 125 mm) — la litière doit rester détrempée'],
    ['Relance récente', 'pluie des 15 j (18 → 55 mm)'],
    ['Régularité', '3–8 jours de pluie (> 3 mm) sur les 20 derniers'],
    ['Série sèche', 'sensible — pénalité dès 9 j sans pluie'],
    ['Température du sol', 'fraîche : 9–16 °C'],
    ['Gel', '−40 % dès la première gelée (T° min < −1 °C)'],
  ],
};
