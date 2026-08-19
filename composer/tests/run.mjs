/* Tests de la partie calcul : import, facettisation, maillage, algèbre.
   Lancement : node composer/tests/run.mjs
   (Les tests d'interface, qui demandent un navigateur, sont dans run-ui.mjs.) */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const samples = join(here, 'samples');

const { M3D } = require(join(root, 'js/m3d.js'));
const { Mesh } = require(join(root, 'js/mesh.js'));
const { Import } = require(join(root, 'js/import.js'));
const { Step } = require(join(root, 'js/step.js'));

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}
const near = (a, b, tolRel) => Math.abs(a - b) <= Math.abs(b) * (tolRel || 0.02) + 1e-9;

/* ---------- Mesures sur une soupe de triangles ---------- */
function measure(tris) {
  let area = 0, vol = 0;
  const bb = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (let i = 0; i < tris.length; i += 9) {
    const p = [[tris[i], tris[i + 1], tris[i + 2]], [tris[i + 3], tris[i + 4], tris[i + 5]], [tris[i + 6], tris[i + 7], tris[i + 8]]];
    const u = M3D.V.sub(p[1], p[0]), v = M3D.V.sub(p[2], p[0]);
    area += M3D.V.len(M3D.V.cross(u, v)) / 2;
    vol += M3D.V.dot(p[0], M3D.V.cross(p[1], p[2])) / 6;
    for (const q of p) for (let k = 0; k < 3; k++) {
      if (q[k] < bb.min[k]) bb.min[k] = q[k];
      if (q[k] > bb.max[k]) bb.max[k] = q[k];
    }
  }
  return { area, vol, bb, n: tris.length / 9 };
}
const merge = (actors) => {
  const total = actors.reduce((s, a) => s + a.tris.length, 0);
  const out = new Float32Array(total);
  let o = 0;
  for (const a of actors) { out.set(a.tris, o); o += a.tris.length; }
  return out;
};

/* ================= Algèbre ================= */
console.log('\nAlgèbre 3D');
{
  const { M, Q, V } = M3D;
  const q = Q.fromAxisAngle([0, 0, 1], Math.PI / 2);
  const m = M.compose([10, 0, 0], q, [5, 0, 0]);
  check('rotation de 90° autour du pivot', V.dist(M.apply(m, [5, 0, 0]), [15, 0, 0]) < 1e-6,
    JSON.stringify(M.apply(m, [5, 0, 0])));
  const p = [3, -7, 2];
  check('inverse de matrice', V.dist(M.apply(M.invert(m), M.apply(m, p)), p) < 1e-5);
  check('Euler aller-retour', V.dist(Q.toEulerDeg(Q.fromEulerDeg([12, -34, 56])), [12, -34, 56]) < 1e-4);
  const hit = M3D.rayTriangle([0, 0, 10], [0, 0, -1], [-1, -1, 0], [1, -1, 0], [0, 1, 0]);
  check('rayon / triangle', Math.abs(hit - 10) < 1e-6, String(hit));
  check('rayon / triangle : hors du triangle', M3D.rayTriangle([5, 5, 10], [0, 0, -1], [-1, -1, 0], [1, -1, 0], [0, 1, 0]) === null);
  const cl = M3D.closestBetweenLines([0, 5, 0], [1, 0, 0], [0, 0, 0], [0, 0, 1]);
  check('droites gauches : point le plus proche', Math.abs(cl.s) < 1e-9);
}

/* ================= Découpe d'oreilles ================= */
console.log('\nTriangulation de contours');
{
  const area = (r) => r.tris.reduce((s, t) => {
    const [a, b, c] = t.map(i => r.pts[i]);
    return s + Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
  }, 0);
  check('carré percé', near(area(Step.triangulate([[0, 0], [10, 0], [10, 10], [0, 10]],
    [[[3, 3], [3, 7], [7, 7], [7, 3]]])), 84, 1e-9));
  check('deux trous', near(area(Step.triangulate([[0, 0], [20, 0], [20, 10], [0, 10]],
    [[[2, 2], [2, 4], [4, 4], [4, 2]], [[10, 2], [10, 8], [16, 8], [16, 2]]])), 160, 1e-9));
  check('contour en L', near(area(Step.triangulate([[0, 0], [10, 0], [10, 4], [4, 4], [4, 10], [0, 10]], [])), 64, 1e-9));
  check('contour dégénéré', Step.triangulate([[0, 0], [1, 0]], []).tris.length === 0);
}

/* ================= Maillage ================= */
console.log('\nPréparation du maillage');
{
  const P = [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0], [0, 0, 10], [10, 0, 10], [10, 10, 10], [0, 10, 10]];
  const T = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4],
  [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  const a = [];
  for (const t of T) for (const i of t) a.push(...P[i]);
  const m = Mesh.build(Float32Array.from(a));
  check('cube : 12 triangles', m.nTri === 12);
  check('cube : 12 arêtes vives', m.edges.length / 6 === 12, String(m.edges.length / 6));
  check('cube : centre', M3D.V.dist(m.center, [5, 5, 5]) < 1e-9);
  check('cube : normales de face conservées', Math.abs(m.normal[2] + 1) < 1e-6);
}

/* ================= Séparation des corps ================= */
console.log('\nSéparation en corps');
{
  const box = (x0, d) => {
    const P = [[x0, 0, 0], [x0 + d, 0, 0], [x0 + d, d, 0], [x0, d, 0], [x0, 0, d], [x0 + d, 0, d], [x0 + d, d, d], [x0, d, d]];
    const T = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4],
    [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
    const o = [];
    for (const t of T) for (const i of t) o.push(...P[i]);
    return o;
  };
  const parts = Import.splitConnected(Float32Array.from([...box(0, 10), ...box(50, 10), ...box(90, 5)]));
  check('trois boîtes disjointes', parts && parts.length === 3, parts ? String(parts.length) : 'null');
  check('corps soudé : pas de découpe', Import.splitConnected(Float32Array.from(box(0, 10))) === null);
}

/* ================= STL ================= */
console.log('\nImport STL');
{
  const f = join(root, '..', 'plaque-pehd/tests/samples/plaque-rect-1200x800-ep15.stl');
  if (existsSync(f)) {
    const buf = readFileSync(f);
    const res = Import.importSTL(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    const m = measure(merge(res.actors));
    check('plaque 1200×800×15 : boîte englobante',
      near(m.bb.max[0] - m.bb.min[0], 1200) && near(m.bb.max[1] - m.bb.min[1], 800) && near(m.bb.max[2] - m.bb.min[2], 15),
      JSON.stringify([m.bb.min, m.bb.max]));
    check('plaque : volume', near(m.vol, 1200 * 800 * 15, 0.01), m.vol.toFixed(0));
  } else console.log('  (échantillon STL absent, test ignoré)');
}

/* ================= STEP ================= */
console.log('\nFacettisation STEP');
{
  const cyl = join(samples, 'cylindre-d60-h40.step');
  if (!existsSync(cyl)) {
    console.log('  (échantillons absents : lancez d\'abord node composer/tests/make-samples.mjs)');
  } else {
    const R = 30, H = 40;
    const m = measure(merge(Step.importSTEP(readFileSync(cyl, 'utf8')).actors));
    check('cylindre : aire', near(m.area, 2 * Math.PI * R * R + 2 * Math.PI * R * H, 0.02), m.area.toFixed(0));
    check('cylindre : volume', near(m.vol, Math.PI * R * R * H, 0.02), m.vol.toFixed(0));
    check('cylindre : boîte englobante', near(m.bb.max[0] - m.bb.min[0], 2 * R, 0.01) && near(m.bb.max[2] - m.bb.min[2], H, 1e-6));
    check('cylindre : maillage raisonnable', m.n < 600, String(m.n));

    const Rs = 25;
    const ms = measure(merge(Step.importSTEP(readFileSync(join(samples, 'sphere-r25.step'), 'utf8')).actors));
    check('sphère : aire', near(ms.area, 4 * Math.PI * Rs * Rs, 0.02), ms.area.toFixed(0));
    check('sphère : volume', near(ms.vol, 4 / 3 * Math.PI * Rs ** 3, 0.03), ms.vol.toFixed(0));
  }

  const asm = join(root, '..', 'plaque-pehd/tests/samples/assemblage-panneau-sur-bati.step');
  if (existsSync(asm)) {
    const res = Step.importSTEP(readFileSync(asm, 'utf8'));
    check('assemblage : 6 acteurs', res.actors.length === 6, String(res.actors.length));
    check('assemblage : noms de pièces repris', res.actors[0].name === 'PANNEAU_PEHD', res.actors[0].name);
    const m = measure(merge(res.actors));
    check('assemblage : étendue', near(m.bb.max[0] - m.bb.min[0], 1400, 0.01) && near(m.bb.max[1] - m.bb.min[1], 900, 0.01),
      JSON.stringify([m.bb.min, m.bb.max]));
  }

  const perce = join(root, '..', 'plaque-pehd/tests/samples/plaque-rect-900x600-ep20-trou200.step');
  if (existsSync(perce)) {
    const m = measure(merge(Step.importSTEP(readFileSync(perce, 'utf8')).actors));
    /* Le perçage de cet échantillon est un polygone à 32 côtés, et sa paroi
       n'est pas modélisée : on vérifie donc les aires, pas le volume. */
    const aireTrou = 0.5 * 32 * 100 * 100 * Math.sin(2 * Math.PI / 32);
    check('plaque percée : aire des faces', near(m.area, 2 * (900 * 600 - aireTrou) + 2 * (900 + 600) * 20, 0.005),
      m.area.toFixed(0));
  }
}

/* ================= 3MF ================= */
console.log('\nImport 3MF');
if (typeof DOMParser === 'undefined') {
  console.log("  (DOMParser absent de Node : l'import 3MF est vérifié par run-ui.mjs dans le navigateur)");
} else {
  const buf = readFileSync(join(samples, 'deux-boites.3mf'));
  const res = await Import.import3MF(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  check('3MF : deux objets', res.actors.length === 2);
}

console.log(`\n${pass} test(s) réussis, ${fail} échec(s).`);
process.exit(fail ? 1 : 0);
