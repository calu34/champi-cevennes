import { clamp, trap, sumSlice, bestBurst } from '../lib.mjs';

/* Sanguin / Lactaire délicieux — Lactarius deliciosus / sanguifluus / semisanguifluus.
 * Champignon des PINÈDES méditerranéennes (pin sylvestre, pin noir, pin d'Alep),
 * très présent sur les causses et garrigues du Gard / de l'Hérault. Sort ~2 semaines
 * après les premières vraies pluies d'automne ("pluies de septembre"). Calcaire OK.
 */
export default {
  id: 'sanguin',
  nom: 'Sanguin',
  groupe: 'Lactarius deliciosus / sanguifluus',
  saison: [9, 10, 11, 12],
  fenetreJours: 38,
  habitat: {
    essences: { conifere: 1, mixte: 0.6, feuillu: 0.08, autre: 0.25 },
    substrats: { calcaire: 1, neutre: 1, acide: 0.9 },
    altitude: [40, 1500],
    penteMax: 32,
    exposition: true,
  },
  params: {
    // calé sur GBIF 2019-2025 : déclencheur adouci (1 obs sur 4 sortait à 0)
    trigLo: 13, trigHi: 46, lagPeak: 13, lagSigma: 12,
    p15Lo: 14, p15Hi: 52, tA: 7, tB: 11, tC: 18, tD: 23,
    dryLo: 16, dryHi: 30,
  },

  score(s, k, p = this.params) {
    const P = s.precip, ET = s.et0;
    const P7 = sumSlice(P, k - 6, k), P15 = sumSlice(P, k - 14, k);
    const P21 = sumSlice(P, k - 20, k), P30 = sumSlice(P, k - 29, k);
    const ev = bestBurst(P, k, 24, 2);
    const Tsol = s.tsol[k];
    const dTsol = Tsol - s.tsol[Math.max(0, k - 10)];
    const SM = s.smm[k] / 80;
    const ET7 = sumSlice(ET, k - 6, k);
    let Tmin7 = Infinity;
    for (let i = Math.max(0, k - 6); i <= k; i++) Tmin7 = Math.min(Tmin7, s.tmin[i]);
    let dry = 0, run = 0;
    for (let i = Math.max(0, k - 29); i <= k; i++) { if ((P[i] || 0) < 1) { run++; dry = Math.max(dry, run); } else run = 0; }

    const trig = clamp((ev.mm - p.trigLo) / (p.trigHi - p.trigLo), 0, 1);
    let lag = ev.daysAgo <= 3 ? 0.35 : clamp(1 - Math.abs(ev.daysAgo - p.lagPeak) / p.lagSigma / 2, 0.2, 1);
    if (ev.daysAgo > 34) lag *= 0.5;
    const moist = clamp((P15 - p.p15Lo) / (p.p15Hi - p.p15Lo), 0, 1);
    const band = trap(Tsol, p.tA, p.tB, p.tC, p.tD);
    const dpen = clamp((dry - p.dryLo) / (p.dryHi - p.dryLo), 0, 1);
    let pen = 0.3 * clamp((ET7 - P7) / 25, 0, 1);
    if (Tmin7 < -2) pen += 0.35;

    const raw = Math.pow(trig, 0.75) * lag * band * (0.5 + 0.5 * moist) * (0.5 + 0.5 * SM) * (1 - 0.5 * dpen);
    const value = clamp(100 * raw * (1 - Math.min(pen, 0.85)), 0, 100);
    return { value, detail: { P7, P15, P21, P30, Pevent: ev.mm, Devent: ev.daysAgo, Tsol, dTsol, SM, ET7, Tmin7, dry } };
  },

  criteres: [
    ['Pluie déclenchante', 'meilleur cumul 48 h des 24 derniers jours — nul sous 13 mm, plein à 46'],
    ['Délai', 'optimal 7–19 j après l\'épisode (pic 13 j)'],
    ['Humidité entretenue', 'pluie des 15 j (14 → 52 mm)'],
    ['Température du sol', 'automne doux méditerranéen : 11–18 °C'],
    ['Série sèche', 'pénalité dès 16 j sans pluie'],
    ['Pénalités', 'semaine évaporante (ET0 > pluie), gelée < −2 °C'],
  ],
};
