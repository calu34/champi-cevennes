# Étendre à la France entière

L'architecture est prête ; il reste surtout des choix d'échelle sur la collecte
météo et la livraison des données.

## Ce qui marche déjà tel quel

- `collect/config.mjs` → `departements` : une seule liste. Le bbox de travail est
  calculé automatiquement (union des contours).
- `web/assets/data/dep-XX.geojson` : les **96 départements** métropolitains sont
  présents (`node geo/fetch-departements.mjs`).
- Couches habitat (`geo/fetch-onf|bdforet|brgm|mnt.mjs`) : bouclent sur la liste des
  départements — il suffit de relancer (plus long : ~96 dépts de WFS).
- Modèle, archive, carte : indépendants du nombre de mailles.

## Les deux points durs

### 1. Collecte météo (pluie + T° + ET0)

| | 6 dépts (0.11°) | France (0.11°) |
|---|---|---|
| mailles | ~350 | ~5 500 |
| appels Open-Meteo / jour | ~350 | ~5 500 → **hors quota gratuit** (600/min, 10 000/j) |

**Solutions :**
- **Radar d'abord** : la mosaïque ANTILOPE couvre toute la métropole en **un seul
  téléchargement** (2 Mo). Le poller échantillonne déjà n'importe quelle grille sans
  surcoût. → la pluie passe en radar-only sur toute la France.
- Open-Meteo ne sert alors plus que pour **T° air / ET0** : grille plus grossière
  (0.25°, ~1 100 pts) suffit, et se met en cache (peu de variation spatiale).
- ou **self-host Open-Meteo** (image Docker officielle) : quota illimité.

### 2. Livraison à la carte

`web/data.js` = mailles × jours × 5 variables. À 0.11° France + 95 j → ~15 Mo :
trop lourd pour le navigateur.

**Solutions :**
- **Scoring côté serveur** : le collecteur calcule les indices par espèce/jour/maille
  et n'expédie que les scores (÷ ~5 en volume), voire des **tuiles vectorielles**
  (`tippecanoe`, `pg_tileserv`).
- **Chargement par région** : la carte demande les mailles de l'emprise visible.
- La couche forêts reste légère (déjà par département).

## Ordre conseillé

1. Passer le collecteur en **radar-first** (pluie = ANTILOPE, Open-Meteo = T°/ET0 sur
   grille grossière). Testable sur les 6 dépts.
2. Étendre `departements` région par région (ex. tout le Sud-Est) en vérifiant les
   temps de collecte habitat.
3. Quand `data.js` dépasse ~3 Mo : scoring serveur + tuiles ou chargement régional.
