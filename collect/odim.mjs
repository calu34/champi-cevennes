/* Décodeur ODIM_H5 pour la mosaïque LAME_D_EAU Météo-France (produit ACRR).
 * Vérifié sur un fichier réel : ODIM_H5/V2_3, /dataset1/data1/data uint16 3472×3472,
 * gain 0.01 offset 0, nodata 65535, undetect 65534, projection stéréographique polaire.
 */
import h5mod from 'h5wasm';
import proj4 from 'proj4';

const h5 = h5mod.default || h5mod;
let H5M = null;

const attr = (g, k) => {
  const v = g.attrs[k]?.value;
  return typeof v === 'bigint' ? Number(v) : v;
};

/** Ouvre un buffer HDF5 ODIM et renvoie un échantillonneur lon/lat -> mm (ou null). */
export async function openOdim(bytes) {
  H5M ??= await h5.ready;
  const name = `odim_${Math.random().toString(36).slice(2)}.h5`;
  H5M.FS.writeFile(name, bytes);
  const f = new h5.File(name, 'r');

  const w = f.get('where');
  const projdef = attr(w, 'projdef');
  const xscale = attr(w, 'xscale'), yscale = attr(w, 'yscale');
  const xsize = attr(w, 'xsize'), ysize = attr(w, 'ysize');

  const dw = f.get('dataset1/data1/what');
  const gain = attr(dw, 'gain'), offset = attr(dw, 'offset');
  const nodata = attr(dw, 'nodata'), undetect = attr(dw, 'undetect');

  const d1what = f.get('dataset1/what');
  const start = `${attr(d1what, 'startdate')}${attr(d1what, 'starttime')}`;
  const end = `${attr(d1what, 'enddate')}${attr(d1what, 'endtime')}`;

  const raw = f.get('dataset1/data1/data').value;   // Uint16Array, row-major, ligne 0 = haut
  f.close();
  try { H5M.FS.unlink(name); } catch {}

  // proj4 : WGS84 -> grille projetée. Les +x_0/+y_0 du projdef placent déjà
  // le coin haut-gauche (pixel 0,0) à l'origine ; Y croît vers le haut.
  const fwd = proj4('EPSG:4326', projdef);
  const H = ysize * yscale;

  const sampleRaw = (lon, lat) => {
    const [X, Y] = fwd.forward([lon, lat]);
    const col = Math.round(X / xscale);
    const row = Math.round((H - Y) / yscale);          // haut-gauche = (0,0)
    if (col < 0 || row < 0 || col >= xsize || row >= ysize) return { mm: null, oob: true };
    const r = raw[row * xsize + col];
    if (r === nodata) return { mm: null, nodata: true };
    if (r === undetect) return { mm: 0 };
    return { mm: r * gain + offset };
  };

  return { start, end, xsize, ysize, xscale, yscale, projdef, sampleRaw,
    // debug : renvoyer le pixel d'un lon/lat
    pixel: (lon, lat) => { const [X, Y] = fwd.forward([lon, lat]);
      return [Math.round(X / xscale), Math.round((H - Y) / yscale)]; } };
}
