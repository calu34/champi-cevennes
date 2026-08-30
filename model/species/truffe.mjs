import { clamp, trap, windowStats } from '../lib.mjs';

/* Truffe noire — Tuber melanosporum.
 * Le potentiel de récolte hivernale se joue sur les PLUIES D'ORAGE de l'été
 * (grossissement juin–août). On évalue donc une fenêtre calendaire fixe
 * 1ᵉʳ juin → 31 août de l'année concernée, quel que soit le jour d'évaluation.
 *
 * ⚠ Nécessite que la série couvre cet été. Le collecteur ne garde que ~75 j
 *    glissants → en hiver il faudra un "instantané été" figé (voir geo/README /
 *    collect : à ajouter en phase B). `conf` indique la couverture réelle.
 */
export default {
  id: 'truffe',
  nom: 'Truffe noire',
  groupe: 'Tuber melanosporum',
  saison: [9, 10, 11, 12, 1, 2, 3],   // potentiel connu dès sept., récolte nov.–mars
  fenetreJours: 100,
  habitat: {
    essences: { feuillu: 1, mixte: 0.6, conifere: 0.1, autre: 0.2 },   // chêne pubescent / vert, noisetier
    substrats: { calcaire: 1, neutre: 0.5, acide: 0.1 },               // exigence calcaire
    altitude: [80, 1000],
    penteMax: 35,
    exposition: false,   // plutôt adret ensoleillé — géré à part si besoin
  },
  params: {
    pLo: 25, pOptLo: 60, pOptHi: 130, pHi: 260,   // cumul été (mm)
    gapKill: 21,          // au-delà, mortalité des primordia
    heatFull: 20,         // jours de stress chaleur pour −100 %
  },

  score(s, k, p = this.params) {
    const evalDate = s.time[k];
    const y = +evalDate.slice(0, 4), m = +evalDate.slice(5, 7);
    const summerYear = m <= 5 ? y - 1 : y;
    const jun1 = `${summerYear}-06-01`, aug31 = `${summerYear}-08-31`;

    let i0 = s.time.findIndex(d => d >= jun1);
    let i1 = s.time.length - 1;
    while (i1 > 0 && s.time[i1] > aug31) i1--;
    if (i0 < 0 || i1 < i0) return { value: null, detail: { insuffisant: true } };

    const covered = i1 - i0 + 1;
    const conf = clamp(covered / 85, 0, 1);
    const st = windowStats(s, i0, i1);

    const water = trap(st.tot, p.pLo, p.pOptLo, p.pOptHi, p.pHi);
    const reg = clamp((st.wet10 - 1) / 3, 0, 1);              // 2–4 orages bien répartis
    const gap = clamp(1 - (st.dryMax - p.gapKill) / p.gapKill, 0, 1);
    const heat = clamp(1 - st.heatDry / p.heatFull, 0.25, 1);

    const raw = water * (0.4 + 0.6 * reg) * gap * heat;
    const value = clamp(100 * raw, 0, 100);
    return {
      value, conf,
      detail: { Psummer: Math.round(st.tot), nOrages: st.wet10, trouSec: st.dryMax, joursChauds: st.heatDry, couverture: covered },
    };
  },

  criteres: [
    ['Pluie d\'été', 'cumul 1ᵉʳ juin → 31 août — optimum 60–130 mm, effondrement sous ~25 mm'],
    ['Régularité', '2–4 orages (> 10 mm) bien répartis valent mieux qu\'un gros déluge'],
    ['Trou sec', 'plus de 3 semaines sans pluie en été = mortalité des jeunes truffes'],
    ['Stress chaleur', 'jours à > 33 °C en période sèche : pénalité'],
    ['Substrat', 'strictement calcaire (causses) ; chêne pubescent / vert'],
    ['Fiabilité', "l'indice a besoin de tout l'été — voir « couverture » dans le détail"],
  ],
};
