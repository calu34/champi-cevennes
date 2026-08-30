/* ================================================================== *
 *  Primitives partagées du modèle — aucune dépendance (Node + navigateur).
 * ================================================================== */

export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

/** trapèze : 0 sous a, monte a→b, plateau b→c, descend c→d, 0 au-delà */
export function trap(x, a, b, c, d) {
  if (x <= a || x >= d) return 0;
  if (x < b) return (x - a) / (b - a);
  if (x <= c) return 1;
  return (d - x) / (d - c);
}

/** cloche gaussienne centrée sur `peak`, écart-type `sigma` */
export const bell = (x, peak, sigma) => Math.exp(-((x - peak) ** 2) / (2 * sigma ** 2));

/** somme arr[from..to] (indices inclus, bornés) */
export function sumSlice(arr, from, to) {
  let s = 0;
  for (let i = Math.max(0, from); i <= to && i < arr.length; i++) s += (arr[i] || 0);
  return s;
}

const DERIVE = { bucketCap: 80, soilEmaDays: 12 };

/** série = { time, precip, et0, tmean, tmin, tmax [, soilT, soilM] }
 *  ajoute .tsol (proxy T° sol ~18 cm) et .smm (humidité, mm dans un seau borné) */
export function deriveSeries(s, cfg = DERIVE) {
  const n = s.time.length;

  if (s.soilT?.length === n) {
    s.tsol = s.soilT.slice();
  } else {
    const alpha = 2 / (cfg.soilEmaDays + 1);
    const t = new Array(n);
    let seed = 0, ns = 0;
    for (let i = 0; i < Math.min(5, n); i++) { seed += s.tmean[i]; ns++; }
    t[0] = ns ? seed / ns : s.tmean[0];
    for (let i = 1; i < n; i++) t[i] = alpha * s.tmean[i] + (1 - alpha) * t[i - 1];
    s.tsol = t;
  }

  if (s.soilM?.length === n) {
    s.smm = s.soilM.map(v => clamp(v, 0, 1) * cfg.bucketCap);
  } else {
    const cap = cfg.bucketCap;
    const m = new Array(n);
    let v = cap * 0.5;
    for (let i = 0; i < n; i++) {
      v = clamp(v + (s.precip[i] || 0) - (s.et0[i] || 0), 0, cap);
      m[i] = v;
    }
    s.smm = m;
  }
  return s;
}

/** statistiques sur une fenêtre [i0, i1] de la série (indices inclus) */
export function windowStats(s, i0, i1) {
  i0 = Math.max(0, i0); i1 = Math.min(s.time.length - 1, i1);
  const P = s.precip;
  let tot = 0, wet10 = 0, dryRun = 0, dryMax = 0, heatDry = 0, tmin = Infinity, tmax = -Infinity;
  for (let i = i0; i <= i1; i++) {
    const p = P[i] || 0;
    tot += p;
    if (p >= 10) wet10++;
    if (p < 1) { dryRun++; dryMax = Math.max(dryMax, dryRun); } else dryRun = 0;
    if (p < 1 && (s.tmax[i] ?? 0) > 33) heatDry++;
    tmin = Math.min(tmin, s.tmin[i] ?? Infinity);
    tmax = Math.max(tmax, s.tmax[i] ?? -Infinity);
  }
  return { tot, wet10, dryMax, heatDry, tmin, tmax, days: i1 - i0 + 1 };
}

/** meilleur cumul sur `win` jours consécutifs se terminant dans [k-back, k] */
export function bestBurst(P, k, back, win) {
  let best = 0, end = k;
  for (let i = Math.max(win - 1, k - back); i <= k; i++) {
    let v = 0;
    for (let j = 0; j < win; j++) v += P[i - j] || 0;
    if (v > best) { best = v; end = i; }
  }
  return { mm: best, daysAgo: k - end };
}

/* ---------- rampe de couleur (rouge défavorable → vert favorable) ---------- */
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

/** jour de l'année 0..365 pour une date ISO "YYYY-MM-DD" */
export function doy(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  return Math.floor((d - new Date(Date.UTC(d.getUTCFullYear(), 0, 0))) / 86400000);
}
