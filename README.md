# Champi-Cévennes — carte des conditions de pousse

Cèpes & girolles sur **6 départements** : Hérault (34), Gard (30), Lozère (48),
Aveyron (12), Ardèche (07), Tarn (81). Carte truffe prévue plus tard (2ᵉ carte).

**Vert = conditions réunies. Rouge = défavorable.**

---

## Deux façons de l'utiliser

### A. Sans rien installer — `carte-champignons.html`
Page autonome, double-clic. Va chercher la météo Open-Meteo au chargement.
Pratique pour un coup d'œil, mais limitée : pluie = proxy modèle ~9 km, et le
quota gratuit Open-Meteo est vite atteint si on recharge souvent. Sources dans
`src/` (modèle v0, indépendant de `model/model.mjs`).

### B. V1 — collecteur + carte (recommandé)
Un petit programme tourne **une fois par jour** sur ton PC, récupère les données,
calcule les indices et écrit un fichier ; la carte lit ce fichier — **aucun appel
d'API depuis le navigateur**, plus de problème de quota. C'est aussi la base pour
brancher la **lame d'eau radar ANTILOPE** et le **filtre habitat**.

---

## Installer la V1

### 1. Node.js
```
winget install OpenJS.NodeJS.LTS
```
(ou installeur depuis nodejs.org). Vérifier : `node --version` ≥ 20.

### 2. Première collecte
Dans le dossier `champi-cevennes` :
```
node collect/run.mjs
```
Écrit `web/data.js` (~600 Ko) et `data/store/series.json`. ~1–2 min.

### 3. Voir la carte
```
scripts\voir-la-carte.cmd
```
Ouvre <http://localhost:8123>. (Un mini serveur local est nécessaire : les
navigateurs bloquent les modules JavaScript ouverts en `file://`.)

### 4. Automatiser (Planificateur de tâches Windows)
- Action : `scripts\collecte-quotidienne.cmd`
- Déclencheur : tous les jours vers 06:00
- « Démarrer dans » : le dossier `champi-cevennes`
- Cocher « Exécuter même si l'utilisateur n'est pas connecté » si besoin

Journal dans `data/collecte.log`.

---

## Lame d'eau radar ANTILOPE

Le proxy Open-Meteo est un dépannage. La vraie donnée est la **lame d'eau radar**
Météo-France (produit ACRR, mosaïque METROPOLE, 1 km, pas de 5 min).

**Le pipeline radar est écrit et testé** :
- `collect/odim.mjs` — décodeur HDF5 ODIM (projection stéréo polaire vérifiée)
- `collect/poller.mjs` — une passe : télécharge la dernière trame 5 min, échantillonne
  la grille, cumule dans `data/store/radar/<date>.json`
- `collect/run.mjs` — quand un jour atteint ~258/288 passes, sa pluie proxy est
  remplacée par le cumul radar. Transition automatique, jour par jour.

L'API ne sert **que la dernière trame 5 min** → il faut un **poller permanent**.
D'où le déploiement sur un petit VPS : voir **`deploy/DEPLOY.md`**.

Config : `CHAMPI_SOURCE=antilope` + `CHAMPI_MF_APPID=<APPLICATION_ID>` (OAuth2,
renouvellement automatique) dans `/etc/champi.env`.

---

## Filtre habitat

Pour l'instant : altitude seule (repli). La V1 complète — **BD Forêt V2 (essence)
+ forêts domaniales ONF + substrat acide/calcaire BRGM + pente/exposition MNT** —
est décrite dans **`geo/README.md`** (téléchargements + script d'ingestion à écrire).
Le zonage passera alors de la maille à la **parcelle forestière ONF**.

---

## Structure

```
model/model.mjs        modèle partagé (collecteur ET carte) — seuils, indices, couleurs
collect/
  config.mjs           emprise, grille, chemins, options habitat
  run.mjs              orchestrateur quotidien (proxy + fusion radar → data.js)
  poller.mjs           une passe radar 5 min (piloté par timer systemd)
  odim.mjs             décodeur HDF5 ODIM de la lame d'eau
  openmeteo.mjs        source proxy (pluie + T° + ET0)
  antilope.mjs         accès API radar Météo-France (token OAuth2)
  discover-radar.mjs   vérifier l'accès / le catalogue
  serve.mjs            serveur statique de la carte
  lib.mjs              grille, masque départements, i/o
deploy/                unités systemd + DEPLOY.md (VPS)
web/
  index.html app.mjs style.css      la carte V1 (lit data.js)
  data.js                           généré par le collecteur
  model.mjs                          copie de model/model.mjs
  assets/                            leaflet + geojson départements
data/store/            historique des séries (accumulation ANTILOPE)
geo/                   phase habitat SIG (à faire)
scripts/               .cmd pour le Planificateur de tâches
```

> `web/model.mjs` est une copie de `model/model.mjs`. Après modif du modèle :
> `copy model\model.mjs web\model.mjs` (ou faire de `web/` un lien).

## Régler le modèle

Tous les seuils sont dans `model/model.mjs` → `DEFAULTS` (déclencheur pluie, délai
de fructification, bandes de température du sol, pénalités…). Modifie, relance
`node collect/run.mjs`, recharge la carte.

Calage à venir : occurrences GBIF / iNaturalist des espèces sur les 6 départements
croisées avec la météo des 20 j précédant chaque observation.

## Tester (sans navigateur)

```
node src/test.mjs           # géométrie + modèle sur données réelles
FULL=1 node src/test.mjs    # + rejeu archive automne 2025
```
