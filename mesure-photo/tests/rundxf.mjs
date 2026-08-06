// Tests de l'export DXF : le fichier est relu, la géométrie reconstruite, et
// comparée à la forme d'origine. Un arc décrit dans le mauvais sens se voit
// immédiatement sur l'aire du contour reconstruit.
// Lancement : node tests/rundxf.mjs

import { primitivesToDxf, contourToDxf, sketchToDxf } from '../js/dxf.js';
import { fitPrimitives } from '../js/fitshapes.js';
import { analyzeImage } from '../js/vision.js';
import { polygonArea } from '../js/geometry.js';

let failures = 0;
let checks = 0;
const check = (label, ok, detail = '') => {
  checks++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failures++;
};
const near = (label, actual, expected, tol) => {
  const d = Math.abs(actual - expected);
  check(`${label} ≈ ${typeof expected === 'number' ? expected.toFixed(2) : expected} (±${tol})`,
    d <= tol, `mesuré ${actual.toFixed(2)}, écart ${d.toFixed(2)}`);
};

// --- Lecteur DXF minimal ------------------------------------------------------
function parseDxf(text) {
  const lines = text.split('\n');
  const pairs = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    pairs.push([parseInt(lines[i].trim(), 10), lines[i + 1].trim()]);
  }
  const entities = [];
  let cur = null;
  let inEntities = false;

  for (let i = 0; i < pairs.length; i++) {
    const [code, value] = pairs[i];
    if (code === 2 && value === 'ENTITIES') { inEntities = true; continue; }
    if (code === 0 && value === 'ENDSEC') { if (cur) entities.push(cur); cur = null; inEntities = false; continue; }
    if (!inEntities) continue;

    if (code === 0) {
      if (cur) entities.push(cur);
      cur = value === 'SEQEND' ? null : { type: value, vertices: [] };
      continue;
    }
    if (!cur) continue;
    if (cur.type === 'VERTEX' || cur.type === 'POLYLINE') {
      if (code === 10) cur.x = parseFloat(value);
      if (code === 20) cur.y = parseFloat(value);
    }
    if (code === 10) cur.x1 = parseFloat(value);
    if (code === 20) cur.y1 = parseFloat(value);
    if (code === 11) cur.x2 = parseFloat(value);
    if (code === 21) cur.y2 = parseFloat(value);
    if (code === 40) cur.r = parseFloat(value);
    if (code === 50) cur.a0 = parseFloat(value);
    if (code === 51) cur.a1 = parseFloat(value);
    if (code === 8) cur.layer = value;
  }
  return entities;
}

/** Échantillonne une entité, dans le sens de description du DXF. */
function sampleEntity(e, steps = 24) {
  if (e.type === 'LINE') return [{ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 }];
  if (e.type === 'ARC') {
    let a0 = (e.a0 * Math.PI) / 180;
    let a1 = (e.a1 * Math.PI) / 180;
    // DXF : toujours dans le sens trigonométrique de a0 vers a1.
    while (a1 <= a0) a1 += 2 * Math.PI;
    const out = [];
    for (let s = 0; s <= steps; s++) {
      const a = a0 + ((a1 - a0) * s) / steps;
      out.push({ x: e.x1 + e.r * Math.cos(a), y: e.y1 + e.r * Math.sin(a) });
    }
    return out;
  }
  if (e.type === 'CIRCLE') {
    const out = [];
    for (let s = 0; s < steps * 2; s++) {
      const a = (2 * Math.PI * s) / (steps * 2);
      out.push({ x: e.x1 + e.r * Math.cos(a), y: e.y1 + e.r * Math.sin(a) });
    }
    return out;
  }
  return [];
}

/**
 * Reconstruit le contour comme le ferait un noyau CAO : en raccordant les
 * entités par leurs extrémités, quitte à en parcourir une à l'envers.
 *
 * Une entité ARC du DXF est par définition décrite dans le sens trigonométrique.
 * Quand le contour la parcourt dans l'autre sens, elle est donc nécessairement
 * écrite « à l'envers » dans le fichier : ce n'est pas un défaut, et il ne faut
 * pas l'interpréter comme une rupture du contour.
 */
function rebuildOutline(entities) {
  const segs = entities
    .filter((e) => e.type !== 'VERTEX' && e.type !== 'POLYLINE')
    .map((e) => sampleEntity(e))
    .filter((s) => s.length > 1);
  if (!segs.length) {
    return entities.filter((e) => e.type === 'VERTEX').map((e) => ({ x: e.x1, y: e.y1 }));
  }

  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const used = new Array(segs.length).fill(false);
  used[0] = true;
  const chain = segs[0].slice();

  for (let step = 1; step < segs.length; step++) {
    const tail = chain[chain.length - 1];
    let best = -1;
    let bestD = Infinity;
    let bestReversed = false;
    for (let i = 0; i < segs.length; i++) {
      if (used[i]) continue;
      const dStart = dist(tail, segs[i][0]);
      const dEnd = dist(tail, segs[i][segs[i].length - 1]);
      if (dStart < bestD) { bestD = dStart; best = i; bestReversed = false; }
      if (dEnd < bestD) { bestD = dEnd; best = i; bestReversed = true; }
    }
    if (best < 0) break;
    used[best] = true;
    const seg = bestReversed ? segs[best].slice().reverse() : segs[best];
    chain.push(...seg.slice(1));
  }
  return chain;
}

/** Écart maximal entre entités consécutives une fois raccordées. */
function stitchGap(entities) {
  const segs = entities
    .filter((e) => e.type !== 'VERTEX' && e.type !== 'POLYLINE')
    .map((e) => sampleEntity(e))
    .filter((s) => s.length > 1);
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const used = new Array(segs.length).fill(false);
  used[0] = true;
  let tail = segs[0][segs[0].length - 1];
  let pire = 0;

  for (let step = 1; step < segs.length; step++) {
    let best = -1, bestD = Infinity, rev = false;
    for (let i = 0; i < segs.length; i++) {
      if (used[i]) continue;
      const dStart = dist(tail, segs[i][0]);
      const dEnd = dist(tail, segs[i][segs[i].length - 1]);
      if (dStart < bestD) { bestD = dStart; best = i; rev = false; }
      if (dEnd < bestD) { bestD = dEnd; best = i; rev = true; }
    }
    if (best < 0) break;
    used[best] = true;
    pire = Math.max(pire, bestD);
    const seg = rev ? segs[best].slice().reverse() : segs[best];
    tail = seg[seg.length - 1];
  }
  // Bouclage sur le premier point
  pire = Math.max(pire, dist(tail, segs[0][0]));
  return pire;
}

function blank(w, h) {
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  return { data, width: w, height: h };
}
function fillPolygon(img, pts) {
  const minY = Math.max(0, Math.floor(Math.min(...pts.map((p) => p.y))));
  const maxY = Math.min(img.height - 1, Math.ceil(Math.max(...pts.map((p) => p.y))));
  for (let y = minY; y <= maxY; y++) {
    const xs = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = Math.max(0, Math.round(xs[k])); x <= Math.min(img.width - 1, Math.round(xs[k + 1])); x++) {
        const i = (y * img.width + x) * 4;
        img.data[i] = 40; img.data[i + 1] = 40; img.data[i + 2] = 40;
      }
    }
  }
}
function roundedPolygon(vertices, radii, samples = 128) {
  const n = vertices.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const prev = vertices[(i - 1 + n) % n];
    const cur = vertices[i];
    const next = vertices[(i + 1) % n];
    const r = Array.isArray(radii) ? radii[i] : radii;
    const v1 = { x: prev.x - cur.x, y: prev.y - cur.y };
    const v2 = { x: next.x - cur.x, y: next.y - cur.y };
    const l1 = Math.hypot(v1.x, v1.y);
    const l2 = Math.hypot(v2.x, v2.y);
    const u1 = { x: v1.x / l1, y: v1.y / l1 };
    const u2 = { x: v2.x / l2, y: v2.y / l2 };
    const ang = Math.acos(Math.max(-1, Math.min(1, u1.x * u2.x + u1.y * u2.y)));
    const d = r / Math.tan(ang / 2);
    const t1 = { x: cur.x + u1.x * d, y: cur.y + u1.y * d };
    const bis = { x: u1.x + u2.x, y: u1.y + u2.y };
    const lb = Math.hypot(bis.x, bis.y) || 1;
    const c = { x: cur.x + (bis.x / lb) * (r / Math.sin(ang / 2)), y: cur.y + (bis.y / lb) * (r / Math.sin(ang / 2)) };
    const t2 = { x: cur.x + u2.x * d, y: cur.y + u2.y * d };
    const a0 = Math.atan2(t1.y - c.y, t1.x - c.x);
    const a1 = Math.atan2(t2.y - c.y, t2.x - c.x);
    let dd = a1 - a0;
    while (dd > Math.PI) dd -= 2 * Math.PI;
    while (dd < -Math.PI) dd += 2 * Math.PI;
    const steps = Math.max(6, Math.round((samples * Math.abs(dd)) / (2 * Math.PI)));
    for (let s = 0; s <= steps; s++) out.push({ x: c.x + r * Math.cos(a0 + (dd * s) / steps), y: c.y + r * Math.sin(a0 + (dd * s) / steps) });
  }
  return out;
}

const RECT = [{ x: 100, y: 100 }, { x: 500, y: 100 }, { x: 500, y: 340 }, { x: 100, y: 340 }];
const HAUTEUR = 440;

// --- 1. Structure du fichier ---------------------------------------------------
console.log('\n1. Structure du fichier DXF');
{
  const img = blank(600, HAUTEUR);
  fillPolygon(img, roundedPolygon(RECT, 40));
  const fit = fitPrimitives(analyzeImage(img).main.contour);
  const dxf = primitivesToDxf(fit.primitives, { originY: HAUTEUR });

  check('en-tête AutoCAD R12', dxf.includes('AC1009'));
  check('unités déclarées en millimètres', dxf.includes('$INSUNITS'));
  check('section ENTITIES présente', dxf.includes('ENTITIES'));
  check('fin de fichier', dxf.trimEnd().endsWith('EOF'));

  const ents = parseDxf(dxf);
  const lignes = ents.filter((e) => e.type === 'LINE').length;
  const arcs = ents.filter((e) => e.type === 'ARC').length;
  check('4 droites et 4 arcs', lignes === 4 && arcs === 4, `${lignes} droites, ${arcs} arcs`);
  check('toutes les entités sur un calque nommé', ents.every((e) => e.layer === 'CONTOUR'));
}

// --- 2. Sens des arcs : l'aire trahit une inversion ---------------------------
console.log('\n2. Sens de description des arcs');
{
  const img = blank(600, HAUTEUR);
  const vrai = roundedPolygon(RECT, 40);
  fillPolygon(img, vrai);
  const fit = fitPrimitives(analyzeImage(img).main.contour);
  const ents = parseDxf(primitivesToDxf(fit.primitives, { originY: HAUTEUR }));

  const rebuilt = rebuildOutline(ents);
  const aireVraie = polygonArea(vrai);
  const aireRelue = polygonArea(rebuilt);
  // Un arc décrit à l'envers remplace un congé rentrant par un bourrelet
  // sortant : l'aire s'écarte de plusieurs pourcents.
  near('aire du contour relu', aireRelue, +aireVraie.toFixed(2), aireVraie * 0.02);

  // Le contour doit se refermer une fois les entités raccordées bout à bout.
  const gap = stitchGap(ents);
  check('contour fermé une fois les entités raccordées', gap < 2,
    `écart max ${gap.toFixed(2)} px`);
}

// --- 3. Retournement de l'axe Y ------------------------------------------------
console.log('\n3. Repère : Y vers le haut dans le fichier');
{
  const img = blank(600, HAUTEUR);
  fillPolygon(img, roundedPolygon(RECT, 40));
  const fit = fitPrimitives(analyzeImage(img).main.contour);
  const ents = parseDxf(primitivesToDxf(fit.primitives, { originY: HAUTEUR }));
  const ys = rebuildOutline(ents).map((p) => p.y);

  // Le haut de la pièce est à y≈100 dans l'image, donc à 440-100=340 en DXF.
  near('bord haut de la pièce', Math.max(...ys), 340, 3);
  near('bord bas de la pièce', Math.min(...ys), 100, 3);
  check('aucune ordonnée négative', Math.min(...ys) >= 0);
}

// --- 4. Mise à l'échelle en millimètres ---------------------------------------
console.log('\n4. Mise à l\'échelle');
{
  const img = blank(600, HAUTEUR);
  fillPolygon(img, roundedPolygon(RECT, 40));
  const fit = fitPrimitives(analyzeImage(img).main.contour);
  const ents = parseDxf(primitivesToDxf(fit.primitives, { originY: HAUTEUR, mmPerPx: 0.25 }));
  const pts = rebuildOutline(ents);
  const largeur = Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x));
  near('largeur en mm (400 px × 0,25)', largeur, 100, 1);

  const arcs = ents.filter((e) => e.type === 'ARC');
  near('rayon en mm (congé R40 × 0,25)', arcs[0].r, 10, 0.6);
}

// --- 5. Disque : entité CIRCLE -------------------------------------------------
console.log('\n5. Pièce ronde');
{
  const img = blank(400, 400);
  for (let y = 0; y < 400; y++) {
    for (let x = 0; x < 400; x++) {
      if ((x - 200) ** 2 + (y - 200) ** 2 <= 120 * 120) {
        const i = (y * 400 + x) * 4;
        img.data[i] = 40; img.data[i + 1] = 40; img.data[i + 2] = 40;
      }
    }
  }
  const fit = fitPrimitives(analyzeImage(img).main.contour);
  const ents = parseDxf(primitivesToDxf(fit.primitives, { originY: 400 }));
  check('exporté comme cercle entier', ents.length === 1 && ents[0].type === 'CIRCLE',
    ents.map((e) => e.type).join(', '));
  near('rayon', ents[0].r, 120, 3);
}

// --- 6. Polyligne fidèle -------------------------------------------------------
console.log('\n6. Export en polyligne (fidélité au pixel)');
{
  const img = blank(600, HAUTEUR);
  const vrai = roundedPolygon(RECT, 40);
  fillPolygon(img, vrai);
  const contour = analyzeImage(img).main.outline;
  const ents = parseDxf(contourToDxf(contour, { originY: HAUTEUR }));
  const sommets = ents.filter((e) => e.type === 'VERTEX');
  check('polyligne fermée avec tous ses sommets', sommets.length === contour.length,
    `${sommets.length} / ${contour.length}`);
  near('aire de la polyligne', polygonArea(sommets.map((v) => ({ x: v.x1, y: v.y1 }))),
    +polygonArea(vrai).toFixed(2), polygonArea(vrai) * 0.02);
}

// --- 7. Trous sur un calque distinct -------------------------------------------
console.log('\n7. Esquisse avec perçages');
{
  const img = blank(600, HAUTEUR);
  fillPolygon(img, roundedPolygon(RECT, 40));
  for (let y = 0; y < HAUTEUR; y++) {
    for (let x = 0; x < 600; x++) {
      if ((x - 300) ** 2 + (y - 220) ** 2 <= 40 * 40) {
        const i = (y * 600 + x) * 4;
        img.data[i] = 255; img.data[i + 1] = 255; img.data[i + 2] = 255;
      }
    }
  }
  const obj = analyzeImage(img).main;
  const fit = fitPrimitives(obj.contour);
  const dxf = sketchToDxf(
    { primitives: fit.primitives, holes: obj.holes.map((h) => h.outline) },
    { originY: HAUTEUR },
  );
  const ents = parseDxf(dxf);
  const calques = new Set(ents.map((e) => e.layer).filter(Boolean));
  check('deux calques : contour et trous', calques.has('CONTOUR') && calques.has('TROUS'),
    [...calques].join(', '));
  const trous = ents.filter((e) => e.layer === 'TROUS' && e.type === 'VERTEX');
  check('perçage exporté', trous.length > 20, `${trous.length} sommets`);
}

// --- 8. Cas vide ---------------------------------------------------------------
console.log('\n8. Cas dégénérés');
{
  const vide = primitivesToDxf([], { originY: 100 });
  check('fichier vide mais valide', vide.includes('ENTITIES') && vide.trimEnd().endsWith('EOF'));
  check('aucune entité', parseDxf(vide).length === 0);
}

console.log(`\n${checks - failures}/${checks} vérifications passées.`);
if (failures) {
  console.error(`${failures} échec(s).`);
  process.exit(1);
}
