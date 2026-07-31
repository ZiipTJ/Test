/* Génère des fichiers d'exemple STL et STEP pour tester les importeurs.
   Usage : node tests/make-samples.mjs  ->  tests/samples/ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(dir, 'samples');
fs.mkdirSync(out, { recursive: true });

const sandbox = { window: {}, console, Math, Float64Array, Int32Array, Int8Array, Map, Set, Array, Error, isFinite, isNaN, parseFloat, parseInt, JSON };
vm.createContext(sandbox);
for (const f of ['geom.js', 'mesh.js']) {
  vm.runInContext(fs.readFileSync(path.join(dir, '..', 'js', f), 'utf8'), sandbox, { filename: f });
}
const PP = sandbox.window.PP;

/* ---------- STL binaire d'une plaque extrudée à partir d'un contour ---------- */
function writeSTL(file, region, thickness, meshSize) {
  const m = PP.Mesh.meshRegion(region, meshSize);
  const tris = [];
  const push = (a, b, c) => {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const l = Math.hypot(...n) || 1;
    tris.push({ n: n.map(x => x / l), v: [a, b, c] });
  };
  const top = (i) => [m.nodes[i][0], m.nodes[i][1], thickness];
  const bot = (i) => [m.nodes[i][0], m.nodes[i][1], 0];
  for (const t of m.elems) {
    push(top(t[0]), top(t[1]), top(t[2]));
    push(bot(t[0]), bot(t[2]), bot(t[1]));
  }
  // Faces latérales : arêtes de bord du maillage
  const cnt = new Map();
  for (const t of m.elems) for (let k = 0; k < 3; k++) {
    const a = t[k], b = t[(k + 1) % 3];
    const key = a < b ? a + ',' + b : b + ',' + a;
    cnt.set(key, (cnt.get(key) || 0) + 1);
  }
  for (const [key, c] of cnt) {
    if (c !== 1) continue;
    const [a, b] = key.split(',').map(Number);
    push(bot(a), bot(b), top(b));
    push(bot(a), top(b), top(a));
  }
  const buf = Buffer.alloc(84 + tris.length * 50);
  buf.write('Plaque PEHD - fichier de test', 0);
  buf.writeUInt32LE(tris.length, 80);
  let o = 84;
  for (const t of tris) {
    for (const x of t.n) { buf.writeFloatLE(x, o); o += 4; }
    for (const p of t.v) for (const x of p) { buf.writeFloatLE(x, o); o += 4; }
    buf.writeUInt16LE(0, o); o += 2;
  }
  fs.writeFileSync(file, buf);
  return tris.length;
}

/* ---------- STEP AP203 : plaque rectangulaire percée d'un trou ---------- */
function writeSTEP(file, a, b, t, holeR, holeX, holeY) {
  let id = 100;
  const L = [];
  const nx = () => '#' + (++id);
  const E = (s) => { const r = nx(); L.push(`${r} = ${s};`); return r; };
  const pt = (x, y, z) => E(`CARTESIAN_POINT('',(${x},${y},${z}))`);
  const dir = (x, y, z) => E(`DIRECTION('',(${x},${y},${z}))`);
  const vtx = (p) => E(`VERTEX_POINT('',${p})`);
  const ax2 = (p, d, r) => E(`AXIS2_PLACEMENT_3D('',${p},${d},${r})`);

  const dz = dir(0, 0, 1), dzn = dir(0, 0, -1), dx = dir(1, 0, 0), dy = dir(0, 1, 0);

  function lineEdge(v1, p1, v2, p2) {
    const d = [p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]];
    const len = Math.hypot(...d) || 1;
    const vd = dir(d[0] / len, d[1] / len, d[2] / len);
    const vec = E(`VECTOR('',${vd},${len})`);
    const org = pt(p1[0], p1[1], p1[2]);
    const line = E(`LINE('',${org},${vec})`);
    return E(`EDGE_CURVE('',${v1},${v2},${line},.T.)`);
  }
  function arcEdge(v1, v2, cx, cy, z, r) {
    const c = pt(cx, cy, z);
    const pl = ax2(c, dz, dx);
    const circ = E(`CIRCLE('',${pl},${r})`);
    return E(`EDGE_CURVE('',${v1},${v2},${circ},.T.)`);
  }
  function face(bounds, originPt, normDir, refDir) {
    const pl = ax2(originPt, normDir, refDir);
    const surf = E(`PLANE('',${pl})`);
    return E(`ADVANCED_FACE('',(${bounds.join(',')}),${surf},.T.)`);
  }
  function loop(edges, senses) {
    const oe = edges.map((e, i) => E(`ORIENTED_EDGE('',*,*,${e},${senses[i] ? '.T.' : '.F.'})`));
    return E(`EDGE_LOOP('',(${oe.join(',')}))`);
  }

  const faces = [];
  for (const z of [t, 0]) {
    const P = [[0, 0, z], [a, 0, z], [a, b, z], [0, b, z]];
    const V = P.map(p => vtx(pt(p[0], p[1], p[2])));
    const edges = [];
    for (let i = 0; i < 4; i++) edges.push(lineEdge(V[i], P[i], V[(i + 1) % 4], P[(i + 1) % 4]));
    const ol = loop(edges, [1, 1, 1, 1]);
    const bounds = [E(`FACE_OUTER_BOUND('',${ol},.T.)`)];
    if (holeR > 0) {
      const h1 = [holeX + holeR, holeY, z], h2 = [holeX - holeR, holeY, z];
      const vh1 = vtx(pt(...h1)), vh2 = vtx(pt(...h2));
      const e1 = arcEdge(vh1, vh2, holeX, holeY, z, holeR);
      const e2 = arcEdge(vh2, vh1, holeX, holeY, z, holeR);
      const il = loop([e1, e2], [1, 1]);
      bounds.push(E(`FACE_BOUND('',${il},.T.)`));
    }
    faces.push(face(bounds, pt(0, 0, z), z === t ? dz : dzn, dx));
  }

  const header =
`ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('Plaque PEHD - fichier de test'),'2;1');
FILE_NAME('plaque-test.step','2026-01-01T00:00:00',(''),(''),'','','');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));
ENDSEC;
DATA;
#1 = ( GEOMETRIC_REPRESENTATION_CONTEXT(3)
GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#4))
GLOBAL_UNIT_ASSIGNED_CONTEXT((#2,#3)) REPRESENTATION_CONTEXT('',''));
#2 = ( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) );
#3 = ( NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.) );
#4 = UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-07),#2,'distance_accuracy_value','');
`;
  const footer = `\nENDSEC;\nEND-ISO-10303-21;\n`;
  fs.writeFileSync(file, header + L.join('\n') + footer);
  return faces.length;
}

/* ---------- Génération ---------- */
const rect = (a, b) => [[0, 0], [a, 0], [a, b], [0, b]];
const circle = (cx, cy, r, n) => Array.from({ length: n }, (_, i) => {
  const th = -2 * Math.PI * i / n;   // sens horaire = trou
  return [cx + r * Math.cos(th), cy + r * Math.sin(th)];
});

const nt1 = writeSTL(path.join(out, 'plaque-rect-1200x800-ep15.stl'),
  { outer: rect(1200, 800), holes: [] }, 15, 60);

const nt2 = writeSTL(path.join(out, 'plaque-trouee-1000x1000-ep20.stl'),
  { outer: rect(1000, 1000), holes: [circle(500, 500, 150, 48)] }, 20, 45);

const nt3 = writeSTL(path.join(out, 'plaque-forme-L-ep12.stl'),
  { outer: [[0, 0], [1400, 0], [1400, 500], [600, 500], [600, 1100], [0, 1100]], holes: [] }, 12, 55);

const nf = writeSTEP(path.join(out, 'plaque-rect-900x600-ep20-trou200.step'), 900, 600, 20, 100, 450, 300);

console.log(`STL rectangulaire  : ${nt1} triangles`);
console.log(`STL avec trou      : ${nt2} triangles`);
console.log(`STL en L           : ${nt3} triangles`);
console.log(`STEP               : ${nf} faces planes`);
console.log('-> ' + out);
