/* Génère docs/modele-cotation.pdf — résumé du modèle de cotation, par espèce :
 * critères pris en compte, seuils, et poids (effet maximal sur le score).
 *
 *   cd docs && npm i pdfkit && node make-model-pdf.mjs
 *
 * pdfkit n'est PAS une dépendance du projet (doc uniquement). À relancer quand
 * les seuils dans model/species/*.mjs changent, en reportant les valeurs à jour
 * dans la table SPECIES ci-dessous.
 */
import PDFDocument from 'pdfkit';
import fs from 'node:fs';

const OUT = process.argv[2] || 'modele-cotation.pdf';
const GREEN = '#1b5e20', GREY = '#555', LIGHT = '#f2f2ef', RULE = '#cccccc';

const doc = new PDFDocument({ size: 'A4', margins: { top: 54, bottom: 54, left: 54, right: 54 }, bufferPages: true });
doc.pipe(fs.createWriteStream(OUT));
const W = doc.page.width - 108;

/* ---------- helpers ---------- */
function h1(t) { doc.moveDown(0.4); doc.fillColor(GREEN).font('Helvetica-Bold').fontSize(17).text(t); doc.fillColor('black'); doc.moveDown(0.3); }
function h2(t) { doc.moveDown(0.5); doc.fillColor(GREEN).font('Helvetica-Bold').fontSize(12.5).text(t); doc.fillColor('black').moveDown(0.15); }
function p(t, o = {}) { doc.font('Helvetica').fontSize(9.5).fillColor(o.color || 'black').text(t, { lineGap: 1.5, ...o }); }
function small(t) { doc.font('Helvetica').fontSize(8.5).fillColor(GREY).text(t, { lineGap: 1 }); doc.fillColor('black'); }

function table(cols, rows, opts = {}) {
  const widths = cols.map(c => c.w * W);
  const pad = 5;
  const startX = doc.x;
  let y = doc.y + 2;

  const rowHeight = (cells, font, size) => {
    doc.font(font).fontSize(size);
    return Math.max(...cells.map((txt, i) => doc.heightOfString(String(txt), { width: widths[i] - 2 * pad, lineGap: 1 }))) + 2 * pad;
  };
  const draw = (cells, font, size, fill) => {
    const hgt = rowHeight(cells, font, size);
    if (y + hgt > doc.page.height - 54) { doc.addPage(); y = 54; }
    if (fill) { doc.rect(startX, y, widths.reduce((a, b) => a + b), hgt).fill(fill); }
    let x = startX;
    doc.font(font).fontSize(size).fillColor('black');
    cells.forEach((txt, i) => {
      doc.text(String(txt), x + pad, y + pad, { width: widths[i] - 2 * pad, lineGap: 1 });
      x += widths[i];
    });
    doc.moveTo(startX, y + hgt).lineTo(startX + widths.reduce((a, b) => a + b), y + hgt).strokeColor(RULE).lineWidth(0.5).stroke();
    y += hgt;
  };

  draw(cols.map(c => c.t), 'Helvetica-Bold', 8.5, LIGHT);
  rows.forEach(r => draw(r, 'Helvetica', 8.5, null));
  doc.x = startX; doc.y = y + 6;
}

/* ---------- données ---------- */
const GENERAL = {
  intro: [
    "Indice 0 à 100 par zone. Vert = conditions météo réunies, rouge = défavorable. " +
    "Un indice élevé ne garantit pas la présence du champignon : il dit que la météo récente est compatible avec une fructification.",
    "Deux échelles : l'indice d'une MAILLE = score météo x facteur altitude ; l'indice d'une FORÊT publique = " +
    "score météo x facteur habitat (essence x substrat x altitude/pente x exposition), propre à chaque espèce.",
    "Source de pluie : lame d'eau radar Météo-France (1 km, cumuls constatés) ; proxy Open-Meteo (~9 km) pour les jours incomplets. " +
    "Le mode « Auto » de la carte affiche la meilleure espèce en saison au jour choisi.",
  ],
  vars: [
    ['Tsol', "proxy de la température du sol vers 18 cm : moyenne mobile exponentielle (~12 j) de la T° de l'air moyenne. Le sol suit l'air avec retard et amortissement."],
    ['Humidité du sol', "bilan pluie - ET0 (évapotranspiration de référence) accumulé dans un réservoir borné à 80 mm, exprimé en fraction 0-1. Intègre l'évaporation, pas seulement la pluie."],
    ['Épisode déclenchant', "meilleur cumul sur 48 h glissantes dans la fenêtre récente. Le mycélium ne lance une fructification qu'après un apport d'eau net."],
    ['Délai', "nombre de jours écoulés depuis cet épisode - temps de formation du carpophore."],
    ['Série sèche', "plus longue suite de jours à moins de 1 mm sur 25-30 j."],
    ['Bande thermique', "trapèze a / b / c / d : 0 sous a, montée a->b, plateau optimal b->c, descente c->d, 0 au-delà de d."],
  ],
  poids: [
    ['Porte thermique / de pluie', "facteur multiplicatif qui peut valoir 0. S'il est nul (hors bande de T°, pas d'épisode de pluie), le score de l'espèce est nul quel que soit le reste."],
    ['Modulateur -X %', "facteur de la forme (a + b·x) : peut réduire le score jusqu'à X %, jamais l'annuler."],
    ['Pénalité -X %', "retranche jusqu'à X % au score final (gel, dessèchement, canicule). Les pénalités se cumulent, plafonnées."],
    ['Bonus +X %', "augmente le score (choc thermique favorable)."],
  ],
};

const SPECIES = [
  {
    nom: 'Cèpe', latin: 'Boletus edulis / aereus / pinophilus / aestivalis',
    saison: 'juin -> novembre', fenetre: '35 jours glissants',
    bio: "Pousse 10 à 20 jours après une pluie franche, si le sol est à bonne température et reste humide les deux semaines suivantes. Une pluie unique suivie de sec = avortement.",
    habitat: [
      ['Essence', 'feuillu x1  -  mixte x0.95  -  conifère x0.85  -  lande/ouvert x0.35'],
      ['Substrat', 'acide x1  -  neutre x0.85  -  calcaire x0.55'],
      ['Altitude', '150 - 1700 m (x0.5 hors bornes, x0.85 juste au-dessus du plancher)'],
      ['Pente', 'x0.7 au-delà de 32°'],
      ['Exposition', 'versant nord (ubac) +18 % max en période sèche ; sud -18 %'],
    ],
    criteres: [
      ['Pluie déclenchante', 'meilleur cumul 48 h des 21 derniers jours ; nul sous 12 mm, plein à 45 mm', 'Porte (courbe trig^0.7)'],
      ['Délai depuis l\'épisode', 'cloche centrée sur 14 j (écart-type 10) ; x0.35 si <= 3 j, x0.5 si > 38 j', 'Porte (nul si trop récent ou > 5 semaines)'],
      ['Humidité entretenue', 'pluie des 15 j : 12 -> 45 mm', 'Modulateur -50 %'],
      ['Température du sol', 'trapèze 8 / 12 / 20 / 23 °C', 'Porte thermique'],
      ['Choc thermique', 'refroidissement de 2 à 6 °C sur 10 j', 'Bonus +25 % max'],
      ['Pénalité gel', 'T° min 7 j < 0 °C : -50 % ; < -3 °C : -30 % de plus', 'Pénalité'],
      ['Pénalité dessèchement', 'ET0 - pluie sur 7 j, de 0 à 25 mm', 'Pénalité -35 % max'],
      ['Pénalité canicule', 'T° max entre J-20 et J-10 > 34 °C', 'Pénalité -15 %'],
    ],
    calage: 'Recalé sur GBIF 2019-2025 : les seuils d\'origine sous-cotaient les vraies observations (médiane 8/100). Seuils élargis, planchers relevés.',
    formule: 'raw = trig^0.7 x délai x bande° x (0.5 + 0.5·hum15) x (0.55 + 0.45·humSol) x (1 + choc)   ;   score = 100·raw x (1 - pénalités, plafond -90 %)',
  },
  {
    nom: 'Girolle', latin: 'Cantharellus cibarius',
    saison: 'juin -> novembre', fenetre: '45 jours glissants',
    bio: "Moins de déclencheur, plus de régularité : la girolle travaille sur des semaines d'humidité de fond. Sort dès l'été et supporte mal les trous secs prolongés.",
    habitat: [
      ['Essence', 'feuillu x1  -  mixte x0.95  -  conifère x0.9  -  lande x0.35'],
      ['Substrat', 'acide x1  -  neutre x0.8  -  calcaire x0.25 (nettement calcifuge)'],
      ['Altitude', '200 - 1650 m'],
      ['Pente', 'x0.7 au-delà de 32°'],
      ['Exposition', 'ubac +18 % max en période sèche'],
    ],
    criteres: [
      ['Humidité de fond', 'pluie des 30 j : 40 -> 110 mm', 'Moteur pluie, poids 50 %'],
      ['Relance récente', 'pluie des 15 j : 15 -> 50 mm', 'Moteur pluie, poids 50 %'],
      ['Série sèche', 'pénalité de 12 j (début) à 25 j (max) sans pluie', 'Modulateur -70 % max'],
      ['Température du sol', 'trapèze 10 / 13 / 20 / 24 °C (bande large et chaude)', 'Porte thermique'],
      ['Gel', 'T° min 7 j < 0 °C', 'Pénalité -40 %'],
    ],
    formule: 'raw = (0.5·fond + 0.5·relance) x bande° x (0.4 + 0.6·humSol) x (1 - 0.7·sécheresse)   ;   score = 100·raw x (1 - gel)',
  },
  {
    nom: 'Pied-de-mouton', latin: 'Hydnum repandum / rufescens',
    saison: 'septembre -> décembre', fenetre: '40 jours glissants',
    bio: "Espèce d'arrière-saison, la plus tolérante à la sécheresse et au froid. Sort quand cèpes et girolles sont finis et tient jusqu'aux gelées. Mycorhizien de feuillus comme de conifères, peu exigeant.",
    habitat: [
      ['Essence', 'feuillu x1  -  mixte x1  -  conifère x0.9  -  lande x0.3'],
      ['Substrat', 'acide x1  -  neutre x0.9  -  calcaire x0.7'],
      ['Altitude', '150 - 1650 m'],
      ['Pente', 'x0.7 au-delà de 32°'],
      ['Exposition', 'ubac +18 % max en période sèche'],
    ],
    criteres: [
      ['Pluie déclenchante', 'meilleur cumul 48 h des 28 derniers jours ; nul sous 15 mm, plein à 55', 'Moteur -65 % (n\'annule pas)'],
      ['Délai', 'triangle large centré sur 16 j (+/- 22 j), plancher 15 % ; 35 % si <= 4 j', 'Porte douce (min 15 %)'],
      ['Humidité de fond', 'pluie des 30 j : 35 -> 100 mm', 'Modulateur -60 %'],
      ['Température du sol', 'trapèze 3 / 7 / 14 / 19 °C (bande fraîche)', 'Porte thermique'],
      ['Humidité du sol', 'réservoir pluie - ET0', 'Modulateur -50 %'],
      ['Série sèche', 'pénalité de 18 j à 36 j sans pluie', 'Modulateur -55 % max (très tolérant)'],
      ['Gel', 'T° min 7 j < -1 °C : -15 % ; < -5 °C : -40 %', 'Pénalité'],
    ],
    formule: 'raw = (0.35 + 0.65·pluie) x délai x bande° x (0.4 + 0.6·hum30) x (0.5 + 0.5·humSol) x (1 - 0.55·sécheresse)   ;   score = 100·raw x (1 - gel)',
  },
  {
    nom: 'Trompette de la mort', latin: 'Craterellus cornucopioides',
    saison: 'septembre -> novembre (surtout octobre)', fenetre: '40 jours glissants',
    bio: "Comme la girolle : humidité entretenue de la litière plutôt qu'un épisode brutal. Pousse en troupes dans les feuillus des vallons frais et ombragés. Très sensible aux trous secs.",
    habitat: [
      ['Essence', 'feuillu x1  -  mixte x0.7  -  conifère x0.15  -  lande x0.2'],
      ['Substrat', 'neutre x1  -  calcaire x0.9  -  acide x0.75'],
      ['Altitude', '100 - 1350 m'],
      ['Pente', 'x0.7 au-delà de 25° (préfère les fonds plats)'],
      ['Exposition', 'ubac +18 % max en période sèche'],
    ],
    criteres: [
      ['Humidité de fond', 'pluie des 30 j : 45 -> 125 mm', 'Moteur pluie (poids 45 %)'],
      ['Relance récente', 'pluie des 15 j : 18 -> 55 mm', 'Moteur pluie (poids 30 %)'],
      ['Régularité', 'nombre de jours de pluie > 3 mm sur 20 j : 3 -> 8', 'Moteur pluie (poids 25 %)'],
      ['Température du sol', 'trapèze 6 / 9 / 16 / 20 °C', 'Porte thermique'],
      ['Humidité du sol', 'réservoir pluie - ET0', 'Modulateur -65 %'],
      ['Série sèche', 'pénalité dès 9 j, maximale à 19 j sans pluie', 'Modulateur -75 % max'],
      ['Gel', 'T° min 7 j < -1 °C', 'Pénalité -40 %'],
    ],
    formule: 'raw = (0.45·fond + 0.30·relance + 0.25·régularité) x bande° x (0.35 + 0.65·humSol) x (1 - 0.75·sécheresse)   ;   score = 100·raw x (1 - gel)',
  },
  {
    nom: 'Chanterelle en tube', latin: 'Craterellus tubaeformis (girolle grise)',
    saison: 'octobre -> janvier', fenetre: '45 jours glissants',
    bio: "La plus tardive et la plus rustique : traverse les premières gelées. Conifères moussus, sols acides frais, souvent en montagne.",
    habitat: [
      ['Essence', 'conifère x1  -  mixte x0.9  -  feuillu x0.55  -  lande x0.3'],
      ['Substrat', 'acide x1  -  neutre x0.7  -  calcaire x0.3'],
      ['Altitude', '300 - 1750 m'],
      ['Pente', 'x0.7 au-delà de 34°'],
      ['Exposition', 'non prise en compte'],
    ],
    criteres: [
      ['Humidité de fond', 'pluie des 30 j : 40 -> 115 mm', 'Moteur pluie (poids 60 %)'],
      ['Relance récente', 'pluie des 15 j : 12 -> 45 mm', 'Moteur pluie (poids 40 %)'],
      ['Température du sol', 'trapèze 0 / 4 / 11 / 16 °C (bande froide)', 'Porte thermique'],
      ['Humidité du sol', 'réservoir pluie - ET0', 'Modulateur -60 %'],
      ['Série sèche', 'pénalité de 16 j à 32 j sans pluie', 'Modulateur -50 % max'],
      ['Gel', 'T° min 7 j < -5 °C : -20 % ; < -9 °C : -50 %', 'Pénalité (très rustique)'],
    ],
    formule: 'raw = (0.6·fond + 0.4·relance) x bande° x (0.4 + 0.6·humSol) x (1 - 0.5·sécheresse)   ;   score = 100·raw x (1 - gel)',
  },
  {
    nom: 'Sanguin', latin: 'Lactarius deliciosus / sanguifluus / semisanguifluus',
    saison: 'septembre -> décembre', fenetre: '38 jours glissants',
    bio: "Champignon des pinèdes méditerranéennes (causses et garrigues du Gard et de l'Hérault). Sort environ deux semaines après les premières vraies pluies d'automne.",
    habitat: [
      ['Essence', 'conifère x1  -  mixte x0.6  -  feuillu x0.08  -  lande x0.25'],
      ['Substrat', 'calcaire x1  -  neutre x1  -  acide x0.9'],
      ['Altitude', '40 - 1500 m'],
      ['Pente', 'x0.7 au-delà de 32°'],
      ['Exposition', 'ubac +18 % max en période sèche'],
    ],
    criteres: [
      ['Pluie déclenchante', 'meilleur cumul 48 h des 24 derniers jours ; nul sous 13 mm, plein à 46', 'Porte (courbe trig^0.75)'],
      ['Délai', 'triangle centré sur 13 j (+/- 12 j), plancher 20 % ; 35 % si <= 3 j ; x0.5 si > 34 j', 'Porte'],
      ['Humidité entretenue', 'pluie des 15 j : 14 -> 52 mm', 'Modulateur -50 %'],
      ['Température du sol', 'trapèze 7 / 11 / 18 / 23 °C (automne doux méditerranéen)', 'Porte thermique'],
      ['Humidité du sol', 'réservoir pluie - ET0', 'Modulateur -50 %'],
      ['Série sèche', 'pénalité de 16 j à 30 j sans pluie', 'Modulateur -50 % max'],
      ['Pénalité dessèchement', 'ET0 - pluie sur 7 j', 'Pénalité -30 % max'],
      ['Pénalité gel', 'T° min 7 j < -2 °C', 'Pénalité -35 %'],
    ],
    calage: 'Déclencheur adouci sur GBIF 2019-2025 : une observation sur quatre sortait à zéro (le meilleur épisode 48 h y était sous 22 mm).',
    formule: 'raw = trig^0.75 x délai x bande° x (0.5 + 0.5·hum15) x (0.5 + 0.5·humSol) x (1 - 0.5·sécheresse)   ;   score = 100·raw x (1 - pénalités, plafond -85 %)',
  },
  {
    nom: 'Truffe noire', latin: 'Tuber melanosporum',
    saison: 'potentiel connu dès septembre ; récolte novembre -> mars',
    fenetre: 'fenêtre calendaire FIXE : 1er juin -> 31 août de l\'été concerné (pas glissante)',
    bio: "Le potentiel de la récolte hivernale se joue sur les pluies d'orage de l'été (grossissement juin-août). L'indice évalue donc tout l'été écoulé, quel que soit le jour de consultation. Le champ « fiabilité » indique la couverture réelle de l'été par les données.",
    habitat: [
      ['Essence', 'feuillu x1 (chêne pubescent / vert, noisetier)  -  mixte x0.6  -  conifère x0.1  -  lande x0.2'],
      ['Substrat', 'calcaire x1  -  neutre x0.5  -  acide x0.1 (exigence calcaire stricte - causses)'],
      ['Altitude', '80 - 1000 m'],
      ['Pente', 'x0.7 au-delà de 35°'],
      ['Exposition', 'non prise en compte (plutôt adret ensoleillé)'],
    ],
    criteres: [
      ['Pluie d\'été', 'cumul 1er juin -> 31 août ; trapèze 25 / 60 / 130 / 260 mm', 'Porte (nul sous ~25 mm ou au-delà de 260 mm)'],
      ['Régularité des orages', 'nombre de jours à >= 10 mm : (n - 1) / 3, plein à 4 orages', 'Modulateur -60 %'],
      ['Trou sec estival', 'plus longue série sèche ; au-delà de 21 j, chute linéaire jusqu\'à 0 à 42 j', 'Porte'],
      ['Stress chaleur', 'jours à > 33 °C en période sèche : 1 - n / 20, plancher 25 %', 'Modulateur -75 % max'],
      ['Fiabilité (conf)', 'couverture de l\'été par les données / 85 j', 'Indicateur (hors score)'],
    ],
    formule: 'raw = eau_été x (0.4 + 0.6·régularité) x trou_sec x stress_chaleur   ;   score = 100·raw   (aucune pénalité gel : tout se joue en été)',
  },
  {
    nom: 'Morille', latin: 'Morchella esculenta / elata',
    saison: 'mars -> mai', fenetre: '40 jours glissants',
    bio: "Champignon de printemps. Le déclencheur n'est pas le niveau de température mais sa DYNAMIQUE : un sol qui se réchauffe et franchit 9-14 °C, sur une réserve hydrique de sortie d'hiver.",
    habitat: [
      ['Essence', 'lande / sol nu x0.9  -  feuillu x0.8 (frêne)  -  mixte x0.7  -  conifère x0.35'],
      ['Substrat', 'calcaire x1  -  neutre x0.9  -  acide x0.6'],
      ['Altitude', '80 - 1400 m'],
      ['Pente', 'x0.7 au-delà de 30°'],
      ['Exposition', 'non prise en compte'],
      ['Couches manquantes', 'brûlis de l\'année n-1 (x2.2 sur les forêts recoupant un feu < 2 ans, si la couche est chargée), ripisylve, frênaie'],
    ],
    criteres: [
      ['Température du sol', 'trapèze 5 / 9 / 13 / 16 °C (fenêtre resserrée)', 'Porte thermique'],
      ['Réchauffement du sol', 'hausse de Tsol sur 14 j, plein à +2.5 °C', 'Moteur -80 % (c\'est la dynamique qui déclenche)'],
      ['Réserve hydrique', 'pluie des 30 j : 20 -> 65 mm', 'Modulateur -65 %'],
      ['Humidité du sol', 'réservoir pluie - ET0', 'Modulateur -50 %'],
      ['Amplitude jour / nuit', 'écart T° max - min sur 7 j : 7 -> 15 °C', 'Modulateur -25 %'],
      ['Gel', 'T° min 7 j < -2 °C', 'Pénalité -50 %'],
    ],
    calage: 'Séparation faible (63 %) au calage GBIF : la morille dépend surtout d\'un habitat (brûlis n-1, frênaie, ripisylve) pas encore cartographié. Fenêtre resserrée et poids accru sur la dynamique de réchauffement pour tirer un peu de signal.',
    formule: 'raw = bande° x (0.2 + 0.8·réchauffement) x (0.35 + 0.65·pluie30) x (0.5 + 0.5·humSol) x (0.75 + 0.25·amplitude)   ;   score = 100·raw x (1 - gel)',
  },
];

/* ---------- page de garde ---------- */
doc.fillColor(GREEN).font('Helvetica-Bold').fontSize(24).text('Modèle de cotation', { align: 'left' });
doc.fillColor('black').font('Helvetica').fontSize(13).text('Conditions de pousse des champignons - Cévennes & Sud-Massif central');
doc.moveDown(0.4);
small('Hérault (34) - Gard (30) - Lozère (48) - Aveyron (12) - Ardèche (07) - Tarn (81)   |   version 1   |   ' + new Date().toLocaleDateString('fr-FR'));
doc.moveDown(1);

h2('Lecture de l\'indice');
GENERAL.intro.forEach(t => { p(t); doc.moveDown(0.25); });

h2('Variables météo dérivées');
table(
  [{ t: 'Variable', w: 0.24 }, { t: 'Définition', w: 0.76 }],
  GENERAL.vars,
);

h2('Ce que signifie le « poids » d\'un critère');
p("Le modèle est MULTIPLICATIF, pas une somme pondérée : les facteurs se multiplient. Le poids indiqué pour chaque critère est donc son effet maximal sur le score, selon quatre types :");
doc.moveDown(0.2);
table(
  [{ t: 'Type', w: 0.28 }, { t: 'Effet', w: 0.72 }],
  GENERAL.poids,
);

doc.addPage();
h1('Calage sur observations GBIF (2019-2025)');
p("Rejeu du modèle sur les occurrences GBIF passées contre des tirages au hasard en saison (pseudo-absences). Métrique : % des observations dont le score dépasse la médiane « au hasard » — 50 % = modèle nul, > 70 % = bon signal.");
doc.moveDown(0.2);
table(
  [{ t: 'Espèce', w: 0.24 }, { t: 'n obs', w: 0.12 }, { t: 'Score obs (méd)', w: 0.22 }, { t: 'Séparation', w: 0.16 }, { t: 'Suite', w: 0.26 }],
  [
    ['Cèpe', '107', '8 -> recalé', '79 %', 'seuils élargis'],
    ['Girolle', '89', '46', '78 %', 'OK'],
    ['Pied-de-mouton', '51', '44', '80 %', 'OK'],
    ['Trompette', '29', '60', '83 %', 'OK'],
    ['Chanterelle en tube', '40', '75', '78 %', 'un peu optimiste'],
    ['Sanguin', '24', '30 (Q1 = 0)', '71 %', 'déclencheur adouci'],
    ['Truffe', '2', '-', '-', 'GBIF quasi vide - non calable'],
    ['Morille', '40', '22', '63 %', 'besoin couche brûlis'],
  ],
);
p("Les seuils fins et la truffe seront revus au fur et à mesure des remontées de terrain (data/observations.jsonl via l'appli).", { color: GREY });

/* ---------- une page par espèce ---------- */
for (const sp of SPECIES) {
  doc.addPage();
  h1(sp.nom);
  doc.font('Helvetica-Oblique').fontSize(9.5).fillColor(GREY).text(sp.latin);
  doc.fillColor('black').moveDown(0.3);
  doc.font('Helvetica-Bold').fontSize(9).text('Saison : ', { continued: true }).font('Helvetica').text(sp.saison);
  doc.font('Helvetica-Bold').fontSize(9).text('Fenêtre de calcul : ', { continued: true }).font('Helvetica').text(sp.fenetre);
  doc.moveDown(0.4);
  p(sp.bio);
  doc.moveDown(0.3);

  h2('Habitat (facteurs appliqués à la couche forêts)');
  table([{ t: 'Couche', w: 0.2 }, { t: 'Facteur', w: 0.8 }], sp.habitat);

  h2('Critères de cotation et poids');
  table(
    [{ t: 'Critère', w: 0.22 }, { t: 'Variable et seuils', w: 0.5 }, { t: 'Rôle / poids', w: 0.28 }],
    sp.criteres,
  );

  h2('Formule');
  doc.font('Courier').fontSize(7.8).fillColor('#222').text(sp.formule, { lineGap: 2 });
  doc.fillColor('black');

  if (sp.calage) {
    doc.moveDown(0.5);
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(GREEN).text('Calage : ', { continued: true })
      .font('Helvetica').fillColor(GREY).text(sp.calage);
    doc.fillColor('black');
  }
}

/* ---------- pied de page ---------- */
const range = doc.bufferedPageRange();
for (let i = 0; i < range.count; i++) {
  doc.switchToPage(i);
  const mb = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;              // sinon pdfkit ajoute des pages vides
  doc.font('Helvetica').fontSize(7).fillColor(GREY)
    .text(`Champi-Cévennes - modèle v1 - seuils indicatifs, à caler sur observations réelles          ${i + 1} / ${range.count}`,
      54, doc.page.height - 34, { width: W, align: 'center', lineBreak: false });
  doc.page.margins.bottom = mb;
}

doc.end();
console.log('écrit', OUT);
