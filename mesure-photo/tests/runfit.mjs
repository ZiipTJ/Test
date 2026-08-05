// Tests de la lecture des rayons : formes de synthèse à congés connus, passées
// par toute la chaîne réelle (image -> détourage -> contour -> primitives).
// Lancement : node tests/runfit.mjs

import { analyzeImage } from '../js/vision.js';
import { fitPrimitives, groupRadii, fitCircle, fitLine, resampleClosed } from '../js/fitshapes.js';

let failures = 0;
let checks = 0;
const check = (label, ok, detail = '') => {
  checks++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failures++;
};
const near = (label, actual, expected, tol) => {
  const d = Math.abs(actual - expected);
  check(`${label} ≈ ${expected} (±${tol})`, d <= tol, `mesuré ${actual.toFixed(2)}, écart ${d.toFixed(2)}`);
};

// --- Fabrication d'images -----------------------------------------------------
function blank(w, h) {
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  return { data, width: w, height: h };
}

function fillPolygon(img, pts, color = [40, 40, 40]) {
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
        img.data[i] = color[0]; img.data[i + 1] = color[1]; img.data[i + 2] = color[2];
      }
    }
  }
}

/**
 * Polygone à coins arrondis : chaque sommet reçoit un congé du rayon demandé,
 * échantillonné finement pour que la rasterisation soit fidèle.
 */
function roundedPolygon(vertices, radii, samples = 64) {
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

    const angle = Math.acos(Math.max(-1, Math.min(1, u1.x * u2.x + u1.y * u2.y)));
    if (r <= 0 || !isFinite(angle) || angle < 1e-6) { out.push({ ...cur }); continue; }

    const dist = r / Math.tan(angle / 2);          // distance sommet -> point de tangence
    const t1 = { x: cur.x + u1.x * dist, y: cur.y + u1.y * dist };
    const t2 = { x: cur.x + u2.x * dist, y: cur.y + u2.y * dist };

    // Centre du congé : sur la bissectrice, à r / sin(angle/2) du sommet
    const bis = { x: u1.x + u2.x, y: u1.y + u2.y };
    const lb = Math.hypot(bis.x, bis.y) || 1;
    const cd = r / Math.sin(angle / 2);
    const center = { x: cur.x + (bis.x / lb) * cd, y: cur.y + (bis.y / lb) * cd };

    let a0 = Math.atan2(t1.y - center.y, t1.x - center.x);
    let a1 = Math.atan2(t2.y - center.y, t2.x - center.x);
    let d = a1 - a0;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;

    for (let s = 0; s <= samples; s++) {
      const a = a0 + (d * s) / samples;
      out.push({ x: center.x + r * Math.cos(a), y: center.y + r * Math.sin(a) });
    }
  }
  return out;
}

function analyseShape(img, options = {}) {
  const res = analyzeImage(img);
  if (!res.main) return null;
  return fitPrimitives(res.main.contour, options);
}

// --- 1. Ajustements élémentaires ---------------------------------------------
console.log('\n1. Ajustements aux moindres carrés');
{
  const pts = [];
  for (let a = 0; a < 1.2; a += 0.02) pts.push({ x: 300 + 75 * Math.cos(a), y: 200 + 75 * Math.sin(a) });
  const c = fitCircle(pts);
  near('rayon d\'un arc parfait', c.radius, 75, 0.01);
  near('centre X', c.center.x, 300, 0.01);
  check('résidu quasi nul', c.rms < 0.01, c.rms.toExponential(2));

  const bruit = pts.map((p, i) => ({ x: p.x + (i % 3 - 1) * 0.4, y: p.y + (i % 2 - 0.5) * 0.4 }));
  near('rayon avec bruit ±0,4 px', fitCircle(bruit).radius, 75, 1.5);

  const seg = [];
  for (let t = 0; t < 100; t += 1) seg.push({ x: 50 + t * 0.8, y: 100 + t * 0.6 });
  const l = fitLine(seg);
  near('longueur d\'un segment', l.length, Math.hypot(99 * 0.8, 99 * 0.6), 0.01);
  near('angle du segment (°)', (l.angle * 180) / Math.PI, 36.87, 0.1);
}
{
  const carre = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
  const r = resampleClosed(carre, 5);
  check('rééchantillonnage à pas constant', r.length === 80, `${r.length} points`);
  const d = Math.hypot(r[1].x - r[0].x, r[1].y - r[0].y);
  near('pas obtenu', d, 5, 0.001);
}

// --- 2. Rectangle à coins arrondis --------------------------------------------
console.log('\n2. Rectangle 400 × 240 px, congés R40');
{
  const img = blank(560, 400);
  const poly = roundedPolygon([
    { x: 80, y: 80 }, { x: 480, y: 80 }, { x: 480, y: 320 }, { x: 80, y: 320 },
  ], 40);
  fillPolygon(img, poly);
  const fit = analyseShape(img);
  const arcs = fit.primitives.filter((p) => p.type === 'arc');
  const lines = fit.primitives.filter((p) => p.type === 'line');
  check('4 côtés droits', lines.length === 4, `${lines.length}`);

  const groups = groupRadii(fit.primitives);
  check('un seul rayon distinct', groups.length === 1, `${groups.length} groupes : ${groups.map((g) => g.radius.toFixed(1)).join(', ')}`);
  check('4 congés', groups[0] && groups[0].count === 4, `${groups[0] ? groups[0].count : 0}`);
  near('rayon détecté', groups[0].radius, 40, 3);
  check('arcs bien convexes', arcs.every((a) => !a.concave));

  const longSide = Math.max(...lines.map((l) => l.length));
  near('plus long côté droit', longSide, 400 - 2 * 40, 6);
}

// --- 3. Trapèze arrondi (forme d'un écusson) ----------------------------------
console.log('\n3. Trapèze arrondi 420/300 × 220 px, congés R30 — forme d\'écusson');
{
  const img = blank(560, 400);
  const poly = roundedPolygon([
    { x: 130, y: 90 }, { x: 430, y: 90 }, { x: 490, y: 310 }, { x: 70, y: 310 },
  ], 30);
  fillPolygon(img, poly);
  const fit = analyseShape(img);
  const groups = groupRadii(fit.primitives);
  check('4 côtés droits', fit.primitives.filter((p) => p.type === 'line').length === 4,
    `${fit.primitives.filter((p) => p.type === 'line').length}`);
  check('4 congés d\'un même rayon', groups.length === 1 && groups[0].count === 4,
    `${groups.map((g) => `${g.count}×R${g.radius.toFixed(1)}`).join(', ')}`);
  near('rayon détecté', groups[0].radius, 30, 3);
}

// --- 4. Deux rayons différents ------------------------------------------------
console.log('\n4. Rectangle à congés inégaux : R20 en haut, R60 en bas');
{
  const img = blank(600, 440);
  const poly = roundedPolygon([
    { x: 90, y: 80 }, { x: 510, y: 80 }, { x: 510, y: 360 }, { x: 90, y: 360 },
  ], [20, 20, 60, 60]);
  fillPolygon(img, poly);
  const fit = analyseShape(img);
  const groups = groupRadii(fit.primitives);
  check('deux rayons distincts', groups.length === 2, `${groups.map((g) => `${g.count}×R${g.radius.toFixed(1)}`).join(', ')}`);
  if (groups.length === 2) {
    const petit = groups.find((g) => g.radius < 40);
    const grand = groups.find((g) => g.radius >= 40);
    check('2 congés de chaque', petit.count === 2 && grand.count === 2, `${petit.count} / ${grand.count}`);
    near('petit rayon', petit.radius, 20, 3);
    near('grand rayon', grand.radius, 60, 5);
  }
}

// --- 5. Disque ----------------------------------------------------------------
console.log('\n5. Disque R100 : un seul rayon, aucun côté droit');
{
  const img = blank(400, 400);
  for (let y = 0; y < 400; y++) {
    for (let x = 0; x < 400; x++) {
      if ((x - 200) ** 2 + (y - 200) ** 2 <= 100 * 100) {
        const i = (y * 400 + x) * 4;
        img.data[i] = 40; img.data[i + 1] = 40; img.data[i + 2] = 40;
      }
    }
  }
  const fit = analyseShape(img);
  check('aucun côté droit', fit.primitives.filter((p) => p.type === 'line').length === 0,
    `${fit.primitives.filter((p) => p.type === 'line').length}`);
  const groups = groupRadii(fit.primitives);
  check('un seul rayon', groups.length === 1, `${groups.map((g) => g.radius.toFixed(1)).join(', ')}`);
  near('rayon détecté', groups[0].radius, 100, 3);
  near('tour complet balayé (°)', (groups[0].totalSweep * 180) / Math.PI, 360, 12);
}

// --- 6. Oblong (demi-cercles aux extrémités) ----------------------------------
console.log('\n6. Oblong 380 × 160 px : deux demi-cercles R80 et deux droites');
{
  const img = blank(520, 320);
  const poly = roundedPolygon([
    { x: 110, y: 80 }, { x: 410, y: 80 }, { x: 410, y: 240 }, { x: 110, y: 240 },
  ], 80);
  fillPolygon(img, poly);
  const fit = analyseShape(img);
  const groups = groupRadii(fit.primitives);
  near('rayon des extrémités', groups[0].radius, 80, 4);
  check('2 côtés droits', fit.primitives.filter((p) => p.type === 'line').length === 2,
    `${fit.primitives.filter((p) => p.type === 'line').length}`);
  const demi = groups[0].items.map((a) => Math.abs((a.sweep * 180) / Math.PI));
  check('balayage ≈ 180° par extrémité', demi.every((d) => Math.abs(d - 180) < 20), demi.map((d) => d.toFixed(0)).join('/'));
}

// --- 7. Mise à l'échelle en millimètres ---------------------------------------
console.log('\n7. Conversion en millimètres');
{
  const img = blank(560, 400);
  fillPolygon(img, roundedPolygon([
    { x: 80, y: 80 }, { x: 480, y: 80 }, { x: 480, y: 320 }, { x: 80, y: 320 },
  ], 40));
  const fit = analyseShape(img);
  const groups = groupRadii(fit.primitives);
  const mmPerPx = 0.25;                    // pièce de 100 mm de large
  near('rayon en mm', groups[0].radius * mmPerPx, 10, 0.8);
}

// --- 8. Robustesse : contour bruité -------------------------------------------
console.log('\n8. Contour bruité (bords irréguliers)');
{
  const img = blank(560, 400);
  const poly = roundedPolygon([
    { x: 80, y: 80 }, { x: 480, y: 80 }, { x: 480, y: 320 }, { x: 80, y: 320 },
  ], 40).map((p, i) => ({ x: p.x + ((i * 7) % 3 - 1) * 1.2, y: p.y + ((i * 5) % 3 - 1) * 1.2 }));
  fillPolygon(img, poly);
  const fit = analyseShape(img, { smooth: 3 });
  const groups = groupRadii(fit.primitives, 0.2);
  check('congés toujours trouvés', groups.length >= 1 && groups[0].count >= 3,
    `${groups.map((g) => `${g.count}×R${g.radius.toFixed(1)}`).join(', ')}`);
  near('rayon malgré le bruit', groups[0].radius, 40, 6);
}

console.log(`\n${checks - failures}/${checks} vérifications passées.`);
if (failures) {
  console.error(`${failures} échec(s).`);
  process.exit(1);
}
