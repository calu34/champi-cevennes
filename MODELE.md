# Modèle « conditions de pousse »

Tous les seuils sont dans **`model/model.mjs` → `DEFAULTS`**. Modifie, relance
`node collect/run.mjs`, recharge la carte.

L'indice final d'une **maille** = `indice météo (0–100)`.
L'indice d'une **forêt domaniale** = `indice météo de sa maille × facteur habitat`.

---

## Variables météo dérivées

Le collecteur fournit, par maille et par jour : pluie, ET0 (évapotranspiration de
référence), T° air moyenne / min / max. Le modèle en dérive :

| Variable | Calcul | Rôle |
|---|---|---|
| `Pevent` | meilleur cumul sur 48 h glissantes dans les 21 derniers jours | **pluie déclenchante** |
| `Devent` | nombre de jours depuis cet épisode | **délai de fructification** |
| `P7 / P15 / P21 / P30` | pluie cumulée sur 7 / 15 / 21 / 30 j | humidité de fond |
| `Tsol` | moyenne mobile exponentielle (~12 j) de la T° air moyenne | **proxy T° du sol à ~18 cm** |
| `dTsol` | `Tsol(J) − Tsol(J−10)` | choc thermique |
| `SM` | bilan `pluie − ET0` accumulé dans un réservoir borné à 80 mm, exprimé en fraction 0–1 | **humidité réellement disponible** (intègre l'évaporation) |
| `ET7` | ET0 cumulée sur 7 j | dessèchement de la semaine |
| `Tmin7` | T° min de l'air sur 7 j | risque de gel |
| `dry` | plus longue série de jours à < 1 mm sur 30 j | sécheresse prolongée |
| `heatPrior` | T° max entre J−20 et J−10 | canicule *avant* l'épisode |

> **Proxy T° sol** : faute de mesure, on lisse la T° de l'air (le sol suit l'air avec
> un retard et un amortissement). `soilEmaDays = 12`. Sera remplacé par la vraie T°
> sol si on l'ajoute au collecteur.

---

## Indice CÈPE

*Un cèpe pousse 10–20 j après une vraie pluie, si le sol est à bonne température et
reste humide.*

| Critère | Variable | Seuils (`cepe.*`) | Effet | Rationnel |
|---|---|---|---|---|
| Pluie déclenchante | `Pevent` | `trigLo 20` → `trigHi 60` mm | 0 sous 20 mm, plein à 60 | le mycélium ne lance une fructification qu'après un apport d'eau net |
| Délai | `Devent` | `lagPeak 14`, `lagSigma 7` j | cloche gaussienne, pic à 14 j ; ×0.2 si ≤ 3 j ; ×0.4 si > 32 j | temps de formation du carpophore ; après ~1 mois la vague est passée |
| Humidité entretenue | `P15` | `p15Lo 30` → `p15Hi 80` mm | facteur 0→1 sur `(0.35 + 0.65·moist)` | une pluie unique suivie de 2 semaines sèches = avortement |
| Température du sol | `Tsol` | trapèze `8 / 13 / 19 / 22` °C | 0 hors [8, 22], plein sur [13, 19] | trop chaud (été) ou trop froid (gel) = pas de fructification |
| Choc thermique | `dTsol` | bonus `+25 %` max si `−dTsol/5` ∈ [0, 1] | le refroidissement après une période chaude est un signal connu |
| Humidité du sol | `SM` | facteur `0.4 + 0.6·SM` | réserve réellement disponible |
| Pénalité gel | `Tmin7` | `−0.5` si < 0 °C, `−0.3` de plus si < −3 °C | le gel détruit les carpophores |
| Pénalité dessèchement | `ET7 − P7` | `−0.35` max, proportionnel sur [0, 25 mm] | vent + chaleur + pas de pluie |
| Pénalité canicule préalable | `heatPrior` | `−0.15` si > 34 °C | stress du mycélium avant l'épisode |

```
raw  = Pevent_scale^0.8 · delai · bande_thermique · (0.35+0.65·moist) · (0.4+0.6·SM) · (1+choc) / 1.25
cepe = clamp( 100 · raw · (1 − min(pénalités, 0.9)), 0, 100 )
```

---

## Indice GIROLLE

*Moins de déclencheur, plus de régularité. La girolle travaille sur des semaines.*

| Critère | Variable | Seuils (`girolle.*`) | Différence avec le cèpe |
|---|---|---|---|
| Humidité longue | `P30` | `p30Lo 40` → `p30Hi 110` mm | répond à une humidité de fond, pas à un coup de pluie |
| Relance récente | `P15` | `p15Lo 15` → `p15Hi 50` mm | il faut juste que ça se maintienne |
| Série sèche | `dry` | `dryLo 12` → `dryHi 25` j (pénalité jusqu'à −70 %) | supporte mal un trou sec prolongé |
| Température du sol | `Tsol` | trapèze `10 / 13 / 20 / 24` °C | bande plus large et plus chaude — sort dès l'été |
| Pénalité gel | `Tmin7` | `−0.4` si < 0 °C | |

Pas de choc thermique, pas de canicule préalable.

```
raw     = (0.5·gm + 0.5·topup) · bande_thermique · (0.4+0.6·SM) · (1 − 0.7·dpen)
girolle = clamp( 100 · raw · (1 − min(gel, 0.9)), 0, 100 )
```

**Indice combiné** = `max(cèpe, girolle)`.

---

## Facteur habitat (couche forêts domaniales uniquement)

Multiplie l'indice météo de la forêt.

| Couche | Source | Facteur |
|---|---|---|
| Essence | BD Forêt V2 | feuillu ×1 · mixte ×0.95 · conifère ×0.85 · lande/ouvert ×0.35 |
| Substrat | BRGM litho 1/1M | acide ×1 · neutre ×0.8 · **calcaire ×0.25** |
| Altitude | MNT | ×0.5 hors [200, 1650] m ; ×0.8 sous 200 m |
| Pente | MNT | ×0.7 si > 30° |
| Exposition | MNT + `dry` | ubac (Nord) `+18 %` max en période sèche, adret (Sud) `−18 %` ; nul si humide |

---

## Calage prévu

Croiser les occurrences GBIF / iNaturalist de *Boletus edulis* et *Cantharellus
cibarius* sur les 6 départements avec la météo des 20 j précédant chaque observation,
pour ajuster les seuils sur des données réelles plutôt qu'à dire d'expert.
