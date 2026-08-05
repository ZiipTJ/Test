// Tests de la chaîne de mesure sur des images de synthèse (objet sombre sur fond blanc).
// Lancement : node tests/run.mjs

import { analyzeImage, toRealUnits } from '../js/vision.js';
import { minAreaRect, convexHull } from '../js/geometry.js';

let failures = 0;
let checks = 0;

function check(label, condition, detail = '') {
  checks++;
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function near(label, actual, expected, tol) {
  const delta = Math.abs(actual - expected);
  check(`${label} ≈ ${expected} (±${tol})`, delta <= tol, `mesuré ${actual.toFixed(2)}, écart ${delta.toFixed(2)}`);
}

function blankImage(width, height) {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  return { data, width, height };
}

function setPixel(img, x, y, [r, g, b]) {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const i = (y * img.width + x) * 4;
  img.data[i] = r;
  img.data[i + 1] = g;
  img.data[i + 2] = b;
  img.data[i + 3] = 255;
}

function fillPolygon(img, points, color = [40, 40, 40]) {
  const minY = Math.max(0, Math.floor(Math.min(...points.map((p) => p.y))));
  const maxY = Math.min(img.height - 1, Math.ceil(Math.max(...points.map((p) => p.y))));
  for (let y = minY; y <= maxY; y++) {
    const xs = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) {
        xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = Math.round(xs[k]); x <= Math.round(xs[k + 1]); x++) setPixel(img, x, y, color);
    }
  }
}

function fillDisc(img, cx, cy, r, color = [30, 30, 30]) {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) setPixel(img, x, y, color);
    }
  }
}

function rotatedRect(cx, cy, w, h, angleDeg) {
  const a = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return [
    [-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2],
  ].map(([u, v]) => ({ x: cx + u * cos - v * sin, y: cy + u * sin + v * cos }));
}

// --- 1. Rectangle droit -------------------------------------------------------
console.log('\n1. Rectangle 400 x 200 px, aligné sur les axes');
{
  const img = blankImage(600, 400);
  fillPolygon(img, rotatedRect(300, 200, 400, 200, 0));
  const res = analyzeImage(img);
  check('un seul objet détecté', res.objects.length === 1, `${res.objects.length} objets`);
  near('longueur', res.main.px.length, 400, 3);
  near('largeur', res.main.px.width, 200, 3);
  near('aire', res.main.px.areaGross, 400 * 200, 400 * 200 * 0.02);
  near('périmètre', res.main.px.perimeter, 1200, 40);
  check('pas de trou', res.main.px.holeArea === 0, `${res.main.px.holeArea} px`);
  check('taux de remplissage ≈ 1', Math.abs(res.main.ratios.fill - 1) < 0.03, res.main.ratios.fill.toFixed(3));
}

// --- 2. Rectangle incliné -----------------------------------------------------
console.log('\n2. Rectangle 300 x 120 px incliné à 27° (le rectangle mini doit suivre l\'objet)');
{
  const img = blankImage(600, 500);
  fillPolygon(img, rotatedRect(300, 250, 300, 120, 27));
  const res = analyzeImage(img);
  near('longueur', res.main.px.length, 300, 4);
  near('largeur', res.main.px.width, 120, 4);
  const angleDeg = ((res.main.px.angle * 180) / Math.PI + 180) % 180;
  near('angle', angleDeg, 27, 3);
  check('bbox axes > dimensions objet', res.main.px.bboxWidth > 300, `${res.main.px.bboxWidth}`);
}

// --- 3. Disque ----------------------------------------------------------------
console.log('\n3. Disque de diamètre 300 px');
{
  const img = blankImage(500, 500);
  fillDisc(img, 250, 250, 150);
  const res = analyzeImage(img);
  near('longueur', res.main.px.length, 300, 5);
  near('largeur', res.main.px.width, 300, 5);
  near('diamètre équivalent', res.main.px.equivalentDiameter, 300, 5);
  check('circularité ≈ 1', Math.abs(res.main.ratios.circularity - 1) < 0.08, res.main.ratios.circularity.toFixed(3));
}

// --- 4. Pièce percée ----------------------------------------------------------
console.log('\n4. Plaque 360 x 240 px percée d\'un trou Ø100');
{
  const img = blankImage(600, 400);
  fillPolygon(img, rotatedRect(300, 200, 360, 240, 0));
  fillDisc(img, 300, 200, 50, [255, 255, 255]);
  const res = analyzeImage(img);
  near('longueur', res.main.px.length, 360, 3);
  near('largeur', res.main.px.width, 240, 3);
  const holeExpected = Math.PI * 50 * 50;
  near('aire du trou', res.main.px.holeArea, holeExpected, holeExpected * 0.06);
  near('aire nette (matière)', res.main.px.areaNet, 360 * 240 - holeExpected, 360 * 240 * 0.02);
}

// --- 5. Forme en L ------------------------------------------------------------
console.log('\n5. Forme en L 300 x 300 px (le remplissage doit être ≈ 0,55)');
{
  const img = blankImage(500, 500);
  fillPolygon(img, [
    { x: 100, y: 100 }, { x: 400, y: 100 }, { x: 400, y: 220 },
    { x: 220, y: 220 }, { x: 220, y: 400 }, { x: 100, y: 400 },
  ]);
  const res = analyzeImage(img);
  near('longueur', res.main.px.length, 300, 5);
  near('largeur', res.main.px.width, 300, 5);
  check('remplissage < 0,7', res.main.ratios.fill < 0.7, res.main.ratios.fill.toFixed(3));
  check('objet non circulaire', res.main.ratios.circularity < 0.85, res.main.ratios.circularity.toFixed(3));
}

// --- 6. Deux objets -----------------------------------------------------------
console.log('\n6. Deux objets : le plus grand est retenu comme objet principal');
{
  const img = blankImage(700, 400);
  fillPolygon(img, rotatedRect(200, 200, 240, 160, 0));
  fillDisc(img, 520, 200, 60);
  const res = analyzeImage(img);
  check('deux objets détectés', res.objects.length === 2, `${res.objects.length}`);
  near('objet principal — longueur', res.main.px.length, 240, 4);
  near('second objet — diamètre', res.objects[1].px.length, 120, 5);
}

// --- 7. Calibration et conversion --------------------------------------------
console.log('\n7. Calibration : rectangle 400 px déclaré comme 250 mm de long');
{
  const img = blankImage(600, 400);
  fillPolygon(img, rotatedRect(300, 200, 400, 200, 0));
  const res = analyzeImage(img);
  const mmPerPx = 250 / res.main.px.length;
  const real = toRealUnits(res.main.px, mmPerPx);
  near('longueur réelle (mm)', real.length, 250, 0.5);
  near('largeur réelle (mm)', real.width, 125, 2);
  near('aire réelle (mm²)', real.areaGross, 250 * 125, 250 * 125 * 0.03);
}

// --- 8. Objet clair mais coloré ----------------------------------------------
console.log('\n8. Objet clair mais coloré (jaune) : détecté par la saturation');
{
  const img = blankImage(500, 400);
  fillPolygon(img, rotatedRect(250, 200, 300, 150, 0), [250, 225, 60]);
  const res = analyzeImage(img);
  check('objet détecté', res.main !== null);
  if (res.main) {
    near('longueur', res.main.px.length, 300, 4);
    near('largeur', res.main.px.width, 150, 4);
  }
}

// --- 9. Fond légèrement gris / photo sous-exposée -----------------------------
console.log('\n9. Fond gris clair (230) et objet gris moyen (120)');
{
  const img = blankImage(500, 400);
  img.data.fill(230);
  for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
  fillPolygon(img, rotatedRect(250, 200, 280, 180, 0), [120, 120, 120]);
  const res = analyzeImage(img);
  check('objet détecté malgré le fond gris', res.main !== null);
  if (res.main) {
    near('longueur', res.main.px.length, 280, 4);
    near('largeur', res.main.px.width, 180, 4);
  }
}

// --- 10. Primitives géométriques ---------------------------------------------
console.log('\n10. Primitives géométriques');
{
  const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 5, y: 5 }];
  const hull = convexHull(square);
  check('enveloppe convexe du carré = 4 sommets', hull.length === 4, `${hull.length}`);
  const rect = minAreaRect(rotatedRect(0, 0, 100, 40, 45));
  near('rectangle mini incliné — longueur', rect.width, 100, 0.001);
  near('rectangle mini incliné — largeur', rect.height, 40, 0.001);
}

console.log(`\n${checks - failures}/${checks} vérifications passées.`);
if (failures) {
  console.error(`${failures} échec(s).`);
  process.exit(1);
}
