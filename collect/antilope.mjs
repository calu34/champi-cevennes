/* Source ANTILOPE / lame d'eau radar Météo-France.
 *
 * CE QUE L'API "Données Radar" FOURNIT RÉELLEMENT (vérifié 08/2026, Swagger v2) :
 *   base   : https://public-api.meteofrance.fr/public/DPRadar/v1
 *   auth   : Authorization: Bearer <token>   (token OAuth2, 1 h — voir getToken)
 *   produit: GET /mosaiques/METROPOLE/observations/LAME_D_EAU/produit?maille=500
 *            → fichier HDF5 ODIM (~2 Mo)   [maille=1000 → BUFR gzippé]
 *   ⚠ UNIQUEMENT le dernier pas de temps 5 min ("date TU la plus récente").
 *     Pas d'historique, pas de cumul tout fait.
 *
 * CONSÉQUENCE : pour un cumul 24 h il faut interroger toutes les 5 min et sommer
 *   soi-même (288 fichiers/j, ~300-600 Mo/j, décodage HDF5). C'est un POLLER
 *   permanent, pas une tâche quotidienne — nécessite une machine allumée en continu.
 *   Tant que ce n'est pas en place, le collecteur reste sur le proxy Open-Meteo.
 *
 * Piste alternative sans poller : COMEPHORE (data.gouv.fr, GeoTIFF horaire déjà
 *   cumulé, 1 km) — mais publié avec ~2 mois de retard → calage/rétro seulement.
 */
import { CFG } from './config.mjs';
import { todayISO } from './lib.mjs';

const BASE = 'https://public-api.meteofrance.fr/public/DPRadar/v1';
const TOKEN_URL = 'https://portail-api.meteofrance.fr/token';

/* Trois modes d'authentification, par ordre de préférence :
 *   CHAMPI_MF_APIKEY  → en-tête `apikey: <clé>`     (token "API Key" du portail, durée longue)
 *   CHAMPI_MF_APPID   → OAuth2 client_credentials   (base64 "client_id:client_secret", auto-renouvelé)
 *   CHAMPI_MF_TOKEN   → en-tête `Authorization: Bearer <token>`  (dépannage, 1 h)              */
const API_KEY = process.env.CHAMPI_MF_APIKEY || null;
const APP_ID = process.env.CHAMPI_MF_APPID || null;
let _tok = { value: process.env.CHAMPI_MF_TOKEN || null, exp: 0 };

async function getToken() {
  if (_tok.value && Date.now() < _tok.exp - 60000) return _tok.value;
  if (!APP_ID) {
    if (_tok.value) return _tok.value;
    throw new Error('aucun identifiant Météo-France (CHAMPI_MF_APIKEY / APPID / TOKEN)');
  }
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: `Basic ${APP_ID}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!r.ok) throw new Error(`token Météo-France: HTTP ${r.status}`);
  const j = await r.json();
  _tok = { value: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return _tok.value;
}

async function authHeaders() {
  if (API_KEY) return { apikey: API_KEY };
  return { Authorization: `Bearer ${await getToken()}` };
}

async function mfGet(path) {
  for (let a = 0; a < 3; a++) {
    const r = await fetch(BASE + path, { headers: await authHeaders() });
    if (r.status === 401 && APP_ID) { _tok.value = null; continue; }
    if (r.status === 429) { await new Promise(s => setTimeout(s, 12000)); continue; }
    if (!r.ok) throw new Error(`${path} → HTTP ${r.status}`);
    return r;
  }
  throw new Error(`${path} : échec`);
}

/** Discovery : liste zones / observations (utile pour vérifier l'accès). */
export async function discover() {
  const zones = await (await mfGet('/mosaiques')).json();
  const obs = await (await mfGet('/mosaiques/METROPOLE/observations')).json();
  const lame = await (await mfGet('/mosaiques/METROPOLE/observations/LAME_D_EAU')).json();
  return { zones, obs, lame };
}

/** Télécharge le dernier fichier LAME_D_EAU (HDF5 ODIM, maille 500 m). */
export async function fetchLatestLameEau() {
  const r = await mfGet('/mosaiques/METROPOLE/observations/LAME_D_EAU/produit?maille=500');
  const validity = r.headers.get('content-disposition')?.match(/(\d{14})/)?.[1] || null;
  return { bytes: new Uint8Array(await r.arrayBuffer()), validity };
}

/* TODO (si on décide de faire le poller) :
 *  - décoder le HDF5 ODIM : h5wasm, datasets /dataset1/data1/data (+ /what gain,offset,nodata),
 *    géoréférencement dans /where (projdef, LL/UR lat-lon, xscale/yscale)
 *  - reprojeter lon/lat → pixel, échantillonner la grille
 *  - accumulateur journalier persistant (data/store/radar-accum.json), gestion des trous
 *  - collect/poller.mjs lancé toutes les 5 min (tâche séparée)
 */
export const ANTILOPE_READY = false;
export async function fetchAntilope24h() {
  throw new Error('poller ANTILOPE non implémenté — voir en-tête de collect/antilope.mjs');
}
