/* Configuration commune du collecteur. */
import { DEFAULTS } from '../model/model.mjs';

export const CFG = {
  // emprise : Hérault 34, Gard 30, Lozère 48, Aveyron 12, Ardèche 07, Tarn 81
  departements: ['07', '12', '30', '34', '48', '81'],
  bbox: { latMin: 43.21, latMax: 45.37, lonMin: 1.51, lonMax: 4.87 },

  // grille de travail. 0.11° ≈ 11 km pour le proxy Open-Meteo.
  // Passera à 0.01° (~1 km) quand la source sera ANTILOPE.
  gridStep: +(process.env.CHAMPI_GRIDSTEP || 0.11),

  window: 75,          // jours d'historique conservés dans le store
  forecastDays: 3,     // jours de prévision ajoutés (source proxy uniquement)

  source: process.env.CHAMPI_SOURCE || 'proxy',   // 'proxy' | 'antilope'

  paths: {
    store: 'data/store',          // un fichier YYYY-MM-DD.json par jour
    webData: 'web/data.js',       // sortie consommée par la carte
    depGeojson: 'web/assets/data',// dep-XX.geojson
    parcels: 'data/habitat/parcels.geojson',   // parcelles ONF domaniales enrichies (phase habitat)
  },

  // options du filtre habitat (activées au fur et à mesure de la phase GIS)
  habitat: { useForet: false, useDomaniale: false, useSubstrat: false, useMnt: true },

  model: DEFAULTS,
};
