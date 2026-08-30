import fs from 'node:fs';

const dir = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
let src = fs.readFileSync(dir + 'app.js', 'utf8');

// couper le bloc d'auto-exécution, exposer les internes
src = src.slice(0, src.indexOf('initMap();'));
src += `
globalThis.__M = { initMap, fetchGrid, scoreAt, computeSeries, whichDep, CFG, colorFor, trap,
  pointInFeature, habitatFactor, get POINTS(){return POINTS} };
`;

const dataDir = fs.existsSync(dir + 'data') ? dir + 'data/' : dir;
const DEPS = {};
for (const c of ['07','12','30','34','48','81'])
  DEPS[c] = JSON.parse(fs.readFileSync(dataDir + `dep-${c}.geojson`, 'utf8'));

// --- mocks DOM / Leaflet ---
const stub = new Proxy(function(){}, {
  get: (t, k) => (k === 'textContent' || k === 'value' || k === 'min' || k === 'max' ? '' :
                  k === 'style' ? {} : (...a) => stub),
  set: () => true, apply: () => stub, construct: () => stub,
});
const chain = new Proxy({}, { get: () => (...a) => chain });
const L = {
  map: () => ({ setView: () => chain }), tileLayer: () => chain, geoJSON: () => chain,
  layerGroup: () => ({ addTo: () => chain, clearLayers(){}, }), rectangle: () => chain,
};
let ANCHOR = '';
const anchorStub = {
  get value() { return ANCHOR; }, set value(v) {}, set max(v) {}, addEventListener() {},
};
const document = {
  getElementById: id => (id === 'anchorDate' ? anchorStub : stub), querySelectorAll: () => [],
};

new Function('L', 'document', 'DEPS', src)(L, document, DEPS);
const M = globalThis.__M;

// --- 1. masquage géo ---
const tests = [
  ['Montpellier 34', 3.88, 43.61, '34'],
  ['Mende 48',       3.50, 44.52, '48'],
  ['Millau 12',      3.08, 44.10, '12'],
  ['Aubenas 07',     4.39, 44.62, '07'],
  ['Nîmes 30',       4.36, 43.84, '30'],
  ['Albi 81',        2.15, 43.93, '81'],
  ['Lyon (hors)',    4.84, 45.76, null],
  ['Mer (hors)',     3.90, 43.20, null],
];
let okGeo = 0;
for (const [name, lon, lat, exp] of tests) {
  const got = M.whichDep(lon, lat);
  const ok = got === exp;
  okGeo += ok;
  console.log(`  ${ok ? 'OK ' : 'XX '} ${name.padEnd(14)} -> ${got}  (attendu ${exp})`);
}
console.log(`géo: ${okGeo}/${tests.length}\n`);

// --- 2. pipeline complet sur données réelles ---
M.initMap();
console.time('fetchGrid');
await M.fetchGrid();
console.timeEnd('fetchGrid');
const P = M.POINTS;
console.log(`\nmailles chargées: ${P.length}`);
if (!P.length) { console.log('(limite Open-Meteo probable — réessayer dans 1 min)'); process.exit(0); }
const byDep = {};
for (const p of P) byDep[p.dep] = (byDep[p.dep] || 0) + 1;
console.log('par département:', byDep);

const ref = P[0];
const k = ref.time.indexOf(new Date().toISOString().slice(0, 10));
console.log(`\nséries: ${ref.time.length} jours, ${ref.time[0]} → ${ref.time.at(-1)}, J=${ref.time[k]} (idx ${k})`);

// stats des indices au jour J
const stat = (sel) => {
  const v = P.map(p => M.scoreAt(p, k)[sel]);
  v.sort((a, b) => a - b);
  const q = f => v[Math.floor(f * (v.length - 1))].toFixed(1);
  return `min ${q(0)}  p25 ${q(.25)}  med ${q(.5)}  p75 ${q(.75)}  p95 ${q(.95)}  max ${q(1)}`;
};
console.log('cèpe   :', stat('cepe'));
console.log('girolle:', stat('girolle'));
console.log('combiné:', stat('combine'));

// échantillon détaillé (3 mailles au hasard)
for (const p of [P[0], P[(P.length/2)|0], P.at(-1)]) {
  const s = M.scoreAt(p, k), d = s.detail;
  console.log(`\n${p.dep} ${p.lat},${p.lon} ${p.elev}m  cèpe=${s.cepe.toFixed(0)} gir=${s.girolle.toFixed(0)} hab×${M.habitatFactor(p.elev)}`);
  console.log(`   P15=${d.P15.toFixed(0)} P30=${d.P30.toFixed(0)} evt48h=${d.Pevent.toFixed(0)}mm il y a ${d.Devent}j  Tsol=${d.Tsol.toFixed(1)} dry=${d.dry}j`);
}

// --- 3. NaN / bornes ---
let bad = 0;
for (const p of P) for (const kk of [30, 45, k, ref.time.length - 1]) {  // eslint-disable-line
  const s = M.scoreAt(p, kk);
  for (const key of ['cepe', 'girolle', 'combine'])
    if (!(s[key] >= 0 && s[key] <= 100)) { bad++; if (bad < 4) console.log('  BORNE', p.dep, kk, key, s[key]); }
}
console.log(`\nvaleurs hors [0,100] ou NaN: ${bad}`);
console.log('colorFor: 0->', M.colorFor(0), ' 50->', M.colorFor(50), ' 100->', M.colorFor(100));

// --- 4. mode archive : rejeu automne 2025 ---
if (!process.env.FULL) { console.log('\n(archive: FULL=1 pour tester)'); process.exit(0); }
console.log('\n=== mode archive : 2025-10-25 ===');
ANCHOR = '2025-10-25';
await new Promise(r => setTimeout(r, 61000));      // laisser retomber la limite Open-Meteo
await M.fetchGrid();
const PA = M.POINTS, rA = PA[0];
const kA = rA.time.indexOf(ANCHOR);
console.log(`mailles ${PA.length}, fenêtre ${rA.time[0]} → ${rA.time.at(-1)}, ancre idx ${kA}`);
const statA = sel => {
  const v = PA.map(p => M.scoreAt(p, kA)[sel]).sort((a, b) => a - b);
  const q = f => v[Math.floor(f * (v.length - 1))].toFixed(1);
  return `med ${q(.5)}  p75 ${q(.75)}  p90 ${q(.9)}  max ${q(1)}`;
};
console.log('cèpe   :', statA('cepe'));
console.log('girolle:', statA('girolle'));
let favC = PA.filter(p => M.scoreAt(p, kA).cepe > 40).length;
let favG = PA.filter(p => M.scoreAt(p, kA).girolle > 40).length;
console.log(`mailles cèpe>40 : ${favC} / ${PA.length}   girolle>40 : ${favG}`);
// scan temporel : indice cèpe médian par semaine sur la fenêtre
for (let kk = 20; kk < rA.time.length; kk += 7) {
  const v = PA.map(p => M.scoreAt(p, kk).cepe).sort((a, b) => a - b);
  console.log(`  ${rA.time[kk]}  cèpe med ${v[v.length >> 1].toFixed(0)}  max ${v.at(-1).toFixed(0)}`);
}
