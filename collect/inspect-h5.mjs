/* Récupère un fichier LAME_D_EAU et dcompe sa structure ODIM_H5.
 * Sert à écrire correctement le décodeur du poller.
 *   CHAMPI_MF_TOKEN=<token>  node collect/inspect-h5.mjs
 * (accepte aussi un fichier local :  node collect/inspect-h5.mjs chemin/vers/fichier.h5)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import h5mod from 'h5wasm';
import { fetchLatestLameEau } from './antilope.mjs';

const h5 = h5mod.default || h5mod;
const H5M = await h5.ready;

let bytes, label;
if (process.argv[2]) {
  bytes = new Uint8Array(fs.readFileSync(process.argv[2]));
  label = process.argv[2];
} else {
  const r = await fetchLatestLameEau();
  bytes = r.bytes; label = `API (validité ${r.validity})`;
}
console.log(`Source : ${label} — ${bytes.length} octets\n`);

H5M.FS.writeFile('inspect.h5', bytes);
const f = new h5.File('inspect.h5', 'r');

const j = v => JSON.stringify(v, (_, x) =>
  typeof x === 'bigint' ? Number(x) : ArrayBuffer.isView(x) ? Array.from(x, y => typeof y === 'bigint' ? Number(y) : y) : x);
const attrs = o => Object.fromEntries(Object.entries(o.attrs || {}).map(([k, v]) => [k, v.value]));

function walk(g, prefix = '') {
  const a = attrs(g);
  if (Object.keys(a).length) console.log(`${prefix}  @`, JSON.stringify(a));
  for (const key of g.keys()) {
    const item = g.get(key);
    if (item instanceof h5.Group) {
      console.log(`${prefix}/${key}/`);
      walk(item, prefix + '/' + key);
    } else {
      const at = attrs(item);
      console.log(`${prefix}/${key}  dataset shape=${JSON.stringify(item.shape)} dtype=${item.dtype}` +
        (Object.keys(at).length ? `  @${JSON.stringify(at)}` : ''));
      if (item.shape?.length === 2) {
        const v = item.value;
        let mn = Infinity, mx = -Infinity;
        for (let i = 0; i < v.length; i += 997) { if (v[i] < mn) mn = v[i]; if (v[i] > mx) mx = v[i]; }
        console.log(`${prefix}     échantillon min=${mn} max=${mx}`);
      }
    }
  }
}
walk(f);
f.close();
