/* Configuration commune.
 *
 * ── Étendre la zone couverte ──────────────────────────────────────────────
 *  1. ajouter les codes départements dans `departements`
 *  2. déposer les `dep-XX.geojson` correspondants dans web/assets/data/
 *     (node geo/fetch-departements.mjs les récupère)
 *  3. relancer les couches habitat : node geo/fetch-onf.mjs && …
 *  Le bbox de travail est calculé automatiquement à partir des départements.
 */
export const CFG = {
  departements: (process.env.CHAMPI_DEPS || '07,12,30,34,48,81').split(','),

  // pas de grille. ~0.11° ≈ 11 km (proxy Open-Meteo). Radar = échantillonné plus fin.
  // Sur une grande emprise, augmenter (quota Open-Meteo) : 0.11 → ~350 pts sur 6 dépts,
  // ~30 000 pts sur la France → passer en radar-seul + grille météo grossière.
  gridStep: +(process.env.CHAMPI_GRIDSTEP || 0.11),
  // grille météo Open-Meteo. null → = gridStep. Sur grande emprise, mettre plus
  // grossier (ex. 0.3) : la pluie vient du radar, Open-Meteo ne fait que T°/ET0.
  meteoGridStep: process.env.CHAMPI_METEOSTEP ? +process.env.CHAMPI_METEOSTEP : null,

  forecastDays: 3,     // jours de prévision (source proxy)
  // l'historique complet est dans data/archive/<mois>.json (append-only, illimité)

  source: process.env.CHAMPI_SOURCE || 'proxy',   // 'proxy' | 'antilope'

  paths: {
    store: 'data/store',
    webData: 'web/data.js',
    depGeojson: 'web/assets/data',
    forets: 'web/assets/data/forets-publiques.geojson',
  },

  // couches habitat appliquées à la couche forêts (H1–H4 faits)
  habitat: { essence: true, substrat: true, mnt: true },
};
