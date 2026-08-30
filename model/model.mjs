/* ================================================================== *
 *  Modèle "conditions de pousse" — cèpes & girolles
 *  Module PARTAGÉ : utilisé par le collecteur Node ET par la carte web.
 *  Aucune dépendance (pas de DOM, pas de Leaflet).
 * ================================================================== */

export const DEFAULTS = {
  bucketCap: 80,              // mm — réserve utile du "seau" sol (proxy humidité)
  soilEmaDays: 12,            // proxy T° sol ≈ 18 cm = EMA de la T° air moyenne
  cepe: {
    trigLo: 20, trigHi: 60,   // épisode déclencheur (mm / 48 h)
    lagPeak: 14, lagSigma: 7, // délai de fructification (jours depuis l'épisode)
    tA: 8, tB: 13, tC: 19, tD: 22,   // bande T° sol favorable (°C)
    p15Lo: 30, p15Hi: 80,     // humidité entretenue (mm / 15 j)
  },
  girolle: {
    p30Lo: 40, p30Hi: 110,
    p15Lo: 15, p15Hi: 50,
    dryLo: 12, dryHi: 25,     // série sèche pénalisante (jours)
    tA: 10, tB: 13, tC: 20, tD: 24,
  },
};

/* ---------- utilitaires numériques ---------- */
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

export function trap(x, a, b, c, d) {
  if (x <= a || x >= d) return 0;
  if (x < b) return (x - a) / (b - a);
  if (x <= c) return 1;
  return (d - x) / (d - c);
}

function sumSlice(arr, from, to) {
  let s = 0;
  for (let i = Math.max(0, from); i <= to && i < arr.length; i++) s += (arr[i] || 0);
  return s;
}

/* ---------- séries dérivées ---------- *
 * série = { time:[], precip:[], et0:[], tmean:[], tmin:[], tmax:[] }
 * Ajoute .tsol (proxy T° sol) et .smm (proxy humidité, mm dans le seau).
 * Si de vraies séries sol sont fournies (soilT, soilM) elles priment.        */
export function deriveSeries(s, cfg = DEFAULTS) {
  const n = s.time.length;

  if (s.soilT && s.soilT.length === n) {
    s.tsol = s.soilT.slice();
  } else {
    const alpha = 2 / (cfg.soilEmaDays + 1);
    const tsol = new Array(n);
    let seed = 0, ns = 0;
    for (let i = 0; i < Math.min(5, n); i++) { seed += s.tmean[i]; ns++; }
    tsol[0] = ns ? seed / ns : s.tmean[0];
    for (let i = 1; i < n; i++) tsol[i] = alpha * s.tmean[i] + (1 - alpha) * tsol[i - 1];
    s.tsol = tsol;
  }

  if (s.soilM && s.soilM.length === n) {
    // soilM attendu en fraction 0..1 → converti en mm équivalents du seau
    s.smm = s.soilM.map(v => clamp(v, 0, 1) * cfg.bucketCap);
  } else {
    const cap = cfg.bucketCap;
    const smm = new Array(n);
    let v = cap * 0.5;
    for (let i = 0; i < n; i++) {
      v = clamp(v + (s.precip[i] || 0) - (s.et0[i] || 0), 0, cap);
      smm[i] = v;
    }
    s.smm = smm;
  }
  return s;
}

/* ---------- indices au jour d'index k ---------- */
export function scoreAt(s, k, cfg = DEFAULTS) {
  const P = s.precip, ET = s.et0, TMIN = s.tmin, TMAX = s.tmax;
  const P7  = sumSlice(P, k - 6,  k);
  const P15 = sumSlice(P, k - 14, k);
  const P21 = sumSlice(P, k - 20, k);
  const P30 = sumSlice(P, k - 29, k);

  let Pevent = 0, eventEnd = k;
  for (let i = Math.max(1, k - 20); i <= k; i++) {
    const v = (P[i] || 0) + (P[i - 1] || 0);
    if (v > Pevent) { Pevent = v; eventEnd = i; }
  }
  const Devent = k - eventEnd;
  const Tsol  = s.tsol[k];
  const dTsol = Tsol - s.tsol[Math.max(0, k - 10)];
  const SM    = s.smm[k] / cfg.bucketCap;
  const ET7   = sumSlice(ET, k - 6, k);
  let Tmin7 = Infinity;
  for (let i = Math.max(0, k - 6); i <= k; i++) Tmin7 = Math.min(Tmin7, TMIN[i]);
  let dry = 0, run = 0;
  for (let i = Math.max(0, k - 29); i <= k; i++) {
    if ((P[i] || 0) < 1) { run++; dry = Math.max(dry, run); } else run = 0;
  }
  let heatPrior = -Infinity;
  for (let i = Math.max(0, k - 20); i <= k - 10; i++) heatPrior = Math.max(heatPrior, TMAX[i] ?? -Infinity);

  /* --- cèpe --- */
  const c = cfg.cepe;
  const trig = clamp((Pevent - c.trigLo) / (c.trigHi - c.trigLo), 0, 1);
  let lag = Math.exp(-((Devent - c.lagPeak) ** 2) / (2 * c.lagSigma ** 2));
  if (Devent <= 3) lag *= 0.2;
  if (Devent > 32) lag *= 0.4;
  const moist = clamp((P15 - c.p15Lo) / (c.p15Hi - c.p15Lo), 0, 1);
  const band  = trap(Tsol, c.tA, c.tB, c.tC, c.tD);
  const shock = clamp(-dTsol / 5, 0, 1) * 0.25;
  let pen = 0;
  if (Tmin7 < 0)  pen += 0.5;
  if (Tmin7 < -3) pen += 0.3;
  pen += 0.35 * clamp((ET7 - P7) / 25, 0, 1);
  if (heatPrior > 34) pen += 0.15;
  const cepeRaw = Math.pow(trig, 0.8) * lag * band * (0.35 + 0.65 * moist) * (0.4 + 0.6 * SM) * (1 + shock) / 1.25;
  const cepe = clamp(100 * cepeRaw * (1 - Math.min(pen, 0.9)), 0, 100);

  /* --- girolle --- */
  const g = cfg.girolle;
  const gm    = clamp((P30 - g.p30Lo) / (g.p30Hi - g.p30Lo), 0, 1);
  const topup = clamp((P15 - g.p15Lo) / (g.p15Hi - g.p15Lo), 0, 1);
  const dpen  = clamp((dry - g.dryLo) / (g.dryHi - g.dryLo), 0, 1);
  const gband = trap(Tsol, g.tA, g.tB, g.tC, g.tD);
  let gpen = 0;
  if (Tmin7 < 0) gpen += 0.4;
  const girRaw = (0.5 * gm + 0.5 * topup) * gband * (0.4 + 0.6 * SM) * (1 - 0.7 * dpen);
  const girolle = clamp(100 * girRaw * (1 - Math.min(gpen, 0.9)), 0, 100);

  return {
    cepe, girolle, combine: Math.max(cepe, girolle),
    detail: { P7, P15, P21, P30, Pevent, Devent, Tsol, dTsol, SM, ET7, Tmin7, dry, heatPrior },
  };
}

/* ---------- habitat : combine les couches en un facteur 0..1 ---------- *
 * h = { forest:bool, essence:'feuillu'|'conifere'|'mixte'|'autre'|null,
 *       domaniale:bool, substrat:'acide'|'neutre'|'calcaire'|null,
 *       elev:m, slopeDeg:°, aspect:° (0=N,90=E) }                          */
const ESSENCE_F = { feuillu: 1, mixte: 0.95, conifere: 0.85, autre: 0.35 };
export function habitatFactor(h, opts = {}) {
  if (!h) return 1;
  let f = 1;

  if (opts.useForet && h.essence) f *= ESSENCE_F[h.essence] ?? 0.7;
  if (opts.useDomaniale && h.domaniale === false) f *= 0.15;   // hors domaniale : très atténué
  if (opts.useSubstrat) {
    if (h.substrat === 'calcaire') f *= 0.25;
    else if (h.substrat === 'neutre') f *= 0.8;
  }
  if (opts.useMnt && h.elev != null) {
    if (h.elev < 120 || h.elev > 1650) f *= 0.5;
    else if (h.elev < 200) f *= 0.8;
    if (h.slopeDeg != null && h.slopeDeg > 30) f *= 0.7;       // trop raide
  }
  return clamp(f, 0, 1);
}

/* ---------- rampe de couleur (vert = favorable) ---------- */
const RAMP = [
  [0, [128, 0, 20]], [10, [215, 48, 39]], [25, [252, 141, 89]], [40, [254, 224, 139]],
  [55, [217, 239, 139]], [75, [145, 207, 96]], [100, [26, 152, 80]],
];
export function colorFor(v) {
  v = clamp(v, 0, 100);
  for (let i = 1; i < RAMP.length; i++) {
    if (v <= RAMP[i][0]) {
      const [x0, c0] = RAMP[i - 1], [x1, c1] = RAMP[i];
      const t = (v - x0) / (x1 - x0);
      const c = c0.map((ch, j) => Math.round(ch + t * (c1[j] - ch)));
      return `rgb(${c[0]},${c[1]},${c[2]})`;
    }
  }
  return 'rgb(26,152,80)';
}
