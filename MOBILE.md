# Vers l'application mobile

L'objectif : la même donnée et le même modèle qu'aujourd'hui, consommables par une
app. Rien n'est spécifique à un framework — le modèle (`model/`) tourne déjà à
l'identique en Node et dans un navigateur.

## Ce qui est en place

### 1. API JSON (générée par `collect/run.mjs`, servie par `collect/serve.mjs`)

| Endpoint | Contenu | Taille |
|---|---|---|
| `api/meta.json` | version de schéma, date, départements, liste d'espèces, table des endpoints | ~0.5 Ko |
| `api/now.json` | **instantané au jour J** : par maille, score météo 0–100 de chaque espèce + meilleure espèce | ~1 Ko / 100 mailles |
| `api/latest.json` | **série complète** ~95 j (curseur temporel) : identique à `window.CHAMPI`, en JSON pur, champ `schema` | ~200 Ko / 350 mailles |
| `assets/data/forets-publiques.geojson` | périmètres forêts ONF enrichis (essence, substrat, alti/pente/expo, `dom`) | ~900 Ko |
| `assets/data/brulis.geojson` | périmètres de feux récents (morilles) | variable |
| `assets/data/dep-XX.geojson` | contours départements | — |

- **CORS ouvert** (`Access-Control-Allow-Origin: *`) — données publiques en lecture seule.
- Cache : `max-age=300` sur le JSON, `3600` sur la coquille.
- Le collecteur écrit ces fichiers à chaque passage (05:30) ; `web/api/` est gitignore
  (regénéré), comme `web/data.js`.

### 2. Schéma `now.json`

```jsonc
{
  "schema": 1,
  "generated": "2026-09-01T05:32:00Z",
  "source": "antilope+proxy (radar : 3 j, …)",
  "day": "2026-09-01",
  "especes": [
    { "id": "cepe", "nom": "Cèpe", "saison": [6,7,8,9,10,11], "enSaison": true },
    …
  ],
  "cells": [
    { "id": "44.1_3.5", "lat": 44.1, "lon": 3.5, "dep": "30", "elev": 612,
      "scores": { "cepe": 41, "girolle": 33, "pdm": 0, "trompette": 0,
                  "ctube": 0, "sanguin": 12, "truffe": 27, "morille": 0 },
      "best": { "id": "cepe", "v": 41 } }
  ]
}
```

`scores` = **score météo pur** (pas de facteur habitat, qui est propre à chaque
forêt). Pour l'indice affiné d'une forêt : `latest.json` + `model/model.mjs`
(`habitatFactor`, `expositionFactor`) côté client, comme le fait `web/app.mjs`.

### 3. PWA (installable)

`web/manifest.webmanifest` + `web/sw.js` : la carte s'installe sur l'écran d'accueil
(Android/iOS) et fonctionne hors-ligne (dernières données en cache — *network-first*
sur les données, *cache-first* sur la coquille). Bumper `CACHE` dans `sw.js` à chaque
changement de coquille.

**Prérequis : servir en HTTPS** — voir [`deploy/caddy.md`](deploy/caddy.md). Une PWA
ne s'installe pas sur `http://` ni via le tunnel SSH.

Icônes : `assets/icon-{180,192,512}.png` (générées) + `icon.svg`. `icon-180.png` =
apple-touch-icon (iOS ignore le SVG pour l'écran d'accueil).

### Installer sur iPhone (détaillé)

1. Le serveur doit être en **HTTPS** avec un vrai nom de domaine (`deploy/caddy.md`).
2. Ouvrir l'URL **dans Safari** (pas Chrome — sur iOS seul Safari installe une PWA).
3. Barre du bas → bouton **Partager** (carré avec flèche vers le haut).
4. Faire défiler → **« Sur l'écran d'accueil »**.
5. Garder le nom « Champi Cévennes » → **Ajouter** (en haut à droite).
6. L'icône apparaît sur l'écran d'accueil ; l'ouvrir → plein écran, sans barre Safari.

Réglages iOS utiles :
- Au 1ᵉʳ 📍 : iOS demande la localisation → **« Autoriser quand l'app est active »**.
- Pour que les photos soient géolocalisées : *Réglages → Confidentialité → Service de
  localisation → Appareil photo → « Lorsque l'app est active »*.
- Pour le bouton 🖼️ : choisir la photo **depuis la photothèque** (les photos prises
  dans une page web perdent le GPS).
- iOS peut purger le stockage d'une PWA après ~7 j d'inactivité → utiliser
  **⇅ export** de temps en temps, ou l'envoi au serveur (ci-dessous).

Android / Chrome : ouvrir l'URL → menu ⋮ → **« Installer l'application »**.

### Contribuer au calage (envoi d'observations)

Dans le popup d'un point : *« Aider à caler le modèle »* → **j'ai trouvé** / **cherché,
rien vu** → **📤 envoyer**. POST `api/observ` (JSON, photo en vignette).
Le serveur (`serve.mjs`) ajoute une ligne à `data/observations.jsonl` + la photo dans
`data/observations/` (gitignore, VPS-only). Hors-ligne → file d'attente locale,
renvoyée automatiquement au retour du réseau.

- Clé partagée optionnelle : `CHAMPI_OBSERV_KEY` dans l'environnement du service
  (sinon endpoint ouvert — acceptable derrière une URL peu devinable / basic_auth).
- Rejeu : `node geo/observations.mjs` — compare les scores aux « trouvé » vs « rien
  vu » vs pseudo-absences. Les « rien vu » sont les données les plus précieuses.

### 4. Points personnels (`web/points.mjs`)

Coins à champignons, **stockés sur l'appareil** (localStorage + IndexedDB pour les
vignettes), jamais envoyés. Boutons en bas à droite de la carte :

| | |
|---|---|
| 📍 | marque la **position GPS** actuelle (`navigator.geolocation`) |
| 📌 | mode « poser un point » : touche la carte |
| 🖼️ | **photo géolocalisée** : lit les coordonnées EXIF GPS (parseur maison, sans lib) et pose le point ; garde une vignette 640 px. Choisir *depuis la galerie* — les photos prises via `<input capture>` perdent souvent le GPS. |
| ⇅ | export / import `.geojson` (fusion par `id`) |

Chaque point : nom, espèce, note, date, vignette, **et le score météo du jour à cet
endroit** (maille la plus proche). Popup éditable, suppression.

Synchro vers le VPS : faite (voir « Contribuer au calage »). Évolutions restantes :
tri par distance / « autour de moi », vue liste.

## Ce qui reste pour une vraie app

1. **Géoloc + « autour de moi »** : trier `now.json` par distance, afficher la
   meilleure espèce et les 3 meilleures mailles proches. (données déjà suffisantes ;
   la géoloc est déjà branchée pour les points perso)
2. **Notifications** : le collecteur détecte un passage de maille sous/au-dessus d'un
   seuil (déjà loggé dans `run.mjs` étape 5) → push. Nécessite un petit backend push
   (ou un service tiers) ; les données de déclenchement existent.
3. **Choix du rendu** :
   - **PWA enrichie** (le plus court) : garder `web/`, ajouter vue liste + géoloc.
   - **React Native / Expo** : réutiliser `model/` tel quel (ES modules purs), carte
     via `react-native-maps` ou MapLibre, fetch des mêmes endpoints.
4. **France entière** : `now.json` passe à ~5 500 mailles (~50 Ko gzip) — OK pour
   mobile ; `latest.json` devient trop lourd → livraison par tuiles (voir `SCALE.md`).
5. **Auth / quotas** : aucune pour l'instant (lecture seule publique). À revoir si
   ouverture large.

## Servir en production

`collect/serve.mjs` écoute `127.0.0.1:8123` (unit `champi-web`). Pour exposer l'API
à une app : reverse-proxy HTTPS (Caddy/nginx) devant le port 8123, ou publier
`web/` sur un CDN et n'y pousser que les fichiers générés.
