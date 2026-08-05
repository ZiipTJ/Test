// Interface : chargement de la photo, réglages de détection, calibration, mesures.

import { analyzeImage, toRealUnits, DEFAULT_OPTIONS } from './vision.js';
import { fitPrimitives, groupRadii } from './fitshapes.js';
import { init3d } from './app3d.js';
import { shared } from './shared.js';

const WORK_MAX_SIDE = 1400; // l'analyse tourne sur une image redimensionnée (rapidité)

const REFERENCES = [
  { id: 'custom', label: 'Longueur saisie à la main', mm: null },
  { id: 'cb', label: 'Carte bancaire (85,60 mm de long)', mm: 85.6 },
  { id: 'cb-h', label: 'Carte bancaire (53,98 mm de haut)', mm: 53.98 },
  { id: 'a4-l', label: 'Feuille A4 (297 mm de long)', mm: 297 },
  { id: 'a4-w', label: 'Feuille A4 (210 mm de large)', mm: 210 },
  { id: 'a5-l', label: 'Feuille A5 (210 mm de long)', mm: 210 },
  { id: 'e2', label: 'Pièce de 2 € (Ø 25,75 mm)', mm: 25.75 },
  { id: 'e1', label: 'Pièce de 1 € (Ø 23,25 mm)', mm: 23.25 },
  { id: 'e050', label: 'Pièce de 50 cts (Ø 24,25 mm)', mm: 24.25 },
  { id: 'e020', label: 'Pièce de 20 cts (Ø 22,25 mm)', mm: 22.25 },
  { id: 'e010', label: 'Pièce de 10 cts (Ø 19,75 mm)', mm: 19.75 },
];

const UNITS = {
  mm: { label: 'mm', factor: 1, decimals: 1 },
  cm: { label: 'cm', factor: 0.1, decimals: 2 },
  m: { label: 'm', factor: 0.001, decimals: 4 },
  in: { label: 'in', factor: 1 / 25.4, decimals: 3 },
};

const state = {
  source: null,          // canvas plein format
  work: null,            // canvas à la résolution d'analyse
  imageData: null,
  result: null,
  selected: 0,
  mmPerPx: null,
  calibration: null,     // { method, detail }
  unit: 'mm',
  tool: 'select',
  drag: null,
  calibSegment: null,
  measures: [],
  fileName: '',
  options: { ...DEFAULT_OPTIONS },
  view: { mask: true, contour: true, rect: false, feret: false, radii: true },
  fit: null,
  fitOptions: { smooth: 2, minSweepDeg: 15 },
  highlight: -1,
};

// En deçà de ce rayon en pixels, l'ajustement de cercle n'a plus assez de
// matière : le rayon sort systématiquement sous-estimé et instable.
const RADIUS_RELIABLE_PX = 20;

const $ = (id) => document.getElementById(id);
const canvas = $('canvas');
const ctx = canvas.getContext('2d');

// ---------------------------------------------------------------------------
// Chargement de l'image
// ---------------------------------------------------------------------------

async function loadFile(file) {
  if (!file || !file.type.startsWith('image/')) {
    setStatus('Ce fichier n\'est pas une image.', 'warn');
    return;
  }
  setStatus('Lecture de la photo…');
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (err) {
    bitmap = await createImageBitmap(file);
  }

  const source = document.createElement('canvas');
  source.width = bitmap.width;
  source.height = bitmap.height;
  source.getContext('2d').drawImage(bitmap, 0, 0);

  const scale = Math.min(1, WORK_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const work = document.createElement('canvas');
  work.width = Math.max(1, Math.round(bitmap.width * scale));
  work.height = Math.max(1, Math.round(bitmap.height * scale));
  const wctx = work.getContext('2d');
  wctx.imageSmoothingQuality = 'high';
  wctx.drawImage(bitmap, 0, 0, work.width, work.height);

  state.source = source;
  state.work = work;
  state.workFactor = scale;
  state.imageData = wctx.getImageData(0, 0, work.width, work.height);
  state.fileName = file.name || 'photo';
  state.selected = 0;
  state.measures = [];
  state.calibSegment = null;
  state.mmPerPx = null;
  state.calibration = null;

  canvas.width = work.width;
  canvas.height = work.height;
  $('dropzone').classList.add('has-image');
  $('imageInfo').textContent = `${state.fileName} — ${bitmap.width} × ${bitmap.height} px (analyse à ${work.width} × ${work.height})`;

  analyze();
}

// ---------------------------------------------------------------------------
// Analyse
// ---------------------------------------------------------------------------

function analyze() {
  if (!state.imageData) return;
  const t0 = performance.now();
  state.result = analyzeImage(state.imageData, state.options);
  const ms = Math.round(performance.now() - t0);

  if (!state.result.objects.length) {
    setStatus('Aucun objet détecté. Augmente la sensibilité ou vérifie que le fond est bien uniforme.', 'warn');
  } else {
    state.selected = Math.min(state.selected, state.result.objects.length - 1);
    setStatus(`${state.result.objects.length} objet(s) détecté(s) en ${ms} ms — seuil de luminance ${Math.round(state.result.threshold)} / fond ${Math.round(state.result.backgroundLuminance)}.`);
  }
  computeFit();
  applyCalibration();
  renderAll();
}

/** Décompose le contour de l'objet sélectionné en droites et arcs. */
function computeFit() {
  const obj = currentObject();
  state.highlight = -1;
  if (!obj || !obj.contour || obj.contour.length < 16) {
    state.fit = null;
    return;
  }
  state.fit = fitPrimitives(obj.contour, state.fitOptions);
  state.fit.groups = groupRadii(state.fit.primitives);
}

function currentObject() {
  if (!state.result || !state.result.objects.length) return null;
  return state.result.objects[state.selected] || state.result.objects[0];
}

// ---------------------------------------------------------------------------
// Calibration
// ---------------------------------------------------------------------------

function applyCalibration() {
  const method = $('calibMethod').value;
  const obj = currentObject();
  const known = parseFloat($('calibValue').value);
  const refId = $('calibRef').value;
  const ref = REFERENCES.find((r) => r.id === refId);
  const refMm = ref && ref.mm != null ? ref.mm : known;

  state.mmPerPx = null;
  state.calibration = null;

  if (method === 'object') {
    if (!obj || !isFinite(known) || known <= 0) return;
    const target = $('calibTarget').value; // length | width | diagonal
    const px = obj.px[target];
    if (!px) return;
    state.mmPerPx = known / px;
    state.calibration = { method: 'Cote connue sur l\'objet', detail: `${labelOf(target)} = ${known} mm sur ${px.toFixed(1)} px` };
  } else if (method === 'segment') {
    if (!state.calibSegment || !isFinite(refMm) || refMm <= 0) return;
    const { a, b } = state.calibSegment;
    const px = Math.hypot(b.x - a.x, b.y - a.y);
    if (px < 2) return;
    state.mmPerPx = refMm / px;
    state.calibration = { method: 'Segment tracé', detail: `${fmtNum(refMm)} mm sur ${px.toFixed(1)} px` };
  } else if (method === 'reference') {
    const refObj = state.result && state.result.objects[parseInt($('calibRefObject').value, 10)];
    if (!refObj || !isFinite(refMm) || refMm <= 0) return;
    const target = $('calibRefTarget').value;
    const px = refObj.px[target];
    if (!px) return;
    state.mmPerPx = refMm / px;
    state.calibration = { method: 'Objet de référence', detail: `${ref && ref.mm ? ref.label : `${fmtNum(refMm)} mm`} sur ${px.toFixed(1)} px` };
  }

  publishScale();
}

/** Publie l'échelle pour l'onglet Modèle 3D. */
function publishScale() {
  shared.mmPerPx = state.mmPerPx;
  shared.workFactor = state.workFactor || 1;
  shared.calibration = state.calibration;
  shared.fileName = state.fileName;
}

function labelOf(key) {
  return { length: 'Longueur', width: 'Largeur', diagonal: 'Diagonale', equivalentDiameter: 'Diamètre' }[key] || key;
}

// ---------------------------------------------------------------------------
// Rendu
// ---------------------------------------------------------------------------

function renderAll() {
  drawCanvas();
  renderObjectList();
  renderResults();
  renderRadii();
  renderMeasures();
  renderCalibrationPanel();
}

function drawCanvas() {
  if (!state.work) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(state.work, 0, 0);

  const res = state.result;
  if (res && state.view.mask) drawMaskTint(res);

  if (res) {
    res.objects.forEach((obj, i) => {
      const active = i === state.selected;
      if (state.view.contour) drawContour(obj, active);
      if (state.view.rect && obj.rect) drawRect(obj, active);
      if (state.view.feret && active) drawFeret(obj);
    });
  }

  if (res && state.view.radii && state.fit) drawPrimitives();

  if (state.calibSegment) drawSegment(state.calibSegment, '#f59e0b', 'calibration');
  state.measures.forEach((m, i) => drawSegment(m, '#22d3ee', `M${i + 1} · ${formatLength(dist(m) * (state.mmPerPx || 0)) || `${dist(m).toFixed(0)} px`}`));
  if (state.drag && state.drag.b) {
    drawSegment(state.drag, state.tool === 'calibrate' ? '#f59e0b' : '#22d3ee', '');
  }
}

function drawMaskTint(res) {
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const labels = res.labels;
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] < 0) continue;
    const isMain = labels[i] === (currentObject() ? currentObject().id : -1);
    const p = i * 4;
    img.data[p] = img.data[p] * 0.55 + (isMain ? 56 : 120) * 0.45;
    img.data[p + 1] = img.data[p + 1] * 0.55 + (isMain ? 189 : 120) * 0.45;
    img.data[p + 2] = img.data[p + 2] * 0.55 + (isMain ? 248 : 140) * 0.45;
  }
  ctx.putImageData(img, 0, 0);
}

function drawContour(obj, active) {
  const pts = obj.outline.length >= 3 ? obj.outline : obj.contour;
  if (pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0].x + 0.5, pts[0].y + 0.5);
  for (const p of pts) ctx.lineTo(p.x + 0.5, p.y + 0.5);
  ctx.closePath();
  ctx.lineWidth = active ? 2 : 1;
  ctx.strokeStyle = active ? '#38bdf8' : 'rgba(148,163,184,.8)';
  ctx.stroke();
}

function drawRect(obj, active) {
  const c = obj.rect.corners;
  ctx.beginPath();
  ctx.moveTo(c[0].x, c[0].y);
  for (let i = 1; i < c.length; i++) ctx.lineTo(c[i].x, c[i].y);
  ctx.closePath();
  ctx.setLineDash(active ? [] : [6, 4]);
  ctx.lineWidth = active ? 2 : 1;
  ctx.strokeStyle = active ? '#f97316' : 'rgba(249,115,22,.5)';
  ctx.stroke();
  ctx.setLineDash([]);

  if (!active) return;
  const longMid = [mid(c[0], c[1]), mid(c[2], c[3])];
  const shortMid = [mid(c[1], c[2]), mid(c[3], c[0])];
  const lengthEdge = Math.hypot(c[1].x - c[0].x, c[1].y - c[0].y) >= Math.hypot(c[2].x - c[1].x, c[2].y - c[1].y);
  const lText = formatLength(state.mmPerPx ? obj.px.length * state.mmPerPx : null) || `${obj.px.length.toFixed(0)} px`;
  const wText = formatLength(state.mmPerPx ? obj.px.width * state.mmPerPx : null) || `${obj.px.width.toFixed(0)} px`;
  labelAt(lengthEdge ? mid(c[0], c[1]) : mid(c[1], c[2]), lText, '#f97316');
  labelAt(lengthEdge ? mid(c[1], c[2]) : mid(c[0], c[1]), wText, '#f97316');
  void longMid; void shortMid;
}

/** Trace les droites et les arcs ajustés, avec leur cote. */
function drawPrimitives() {
  const prims = state.fit.primitives;
  const scale = Math.max(1, canvas.width / 900);

  prims.forEach((p, i) => {
    const active = i === state.highlight;
    ctx.lineWidth = (active ? 4 : 2.5) * scale;

    if (p.type === 'arc') {
      ctx.strokeStyle = active ? '#f0abfc' : '#c084fc';
      ctx.beginPath();
      ctx.arc(p.center.x, p.center.y, p.radius, p.startAngle, p.startAngle + p.sweep, p.sweep < 0);
      ctx.stroke();
      // repère du centre
      ctx.beginPath();
      ctx.arc(p.center.x, p.center.y, 2.5 * scale, 0, Math.PI * 2);
      ctx.fillStyle = active ? '#f0abfc' : 'rgba(192,132,252,.7)';
      ctx.fill();
    } else {
      ctx.strokeStyle = active ? '#6ee7b7' : '#34d399';
      ctx.beginPath();
      ctx.moveTo(p.a.x, p.a.y);
      ctx.lineTo(p.b.x, p.b.y);
      ctx.stroke();
    }
  });

  // Étiquettes dans un second temps, pour qu'aucun tracé ne passe dessus.
  prims.forEach((p, i) => {
    const active = i === state.highlight;
    if (p.type === 'arc') {
      const mid = p.startAngle + p.sweep / 2;
      const out = p.radius + 16 * scale;
      const pos = { x: p.center.x + out * Math.cos(mid), y: p.center.y + out * Math.sin(mid) };
      const text = state.mmPerPx ? `R${fmtNum(p.radius * state.mmPerPx, 1)}` : `R${p.radius.toFixed(0)} px`;
      labelAt(pos, text, p.radius < RADIUS_RELIABLE_PX ? '#fbbf24' : (active ? '#f0abfc' : '#c084fc'));
    } else if (p.length > 26) {
      const text = state.mmPerPx ? formatLength(p.length * state.mmPerPx) : `${p.length.toFixed(0)} px`;
      labelAt(mid(p.a, p.b), text, active ? '#6ee7b7' : '#34d399');
    }
  });
}

function drawFeret(obj) {
  if (!obj.feret || !obj.feret.a) return;
  ctx.beginPath();
  ctx.moveTo(obj.feret.a.x, obj.feret.a.y);
  ctx.lineTo(obj.feret.b.x, obj.feret.b.y);
  ctx.strokeStyle = '#a78bfa';
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 3]);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawSegment(seg, color, label) {
  ctx.beginPath();
  ctx.moveTo(seg.a.x, seg.a.y);
  ctx.lineTo(seg.b.x, seg.b.y);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();
  for (const p of [seg.a, seg.b]) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }
  if (label) labelAt(mid(seg.a, seg.b), label, color);
}

function labelAt(p, text, color) {
  const scale = Math.max(1, canvas.width / 900);
  ctx.font = `${Math.round(13 * scale)}px ui-sans-serif, system-ui, sans-serif`;
  const w = ctx.measureText(text).width + 10 * scale;
  const h = 20 * scale;
  ctx.fillStyle = 'rgba(15,23,42,.82)';
  ctx.fillRect(p.x - w / 2, p.y - h / 2, w, h);
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, p.x, p.y);
}

const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const dist = (s) => Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);

// ---------------------------------------------------------------------------
// Panneaux
// ---------------------------------------------------------------------------

function renderObjectList() {
  const box = $('objectList');
  const res = state.result;
  if (!res || !res.objects.length) {
    box.innerHTML = '<p class="muted">Aucun objet détecté.</p>';
    return;
  }
  box.innerHTML = res.objects.map((obj, i) => {
    const l = state.mmPerPx ? formatLength(obj.px.length * state.mmPerPx) : `${obj.px.length.toFixed(0)} px`;
    const w = state.mmPerPx ? formatLength(obj.px.width * state.mmPerPx) : `${obj.px.width.toFixed(0)} px`;
    return `<button class="object-chip${i === state.selected ? ' active' : ''}" data-index="${i}">
      <span class="chip-title">Objet ${i + 1}${i === 0 ? ' (le plus grand)' : ''}</span>
      <span class="chip-dims">${l} × ${w}</span>
    </button>`;
  }).join('');
  box.querySelectorAll('.object-chip').forEach((el) => {
    el.addEventListener('click', () => {
      state.selected = parseInt(el.dataset.index, 10);
      computeFit();
      applyCalibration();
      renderAll();
    });
  });
}

function renderResults() {
  const obj = currentObject();
  const box = $('results');
  if (!obj) {
    box.innerHTML = '<p class="muted">Charge une photo pour obtenir les cotes.</p>';
    $('warnings').innerHTML = '';
    return;
  }

  const k = state.mmPerPx;
  const real = k ? toRealUnits(obj.px, k) : null;
  const row = (label, mmValue, pxValue, hint = '') => `
    <div class="row">
      <span class="row-label">${label}${hint ? `<em>${hint}</em>` : ''}</span>
      <span class="row-value">${mmValue != null ? formatLength(mmValue) : '—'}</span>
      <span class="row-px">${pxValue}</span>
    </div>`;

  const areaRow = (label, mm2, px2) => `
    <div class="row">
      <span class="row-label">${label}</span>
      <span class="row-value">${mm2 != null ? formatArea(mm2) : '—'}</span>
      <span class="row-px">${Math.round(px2).toLocaleString('fr-FR')} px²</span>
    </div>`;

  box.innerHTML = `
    <div class="row head"><span>Cote</span><span>Mesure</span><span>Pixels</span></div>
    ${row('Longueur', real && real.length, `${obj.px.length.toFixed(1)} px`, 'grand côté du rectangle mini')}
    ${row('Largeur', real && real.width, `${obj.px.width.toFixed(1)} px`, 'petit côté')}
    ${row('Diagonale max (Feret)', real && real.diagonal, `${obj.px.diagonal.toFixed(1)} px`)}
    ${row('Encombrement horizontal', real && real.bboxWidth, `${obj.px.bboxWidth} px`, 'dans le repère de la photo')}
    ${row('Encombrement vertical', real && real.bboxHeight, `${obj.px.bboxHeight} px`)}
    ${row('Périmètre', real && real.perimeter, `${obj.px.perimeter.toFixed(1)} px`)}
    ${row('Diamètre équivalent', real && real.equivalentDiameter, `${obj.px.equivalentDiameter.toFixed(1)} px`, 'disque de même aire')}
    ${areaRow('Aire silhouette', real && real.areaGross, obj.px.areaGross)}
    ${areaRow('Aire matière (trous déduits)', real && real.areaNet, obj.px.areaNet)}
    <div class="row"><span class="row-label">Inclinaison sur la photo</span><span class="row-value">${(((obj.px.angle * 180) / Math.PI + 180) % 180).toFixed(1)}°</span><span class="row-px"></span></div>
    <div class="row"><span class="row-label">Remplissage du rectangle</span><span class="row-value">${(obj.ratios.fill * 100).toFixed(1)} %</span><span class="row-px"></span></div>
    <div class="row"><span class="row-label">Circularité</span><span class="row-value">${obj.ratios.circularity.toFixed(3)}</span><span class="row-px">1 = cercle parfait</span></div>
    ${obj.px.holeArea > 0 ? `<div class="row"><span class="row-label">Trous / découpes</span><span class="row-value">${(obj.ratios.holes * 100).toFixed(1)} % de la silhouette</span><span class="row-px"></span></div>` : ''}
  `;

  renderWarnings(obj);
}

function renderWarnings(obj) {
  const list = [];
  if (!state.mmPerPx) {
    list.push(['info', 'Pas encore d\'échelle : les cotes restent en pixels. Renseigne une cote connue ou trace un segment de référence.']);
  }
  if (obj.touchesBorder) {
    list.push(['warn', 'L\'objet touche le bord de la photo : une partie est peut-être coupée, la cote sera fausse.']);
  }
  if (obj.ratios.fill > 0.995 && obj.px.areaGross > 0.5 * state.result.width * state.result.height) {
    list.push(['warn', 'L\'objet occupe presque toute l\'image : recule un peu pour garder du fond blanc autour.']);
  }
  const check = parseFloat($('checkValue').value);
  const checkTarget = $('checkTarget').value;
  if (state.mmPerPx && isFinite(check) && check > 0) {
    const measured = obj.px[checkTarget] * state.mmPerPx;
    const err = ((measured - check) / check) * 100;
    const level = Math.abs(err) <= 1 ? 'ok' : Math.abs(err) <= 3 ? 'info' : 'warn';
    list.push([level, `Contrôle : ${labelOf(checkTarget).toLowerCase()} mesurée ${formatLength(measured)} contre ${formatLength(check)} annoncés — écart ${err >= 0 ? '+' : ''}${err.toFixed(1)} %.`
      + (Math.abs(err) > 3 ? ' Un écart de cet ordre vient presque toujours d\'une prise de vue penchée ou d\'un objet épais photographié de trop près.' : '')]);
  }
  $('warnings').innerHTML = list.map(([kind, text]) => `<p class="note ${kind}">${text}</p>`).join('');
}

/** Panneau de lecture des rayons et des méplats. */
function renderRadii() {
  const box = $('radiiPanel');
  const summary = $('radiiSummary');
  if (!state.fit || !state.fit.primitives.length) {
    box.innerHTML = '<p class="muted">Charge une photo : le contour sera décomposé en droites et en arcs.</p>';
    summary.innerHTML = '';
    return;
  }

  const k = state.mmPerPx;
  const prims = state.fit.primitives;
  const groups = state.fit.groups;
  const fmtR = (px) => (k ? `R${fmtNum(px * k, 2)} ${UNITS[state.unit].label === 'mm' ? 'mm' : UNITS[state.unit].label}` : `R${px.toFixed(1)} px`);

  summary.innerHTML = groups.length
    ? groups.map((g) => {
      const doubtful = g.radius < RADIUS_RELIABLE_PX;
      const spread = g.count > 1 ? ` <em>(${fmtNum(g.min * (k || 1), 1)} à ${fmtNum(g.max * (k || 1), 1)})</em>` : '';
      return `<div class="radius-chip${doubtful ? ' doubtful' : ''}">
          <span class="radius-count">${g.count} ×</span>
          <strong>${k ? `R${fmtNum(g.radius * k, 2)}` : `R${g.radius.toFixed(1)} px`}</strong>
          ${k ? `<span class="radius-unit">${UNITS[state.unit].label}</span>` : ''}
          ${spread}
        </div>`;
    }).join('')
    : '<p class="muted">Aucun arc détecté : le contour est entièrement rectiligne.</p>';

  box.innerHTML = `<div class="row head"><span>Élément</span><span>Cote</span><span>Étendue</span></div>` + prims.map((p, i) => {
    if (p.type === 'arc') {
      const deg = Math.abs((p.sweep * 180) / Math.PI);
      const doubtful = p.radius < RADIUS_RELIABLE_PX;
      return `<div class="row prim${doubtful ? ' doubtful' : ''}" data-prim="${i}">
        <span class="row-label">${p.full ? 'Cercle' : 'Arc'} ${p.concave ? '(rentrant)' : ''}${doubtful ? '<em>rayon trop petit dans l\'image</em>' : ''}</span>
        <span class="row-value">${fmtR(p.radius)}</span>
        <span class="row-px">${deg.toFixed(0)}°</span>
      </div>`;
    }
    return `<div class="row prim" data-prim="${i}">
      <span class="row-label">Méplat</span>
      <span class="row-value">${k ? formatLength(p.length * k) : `${p.length.toFixed(1)} px`}</span>
      <span class="row-px">${(((p.angle * 180) / Math.PI + 180) % 180).toFixed(0)}°</span>
    </div>`;
  }).join('');

  box.querySelectorAll('[data-prim]').forEach((el) => {
    el.addEventListener('click', () => {
      const i = parseInt(el.dataset.prim, 10);
      state.highlight = state.highlight === i ? -1 : i;
      box.querySelectorAll('[data-prim]').forEach((r) => r.classList.toggle('active', +r.dataset.prim === state.highlight));
      drawCanvas();
    });
  });

  const notes = [];
  const small = prims.filter((p) => p.type === 'arc' && p.radius < RADIUS_RELIABLE_PX).length;
  if (small) {
    notes.push(`<p class="note warn">${small} arc(s) font moins de ${RADIUS_RELIABLE_PX} px de rayon sur la photo. En dessous de ce seuil l'ajustement manque de matière et sous-estime le rayon de 10 à 30 %. Reprends la photo de plus près, ou en plus haute définition.</p>`);
  }
  if (!k) {
    notes.push('<p class="note info">Les rayons sont en pixels tant que l\'échelle n\'est pas donnée. Renseigne une cote connue dans le panneau Échelle.</p>');
  }
  $('radiiNotes').innerHTML = notes.join('');
}

function renderMeasures() {
  const box = $('measureList');
  if (!state.measures.length) {
    box.innerHTML = '<p class="muted">Choisis l\'outil « Mesurer » puis trace un segment sur la photo pour relever une cote libre.</p>';
    return;
  }
  box.innerHTML = state.measures.map((m, i) => {
    const px = dist(m);
    const real = state.mmPerPx ? formatLength(px * state.mmPerPx) : `${px.toFixed(1)} px`;
    return `<div class="measure-row"><span>M${i + 1}</span><strong>${real}</strong><span class="row-px">${px.toFixed(1)} px</span><button data-index="${i}" title="Supprimer">✕</button></div>`;
  }).join('');
  box.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    state.measures.splice(parseInt(b.dataset.index, 10), 1);
    renderAll();
  }));
}

function renderCalibrationPanel() {
  const method = $('calibMethod').value;
  $('calibObjectFields').hidden = method !== 'object';
  $('calibSegmentFields').hidden = method !== 'segment';
  $('calibRefFields').hidden = method !== 'reference';

  const ref = REFERENCES.find((r) => r.id === $('calibRef').value);
  $('calibRefWrap').hidden = method === 'object';
  $('calibValueWrap').hidden = !(method === 'object' || (ref && ref.mm == null));
  $('calibValueLabel').textContent = method === 'object'
    ? `Valeur réelle de cette cote (mm)`
    : 'Longueur réelle de la référence (mm)';

  const sel = $('calibRefObject');
  const objects = (state.result && state.result.objects) || [];
  const keep = sel.value;
  sel.innerHTML = objects.map((o, i) => `<option value="${i}">Objet ${i + 1} — ${o.px.length.toFixed(0)} × ${o.px.width.toFixed(0)} px</option>`).join('');
  if (keep && keep < objects.length) sel.value = keep;

  const badge = $('scaleBadge');
  if (state.mmPerPx) {
    const pxPerMm = 1 / state.mmPerPx;
    badge.className = 'scale-badge ok';
    badge.innerHTML = `Échelle : <strong>${state.mmPerPx.toFixed(4)} mm/px</strong> (${pxPerMm.toFixed(2)} px/mm) · ${state.calibration ? state.calibration.method : ''}<br><span class="muted">${state.calibration ? state.calibration.detail : ''}</span>`;
  } else {
    badge.className = 'scale-badge';
    badge.textContent = 'Échelle non définie — les cotes sont en pixels.';
  }
}

// ---------------------------------------------------------------------------
// Formatage
// ---------------------------------------------------------------------------

function fmtNum(v, d = 2) {
  return Number(v).toLocaleString('fr-FR', { maximumFractionDigits: d });
}

function formatLength(mm) {
  if (mm == null || !isFinite(mm)) return null;
  const u = UNITS[state.unit];
  return `${(mm * u.factor).toLocaleString('fr-FR', { minimumFractionDigits: u.decimals, maximumFractionDigits: u.decimals })} ${u.label}`;
}

function formatArea(mm2) {
  if (mm2 == null || !isFinite(mm2)) return null;
  const u = UNITS[state.unit];
  const v = mm2 * u.factor * u.factor;
  return `${v.toLocaleString('fr-FR', { maximumFractionDigits: Math.max(1, u.decimals) })} ${u.label}²`;
}

function setStatus(text, kind = 'info') {
  const el = $('status');
  el.textContent = text;
  el.className = `status ${kind}`;
}

// ---------------------------------------------------------------------------
// Interactions sur le canvas
// ---------------------------------------------------------------------------

function canvasPoint(evt) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((evt.clientX - rect.left) / rect.width) * canvas.width,
    y: ((evt.clientY - rect.top) / rect.height) * canvas.height,
  };
}

canvas.addEventListener('pointerdown', (e) => {
  if (!state.result) return;
  const p = canvasPoint(e);
  if (state.tool === 'select') {
    const idx = objectAt(p);
    if (idx >= 0) {
      state.selected = idx;
      computeFit();
      applyCalibration();
      renderAll();
    }
    return;
  }
  canvas.setPointerCapture(e.pointerId);
  state.drag = { a: p, b: p };
});

canvas.addEventListener('pointermove', (e) => {
  if (!state.drag) return;
  state.drag.b = canvasPoint(e);
  drawCanvas();
});

canvas.addEventListener('pointerup', () => {
  if (!state.drag) return;
  const seg = state.drag;
  state.drag = null;
  if (dist(seg) < 3) { drawCanvas(); return; }
  if (state.tool === 'calibrate') {
    state.calibSegment = seg;
    $('calibMethod').value = 'segment';
    applyCalibration();
  } else if (state.tool === 'measure') {
    state.measures.push(seg);
  }
  renderAll();
});

function objectAt(p) {
  const res = state.result;
  if (!res) return -1;
  const x = Math.round(p.x);
  const y = Math.round(p.y);
  if (x < 0 || y < 0 || x >= res.width || y >= res.height) return -1;
  const label = res.labels[y * res.width + x];
  if (label < 0) return -1;
  return res.objects.findIndex((o) => o.id === label);
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

function buildReport() {
  const obj = currentObject();
  if (!obj) return '';
  const k = state.mmPerPx;
  const real = k ? toRealUnits(obj.px, k) : null;
  const lines = [
    `Fiche de mesure — ${state.fileName}`,
    `Date : ${new Date().toLocaleString('fr-FR')}`,
    state.calibration ? `Calibration : ${state.calibration.method} (${state.calibration.detail})` : 'Calibration : aucune (valeurs en pixels)',
    k ? `Échelle : ${k.toFixed(4)} mm/px` : '',
    '',
    `Longueur              : ${real ? formatLength(real.length) : obj.px.length.toFixed(1) + ' px'}`,
    `Largeur               : ${real ? formatLength(real.width) : obj.px.width.toFixed(1) + ' px'}`,
    `Diagonale max         : ${real ? formatLength(real.diagonal) : obj.px.diagonal.toFixed(1) + ' px'}`,
    `Périmètre             : ${real ? formatLength(real.perimeter) : obj.px.perimeter.toFixed(1) + ' px'}`,
    `Diamètre équivalent   : ${real ? formatLength(real.equivalentDiameter) : obj.px.equivalentDiameter.toFixed(1) + ' px'}`,
    `Aire silhouette       : ${real ? formatArea(real.areaGross) : obj.px.areaGross + ' px²'}`,
    `Aire matière          : ${real ? formatArea(real.areaNet) : obj.px.areaNet + ' px²'}`,
    `Inclinaison           : ${(((obj.px.angle * 180) / Math.PI + 180) % 180).toFixed(1)}°`,
    `Remplissage rectangle : ${(obj.ratios.fill * 100).toFixed(1)} %`,
    `Circularité           : ${obj.ratios.circularity.toFixed(3)}`,
  ];
  if (state.fit && state.fit.primitives.length) {
    lines.push('', 'Contour décomposé :');
    state.fit.primitives.forEach((p, i) => {
      const n = String(i + 1).padStart(2, ' ');
      if (p.type === 'arc') {
        const deg = Math.abs((p.sweep * 180) / Math.PI).toFixed(0);
        lines.push(`  ${n}. ${p.full ? 'Cercle' : 'Arc  '} R${k ? fmtNum(p.radius * k, 2) + ' mm' : p.radius.toFixed(1) + ' px'} sur ${deg}°${p.radius < RADIUS_RELIABLE_PX ? '   (rayon trop petit dans l\'image : peu fiable)' : ''}`);
      } else {
        lines.push(`  ${n}. Méplat ${k ? fmtNum(p.length * k, 2) + ' mm' : p.length.toFixed(1) + ' px'}`);
      }
    });
    if (state.fit.groups && state.fit.groups.length) {
      lines.push('', 'Rayons regroupés :');
      for (const g of state.fit.groups) {
        lines.push(`  ${g.count} × R${k ? fmtNum(g.radius * k, 2) + ' mm' : g.radius.toFixed(1) + ' px'}`);
      }
    }
  }
  if (state.measures.length) {
    lines.push('', 'Mesures libres :');
    state.measures.forEach((m, i) => {
      const px = dist(m);
      lines.push(`  M${i + 1} : ${k ? formatLength(px * k) : px.toFixed(1) + ' px'}`);
    });
  }
  return lines.filter((l) => l !== '').join('\n');
}

function download(name, content, type = 'text/plain') {
  const blob = new Blob([content], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Câblage de l'interface
// ---------------------------------------------------------------------------

function bind() {
  $('fileInput').addEventListener('change', (e) => loadFile(e.target.files[0]));
  $('pickFile').addEventListener('click', () => $('fileInput').click());

  const dz = $('dropzone');
  ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => {
    e.preventDefault();
    dz.classList.add('dragging');
  }));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => {
    e.preventDefault();
    dz.classList.remove('dragging');
  }));
  dz.addEventListener('drop', (e) => loadFile(e.dataTransfer.files[0]));
  dz.addEventListener('click', (e) => {
    if (e.target.closest('canvas')) return;
    $('fileInput').click();
  });

  window.addEventListener('paste', (e) => {
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
    if (item) loadFile(item.getAsFile());
  });

  // Réglages de détection
  const wire = (id, key, transform = (v) => parseFloat(v)) => {
    const el = $(id);
    const out = $(`${id}Out`);
    const sync = () => {
      state.options[key] = transform(el.value);
      if (out) out.textContent = el.value;
    };
    sync();
    el.addEventListener('input', () => {
      sync();
      if (out) out.textContent = el.value;
    });
    el.addEventListener('change', () => {
      sync();
      analyze();
    });
  };
  wire('tolerance', 'tolerance');
  wire('saturation', 'saturation', (v) => parseFloat(v) / 100);
  wire('morph', 'morph', (v) => parseInt(v, 10));
  wire('minArea', 'minAreaRatio', (v) => parseFloat(v) / 10000);
  $('autoThreshold').addEventListener('change', (e) => {
    state.options.autoThreshold = e.target.checked;
    analyze();
  });

  // Vues
  ['mask', 'contour', 'rect', 'feret', 'radii'].forEach((key) => {
    $(`view-${key}`).addEventListener('change', (e) => {
      state.view[key] = e.target.checked;
      drawCanvas();
    });
  });

  // Outils
  document.querySelectorAll('[data-tool]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.tool = btn.dataset.tool;
      document.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('active', b === btn));
      canvas.classList.toggle('crosshair', state.tool !== 'select');
      $('toolHint').textContent = {
        select: 'Clique un objet sur la photo pour le sélectionner.',
        calibrate: 'Trace un segment sur une distance connue (règle, arête cotée, objet de référence).',
        measure: 'Trace un segment pour relever une cote libre.',
      }[state.tool];
    });
  });

  // Calibration
  const refSelect = $('calibRef');
  refSelect.innerHTML = REFERENCES.map((r) => `<option value="${r.id}">${r.label}</option>`).join('');
  ['calibMethod', 'calibTarget', 'calibValue', 'calibRef', 'calibRefObject', 'calibRefTarget'].forEach((id) => {
    $(id).addEventListener('input', () => {
      applyCalibration();
      renderAll();
    });
  });
  $('clearSegment').addEventListener('click', () => {
    state.calibSegment = null;
    applyCalibration();
    renderAll();
  });

  // Contrôle croisé
  ['checkValue', 'checkTarget'].forEach((id) => $(id).addEventListener('input', () => {
    const obj = currentObject();
    if (obj) renderWarnings(obj);
  }));

  // Réglages de la lecture des rayons
  const fitSlider = (id, key, transform = parseFloat) => {
    const el = $(id);
    const out = $(`${id}Out`);
    el.addEventListener('input', () => { if (out) out.textContent = el.value; });
    el.addEventListener('change', () => {
      state.fitOptions[key] = transform(el.value);
      computeFit();
      renderAll();
    });
  };
  fitSlider('fitSmooth', 'smooth', (v) => parseInt(v, 10));
  fitSlider('fitMinSweep', 'minSweepDeg', (v) => parseInt(v, 10));

  $('unit').addEventListener('change', (e) => {
    state.unit = e.target.value;
    renderAll();
  });

  $('clearMeasures').addEventListener('click', () => {
    state.measures = [];
    renderAll();
  });

  $('copyReport').addEventListener('click', async () => {
    const text = buildReport();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setStatus('Fiche de mesure copiée dans le presse-papier.', 'ok');
    } catch {
      download('mesures.txt', text);
    }
  });
  $('downloadReport').addEventListener('click', () => {
    const text = buildReport();
    if (text) download(`mesures-${state.fileName.replace(/\.[^.]+$/, '')}.txt`, text);
  });
  $('downloadImage').addEventListener('click', () => {
    if (!state.result) return;
    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `releve-${state.fileName.replace(/\.[^.]+$/, '')}.png`;
      a.click();
      URL.revokeObjectURL(url);
    });
  });

  // Onglets
  document.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('active', b === btn));
      document.querySelectorAll('[data-panel]').forEach((panel) => {
        panel.hidden = panel.dataset.panel !== tab;
      });
      if (tab === '3d' && state.viewerNeedsRender) state.viewerNeedsRender = false;
    });
  });

  renderCalibrationPanel();
  renderResults();
  renderMeasures();
}

bind();
init3d();
