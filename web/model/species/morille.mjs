import { clamp, trap, sumSlice } from '../lib.mjs';

/* Morille — Morchella (esculenta, elata…).
 * Champignon de PRINTEMPS. Déclencheur = réchauffement du sol franchissant
 * ~9–14 °C, sur une réserve hydrique de sortie d'hiver.
 *
 * ⚠ Habitat spécifique non encore cartographié : frênaies, ripisylves, sols
 *    remaniés et surtout BRÛLIS de l'année précédente (couche à ajouter —
 *    BDIFF / EFFIS). Ici seul le signal météo + un habitat forêt approximatif.
 */
export default {
  id: 'morille',
  nom: 'Morille',
  groupe: 'Morchella esculenta / elata',
  saison: [3, 4, 5],
  fenetreJours: 40,
  habitat: {
    essences: { feuillu: 0.8, mixte: 0.7, conifere: 0.35, autre: 0.9 },   // frêne, lisières, sols nus
    substrats: { calcaire: 1, neutre: 0.9, acide: 0.6 },                  // plutôt calciphile
    altitude: [80, 1400],
    penteMax: 30,
    exposition: false,
  },
  couchesManquantes: ['brûlis (n-1)', 'ripisylve', 'frênaie'],
  params: {
    // calé sur GBIF 2019-2025 : séparation faible (63 %) — la morille est surtout
    // affaire d'habitat (brûlis, frênaie) non cartographié. Fenêtre resserrée +
    // poids accru sur la DYNAMIQUE de réchauffement pour tirer un peu de signal.
    tA: 5, tB: 9, tC: 13, tD: 16,   // bande T° sol resserrée
    warmDays: 14, warmFull: 2.5,    // vitesse de réchauffement (°C sur 14 j)
    p30Lo: 20, p30Hi: 65,
    ampLo: 7, ampHi: 15,            // amplitude jour/nuit
  },

  score(s, k, p = this.params) {
    const Tsol = s.tsol[k];
    const warming = Tsol - s.tsol[Math.max(0, k - p.warmDays)];
    const P30 = sumSlice(s.precip, k - 29, k);
    const P15 = sumSlice(s.precip, k - 14, k);
    const SM = s.smm[k] / 80;

    let amp = 0, tmin7 = Infinity, n = 0;
    for (let i = Math.max(0, k - 6); i <= k; i++) {
      amp += (s.tmax[i] ?? 0) - (s.tmin[i] ?? 0);
      tmin7 = Math.min(tmin7, s.tmin[i] ?? Infinity);
      n++;
    }
    amp /= n || 1;

    const band = trap(Tsol, p.tA, p.tB, p.tC, p.tD);
    const rising = clamp(warming / p.warmFull, 0, 1);
    const moist = clamp((P30 - p.p30Lo) / (p.p30Hi - p.p30Lo), 0, 1);
    const ampF = clamp((amp - p.ampLo) / (p.ampHi - p.ampLo), 0, 1);
    const frost = tmin7 < -2 ? 0.5 : 0;

    const raw = band * (0.2 + 0.8 * rising) * (0.35 + 0.65 * moist) * (0.5 + 0.5 * SM) * (0.75 + 0.25 * ampF);
    const value = clamp(100 * raw * (1 - frost), 0, 100);
    return { value, detail: { Tsol: +Tsol.toFixed(1), rechauffement: +warming.toFixed(1), P30: Math.round(P30), P15: Math.round(P15), amplitude: +amp.toFixed(1), Tmin7: +tmin7.toFixed(1) } };
  },

  criteres: [
    ['Réchauffement du sol', 'T° sol qui monte (+2,5 °C sur 14 j) et franchit 9–13 °C au printemps — critère dominant'],
    ['Réserve hydrique', 'pluie des 30 j (20 → 65 mm) — humidité de sortie d\'hiver'],
    ['Amplitude jour/nuit', 'journées douces, nuits fraîches (> 7–15 °C d\'écart)'],
    ['Gel', 'pénalité si T° min < −2 °C'],
    ['Habitat (à venir)', 'frênaies, ripisylves, et surtout brûlis de l\'année précédente — sans cette couche le signal météo reste faible'],
  ],
};
