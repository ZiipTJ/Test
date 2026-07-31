/* Génère les fichiers d'exemple STL et STEP servant à tester les importeurs,
   la mesure d'épaisseur et la détection des contacts.
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

/* ============ Utilitaires STL ============ */
function Tri() { this.list = []; }
Tri.prototype.push = function (a, b, c) {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const l = Math.hypot(...n) || 1;
  this.list.push({ n: n.map(x => x / l), v: [a, b, c] });
};
/* Surface triangulée d'une région, à une cote donnée, orientée vers le haut ou le bas. */
Tri.prototype.face = function (region, z, up, meshSize) {
  const m = PP.Mesh.meshRegion(region, meshSize);
  for (const t of m.elems) {
    const p = t.map(i => [m.nodes[i][0], m.nodes[i][1], z]);
    if (up) this.push(p[0], p[1], p[2]); else this.push(p[0], p[2], p[1]);
  }
};
/* Paroi verticale le long d'un anneau, de z0 à z1. */
Tri.prototype.wall = function (ring, z0, z1) {
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    this.push([a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1]);
    this.push([a[0], a[1], z0], [b[0], b[1], z1], [a[0], a[1], z1]);
  }
};
/* Écriture ASCII multi-corps : le format STL ne sait nommer les corps que là. */
function writeSTLAscii(file, parts) {
  const out = [];
  let n = 0;
  for (const p of parts) {
    out.push(`solid ${p.name}`);
    for (const t of p.tris) {
      out.push(` facet normal ${t.n.map(x => x.toExponential(6)).join(' ')}`);
      out.push('  outer loop');
      for (const v of t.v) out.push(`   vertex ${v.map(x => x.toExponential(6)).join(' ')}`);
      out.push('  endloop');
      out.push(' endfacet');
      n++;
    }
    out.push(`endsolid ${p.name}`);
  }
  fs.writeFileSync(file, out.join('\n') + '\n');
  return n;
}

function writeSTL(file, tris) {
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

const rect = (x0, y0, a, b) => [[x0, y0], [x0 + a, y0], [x0 + a, y0 + b], [x0, y0 + b]];
const rectCW = (x0, y0, a, b) => rect(x0, y0, a, b).slice().reverse();
const circle = (cx, cy, r, n, cw) => Array.from({ length: n }, (_, i) => {
  const t = (cw ? -1 : 1) * 2 * Math.PI * i / n;
  return [cx + r * Math.cos(t), cy + r * Math.sin(t)];
});

/* Les contours sont rééchantillonnés au pas du maillage avant usage, pour que
   les parois et les faces partagent exactement les mêmes sommets : un STL
   exporté par un logiciel de CAO est conforme de la même manière. */
const rs = (ring, h) => PP.Geom.resampleRing(ring, h);

/* Plaque d'épaisseur constante extrudée depuis un contour. */
function plateSTL(region, thickness, meshSize) {
  const T = new Tri();
  const reg = { outer: rs(region.outer, meshSize), holes: region.holes.map(h => rs(h, meshSize)) };
  T.face(reg, thickness, true, meshSize);
  T.face(reg, 0, false, meshSize);
  T.wall(reg.outer, 0, thickness);
  for (const h of reg.holes) T.wall(h, 0, thickness);
  return T.list;
}

/* Panneau fraisé : épaisseur pleine, moins des poches débouchant vers le haut. */
function milledPlateSTL(outer0, thickness, pockets0, meshSize) {
  const T = new Tri();
  const outer = rs(outer0, meshSize);
  const pockets = pockets0.map(p => ({ ring: rs(p.ring, meshSize), depth: p.depth }));
  const holes = pockets.map(p => p.ring.slice().reverse());
  T.face({ outer, holes }, thickness, true, meshSize);          // dessus, hors poches
  for (const p of pockets) {
    T.face({ outer: p.ring, holes: [] }, thickness - p.depth, true, meshSize); // fond de poche
    T.wall(p.ring, thickness - p.depth, thickness);              // parois de poche
  }
  T.face({ outer, holes: [] }, 0, false, meshSize);              // dessous plein
  T.wall(outer, 0, thickness);
  return T.list;
}

/* Pavé droit (poutre d'ossature). */
function boxSTL(x0, y0, z0, a, b, c) {
  const T = new Tri();
  const h = Math.min(a, b) / 2;
  const r = rs(rect(x0, y0, a, b), h);
  T.face({ outer: r, holes: [] }, z0 + c, true, h);
  T.face({ outer: r, holes: [] }, z0, false, h);
  T.wall(r, z0, z0 + c);
  return T.list;
}

/* ============ Écriture STEP ============ */
/* Écrit un assemblage de corps décrits par des faces planes.
   part = { name, faces: [ { normal:[..], loops:[ [[x,y,z],...], ... ] } ] } */
function writeSTEP(file, parts, opts) {
  opts = opts || {};
  let id = 100;
  const L = [];
  const nx = () => '#' + (++id);
  const E = (s) => { const r = nx(); L.push(`${r} = ${s};`); return r; };
  const pt = (p) => E(`CARTESIAN_POINT('',(${p[0]},${p[1]},${p[2]}))`);
  const dr = (d) => E(`DIRECTION('',(${d[0]},${d[1]},${d[2]}))`);
  const vx = (p) => E(`VERTEX_POINT('',${pt(p)})`);

  function perp(n) {
    const r = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const c = [r[1] * n[2] - r[2] * n[1], r[2] * n[0] - r[0] * n[2], r[0] * n[1] - r[1] * n[0]];
    const l = Math.hypot(...c) || 1;
    return c.map(x => x / l);
  }
  function ax2(origin, axis, ref) { return E(`AXIS2_PLACEMENT_3D('',${pt(origin)},${dr(axis)},${dr(ref)})`); }
  function lineEdge(v1, p1, v2, p2) {
    const d = [p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]];
    const len = Math.hypot(...d) || 1;
    const vec = E(`VECTOR('',${dr(d.map(x => x / len))},${len})`);
    const line = E(`LINE('',${pt(p1)},${vec})`);
    return E(`EDGE_CURVE('',${v1},${v2},${line},.T.)`);
  }
  function loopOf(ring) {
    const V = ring.map(vx);
    const oe = [];
    for (let i = 0; i < ring.length; i++) {
      const j = (i + 1) % ring.length;
      const ec = lineEdge(V[i], ring[i], V[j], ring[j]);
      oe.push(E(`ORIENTED_EDGE('',*,*,${ec},.T.)`));
    }
    return E(`EDGE_LOOP('',(${oe.join(',')}))`);
  }

  const solidRefs = [];
  for (const part of parts) {
    const faceRefs = [];
    for (const f of part.faces) {
      const bounds = f.loops.map((ring, i) => {
        const lp = loopOf(ring);
        return E(`${i === 0 ? 'FACE_OUTER_BOUND' : 'FACE_BOUND'}('',${lp},.T.)`);
      });
      const plane = E(`PLANE('',${ax2(f.loops[0][0], f.normal, perp(f.normal))})`);
      faceRefs.push(E(`ADVANCED_FACE('',(${bounds.join(',')}),${plane},.T.)`));
    }
    const shell = E(`CLOSED_SHELL('',(${faceRefs.join(',')}))`);
    solidRefs.push({ ref: E(`MANIFOLD_SOLID_BREP('${part.name}',${shell})`), name: part.name });
  }

  const body = [];
  if (opts.withTransforms) {
    // Chaque corps dans sa propre représentation, positionnée par une transformation.
    const rootAx = ax2([0, 0, 0], [0, 0, 1], [1, 0, 0]);
    const reps = solidRefs.map(s =>
      E(`ADVANCED_BREP_SHAPE_REPRESENTATION('${s.name}',(${s.ref}),#1)`));
    const rootRep = E(`SHAPE_REPRESENTATION('assemblage',(${rootAx}),#1)`);
    for (const rep of reps) {
      const a1 = ax2([0, 0, 0], [0, 0, 1], [1, 0, 0]);
      const a2 = ax2([0, 0, 0], [0, 0, 1], [1, 0, 0]);
      const idt = E(`ITEM_DEFINED_TRANSFORMATION('','',${a1},${a2})`);
      body.push(`#${++id} = ( REPRESENTATION_RELATIONSHIP('','',${rep},${rootRep})
REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION(${idt})
SHAPE_REPRESENTATION_RELATIONSHIP() );`);
    }
  } else {
    E(`ADVANCED_BREP_SHAPE_REPRESENTATION('assemblage',(${solidRefs.map(s => s.ref).join(',')}),#1)`);
  }
  for (const s of solidRefs) E(`PRODUCT('${s.name}','${s.name}','',(#5))`);

  const header =
`ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('Assemblage de test - panneau PEHD sur ossature'),'2;1');
FILE_NAME('${path.basename(file)}','2026-01-01T00:00:00',(''),(''),'','','');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));
ENDSEC;
DATA;
#1 = ( GEOMETRIC_REPRESENTATION_CONTEXT(3)
GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#4))
GLOBAL_UNIT_ASSIGNED_CONTEXT((#2,#3)) REPRESENTATION_CONTEXT('',''));
#2 = ( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) );
#3 = ( NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.) );
#4 = UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-07),#2,'distance_accuracy_value','');
#5 = APPLICATION_CONTEXT('automotive design');
`;
  fs.writeFileSync(file, header + L.concat(body).join('\n') + '\nENDSEC;\nEND-ISO-10303-21;\n');
  return parts.length;
}

/* --- Constructeurs de faces planes --- */
function boxFaces(x0, y0, z0, a, b, c) {
  const X1 = x0 + a, Y1 = y0 + b, Z1 = z0 + c;
  return [
    { normal: [0, 0, 1], loops: [[[x0, y0, Z1], [X1, y0, Z1], [X1, Y1, Z1], [x0, Y1, Z1]]] },
    { normal: [0, 0, -1], loops: [[[x0, y0, z0], [x0, Y1, z0], [X1, Y1, z0], [X1, y0, z0]]] },
    { normal: [0, -1, 0], loops: [[[x0, y0, z0], [X1, y0, z0], [X1, y0, Z1], [x0, y0, Z1]]] },
    { normal: [0, 1, 0], loops: [[[x0, Y1, z0], [x0, Y1, Z1], [X1, Y1, Z1], [X1, Y1, z0]]] },
    { normal: [-1, 0, 0], loops: [[[x0, y0, z0], [x0, y0, Z1], [x0, Y1, Z1], [x0, Y1, z0]]] },
    { normal: [1, 0, 0], loops: [[[X1, y0, z0], [X1, Y1, z0], [X1, Y1, Z1], [X1, y0, Z1]]] }
  ];
}
/* Panneau avec une poche fraisée débouchant vers le haut. */
function pocketPanelFaces(a, b, t, px, py, pa, pb, depth) {
  const zf = t - depth;
  const outerTop = [[0, 0, t], [a, 0, t], [a, b, t], [0, b, t]];
  const pocketTop = [[px, py, t], [px, py + pb, t], [px + pa, py + pb, t], [px + pa, py, t]];
  const f = [
    { normal: [0, 0, 1], loops: [outerTop, pocketTop] },
    { normal: [0, 0, 1], loops: [[[px, py, zf], [px + pa, py, zf], [px + pa, py + pb, zf], [px, py + pb, zf]]] },
    { normal: [0, 0, -1], loops: [[[0, 0, 0], [0, b, 0], [a, b, 0], [a, 0, 0]]] },
    { normal: [0, -1, 0], loops: [[[0, 0, 0], [a, 0, 0], [a, 0, t], [0, 0, t]]] },
    { normal: [0, 1, 0], loops: [[[0, b, 0], [0, b, t], [a, b, t], [a, b, 0]]] },
    { normal: [-1, 0, 0], loops: [[[0, 0, 0], [0, 0, t], [0, b, t], [0, b, 0]]] },
    { normal: [1, 0, 0], loops: [[[a, 0, 0], [a, b, 0], [a, b, t], [a, 0, t]]] },
    // parois de la poche (normales tournées vers l'intérieur de la poche)
    { normal: [0, -1, 0], loops: [[[px, py, zf], [px + pa, py, zf], [px + pa, py, t], [px, py, t]]] },
    { normal: [0, 1, 0], loops: [[[px, py + pb, zf], [px, py + pb, t], [px + pa, py + pb, t], [px + pa, py + pb, zf]]] },
    { normal: [-1, 0, 0], loops: [[[px, py, zf], [px, py, t], [px, py + pb, t], [px, py + pb, zf]]] },
    { normal: [1, 0, 0], loops: [[[px + pa, py, zf], [px + pa, py + pb, zf], [px + pa, py + pb, t], [px + pa, py, t]]] }
  ];
  // normales des parois de poche : vers l'intérieur de la poche (hors matière)
  f[7].normal = [0, 1, 0]; f[8].normal = [0, -1, 0];
  f[9].normal = [1, 0, 0]; f[10].normal = [-1, 0, 0];
  return f;
}

/* ============ Génération ============ */
const files = [];

files.push(['plaque-rect-1200x800-ep15.stl',
  writeSTL(path.join(out, 'plaque-rect-1200x800-ep15.stl'),
    plateSTL({ outer: rect(0, 0, 1200, 800), holes: [] }, 15, 60)) + ' triangles']);

files.push(['plaque-trouee-1000x1000-ep20.stl',
  writeSTL(path.join(out, 'plaque-trouee-1000x1000-ep20.stl'),
    plateSTL({ outer: rect(0, 0, 1000, 1000), holes: [circle(500, 500, 150, 48, true)] }, 20, 45)) + ' triangles']);

files.push(['plaque-forme-L-ep12.stl',
  writeSTL(path.join(out, 'plaque-forme-L-ep12.stl'),
    plateSTL({ outer: [[0, 0], [1400, 0], [1400, 500], [600, 500], [600, 1100], [0, 1100]], holes: [] }, 12, 55)) + ' triangles']);

/* Panneau fraisé : 25 mm plein, deux poches ramenant à 15 et 10 mm. */
files.push(['panneau-fraise-1000x700.stl',
  writeSTL(path.join(out, 'panneau-fraise-1000x700.stl'),
    milledPlateSTL(rect(0, 0, 1000, 700), 25, [
      { ring: rect(150, 150, 400, 400), depth: 10 },
      { ring: rect(650, 250, 250, 200), depth: 15 }
    ], 40)) + ' triangles']);

/* Assemblage STL : panneau PEHD posé sur une ossature de 5 profils.
   Écrit en ASCII multi-corps, seule forme du STL qui distingue les pièces. */
{
  const t = 20, a = 1400, b = 900, beam = 60, hb = 80;
  const panel = plateSTL({ outer: rect(0, 0, a, b), holes: [] }, t, 70)
    .map(x => (x.v.forEach(p => p[2] += hb), x));
  const parts = [{ name: 'PANNEAU_PEHD', tris: panel }];
  const beams = [
    ['TRAVERSE_AV', 0, 0, 0, a, beam, hb],
    ['TRAVERSE_AR', 0, b - beam, 0, a, beam, hb],
    ['MONTANT_G', 0, beam, 0, beam, b - 2 * beam, hb],
    ['MONTANT_D', a - beam, beam, 0, beam, b - 2 * beam, hb],
    ['ENTRETOISE_C', a / 2 - beam / 2, beam, 0, beam, b - 2 * beam, hb]
  ];
  for (const [name, ...bx] of beams) parts.push({ name, tris: boxSTL(...bx) });
  files.push(['assemblage-panneau-sur-bati.stl',
    writeSTLAscii(path.join(out, 'assemblage-panneau-sur-bati.stl'), parts) + ' triangles, 6 corps']);
}

/* Assemblage STEP : panneau fraisé posé sur une ossature de 5 profils. */
{
  const a = 1400, b = 900, t = 25, hb = 80, beam = 60;
  const panel = pocketPanelFaces(a, b, t, 400, 300, 600, 300, 10)
    .map(f => ({ normal: f.normal, loops: f.loops.map(l => l.map(p => [p[0], p[1], p[2] + hb])) }));
  const parts = [{ name: 'PANNEAU_PEHD', faces: panel }];
  const beams = [
    ['TRAVERSE_AV', 0, 0, 0, a, beam, hb],
    ['TRAVERSE_AR', 0, b - beam, 0, a, beam, hb],
    ['MONTANT_G', 0, beam, 0, beam, b - 2 * beam, hb],
    ['MONTANT_D', a - beam, beam, 0, beam, b - 2 * beam, hb],
    ['ENTRETOISE_C', a / 2 - beam / 2, beam, 0, beam, b - 2 * beam, hb]
  ];
  for (const [name, ...box] of beams) parts.push({ name, faces: boxFaces(...box) });
  files.push(['assemblage-panneau-sur-bati.step',
    writeSTEP(path.join(out, 'assemblage-panneau-sur-bati.step'), parts) + ' corps']);
  files.push(['assemblage-avec-transformations.step',
    writeSTEP(path.join(out, 'assemblage-avec-transformations.step'), parts, { withTransforms: true }) + ' corps']);
}

/* Plaque simple STEP avec trou (conservée pour l'import mono-corps). */
{
  const a = 900, b = 600, t = 20;
  const holeRing = (z) => circle(450, 300, 100, 32, false).map(p => [p[0], p[1], z]);
  const faces = [
    { normal: [0, 0, 1], loops: [[[0, 0, t], [a, 0, t], [a, b, t], [0, b, t]], holeRing(t)] },
    { normal: [0, 0, -1], loops: [[[0, 0, 0], [0, b, 0], [a, b, 0], [a, 0, 0]], holeRing(0)] },
    { normal: [0, -1, 0], loops: [[[0, 0, 0], [a, 0, 0], [a, 0, t], [0, 0, t]]] },
    { normal: [0, 1, 0], loops: [[[0, b, 0], [0, b, t], [a, b, t], [a, b, 0]]] },
    { normal: [-1, 0, 0], loops: [[[0, 0, 0], [0, 0, t], [0, b, t], [0, b, 0]]] },
    { normal: [1, 0, 0], loops: [[[a, 0, 0], [a, b, 0], [a, b, t], [a, 0, t]]] }
  ];
  files.push(['plaque-rect-900x600-ep20-trou200.step',
    writeSTEP(path.join(out, 'plaque-rect-900x600-ep20-trou200.step'), [{ name: 'PLAQUE', faces }]) + ' corps']);
}

for (const [n, info] of files) console.log(`  ${n.padEnd(42)} ${info}`);
console.log('-> ' + out);
