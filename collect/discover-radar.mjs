/* Vérifie l'accès à l'API radar Météo-France et affiche le catalogue.
 *   CHAMPI_MF_TOKEN=<token collé>  node collect/discover-radar.mjs
 *   (ou CHAMPI_MF_APPID=<application_id>  node collect/discover-radar.mjs)
 */
import { discover, fetchLatestLameEau } from './antilope.mjs';

const d = await discover();
console.log('Zones      :', d.zones.links.filter(l => l.rel.includes('data')).map(l => l.title).join(', '));
console.log('Observations:', d.obs.links.filter(l => l.rel.includes('data')).map(l => l.title).join(' | '));
console.log('LAME_D_EAU :');
for (const l of d.lame.links.filter(x => x.href.includes('produit')))
  console.log(`  maille ${l.href.match(/maille=(\d+)/)?.[1]}  ${l.type}  validity ${l.validity_time}`);

const { bytes, validity } = await fetchLatestLameEau();
console.log(`\nFichier HDF5 récupéré : ${bytes.length} octets, validité ${validity}`);
