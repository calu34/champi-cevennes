# Phase habitat — préparation des couches SIG

Objectif : produire **`data/habitat/parcels.geojson`** = les **parcelles forestières
domaniales ONF** des 6 départements, chacune enrichie de :

| attribut | source | valeurs |
|---|---|---|
| `domaniale` | ONF | `true` (on ne garde que les domaniales) |
| `essence` | BD Forêt V2 (IGN) | `feuillu_myco` (chêne, châtaignier, hêtre), `conifere_myco` (pin sylvestre/laricio), `autre` |
| `substrat` | BRGM (carte géol. 1/50 000 harmonisée) | `acide` (schiste, granite, grès), `neutre`, `calcaire` |
| `elev`, `slopeDeg`, `aspect` | MNT (RGE ALTI 25 m ou SRTM 30 m) | moyennes sur la parcelle |

Le collecteur (`collect/run.mjs` → `habitatFor`) fait ensuite un point-dans-polygone
de chaque maille radar vers sa parcelle, et `model.mjs` → `habitatFactor` combine
le tout selon `CFG.habitat`.

## Sources (téléchargements)

1. **Forêts publiques ONF** — <https://www.data.gouv.fr/datasets/forets-publiques-diffusion-publique>
   et **parcelles** — <https://www.data.gouv.fr/datasets/parcelles-forestieres-publiques-diffusion-publique-1>
   (Shapefile / GeoPackage, Licence Ouverte). Filtrer `dom` / domanialité = domaniale.
2. **BD Forêt V2** — IGN Géoservices, par département :
   <https://geoservices.ign.fr/bdforet> (GeoPackage, ~50–150 Mo/dépt).
   Champ `essence` / `TFV` (typologie de formation végétale).
3. **Substrat** — BRGM, carte géologique harmonisée 1/50 000 :
   <https://infoterre.brgm.fr> (WFS) ou export vecteur départemental.
   Reclasser la lithologie en acide / neutre / calcaire.
4. **MNT** — RGE ALTI 25 m (IGN) ou, plus léger, SRTM 30 m
   (<https://dwtkns.com/srtm30m/>, tuiles `N43E002` … `N45E004`).

## Traitement (à écrire — `geo/ingest.mjs`)

Node, sans SIG lourd :
- `shapefile` / `@tmcw/togeojson` pour lire les vecteurs
- `@turf/turf` : `booleanPointInPolygon`, `intersect`, `area`, `centroid`
- `geotiff` : lire le MNT, calculer pente/exposition par différences finies

Étapes :
1. charger parcelles ONF, garder domaniales des 6 dépts → `parcels[]`
2. pour chaque parcelle : intersecter BD Forêt → essence majoritaire ; intersecter
   BRGM → substrat majoritaire ; échantillonner le MNT sur le centroïde + grille
   interne → `elev`, `slopeDeg`, `aspect`
3. écrire `data/habitat/parcels.geojson` (géométries simplifiées à ~50 m)

Une fois le fichier présent, activer dans `collect/config.mjs` :
```js
habitat: { useForet: true, useDomaniale: true, useSubstrat: true, useMnt: true },
```

## Carte truffe (plus tard)

Même pipeline, masque inversé sur le substrat : on **garde** `calcaire`
(causses : Larzac, Méjean, Sauveterre, causse Noir) et on applique un modèle
« bilan hydrique estival → production hivernale » dans un `model/truffe.mjs`.
