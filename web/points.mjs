/* Points personnels (coins à champignons) — 100 % local à l'appareil.
 * Trois façons d'ajouter un point : position GPS, clic sur la carte, photo géolocalisée.
 * Stockage : localStorage (métadonnées GeoJSON) + IndexedDB (vignettes photo).
 * Export / import GeoJSON pour ne rien perdre.
 */
const LS_KEY = 'champi.points';
const SPECIES_OPTS = [
  ['', '—'], ['cepe', 'Cèpe'], ['girolle', 'Girolle'], ['pdm', 'Pied-de-mouton'],
  ['trompette', 'Trompette de la mort'], ['ctube', 'Chanterelle en tube'],
  ['sanguin', 'Sanguin'], ['truffe', 'Truffe noire'], ['morille', 'Morille'], ['autre', 'Autre'],
];

/* ---------- stockage ---------- */
const load = () => {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || fc(); } catch { return fc(); }
};
const fc = () => ({ type: 'FeatureCollection', features: [] });
const save = data => { try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch (e) { alert('Stockage plein — exporte tes points.'); } };

/* IndexedDB minimal pour les vignettes (id -> dataURL) */
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('champi-photos', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('thumbs');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function putThumb(id, dataURL) { try { const db = await idb(); return await new Promise((res) => { const t = db.transaction('thumbs', 'readwrite'); t.objectStore('thumbs').put(dataURL, id); t.oncomplete = res; t.onerror = res; }); } catch { /* stockage indispo */ } }
async function getThumb(id) { try { const db = await idb(); return await new Promise((res) => { const t = db.transaction('thumbs', 'readonly'); const g = t.objectStore('thumbs').get(id); g.onsuccess = () => res(g.result || null); g.onerror = () => res(null); }); } catch { return null; } }
async function delThumb(id) { try { const db = await idb(); return await new Promise((res) => { const t = db.transaction('thumbs', 'readwrite'); t.objectStore('thumbs').delete(id); t.oncomplete = res; t.onerror = res; }); } catch { /* */ } }

/* ---------- envoi d'observations au serveur (calage du modèle) ---------- */
const QKEY = 'champi.observ.queue';
const ENDPOINT = new URL('api/observ', location.href).href;

async function postObserv(payload) {
  const r = await fetch(ENDPOINT, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return r.ok;
}
export async function sendObserv(payload) {
  try { if (await postObserv(payload)) return true; } catch { /* réseau */ }
  try {
    const q = JSON.parse(localStorage.getItem(QKEY) || '[]');
    q.push(payload); localStorage.setItem(QKEY, JSON.stringify(q.slice(-50)));
  } catch { /* plein */ }
  return false;
}
async function flushQueue() {
  let q;
  try { q = JSON.parse(localStorage.getItem(QKEY) || '[]'); } catch { return; }
  if (!q.length) return;
  const rest = [];
  for (const p of q) { let ok = false; try { ok = await postObserv(p); } catch { /* */ } if (!ok) rest.push(p); }
  try { localStorage.setItem(QKEY, JSON.stringify(rest)); } catch { /* */ }
}

/* ---------- EXIF GPS (lecture directe, sans dépendance) ---------- */
export async function exifGPS(file) {
  let buf;
  try { buf = new DataView(await file.arrayBuffer()); } catch { return null; }
  if (buf.byteLength < 12 || buf.getUint16(0) !== 0xFFD8) return null;   // pas un JPEG
  // trouver le segment APP1 "Exif"
  let off = 2, tiff = -1;
  while (off + 4 < buf.byteLength) {
    const marker = buf.getUint16(off);
    if ((marker & 0xFF00) !== 0xFF00) break;
    const size = buf.getUint16(off + 2);
    if (marker === 0xFFE1 && buf.getUint32(off + 4) === 0x45786966) { tiff = off + 10; break; }
    if (marker === 0xFFDA) break;                                 // début image
    off += 2 + size;
  }
  if (tiff < 0) return null;

  const le = buf.getUint16(tiff) === 0x4949;                      // 'II' = little-endian
  const u16 = o => buf.getUint16(o, le);
  const u32 = o => buf.getUint32(o, le);
  const rat = o => u32(o) / (u32(o + 4) || 1);

  const ifd0 = tiff + u32(tiff + 4);
  let gpsIFD = 0;
  for (let i = 0; i < u16(ifd0); i++) {
    const e = ifd0 + 2 + i * 12;
    if (u16(e) === 0x8825) gpsIFD = tiff + u32(e + 8);
  }
  if (!gpsIFD || gpsIFD + 2 > buf.byteLength) return null;

  const g = {};
  for (let i = 0; i < u16(gpsIFD); i++) {
    const e = gpsIFD + 2 + i * 12, tag = u16(e);
    if (tag === 1 || tag === 3) g[tag] = String.fromCharCode(buf.getUint8(e + 8));   // N/S/E/W (ASCII inline)
    else if (tag === 2 || tag === 4) {                            // 3 RATIONAL → offset
      const p = tiff + u32(e + 8);
      g[tag] = [rat(p), rat(p + 8), rat(p + 16)];
    }
  }
  if (!g[2] || !g[4]) return null;
  const dms = a => a[0] + a[1] / 60 + a[2] / 3600;
  let lat = dms(g[2]), lon = dms(g[4]);
  if (g[1] === 'S') lat = -lat;
  if (g[3] === 'W') lon = -lon;
  if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

/* vignette JPEG réduite (≤ 640 px) en dataURL */
function thumbnail(file) {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, 640 / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = img.width * s; cv.height = img.height * s;
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      res(cv.toDataURL('image/jpeg', 0.7));
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => res(null);
    img.src = URL.createObjectURL(file);
  });
}

/* ---------- couche carte ---------- */
export function initPoints(map, { scoreAt } = {}) {
  let data = load();
  const layer = L.layerGroup().addTo(map);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  const icon = L.divIcon({
    className: 'champi-pt', iconSize: [22, 22], iconAnchor: [11, 22],
    html: '<div class="pin"></div>',
  });

  function popupHTML(f) {
    const p = f.properties, [lon, lat] = f.geometry.coordinates;
    const sc = scoreAt ? scoreAt(lat, lon) : null;
    return `<div class="pt-form" data-id="${p.id}">
      <input class="pt-label" placeholder="Nom du coin" value="${(p.label || '').replace(/"/g, '&quot;')}">
      <select class="pt-esp">${SPECIES_OPTS.map(([v, t]) => `<option value="${v}"${v === p.espece ? ' selected' : ''}>${t}</option>`).join('')}</select>
      <textarea class="pt-note" rows="2" placeholder="Notes (accès, repères…)">${p.note || ''}</textarea>
      <div class="pt-meta">${lat.toFixed(5)}, ${lon.toFixed(5)} · ${p.date || ''}</div>
      ${sc ? `<div class="pt-score">Aujourd'hui ici : <b>${sc}</b></div>` : ''}
      <div class="pt-thumb"></div>
      <div class="pt-btns"><button class="pt-save">Enregistrer</button><button class="pt-del">Supprimer</button></div>
      <div class="pt-share">
        <div class="pt-share-t">Aider à caler le modèle&nbsp;:</div>
        <label><input type="radio" name="r-${p.id}" value="trouve" checked> j'ai trouvé</label>
        <label><input type="radio" name="r-${p.id}" value="rien"> cherché, rien vu</label>
        <button class="pt-send">${p.shared ? '✓ renvoyer' : '📤 envoyer (anonyme)'}</button>
        <span class="pt-sent">${p.shared ? 'partagé le ' + String(p.shared).slice(0, 10) : ''}</span>
      </div>
    </div>`;
  }

  function bind(marker, f) {
    marker.on('popupopen', () => {
      const el = document.querySelector(`.pt-form[data-id="${f.properties.id}"]`);
      if (!el) return;
      el.querySelector('.pt-save').onclick = () => {
        f.properties.label = el.querySelector('.pt-label').value.trim();
        f.properties.espece = el.querySelector('.pt-esp').value;
        f.properties.note = el.querySelector('.pt-note').value.trim();
        save(data); marker.setPopupContent(popupHTML(f)); marker.closePopup();
      };
      el.querySelector('.pt-del').onclick = async () => {
        if (!confirm('Supprimer ce point ?')) return;
        data.features = data.features.filter(x => x.properties.id !== f.properties.id);
        await delThumb(f.properties.id); save(data); redraw();
      };
      el.querySelector('.pt-send').onclick = async () => {
        f.properties.label = el.querySelector('.pt-label').value.trim();
        f.properties.espece = el.querySelector('.pt-esp').value;
        f.properties.note = el.querySelector('.pt-note').value.trim();
        const resultat = el.querySelector(`input[name="r-${f.properties.id}"]:checked`)?.value || 'trouve';
        const sentEl = el.querySelector('.pt-sent');
        sentEl.textContent = '…';
        const [lon, lat] = f.geometry.coordinates;
        const payload = {
          lat, lon, date: f.properties.date, espece: f.properties.espece,
          resultat, note: f.properties.note, photo: await getThumb(f.properties.id),
        };
        const ok = await sendObserv(payload);
        if (ok) { f.properties.shared = new Date().toISOString(); sentEl.textContent = 'merci ! envoyé'; }
        else sentEl.textContent = 'hors-ligne — sera renvoyé plus tard';
        save(data);
      };
      getThumb(f.properties.id).then(t => {
        const box = el.querySelector('.pt-thumb');
        if (t && box) box.innerHTML = `<img src="${t}" style="max-width:100%;border-radius:6px">`;
      });
    });
  }

  const markers = new Map();
  function redraw() {
    layer.clearLayers(); markers.clear();
    for (const f of data.features) {
      const [lon, lat] = f.geometry.coordinates;
      const m = L.marker([lat, lon], { icon }).addTo(layer).bindPopup(popupHTML(f), { minWidth: 210 });
      bind(m, f);
      markers.set(f.properties.id, m);
    }
  }

  async function addPoint(lat, lon, { file } = {}) {
    const f = {
      type: 'Feature', geometry: { type: 'Point', coordinates: [+lon.toFixed(6), +lat.toFixed(6)] },
      properties: { id: uid(), label: '', espece: '', note: '', date: new Date().toISOString().slice(0, 10) },
    };
    if (file) { const th = await thumbnail(file); if (th) await putThumb(f.properties.id, th); }
    data.features.push(f); save(data); redraw();
    map.setView([lat, lon], Math.max(map.getZoom(), 13));
    markers.get(f.properties.id)?.openPopup();
  }

  /* --- contrôle : boutons d'ajout --- */
  let placing = false;
  const Ctl = L.Control.extend({
    options: { position: 'bottomright' },
    onAdd() {
      const d = L.DomUtil.create('div', 'champi-pts-ctl leaflet-bar');
      d.innerHTML = `
        <a href="#" title="Marquer ma position GPS" data-a="gps">📍</a>
        <a href="#" title="Poser un point sur la carte" data-a="tap">📌</a>
        <a href="#" title="Depuis une photo géolocalisée" data-a="photo">🖼️</a>
        <a href="#" title="Exporter / importer mes points" data-a="io">⇅</a>
        <input type="file" accept="image/*" hidden>`;
      const fileInput = d.querySelector('input');
      L.DomEvent.disableClickPropagation(d);
      d.querySelectorAll('a').forEach(a => a.onclick = e => {
        e.preventDefault();
        const act = a.dataset.a;
        if (act === 'gps') {
          a.textContent = '…';
          navigator.geolocation.getCurrentPosition(
            pos => { a.textContent = '📍'; addPoint(pos.coords.latitude, pos.coords.longitude); },
            err => { a.textContent = '📍'; alert('Position indisponible : ' + err.message); },
            { enableHighAccuracy: true, timeout: 15000 });
        } else if (act === 'tap') {
          placing = !placing;
          d.classList.toggle('placing', placing);
          map.getContainer().style.cursor = placing ? 'crosshair' : '';
        } else if (act === 'photo') {
          fileInput.click();
        } else if (act === 'io') {
          ioMenu();
        }
      });
      fileInput.onchange = async () => {
        const file = fileInput.files[0]; fileInput.value = '';
        if (!file) return;
        const g = await exifGPS(file);
        if (g) addPoint(g.lat, g.lon, { file });
        else if (confirm("Pas de coordonnées GPS dans cette photo.\nUtiliser ma position actuelle ?")) {
          navigator.geolocation.getCurrentPosition(
            pos => addPoint(pos.coords.latitude, pos.coords.longitude, { file }),
            () => alert('Position indisponible.'));
        }
      };
      return d;
    },
  });
  map.addControl(new Ctl());

  map.on('click', e => {
    if (!placing) return;
    placing = false;
    document.querySelector('.champi-pts-ctl')?.classList.remove('placing');
    map.getContainer().style.cursor = '';
    addPoint(e.latlng.lat, e.latlng.lng);
  });

  /* --- export / import --- */
  function ioMenu() {
    const n = data.features.length;
    const choice = prompt(`${n} point(s).\n1 = exporter (télécharger .geojson)\n2 = importer (fusionner un .geojson)\n(Annuler pour fermer)`);
    if (choice === '1') {
      const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/geo+json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `mes-coins-${new Date().toISOString().slice(0, 10)}.geojson`;
      a.click();
    } else if (choice === '2') {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = '.geojson,application/geo+json,application/json';
      inp.onchange = async () => {
        try {
          const j = JSON.parse(await inp.files[0].text());
          const seen = new Set(data.features.map(f => f.properties.id));
          for (const f of j.features || []) {
            f.properties = f.properties || {};
            f.properties.id ||= uid();
            if (!seen.has(f.properties.id)) { data.features.push(f); seen.add(f.properties.id); }
          }
          save(data); redraw();
          alert(`${data.features.length} points au total.`);
        } catch { alert('Fichier illisible.'); }
      };
      inp.click();
    }
  }

  redraw();
  flushQueue();                          // renvoie les observations restées hors-ligne
  addEventListener('online', flushQueue);
  return { redraw, get count() { return data.features.length; } };
}
