import { clamp, trap, bell, sumSlice, bestBurst } from '../lib.mjs';

export default {
  id: 'cepe',
  nom: 'Cèpe',
  groupe: 'Boletus edulis / aereus / pinophilus / aestivalis',
  saison: [6, 7, 8, 9, 10, 11],
  fenetreJours: 35,
  habitat: {
    essences: { feuillu: 1, mixte: 0.95, conifere: 0.85, autre: 0.35 },
    substrats: { acide: 1, neutre: 0.85, calcaire: 0.55 },   // le cèpe tolère mieux le calcaire que la girolle
    altitude: [150, 1700],
    penteMax: 32,
    exposition: true,
  },
  params: {
    trigLo: 20, trigHi: 60, lagPeak: 14, lagSigma: 7,
    tA: 8, tB: 13, tC: 19, tD: 22, p15Lo: 30, p15Hi: 80,
  },

  score(s, k, p = this.params) {
    const P = s.precip, ET = s.et0, TMIN = s.tmin, TMAX = s.tmax;
    const P7 = sumSlice(P, k - 6, k), P15 = sumSlice(P, k - 14, k);
    const P21 = sumSlice(P, k - 20, k), P30 = sumSlice(P, k - 29, k);
    const ev = bestBurst(P, k, 21, 2);
    const Tsol = s.tsol[k];
    const dTsol = Tsol - s.tsol[Math.max(0, k - 10)];
    const SM = s.smm[k] / 80;
    const ET7 = sumSlice(ET, k - 6, k);
    let Tmin7 = Infinity;
    for (let i = Math.max(0, k - 6); i <= k; i++) Tmin7 = Math.min(Tmin7, TMIN[i]);
    let heatPrior = -Infinity;
    for (let i = Math.max(0, k - 20); i <= k - 10; i++) heatPrior = Math.max(heatPrior, TMAX[i] ?? -Infinity);

    const trig = clamp((ev.mm - p.trigLo) / (p.trigHi - p.trigLo), 0, 1);
    let lag = bell(ev.daysAgo, p.lagPeak, p.lagSigma);
    if (ev.daysAgo <= 3) lag *= 0.2;
    if (ev.daysAgo > 32) lag *= 0.4;
    const moist = clamp((P15 - p.p15Lo) / (p.p15Hi - p.p15Lo), 0, 1);
    const band = trap(Tsol, p.tA, p.tB, p.tC, p.tD);
    const shock = clamp(-dTsol / 5, 0, 1) * 0.25;

    let pen = 0;
    if (Tmin7 < 0) pen += 0.5;
    if (Tmin7 < -3) pen += 0.3;
    pen += 0.35 * clamp((ET7 - P7) / 25, 0, 1);
    if (heatPrior > 34) pen += 0.15;

    const raw = Math.pow(trig, 0.8) * lag * band * (0.35 + 0.65 * moist) * (0.4 + 0.6 * SM) * (1 + shock) / 1.25;
    const value = clamp(100 * raw * (1 - Math.min(pen, 0.9)), 0, 100);
    return { value, detail: { P7, P15, P21, P30, Pevent: ev.mm, Devent: ev.daysAgo, Tsol, dTsol, SM, ET7, Tmin7, dry: ev.daysAgo } };
  },

  criteres: [
    ['Pluie déclenchante', "meilleur cumul sur 48 h des 21 derniers jours — nul sous 20 mm, plein à 60"],
    ['Délai', "optimal 10–20 j après l'épisode (pic 14 j), s'effondre après ~1 mois"],
    ['Humidité entretenue', 'pluie des 15 j (30 → 80 mm) — une pluie unique suivie de sec = avortement'],
    ['Température du sol', 'favorable 13–19 °C, nul hors 8–22 °C'],
    ['Choc thermique', 'baisse de 2–6 °C sur 10 j → bonus'],
    ['Pénalités', 'gel, semaine évaporante, canicule juste avant'],
  ],
};
