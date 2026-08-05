// Onglet « Modèle 3D » : jeu de photos, reconstruction, aperçu et export.

import { analyzeImage, DEFAULT_OPTIONS } from './vision.js';
import { simplifyClosed } from './geometry.js';
import { carve, surfaceNets, smoothMesh, sideView, topView } from './carve.js';
import {
  buildPrism, meshVolume, meshArea, meshBounds, checkWatertight,
  toBinarySTL, toAsciiSTL, carveToCad, centerOnBase,
} from './mesh3d.js';
import { prismToStep } from './step.js';
import { createViewer } from './scene3d.js';
import { shared } from './shared.js';

const WORK_MAX_SIDE_3D = 900; // le sculptage n'a pas besoin de la pleine résolution

const state = {
  photos: [],
  mode: 'prism',
  thickness: 10,
  resolution: 128,
  smooth: 2,
  simplify: 1.5,
  mmPerPx: null,
  axisX: null,
  baseY: null,
  mesh: null,
  stats: null,
  viewer: null,
  workFactor: null,
  sourceSize: null,
  options: { ...DEFAULT_OPTIONS },
};

const $ = (id) => document.getElementById(id);
let nextId = 1;

// ---------------------------------------------------------------------------
// Chargement des photos
// ---------------------------------------------------------------------------

async function addPhotos(files) {
  const list = [...files].filter((f) => f.type.startsWith('image/'));
  if (!list.length) return;
  setStatus(`Analyse de ${list.length} photo(s)…`);

  for (const file of list) {
    let bitmap;
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      bitmap = await createImageBitmap(file);
    }

    // Toutes les vues doivent partager la même échelle pixel : le facteur de
    // réduction est fixé par la première photo et appliqué aux suivantes.
    if (state.workFactor == null) {
      state.workFactor = Math.min(1, WORK_MAX_SIDE_3D / Math.max(bitmap.width, bitmap.height));
      state.sourceSize = { w: bitmap.width, h: bitmap.height };
    }
    const w = Math.max(1, Math.round(bitmap.width * state.workFactor));
    const h = Math.max(1, Math.round(bitmap.height * state.workFactor));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, w, h);

    const photo = {
      id: nextId++,
      name: file.name || `photo ${nextId}`,
      canvas,
      imageData: ctx.getImageData(0, 0, w, h),
      sourceSize: { w: bitmap.width, h: bitmap.height },
      role: state.photos.length === 0 ? 'top' : 'side',
      angle: 0,
      enabled: true,
    };
    analyzePhoto(photo);
    state.photos.push(photo);
  }

  autoAngles();
  autoAxis();
  renderPhotos();
  setStatus(`${state.photos.length} vue(s) chargée(s). Vérifie les rôles et les angles, puis lance la reconstruction.`);
}

function analyzePhoto(photo) {
  const res = analyzeImage(photo.imageData, state.options);
  photo.result = res;
  const main = res.main;
  if (!main) {
    photo.mask = null;
    photo.bbox = null;
    return;
  }
  const { width, height, labels } = res;
  const mask = new Uint8Array(width * height);
  let minX = width, maxX = -1, minY = height, maxY = -1;
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] !== main.id) continue;
    mask[i] = 1;
    const x = i % width;
    const y = (i - x) / width;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  photo.mask = mask;
  photo.bbox = { minX, maxX, minY, maxY };
}

/** Répartit les angles régulièrement sur les vues de côté (protocole tourne-disque). */
function autoAngles() {
  const sides = state.photos.filter((p) => p.role === 'side');
  sides.forEach((p, i) => { p.angle = (360 * i) / sides.length; });
}

/** Axe de rotation et ligne de pose déduits des silhouettes. */
function autoAxis() {
  const sides = state.photos.filter((p) => p.role === 'side' && p.bbox);
  if (sides.length) {
    state.axisX = sides.reduce((s, p) => s + (p.bbox.minX + p.bbox.maxX + 1) / 2, 0) / sides.length;
    state.baseY = Math.max(...sides.map((p) => p.bbox.maxY + 1));
  }
  $('axisX').value = state.axisX != null ? state.axisX.toFixed(1) : '';
  $('baseY').value = state.baseY != null ? state.baseY.toFixed(1) : '';
}

// ---------------------------------------------------------------------------
// Reconstruction
// ---------------------------------------------------------------------------

/**
 * Échelle en mm par pixel de travail. L'onglet Mesure travaille sur ses propres
 * images réduites : on repasse par les pixels de la photo d'origine pour que les
 * deux onglets parlent de la même chose.
 */
function resolveScale() {
  const manual = parseFloat($('scale3d').value);
  if (isFinite(manual) && manual > 0) return manual;
  return null;
}

function buildModel() {
  const scale = resolveScale();
  if (!scale) {
    setStatus('Renseigne d\'abord l\'échelle (mm par pixel) — sans elle le modèle n\'a pas de taille.', 'warn');
    return;
  }
  const usable = state.photos.filter((p) => p.enabled && p.mask);
  if (!usable.length) {
    setStatus('Aucune silhouette exploitable. Vérifie que l\'objet se détache du fond.', 'warn');
    return;
  }

  state.mmPerPx = scale;
  setStatus('Reconstruction en cours…');

  // Laisse le navigateur peindre le message avant le calcul bloquant.
  setTimeout(() => {
    const t0 = performance.now();
    try {
      state.mesh = state.mode === 'prism' ? buildPrismModel(usable, scale) : buildCarvedModel(usable, scale);
    } catch (err) {
      setStatus(`Échec de la reconstruction : ${err.message}`, 'warn');
      return;
    }
    const ms = Math.round(performance.now() - t0);

    if (!state.mesh || !state.mesh.triangles.length) {
      setStatus('Le modèle est vide : les silhouettes ne se recoupent pas. Vérifie les rôles, les angles et la position de l\'axe.', 'warn');
      state.stats = null;
      renderStats();
      return;
    }

    computeStats();
    if (state.viewer) state.viewer.setMesh(state.mesh);
    renderStats();
    setStatus(`Modèle généré en ${ms} ms — ${state.mesh.triangles.length.toLocaleString('fr-FR')} triangles.`, 'ok');
  }, 30);
}

function buildPrismModel(usable, scale) {
  const photo = usable.find((p) => p.role === 'top') || usable[0];
  const obj = photo.result.main;
  if (!obj) throw new Error('aucun objet détecté sur la vue de dessus');

  const tol = state.simplify;
  const outer = simplifyClosed(obj.contour, tol);
  const holes = (obj.holes || []).map((h) => simplifyClosed(h.contour, tol)).filter((h) => h.length >= 3);

  state.prismRings = { outer, holes, photo };
  return buildPrism(outer, holes, state.thickness, scale);
}

function buildCarvedModel(usable, scale) {
  const views = usable.map((p) => {
    const { width, height } = p.result;
    if (p.role === 'top') {
      const cx = p.bbox ? (p.bbox.minX + p.bbox.maxX + 1) / 2 : width / 2;
      const cy = p.bbox ? (p.bbox.minY + p.bbox.maxY + 1) / 2 : height / 2;
      return topView(p.mask, width, height, (p.angle * Math.PI) / 180, cx, cy);
    }
    return sideView(
      p.mask, width, height, (p.angle * Math.PI) / 180,
      state.axisX != null ? state.axisX : width / 2,
      state.baseY != null ? state.baseY : height,
    );
  });

  const grid = carve(views, { resolution: state.resolution });
  let mesh = surfaceNets(grid);
  if (!mesh.triangles.length) return mesh;
  mesh = smoothMesh(mesh, state.smooth, 0.5);
  state.prismRings = null;
  return centerOnBase(carveToCad(mesh, scale));
}

function computeStats() {
  const mesh = state.mesh;
  const b = meshBounds(mesh);
  const wt = checkWatertight(mesh);
  state.stats = {
    size: b.size,
    volume: meshVolume(mesh),
    area: meshArea(mesh),
    triangles: mesh.triangles.length,
    vertices: mesh.vertices.length,
    watertight: wt.watertight,
    boundary: wt.boundary,
  };
}

// ---------------------------------------------------------------------------
// Rendu de l'interface
// ---------------------------------------------------------------------------

function renderPhotos() {
  const box = $('photoList');
  if (!state.photos.length) {
    box.innerHTML = '<p class="muted">Aucune photo. Dépose ici les vues de ton objet.</p>';
    return;
  }

  box.innerHTML = state.photos.map((p) => {
    const ok = !!p.mask;
    const dims = p.bbox ? `${p.bbox.maxX - p.bbox.minX + 1} × ${p.bbox.maxY - p.bbox.minY + 1} px` : 'aucune silhouette';
    return `<div class="photo-card${p.enabled ? '' : ' off'}" data-id="${p.id}">
      <canvas class="thumb" data-thumb="${p.id}" width="120" height="90"></canvas>
      <div class="photo-body">
        <div class="photo-name" title="${p.name}">${p.name}</div>
        <div class="photo-meta ${ok ? '' : 'warn'}">${dims}</div>
        <div class="photo-controls">
          <select data-role="${p.id}">
            <option value="top"${p.role === 'top' ? ' selected' : ''}>Dessus</option>
            <option value="side"${p.role === 'side' ? ' selected' : ''}>Côté</option>
          </select>
          <input type="number" data-angle="${p.id}" value="${p.angle}" step="1" title="Angle de rotation de l'objet (°)">
          <span class="deg">°</span>
          <button data-remove="${p.id}" title="Retirer cette vue">✕</button>
        </div>
      </div>
    </div>`;
  }).join('');

  for (const p of state.photos) {
    const c = box.querySelector(`[data-thumb="${p.id}"]`);
    if (c) drawThumb(c, p);
  }
  box.querySelectorAll('[data-role]').forEach((el) => el.addEventListener('change', () => {
    const p = state.photos.find((x) => x.id === +el.dataset.role);
    p.role = el.value;
    autoAxis();
    renderPhotos();
  }));
  box.querySelectorAll('[data-angle]').forEach((el) => el.addEventListener('change', () => {
    const p = state.photos.find((x) => x.id === +el.dataset.angle);
    p.angle = parseFloat(el.value) || 0;
  }));
  box.querySelectorAll('[data-remove]').forEach((el) => el.addEventListener('click', () => {
    state.photos = state.photos.filter((x) => x.id !== +el.dataset.remove);
    if (!state.photos.length) { state.workFactor = null; state.sourceSize = null; }
    autoAxis();
    renderPhotos();
  }));
}

function drawThumb(canvas, photo) {
  const ctx = canvas.getContext('2d');
  const { width: w, height: h } = photo.canvas;
  const k = Math.min(canvas.width / w, canvas.height / h);
  const dw = w * k;
  const dh = h * k;
  const ox = (canvas.width - dw) / 2;
  const oy = (canvas.height - dh) / 2;
  ctx.fillStyle = '#0b1220';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(photo.canvas, ox, oy, dw, dh);

  if (!photo.mask) return;
  // Silhouette en surimpression, sous-échantillonnée pour rester rapide
  ctx.fillStyle = 'rgba(56,189,248,.45)';
  const step = Math.max(1, Math.round(1 / k));
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      if (photo.mask[y * w + x]) ctx.fillRect(ox + x * k, oy + y * k, Math.max(1, k * step), Math.max(1, k * step));
    }
  }
  if (photo.role === 'side' && state.axisX != null) {
    ctx.strokeStyle = '#f97316';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(ox + state.axisX * k, oy);
    ctx.lineTo(ox + state.axisX * k, oy + dh);
    ctx.stroke();
    if (state.baseY != null) {
      ctx.beginPath();
      ctx.moveTo(ox, oy + state.baseY * k);
      ctx.lineTo(ox + dw, oy + state.baseY * k);
      ctx.stroke();
    }
  }
}

function renderStats() {
  const box = $('model3dStats');
  const s = state.stats;
  if (!s) {
    box.innerHTML = '<p class="muted">Pas encore de modèle.</p>';
    $('exportStl').disabled = true;
    $('exportStlAscii').disabled = true;
    $('exportStep').disabled = true;
    return;
  }
  const mm = (v) => `${v.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} mm`;
  const cm3 = s.volume / 1000;

  box.innerHTML = `
    <div class="row"><span class="row-label">Encombrement</span><span class="row-value">${mm(s.size.x)} × ${mm(s.size.y)} × ${mm(s.size.z)}</span><span class="row-px"></span></div>
    <div class="row"><span class="row-label">Volume</span><span class="row-value">${cm3.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} cm³</span><span class="row-px">${Math.round(s.volume).toLocaleString('fr-FR')} mm³</span></div>
    <div class="row"><span class="row-label">Surface</span><span class="row-value">${(s.area / 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} cm²</span><span class="row-px"></span></div>
    <div class="row"><span class="row-label">Maillage</span><span class="row-value">${s.triangles.toLocaleString('fr-FR')} triangles</span><span class="row-px">${s.vertices.toLocaleString('fr-FR')} sommets</span></div>
    <div class="row"><span class="row-label">Solide fermé</span><span class="row-value">${s.watertight ? 'oui' : `non (${s.boundary} arêtes libres)`}</span><span class="row-px"></span></div>
  `;

  $('exportStl').disabled = false;
  $('exportStlAscii').disabled = false;
  $('exportStep').disabled = state.mode !== 'prism' || !state.prismRings;

  const note = [];
  if (!s.watertight) note.push(['warn', 'Le maillage n\'est pas parfaitement fermé : l\'impression 3D peut le refuser. Baisse la résolution ou lisse davantage.']);
  if (state.mode === 'carve') {
    note.push(['info', 'Le sculptage par silhouettes reconstruit l\'enveloppe visible : les creux qui ne se voient sur aucune silhouette (poche intérieure, contre-dépouille) ne peuvent pas apparaître.']);
    note.push(['info', 'L\'export STEP est réservé au mode Prisme : convertir ce maillage en STEP ne donnerait qu\'un amas de facettes, inexploitable en CAO.']);
  }
  if (state.mode === 'prism') {
    note.push(['ok', 'Mode prisme : le STEP produit est une géométrie exacte (plans et droites), directement reprenable en CAO.']);
  }
  $('model3dNotes').innerHTML = note.map(([k, t]) => `<p class="note ${k}">${t}</p>`).join('');
}

function setStatus(text, kind = 'info') {
  const el = $('status3d');
  el.textContent = text;
  el.className = `status ${kind}`;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

function download(name, data, type) {
  const blob = new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function baseName() {
  const first = state.photos[0];
  return (first ? first.name.replace(/\.[^.]+$/, '') : 'modele').replace(/[^\w-]+/g, '_');
}

// ---------------------------------------------------------------------------
// Câblage
// ---------------------------------------------------------------------------

export function init3d() {
  const dz = $('dropzone3d');
  $('fileInput3d').addEventListener('change', (e) => addPhotos(e.target.files));
  $('pickFiles3d').addEventListener('click', () => $('fileInput3d').click());
  ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => {
    e.preventDefault();
    dz.classList.add('dragging');
  }));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => {
    e.preventDefault();
    dz.classList.remove('dragging');
  }));
  dz.addEventListener('drop', (e) => addPhotos(e.dataTransfer.files));

  $('mode3d').addEventListener('change', (e) => {
    state.mode = e.target.value;
    $('prismFields').hidden = state.mode !== 'prism';
    $('carveFields').hidden = state.mode !== 'carve';
    renderStats();
  });

  const bindNumber = (id, key, transform = parseFloat) => {
    $(id).addEventListener('input', () => {
      const v = transform($(id).value);
      if (isFinite(v)) state[key] = v;
      const out = $(`${id}Out`);
      if (out) out.textContent = $(id).value;
    });
  };
  bindNumber('thickness', 'thickness');
  bindNumber('resolution', 'resolution', (v) => parseInt(v, 10));
  bindNumber('smooth', 'smooth', (v) => parseInt(v, 10));
  bindNumber('simplify', 'simplify');
  $('axisX').addEventListener('input', () => {
    state.axisX = parseFloat($('axisX').value);
    renderPhotos();
  });
  $('baseY').addEventListener('input', () => {
    state.baseY = parseFloat($('baseY').value);
    renderPhotos();
  });

  $('useMeasureScale').addEventListener('click', () => {
    if (!shared.mmPerPx) {
      setStatus('Aucune échelle définie dans l\'onglet Mesure pour l\'instant.', 'warn');
      return;
    }
    // L'onglet Mesure travaille sur une réduction différente : on convertit via
    // les pixels de la photo d'origine.
    const measureFactor = shared.workFactor || 1;
    const factor = state.workFactor || 1;
    const value = (shared.mmPerPx * measureFactor) / factor;
    $('scale3d').value = value.toFixed(5);
    setStatus(`Échelle reprise de l'onglet Mesure : ${value.toFixed(4)} mm par pixel.`, 'ok');
  });

  $('autoAngles').addEventListener('click', () => {
    autoAngles();
    renderPhotos();
    setStatus('Angles répartis régulièrement sur les vues de côté.');
  });
  $('autoAxis').addEventListener('click', () => {
    autoAxis();
    renderPhotos();
    setStatus('Axe de rotation et ligne de pose redéduits des silhouettes.');
  });

  $('build3d').addEventListener('click', buildModel);
  $('wireframe').addEventListener('change', (e) => {
    if (state.viewer) state.viewer.setWireframe(e.target.checked);
  });

  $('exportStl').addEventListener('click', () => {
    if (!state.mesh) return;
    download(`${baseName()}.stl`, toBinarySTL(state.mesh, baseName()), 'model/stl');
  });
  $('exportStlAscii').addEventListener('click', () => {
    if (!state.mesh) return;
    download(`${baseName()}-ascii.stl`, toAsciiSTL(state.mesh, baseName()), 'model/stl');
  });
  $('exportStep').addEventListener('click', () => {
    if (!state.prismRings) return;
    const { outer, holes } = state.prismRings;
    const k = state.mmPerPx;
    const conv = (ring) => ring.map((p) => ({ x: p.x * k, y: -p.y * k }));
    const step = prismToStep(conv(outer), holes.map(conv), state.thickness, baseName());
    download(`${baseName()}.step`, step, 'application/step');
  });

  try {
    state.viewer = createViewer($('viewer3d'));
    if (!state.viewer) $('viewerFallback').hidden = false;
  } catch (err) {
    $('viewerFallback').hidden = false;
  }

  renderPhotos();
  renderStats();
}
