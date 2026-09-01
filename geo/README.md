# Phase habitat — couches SIG

Sortie unique : **`web/assets/data/forets-publiques.geojson`** (versionné) — une
Feature par forêt publique ONF des départements de `config.mjs`, propriété `dom`
(true = domaniale, false = communale — toutes sous régime forestier, cueillette
familiale tolérée). Enrichie par les scripts ci-dessous.

| Étape | Script | Ajoute | Source |
|---|---|---|---|
| H0 | `geo/fetch-departements.mjs` | `dep-XX.geojson` (96 dépts) | france-geojson |
| H1 | `geo/fetch-onf.mjs` | périmètres + `dom` | WFS `ONF.FORETS_PUBLIQUES` |
| H2 | `geo/fetch-bdforet.mjs` | `essence` (feuillu/conifere/mixte/autre) | WFS BD Forêt V2 |
| H3 | `geo/fetch-brgm.mjs` | `substrat` (acide/neutre/calcaire) | WFS BRGM litho 1/1M |
| H4 | `geo/fetch-mnt.mjs` | `elev`, `slopeDeg`, `aspect` | API altimétrique Géoplateforme |
| H5 | `geo/fetch-brulis.mjs` | `brulis.geojson` (morilles) | EFFIS/GWIS (Copernicus) WFS + complément manuel |

Enchaînement complet :
```
node geo/fetch-departements.mjs
node geo/fetch-onf.mjs
node geo/fetch-bdforet.mjs
node geo/fetch-brgm.mjs
node geo/fetch-mnt.mjs
node geo/fetch-brulis.mjs
```
~15 min pour ~1000 forêts (6 dépts). À relancer seulement si les sources changent.

## Facteurs habitat (dans `model/species/<id>.mjs → habitat`)

Chaque espèce a ses propres coefficients — ex. le **calcaire** favorise la truffe
(×1) et pénalise le cèpe (×0.55) / la girolle (×0.25). L'exposition ubac/adret
dépend de la sécheresse (versant Nord +18 % max en période sèche).

## Carte

Couche **« Forêts publiques (ONF) »** + case **« domaniales seules »** (par défaut)
pour comparer domaniales / communales. Calque **« Brûlis »** (masqué si vide).

### Brûlis (H5) — détail

`geo/fetch-brulis.mjs` interroge **EFFIS / GWIS** (Copernicus, GeoServer
`maps.effis.emergency.copernicus.eu`) : polygones de surfaces brûlées MODIS
(~depuis 2000) et VIIRS (375 m). Fenêtre par défaut : 20 mois
(`CHAMPI_BRULIS_MONTHS`). Filtre ensuite les feux qui recoupent un des
départements de `config.mjs`.

- Le script log la ligne `champs = …` au 1ᵉʳ lot reçu : si le mapping date/surface
  est faux (noms de champs EFFIS différents), ajuster `DATE_FIELDS` / `AREA_FIELDS`.
- Complément : `geo/brulis-manuel.geojson` (non versionné, voir
  `brulis-manuel.example.geojson`) pour les petits feux sous le seuil satellite.
- Seuls comptent, côté carte, les feux **< 2 ans** (une morille suit le feu au
  printemps n+1) → relancer H5 chaque hiver.

## Étendre la zone

Ajouter les codes dans `collect/config.mjs → departements`, relancer H0 + H1–H5.
Pour la France entière : voir **`SCALE.md`** (collecte radar-first, livraison par tuiles).

## Calage du modèle

```
node geo/backfill-archive.mjs 2019 2025   # historique ERA5 dans data/archive/
node geo/calage.mjs                       # rejeu GBIF vs pseudo-absences
```
