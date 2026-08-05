// Tests de la chaîne 3D : triangulation, prisme, sculptage par silhouettes,
// export STL et STEP. Lancement : node tests/run3d.mjs

import { triangulate, signedArea } from '../js/triangulate.js';
import {
  buildPrism, meshVolume, meshArea, meshBounds, checkWatertight,
  toBinarySTL, toAsciiSTL, carveToCad, centerOnBase,
} from '../js/mesh3d.js';
import { carve, surfaceNets, smoothMesh, sideView, topView, worldBounds } from '../js/carve.js';
import { prismToStep } from '../js/step.js';

let failures = 0;
let checks = 0;
const check = (label, ok, detail = '') => {
  checks++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failures++;
};
/** Un maillage vide est trivialement « fermé » : on exige d'abord des triangles. */
const checkSolid = (label, mesh) => {
  check(`${label} : maillage non vide`, mesh.triangles.length > 0, `${mesh.triangles.length} triangles`);
  const wt = checkWatertight(mesh);
  check(`${label} : maillage fermé`, mesh.triangles.length > 0 && wt.watertight,
    `bord ${wt.boundary}, non-manifold ${wt.nonManifold}, incohérent ${wt.inconsistent}`);
};
const near = (label, actual, expected, tol) => {
  const d = Math.abs(actual - expected);
  check(`${label} ≈ ${typeof expected === 'number' ? expected.toFixed(2) : expected} (±${tol})`, d <= tol,
    `mesuré ${actual.toFixed(3)}, écart ${d.toFixed(3)}`);
};

const rect = (w, h) => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
const circle = (cx, cy, r, n = 48) => Array.from({ length: n }, (_, i) => {
  const a = (2 * Math.PI * i) / n;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
});
const polygonArea = (ring) => Math.abs(signedArea(ring));

// --- 1. Triangulation ---------------------------------------------------------
console.log('\n1. Triangulation avec trous');
{
  const { vertices, triangles } = triangulate(rect(100, 60));
  check('rectangle : 2 triangles', triangles.length === 2, `${triangles.length}`);
  const area = triangles.reduce((s, [a, b, c]) => s + polygonArea([vertices[a], vertices[b], vertices[c]]), 0);
  near('aire triangulée', area, 6000, 0.01);
}
{
  const outer = rect(100, 100);
  const hole = circle(50, 50, 20).reverse();
  const { vertices, triangles } = triangulate(outer, [hole]);
  const area = triangles.reduce((s, [a, b, c]) => s + polygonArea([vertices[a], vertices[b], vertices[c]]), 0);
  const expected = 10000 - polygonArea(hole);
  near('aire avec un trou circulaire', area, expected, expected * 0.001);
}
{
  const outer = rect(200, 100);
  const holes = [circle(50, 50, 15).reverse(), circle(150, 50, 15).reverse()];
  const { vertices, triangles } = triangulate(outer, holes);
  const area = triangles.reduce((s, [a, b, c]) => s + polygonArea([vertices[a], vertices[b], vertices[c]]), 0);
  const expected = 20000 - holes.reduce((s, h) => s + polygonArea(h), 0);
  near('aire avec deux trous', area, expected, expected * 0.001);
}
{
  const L = [
    { x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 40 },
    { x: 40, y: 40 }, { x: 40, y: 120 }, { x: 0, y: 120 },
  ];
  const { vertices, triangles } = triangulate(L);
  const area = triangles.reduce((s, [a, b, c]) => s + polygonArea([vertices[a], vertices[b], vertices[c]]), 0);
  near('aire d\'une forme en L (concave)', area, polygonArea(L), 0.01);
}

// --- 2. Prisme ---------------------------------------------------------------
console.log('\n2. Prisme extrudé');
{
  const mesh = buildPrism(rect(100, 50), [], 10, 1);
  checkSolid('prisme plein', mesh);
  near('volume', meshVolume(mesh), 100 * 50 * 10, 1);
  const b = meshBounds(mesh);
  near('encombrement X', b.size.x, 100, 0.001);
  near('encombrement Y', b.size.y, 50, 0.001);
  near('encombrement Z', b.size.z, 10, 0.001);
  near('surface développée', meshArea(mesh), 2 * 100 * 50 + 2 * (100 + 50) * 10, 1);
}
{
  const hole = circle(50, 50, 12, 64);
  const mesh = buildPrism(rect(100, 100), [hole], 8, 1);
  checkSolid('prisme percé', mesh);
  const expected = (10000 - polygonArea(hole)) * 8;
  near('volume avec perçage', meshVolume(mesh), expected, expected * 0.001);
}
{
  // Mise à l'échelle : contour en pixels, 0,5 mm par pixel
  const mesh = buildPrism(rect(200, 100), [], 6, 0.5);
  near('volume après mise à l\'échelle', meshVolume(mesh), 100 * 50 * 6, 1);
}

// --- 3. Export STL -----------------------------------------------------------
console.log('\n3. Export STL');
{
  const mesh = buildPrism(rect(40, 30), [], 5, 1);
  const stl = toBinarySTL(mesh, 'test');
  const view = new DataView(stl.buffer, stl.byteOffset, stl.byteLength);
  const count = view.getUint32(80, true);
  check('en-tête binaire : nombre de triangles', count === mesh.triangles.length, `${count} / ${mesh.triangles.length}`);
  check('taille du fichier', stl.byteLength === 84 + count * 50, `${stl.byteLength} octets`);

  // Relecture des sommets et comparaison de la boîte englobante
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (let t = 0; t < count; t++) {
    const off = 84 + t * 50 + 12;
    for (let v = 0; v < 3; v++) {
      const x = view.getFloat32(off + v * 12, true);
      const y = view.getFloat32(off + v * 12 + 4, true);
      const z = view.getFloat32(off + v * 12 + 8, true);
      min.x = Math.min(min.x, x); max.x = Math.max(max.x, x);
      min.y = Math.min(min.y, y); max.y = Math.max(max.y, y);
      min.z = Math.min(min.z, z); max.z = Math.max(max.z, z);
    }
  }
  near('STL relu : largeur', max.x - min.x, 40, 0.01);
  near('STL relu : hauteur', max.z - min.z, 5, 0.01);

  const ascii = toAsciiSTL(mesh);
  check('STL ASCII : structure', ascii.startsWith('solid ') && ascii.trimEnd().endsWith('endsolid mesure_photo'));
  check('STL ASCII : nombre de facettes',
    (ascii.match(/facet normal/g) || []).length === mesh.triangles.length);
}

// --- 4. Sculptage par silhouettes : sphère -----------------------------------
console.log('\n4. Sculptage — sphère vue sous 16 angles');
{
  const W = 200, H = 200, R = 60;
  const axisX = 100, baseY = 100;
  const disc = () => {
    const m = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if ((x - axisX) ** 2 + (y - baseY) ** 2 <= R * R) m[y * W + x] = 1;
      }
    }
    return m;
  };
  const views = Array.from({ length: 16 }, (_, i) => sideView(disc(), W, H, (i * 2 * Math.PI) / 16, axisX, baseY));
  const grid = carve(views, { resolution: 72 });
  const mesh = surfaceNets(grid);
  checkSolid('sphère sculptée', mesh);
  const volume = meshVolume(mesh);
  const expected = (4 / 3) * Math.PI * R ** 3;
  check(`volume à ±4 % du volume théorique (${(expected / 1000).toFixed(0)}e3)`,
    Math.abs(volume - expected) / expected < 0.04, `mesuré ${(volume / 1000).toFixed(0)}e3, écart ${((volume - expected) / expected * 100).toFixed(2)} %`);
  const b = meshBounds(mesh);
  near('diamètre X', b.size.x, 2 * R, 3);
  near('diamètre Y', b.size.y, 2 * R, 3);
  near('diamètre Z', b.size.z, 2 * R, 3);
}

// --- 5. Sculptage : pavé à partir de deux vues -------------------------------
console.log('\n5. Sculptage — pavé 80 × 40 × 24 depuis une vue de dessus et une vue de côté');
{
  const W = 200, H = 200;
  const cx = 100, cy = 100, baseY = 150;
  const box = (w, h, ox, oy) => {
    const m = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (Math.abs(x - ox) <= w / 2 && Math.abs(y - oy) <= h / 2) m[y * W + x] = 1;
      }
    }
    return m;
  };
  // Dessus : 80 (X) × 40 (Z). Côté à 0° : largeur 80 (X), hauteur 24 (Y) posée sur baseY.
  const sideMask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (Math.abs(x - cx) <= 40 && y <= baseY && y >= baseY - 24) sideMask[y * W + x] = 1;
    }
  }
  const views = [
    topView(box(80, 40, cx, cy), W, H, 0, cx, cy),
    sideView(sideMask, W, H, 0, cx, baseY),
  ];
  const grid = carve(views, { resolution: 96 });
  const mesh = surfaceNets(grid);
  const b = meshBounds(mesh);
  near('longueur X', b.size.x, 80, 2.5);
  near('profondeur Z', b.size.z, 40, 2.5);
  near('hauteur Y', b.size.y, 24, 2.5);
  checkSolid('pavé sculpté', mesh);
  near('volume', meshVolume(mesh), 80 * 40 * 24, 80 * 40 * 24 * 0.08);
}

// --- 6. Repères, lissage, mise à l'échelle -----------------------------------
console.log('\n6. Repères et post-traitement');
{
  const W = 120, H = 120;
  const m = new Uint8Array(W * H);
  for (let y = 40; y < 80; y++) for (let x = 40; x < 80; x++) m[y * W + x] = 1;
  const views = [
    topView(m, W, H, 0, 60, 60),
    sideView(m, W, H, 0, 60, 80),
  ];
  const grid = carve(views, { resolution: 48 });
  const mesh = surfaceNets(grid);

  const cad = centerOnBase(carveToCad(mesh, 2)); // 2 mm par pixel
  const b = meshBounds(cad);
  // Le passage au repère CAO doit être une rotation : une symétrie retournerait
  // le solide et donnerait un volume négatif (modèle « à l'envers » en STL).
  check('changement de repère : volume resté positif', meshVolume(cad) > 0, `${meshVolume(cad).toFixed(1)}`);
  const ratio = meshVolume(cad) / (meshVolume(mesh) * 8);
  near('changement de repère : volume mis à l\'échelle ×2³', ratio, 1, 0.001);
  checkSolid('modèle en repère CAO', cad);
  near('Z posé sur zéro', b.min.z, 0, 0.001);
  near('mise à l\'échelle ×2 sur X', b.size.x, 80, 6);
  check('modèle centré en X', Math.abs((b.min.x + b.max.x) / 2) < 0.001);

  const smoothed = smoothMesh(mesh, 2, 0.5);
  check('lissage : nombre de sommets conservé', smoothed.vertices.length === mesh.vertices.length);
  checkSolid('maillage lissé', smoothed);
  const shrink = Math.abs(meshVolume(smoothed) / meshVolume(mesh) - 1);
  check('lissage : volume conservé à ±10 %', shrink < 0.1, `${(shrink * 100).toFixed(1)} %`);
}

// --- 7. Bornes du monde ------------------------------------------------------
console.log('\n7. Boîte englobante déduite des silhouettes');
{
  const W = 100, H = 100;
  const m = new Uint8Array(W * H);
  for (let y = 30; y < 70; y++) for (let x = 20; x < 80; x++) m[y * W + x] = 1;
  const b = worldBounds([sideView(m, W, H, 0, 50, 70)], 0);
  near('demi-largeur', b.max.x, 30, 0.5);
  near('hauteur basse', b.min.y, 0, 0.5);
  near('hauteur haute', b.max.y, 40, 0.5);
}

// --- 8. Export STEP ----------------------------------------------------------
console.log('\n8. Export STEP');
{
  const step = prismToStep(rect(100, 50), [], 10, 'plaque');
  check('en-tête ISO', step.startsWith('ISO-10303-21;'));
  check('pied de fichier', step.trimEnd().endsWith('END-ISO-10303-21;'));
  check('schéma AP214', step.includes('AUTOMOTIVE_DESIGN'));
  check('unité millimètre', step.includes('SI_UNIT(.MILLI.,.METRE.)'));
  check('solide B-rep', step.includes('MANIFOLD_SOLID_BREP'));
  check('rattachement produit', step.includes('SHAPE_DEFINITION_REPRESENTATION'));

  const faces = (step.match(/ADVANCED_FACE/g) || []).length;
  check('6 faces pour un pavé', faces === 6, `${faces} faces`);

  // Toute référence #n doit exister, et une seule fois
  const defined = new Set([...step.matchAll(/^#(\d+)=/gm)].map((m) => m[1]));
  const dupes = [...step.matchAll(/^#(\d+)=/gm)].length !== defined.size;
  check('aucun identifiant dupliqué', !dupes);
  const referenced = [...step.matchAll(/#(\d+)(?!=)/g)].map((m) => m[1]);
  const missing = [...new Set(referenced)].filter((id) => !defined.has(id));
  check('aucune référence pendante', missing.length === 0, `manquants : ${missing.slice(0, 5).join(', ')}`);

  // Chaque boucle d'arêtes doit être fermée : on reconstruit les chaînes de sommets
  const edgeCurves = new Map();
  for (const m of step.matchAll(/#(\d+)=EDGE_CURVE\('',#(\d+),#(\d+),/g)) {
    edgeCurves.set(m[1], [m[2], m[3]]);
  }
  const orientedEdges = new Map();
  for (const m of step.matchAll(/#(\d+)=ORIENTED_EDGE\('',\*,\*,#(\d+),\.([TF])\./g)) {
    const [a, b] = edgeCurves.get(m[2]);
    orientedEdges.set(m[1], m[3] === 'T' ? [a, b] : [b, a]);
  }
  let openLoops = 0;
  for (const m of step.matchAll(/#\d+=EDGE_LOOP\('',\(([^)]*)\)\)/g)) {
    const ids = m[1].split(',').map((s) => s.trim().replace('#', ''));
    const chain = ids.map((id) => orientedEdges.get(id));
    if (chain.some((c) => !c)) { openLoops++; continue; }
    for (let i = 0; i < chain.length; i++) {
      if (chain[i][1] !== chain[(i + 1) % chain.length][0]) { openLoops++; break; }
    }
  }
  check('toutes les boucles d\'arêtes sont fermées', openLoops === 0, `${openLoops} boucle(s) ouverte(s)`);
}
{
  const hole = circle(50, 50, 12, 24).reverse();
  const step = prismToStep(rect(100, 100), [hole], 8, 'plaque_percee');
  const faces = (step.match(/ADVANCED_FACE/g) || []).length;
  check('prisme percé : 4 + 24 parois + 2 faces planes', faces === 4 + 24 + 2, `${faces} faces`);
  check('contour intérieur déclaré', (step.match(/FACE_BOUND/g) || []).length === 2,
    `${(step.match(/FACE_BOUND/g) || []).length} FACE_BOUND`);
  const defined = new Set([...step.matchAll(/^#(\d+)=/gm)].map((m) => m[1]));
  const missing = [...new Set([...step.matchAll(/#(\d+)(?!=)/g)].map((m) => m[1]))].filter((id) => !defined.has(id));
  check('aucune référence pendante', missing.length === 0);
}

console.log(`\n${checks - failures}/${checks} vérifications passées.`);
if (failures) {
  console.error(`${failures} échec(s).`);
  process.exit(1);
}
