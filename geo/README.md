# Phase habitat — préparation des couches SIG

## État

- **H1 — forêts domaniales ONF : FAIT.** `geo/fetch-onf.mjs` récupère les 90 forêts
  domaniales des 6 départements (WFS Géoplateforme `ONF.FORETS_PUBLIQUES`, filtre
  `cdom_frt='OUI'`), simplifie, écrit `web/assets/data/forets-domaniales.geojson`
  (versionné). La carte les affiche colorées par l'indice de la maille qui les
  contient, avec un interrupteur « Forêts domaniales ».
- **H2 — essence dominante : FAIT.** `geo/fetch-bdforet.mjs` interroge BD Forêt V2
  (WFS `LANDCOVER.FORESTINVENTORY.V2:formation_vegetale`) dans l'emprise de chaque
  forêt, calcule la classe dominante (feuillu / conifere / mixte / autre) et l'ajoute
  au geojson. Résultat 6 dépts : 22 feuillu, 50 conifere, 10 mixte, 8 autre — les
  domaniales cévenoles sont surtout des reboisements RTM résineux. `habitatFactor`
  applique feuillu ×1 / mixte ×0.95 / conifere ×0.85 / autre ×0.35 à la couche forêts.
- **H3 substrat acide/calcaire (BRGM)** — à faire
- **H4 pente/exposition (MNT)** — à faire (le filtre altitude actuel est un repli)

> Note : l'essence n'est portée que par la couche **forêts**, pas par les mailles
> de la grille (vue grille = filtre altitude seul).

---


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
