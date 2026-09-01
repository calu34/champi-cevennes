import cepe from './cepe.mjs';
import girolle from './girolle.mjs';
import truffe from './truffe.mjs';
import morille from './morille.mjs';
import pdm from './pdm.mjs';
import trompette from './trompette.mjs';
import ctube from './ctube.mjs';
import sanguin from './sanguin.mjs';

/* Catalogue d'espèces. Ajouter une espèce = créer model/species/<id>.mjs
 * (même forme : id, nom, saison, fenetreJours, habitat, params, score(), criteres)
 * puis l'importer ici. Rien d'autre à toucher. */
export const SPECIES_LIST = [cepe, girolle, pdm, trompette, ctube, sanguin, truffe, morille];
export const SPECIES = Object.fromEntries(SPECIES_LIST.map(s => [s.id, s]));

export const speciesById = id => SPECIES[id];
export const enSaison = (sp, month) => (typeof sp === 'string' ? SPECIES[sp] : sp).saison.includes(month);

/** fenêtre de données (jours) la plus longue demandée par une espèce active */
export const fenetreMax = (mois = null) =>
  SPECIES_LIST.filter(s => mois == null || s.saison.includes(mois))
    .reduce((m, s) => Math.max(m, s.fenetreJours), 0);
