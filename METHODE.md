# Méthode — sur quoi repose le modèle, et ce que le calage vaut

Ce document répond à une question simple : **le modèle est-il validé ?**
Réponse courte : **non, pas au sens statistique**. C'est un modèle de règles
d'expert, dont on a corrigé les erreurs grossières à l'aide de données de présence.
La carte est un **indicateur d'attention** (« va voir par là plutôt que par là »),
pas un prédicteur de récolte.

---

## 1. Les données disponibles

### GBIF (occurrences)
Des **points de présence seulement** : « le 12 octobre 2022, à telle coordonnée,
quelqu'un a photographié un cèpe ». Rien de plus :

- pas de **quantité** trouvée
- pas d'**absence** (« j'ai cherché ici et rien trouvé »)
- pas d'**effort de prospection** (1 personne 10 min vs 5 personnes 3 h)
- biais de report : espèces photogéniques et zones fréquentées sur-représentées ;
  la **truffe** est quasi absente (discrétion des trufficulteurs → 2 obs exploitables
  sur les 6 départements).

C'est la situation classique en modélisation de répartition d'espèces
(MaxEnt, etc.) : on ne dispose que de présences.

### Météo
- **Archive ERA5** (Open-Meteo), 2019 → aujourd'hui, sur la grille de score
  (`data/archive/`, ~90 mois). Sert au rejeu du passé.
- En production : **lame d'eau radar** Météo-France (1 km, cumuls constatés) +
  proxy Open-Meteo pour les jours incomplets.

---

## 2. Ce que le calage teste — et ne teste pas

`geo/calage.mjs` : pour chaque espèce, on rejoue le score du modèle

- **aux observations GBIF** (jour + maille la plus proche), et
- à des **pseudo-absences** : 1000 couples maille/date tirés au hasard dans la
  même saison et les mêmes années.

### Ce que ça teste
> Le jour et à l'endroit où un champignon a effectivement été trouvé, le modèle
> donne-t-il un score **plus élevé** qu'à des points tirés au hasard en saison ?

C'est de la **discrimination présence / bruit de fond**. La métrique principale est
l'**AUC** : probabilité qu'une observation tirée au hasard score plus haut qu'une
pseudo-absence tirée au hasard.

| AUC | Lecture |
|---|---|
| 0.5 | modèle nul (pile ou face) |
| 0.7 | signal acceptable |
| 0.8 | bon |
| 0.9 | excellent |

On regarde aussi la **médiane du score aux observations** (calibration : un vrai
coin doit lire « plausible », pas « défavorable »).

### Ce que ça ne teste PAS
- que le modèle prédit une **quantité** (un score 60 ne vaut pas « deux fois
  mieux » que 30) ;
- une **probabilité absolue** de trouver des champignons ;
- le comportement dans les **conditions rares** (peu ou pas d'obs) ;
- les pseudo-absences **ne sont pas de vraies absences** : un point au hasard
  pouvait aussi porter des champignons que personne n'a notés. Le test **sous-estime**
  donc le modèle, et il est **bruité** (~24 à 107 obs par espèce).

---

## 3. Comment on s'en sert — garde-fou, pas optimisation

**On ne fitte pas** les paramètres pour maximiser l'AUC. Avec 30–100 points et un
modèle à ~10 paramètres par espèce, ce serait du sur-apprentissage pur.

Deux opérations distinctes :

1. **Les seuils viennent de la biologie** — littérature mycologique et connaissance
   de terrain : cèpe = pluie déclenchante + délai ~2 semaines + sol 12–20 °C ;
   girolle = humidité de fond sur 30 j ; truffe = orages juin–août ; morille =
   réchauffement du sol au printemps ; etc. Détail dans `MODELE.md` et
   `docs/modele-cotation.pdf`.

2. **GBIF sert de détecteur d'erreur grossière.** Exemple réel (sept. 2026) : la
   médiane du score aux vraies observations de cèpe était **8/100** — mécaniquement
   absurde. Cause : trop de facteurs multiplicatifs < 1 se composaient. Correction :
   déclencheur élargi 20 → 12 mm (les poussées de cèpes suivent de fait des pluies
   modérées), planchers des modulateurs relevés, normalisation ajustée. Puis
   **vérification que le modèle sépare encore** présences et hasard (sinon on a juste
   tout passé au vert = inutile).

Les petits écarts (AUC 0.71 vs 0.79) sont **dans le bruit** — on n'y touche pas.

### Règle de figeage
Les modèles sont **gelés** à l'état « règles d'expert + correction des erreurs
grossières GBIF ». On ne les retouche que si :
- une erreur de calibration flagrante apparaît (médiane aux obs < 15 ou > 85), ou
- on dispose de **données de terrain** suffisantes (§ 4).

---

## 4. Ce qui validerait vraiment le modèle

Il faut des **absences datées et localisées** et, idéalement, des **quantités**.

- **`data/observations.jsonl`** — alimenté par l'appli (popup d'un point → « j'ai
  trouvé » / « cherché, rien vu »). Les « rien vu » sont de **vraies absences**.
  Rejeu : `node geo/observations.mjs`.
- Un champ **quantité** (rien / quelques-uns / beaucoup / panier) permettrait une
  vraie courbe de calibration score → récolte.
- Le protocole idéal : **même cueilleur, mêmes coins, plusieurs sorties par saison
  sur 1–2 ans**, en notant systématiquement — trouvé ou non, et combien.

Avec ~20–30 observations terrain par espèce (dont des absences), on pourra passer
d'un « le classement a l'air cohérent » à une vraie calibration
(régression, courbe de fiabilité, choix de seuils de couleur justifié).

---

## 5. Résumé

| | État |
|---|---|
| Nature du modèle | règles d'expert, paramétrées à dire d'expert |
| Rôle de GBIF | garde-fou contre les erreurs grossières de calibration |
| Ce qui est établi | le modèle range les vraies observations au-dessus du hasard (AUC ~0.7–0.85 selon l'espèce ; truffe non calable, morille faible sans couche brûlis) |
| Ce qui n'est PAS établi | que les scores reflètent une abondance ou une probabilité réelle |
| Pour valider | collecte terrain (absences + quantités) via l'appli, sur 1–2 saisons |
