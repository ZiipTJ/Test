// Tests de la forme définie par points cliqués : combien de points faut-il pour
// retrouver les cotes et les rayons de la pièce réelle ?
// Lancement : node tests/runpoints.mjs

import { shapeFromPoints, sampleClosedPath, rasterizePolygon } from '../js/manualshape.js';
import { fitPrimitives, groupRadii } from '../js/fitshapes.js';
import { minAreaRect, polygonArea } from '../js/geometry.js';

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

/** Contour exact d'un polygone à congés, échantillonné finement. */
function roundedPolygon(vertices, radii, samples = 160) {
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
    const dist = r / Math.tan(angle / 2);
    const t1 = { x: cur.x + u1.x * dist, y: cur.y + u1.y * dist };
    const t2 = { x: cur.x + u2.x * dist, y: cur.y + u2.y * dist };
    const bis = { x: u1.x + u2.x, y: u1.y + u2.y };
    const lb = Math.hypot(bis.x, bis.y) || 1;
    const center = { x: cur.x + (bis.x / lb) * (r / Math.sin(angle / 2)), y: cur.y + (bis.y / lb) * (r / Math.sin(angle / 2)) };
    let a0 = Math.atan2(t1.y - center.y, t1.x - center.x);
    const a1 = Math.atan2(t2.y - center.y, t2.x - center.x);
    let d = a1 - a0;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    const steps = Math.max(6, Math.round((samples * Math.abs(d)) / (2 * Math.PI)));
    for (let s = 0; s <= steps; s++) out.push({ x: center.x + r * Math.cos(a0 + (d * s) / steps), y: center.y + r * Math.sin(a0 + (d * s) / steps) });
  }
  return out;
}

/** Simule N clics répartis à pas constant le long du vrai contour. */
function clickPoints(contour, count, jitter = 0, seed = 1) {
  let total = 0;
  const cum = [0];
  for (let i = 1; i <= contour.length; i++) {
    const a = contour[i - 1];
    const b = contour[i % contour.length];
    total += Math.hypot(b.x - a.x, b.y - a.y);
    cum.push(total);
  }
  let rnd = seed;
  const rand = () => {
    rnd = (rnd * 1103515245 + 12345) % 2147483648;
    return rnd / 2147483648 - 0.5;
  };

  const pts = [];
  for (let k = 0; k < count; k++) {
    const target = (total * k) / count;
    let i = 1;
    while (i < cum.length && cum[i] < target) i++;
    const a = contour[(i - 1) % contour.length];
    const b = contour[i % contour.length];
    const seg = cum[i] - cum[i - 1] || 1;
    const u = (target - cum[i - 1]) / seg;
    pts.push({
      x: a.x + (b.x - a.x) * u + rand() * 2 * jitter,
      y: a.y + (b.y - a.y) * u + rand() * 2 * jitter,
    });
  }
  return pts;
}

const TRAPEZE = [{ x: 250, y: 130 }, { x: 650, y: 130 }, { x: 760, y: 480 }, { x: 140, y: 480 }];
const RADII = [30, 30, 50, 50];

// --- 1. Échantillonnage de la spline ------------------------------------------
console.log('\n1. Spline passant par les points');
{
  const carre = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
  const droit = sampleClosedPath(carre, { smooth: 0, spacing: 5 });
  check('mode segments droits : sommets respectés',
    droit.some((p) => Math.abs(p.x - 100) < 0.01 && Math.abs(p.y) < 0.01));
  const lisse = sampleClosedPath(carre, { smooth: 1, spacing: 5 });
  check('mode lissé : contour fermé et dense', lisse.length > 40, `${lisse.length} points`);

  // Une spline centripète ne doit ni boucler ni rebrousser sur des points serrés
  const serres = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
  const s = sampleClosedPath(serres, { smooth: 1, spacing: 4 });
  const fini = s.every((p) => isFinite(p.x) && isFinite(p.y));
  check('points très rapprochés : pas de rebroussement', fini);
}

// --- 2. Cotes d'ensemble selon le nombre de points ----------------------------
// Les cotes de référence sont mesurées sur la géométrie exacte : un congé R50
// rogne les coins, la pièce est donc plus étroite que l'écart entre sommets vifs.
const VRAI = roundedPolygon(TRAPEZE, RADII);
const REF = minAreaRect(VRAI);
const REF_AIRE = polygonArea(VRAI);
console.log(`\n2. Cotes d'ensemble — pièce réelle ${REF.width.toFixed(1)} × ${REF.height.toFixed(1)} px`);
{
  console.log('     points | longueur | largeur  | écart max');
  for (const n of [12, 24, 48, 64]) {
    const shape = shapeFromPoints(clickPoints(VRAI, n));
    const eL = Math.abs(shape.px.length - REF.width) / REF.width;
    const el = Math.abs(shape.px.width - REF.height) / REF.height;
    console.log(`     ${String(n).padStart(6)} | ${shape.px.length.toFixed(1).padStart(8)} | ${shape.px.width.toFixed(1).padStart(8)} | ${(Math.max(eL, el) * 100).toFixed(1).padStart(6)} %`);
  }
  // Trop peu de points : la spline coupe les congés et déborde ailleurs.
  const rare = shapeFromPoints(clickPoints(VRAI, 12));
  check('12 points : écart notable, mais borné à 5 %',
    Math.abs(rare.px.width - REF.height) / REF.height < 0.05,
    `${(Math.abs(rare.px.width - REF.height) / REF.height * 100).toFixed(1)} %`);

  for (const n of [24, 48]) {
    const shape = shapeFromPoints(clickPoints(VRAI, n));
    near(`${n} points — longueur`, shape.px.length, +REF.width.toFixed(1), 12);
    near(`${n} points — largeur`, shape.px.width, +REF.height.toFixed(1), 12);
  }
}

// --- 3. Rayons selon le nombre de points --------------------------------------
console.log('\n3. Rayons retrouvés — vrais congés R30 (haut) et R50 (bas)');
{
  const resultats = [];
  for (const n of [16, 24, 32, 48, 64]) {
    const shape = shapeFromPoints(clickPoints(VRAI, n));
    const groups = groupRadii(fitPrimitives(shape.contour).primitives, 0.25);
    const petit = groups.filter((g) => g.radius < 40).sort((a, b) => b.count - a.count)[0];
    const grand = groups.filter((g) => g.radius >= 40).sort((a, b) => b.count - a.count)[0];
    resultats.push({ n, petit: petit ? petit.radius : NaN, grand: grand ? grand.radius : NaN });
  }
  console.log('     points | R30 mesuré | R50 mesuré');
  for (const r of resultats) {
    console.log(`     ${String(r.n).padStart(6)} | ${(isFinite(r.petit) ? r.petit.toFixed(1) : '  --').padStart(10)} | ${(isFinite(r.grand) ? r.grand.toFixed(1) : '  --').padStart(10)}`);
  }

  const dense = resultats[resultats.length - 1];
  check('avec 64 points, les deux rayons sont retrouvés',
    isFinite(dense.petit) && isFinite(dense.grand),
    `${dense.petit} / ${dense.grand}`);
  near('64 points — petit rayon', dense.petit, 30, 8);
  near('64 points — grand rayon', dense.grand, 50, 10);
}

// --- 4. Tolérance au tremblement de la main -----------------------------------
console.log('\n4. Clics imprécis : ±3 px de tremblement, 48 points');
{
  const shape = shapeFromPoints(clickPoints(VRAI, 48, 3, 7));
  near('longueur', shape.px.length, +REF.width.toFixed(1), 16);
  near('largeur', shape.px.width, +REF.height.toFixed(1), 16);
  const ecartAire = Math.abs(shape.px.areaGross - REF_AIRE) / REF_AIRE;
  check('aire à ±6 % de la vraie aire', ecartAire < 0.06,
    `${Math.round(shape.px.areaGross)} px² contre ${Math.round(REF_AIRE)} px², écart ${(ecartAire * 100).toFixed(1)} %`);
}

// --- 5. Cercle défini par quelques points -------------------------------------
console.log('\n5. Cercle R120 défini par 10 points seulement');
{
  const pts = Array.from({ length: 10 }, (_, i) => {
    const a = (2 * Math.PI * i) / 10;
    return { x: 300 + 120 * Math.cos(a), y: 300 + 120 * Math.sin(a) };
  });
  const shape = shapeFromPoints(pts);
  near('diamètre équivalent', shape.px.equivalentDiameter, 240, 6);
  const groups = groupRadii(fitPrimitives(shape.contour).primitives);
  check('un rayon détecté', groups.length >= 1);
  near('rayon', groups[0].radius, 120, 6);
  check('circularité proche de 1', Math.abs(shape.ratios.circularity - 1) < 0.05,
    shape.ratios.circularity.toFixed(3));
}

// --- 6. Mode segments droits : les sommets restent vifs -----------------------
console.log('\n6. Mode segments droits sur un carré : angles conservés');
{
  const carre = [{ x: 100, y: 100 }, { x: 400, y: 100 }, { x: 400, y: 400 }, { x: 100, y: 400 }];
  const shape = shapeFromPoints(carre, { smooth: 0 });
  near('longueur', shape.px.length, 300, 1);
  near('largeur', shape.px.width, 300, 1);
  near('périmètre', shape.px.perimeter, 1200, 4);
  const groups = groupRadii(fitPrimitives(shape.contour).primitives);
  check('aucun congé inventé sur un carré vif', groups.length === 0 || groups[0].radius < 12,
    groups.map((g) => `${g.count}×R${g.radius.toFixed(1)}`).join(' ') || 'aucun arc');
}

// --- 7. Rasterisation en masque ------------------------------------------------
console.log('\n7. Rasterisation du polygone (usage comme zone de recherche)');
{
  const carre = [{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 90 }, { x: 10, y: 90 }];
  const mask = rasterizePolygon(carre, 100, 100);
  let count = 0;
  for (const v of mask) count += v;
  near('surface couverte', count, 80 * 80, 400);
  check('intérieur marqué', mask[50 * 100 + 50] === 1);
  check('extérieur vierge', mask[5 * 100 + 5] === 0);
}

// --- 8. Cas dégénérés -----------------------------------------------------------
console.log('\n8. Cas dégénérés');
{
  check('moins de 3 points : pas de forme', shapeFromPoints([{ x: 0, y: 0 }, { x: 1, y: 1 }]) === null);
  check('liste vide : pas de forme', shapeFromPoints([]) === null);
  const plat = shapeFromPoints([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }]);
  check('points alignés : traité sans planter', plat === null || isFinite(plat.px.length));
}

console.log(`\n${checks - failures}/${checks} vérifications passées.`);
if (failures) {
  console.error(`${failures} échec(s).`);
  process.exit(1);
}
