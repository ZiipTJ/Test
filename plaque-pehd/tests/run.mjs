/* Validation du solveur : comparaison aux solutions analytiques de Timoshenko.
   Usage : node tests/run.mjs   (depuis plaque-pehd/) */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const jsDir = path.join(dir, '..', 'js');
const sandbox = { window: {}, console, Math, Float64Array, Int32Array, Int8Array, Map, Set, Array, Error, isFinite, isNaN, parseFloat, parseInt, JSON };
sandbox.window.PP = {};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const f of ['geom.js', 'mesh.js', 'fem.js', 'material.js', 'model.js', 'importers.js']) {
  vm.runInContext(fs.readFileSync(path.join(jsDir, f), 'utf8'), sandbox, { filename: f });
}
const PP = sandbox.window.PP;

let failures = 0;
function check(name, got, expected, tolPct) {
  const err = Math.abs(got - expected) / Math.abs(expected) * 100;
  const ok = err <= tolPct;
  if (!ok) failures++;
  console.log(`${ok ? 'OK  ' : 'FAIL'}  ${name}: calcul=${got.toPrecision(5)} ref=${expected.toPrecision(5)} ecart=${err.toFixed(2)}% (tol ${tolPct}%)`);
}

function rectRegion(a, b) {
  return { outer: [[0, 0], [a, 0], [a, b], [0, b]], holes: [] };
}

function buildAndSolve(region, h, t, E, nu, loadFn, bcFn) {
  const mesh = PP.Mesh.meshRegion(region, h);
  const D = PP.Fem.bendingD(E, nu, t);
  const nN = mesh.nodes.length;
  const F = new Float64Array(3 * nN);
  const fixed = new Int8Array(3 * nN);
  loadFn(mesh, F);
  bcFn(mesh, fixed);
  const u = PP.Fem.solve(mesh, D, F, fixed);
  let wmax = 0, wmaxNode = -1;
  for (let n = 0; n < nN; n++) if (Math.abs(u[3 * n]) > Math.abs(wmax)) { wmax = u[3 * n]; wmaxNode = n; }
  return { mesh, u, wmax, wmaxNode, D };
}

function uniformLoad(q) {
  return (mesh, F) => {
    for (const t of mesh.elems) {
      const p = t.map(i => mesh.nodes[i]);
      const A = Math.abs((p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[2][0] - p[0][0]) * (p[1][1] - p[0][1])) / 2;
      for (const n of t) F[3 * n] += q * A / 3;
    }
  };
}
const simplySupported = (mesh, fixed) => {
  for (let n = 0; n < mesh.nodes.length; n++) if (mesh.isBoundary[n]) fixed[3 * n] = 1;
};
const clamped = (mesh, fixed) => {
  for (let n = 0; n < mesh.nodes.length; n++)
    if (mesh.isBoundary[n]) { fixed[3 * n] = 1; fixed[3 * n + 1] = 1; fixed[3 * n + 2] = 1; }
};

console.log('--- Validation plaque en flexion (DKT) ---');

const E = 900, nu = 0.3, t = 20, a = 1000, q = 0.01;
const Dp = E * t * t * t / (12 * (1 - nu * nu));

// 1. Carré appuyé sur 4 côtés, charge uniforme : w = 0.00406 q a^4 / D
{
  const r = buildAndSolve(rectRegion(a, a), 25, t, E, nu, uniformLoad(q), simplySupported);
  check('Carre appuye, charge repartie (fleche)', Math.abs(r.wmax), 0.00406 * q * Math.pow(a, 4) / Dp, 3);
  const post = PP.Fem.postprocess(r.mesh, r.D, r.u, t);
  // Mmax = 0.0479 q a^2 -> sigma = 6M/t^2
  let mxMax = 0;
  for (let n = 0; n < r.mesh.nodes.length; n++) mxMax = Math.max(mxMax, r.mesh.isBoundary[n] ? 0 : post.momentsNode[3 * n]);
  check('Carre appuye, moment max', mxMax, 0.0479 * q * a * a, 6);
}

// 2. Carré encastré sur 4 côtés : w = 0.00126 q a^4 / D
{
  const r = buildAndSolve(rectRegion(a, a), 25, t, E, nu, uniformLoad(q), clamped);
  check('Carre encastre, charge repartie (fleche)', Math.abs(r.wmax), 0.00126 * q * Math.pow(a, 4) / Dp, 5);
}

// 3. Rectangle 2:1 appuyé, charge uniforme : w = 0.01013 q b^4 / D (b = petit côté)
{
  const b = 800;
  const r = buildAndSolve(rectRegion(2 * b, b), 25, t, E, nu, uniformLoad(q), simplySupported);
  check('Rectangle 2:1 appuye (fleche)', Math.abs(r.wmax), 0.01013 * q * Math.pow(b, 4) / Dp, 4);
}

// 4. Plaque circulaire appuyée sur le pourtour, charge uniforme :
//    w = (5+nu)/(1+nu) * q R^4 / (64 D)
{
  const R = 500;
  const ring = [];
  for (let i = 0; i < 160; i++) { const th = 2 * Math.PI * i / 160; ring.push([R * Math.cos(th), R * Math.sin(th)]); }
  const r = buildAndSolve({ outer: ring, holes: [] }, 20, t, E, nu, uniformLoad(q), simplySupported);
  const ref = (5 + nu) / (1 + nu) * q * Math.pow(R, 4) / (64 * Dp);
  check('Disque appuye, charge repartie (fleche)', Math.abs(r.wmax), ref, 3);
}

// 5. Plaque circulaire encastrée : w = q R^4 / (64 D)
{
  const R = 500;
  const ring = [];
  for (let i = 0; i < 160; i++) { const th = 2 * Math.PI * i / 160; ring.push([R * Math.cos(th), R * Math.sin(th)]); }
  const r = buildAndSolve({ outer: ring, holes: [] }, 20, t, E, nu, uniformLoad(q), clamped);
  check('Disque encastre, charge repartie (fleche)', Math.abs(r.wmax), q * Math.pow(R, 4) / (64 * Dp), 4);
}

// 6. Charge ponctuelle au centre d'un carré appuyé : w = 0.01160 P a^2 / D
{
  const P = 1000;
  const pointLoad = (mesh, F) => {
    // applique P au nœud le plus proche du centre
    let best = 0, bd = Infinity;
    for (let n = 0; n < mesh.nodes.length; n++) {
      const d = Math.hypot(mesh.nodes[n][0] - a / 2, mesh.nodes[n][1] - a / 2);
      if (d < bd) { bd = d; best = n; }
    }
    F[3 * best] += P;
  };
  const r = buildAndSolve(rectRegion(a, a), 25, t, E, nu, pointLoad, simplySupported);
  check('Carre appuye, charge ponctuelle centrale', Math.abs(r.wmax), 0.01160 * P * a * a / Dp, 6);
}

// 7. Convergence en maillage (carré appuyé)
{
  console.log('\n--- Convergence (carre appuye, ref = %s mm) ---', (0.00406 * q * Math.pow(a, 4) / Dp).toFixed(4));
  for (const h of [80, 50, 30, 20]) {
    const t0 = Date.now();
    const r = buildAndSolve(rectRegion(a, a), h, t, E, nu, uniformLoad(q), simplySupported);
    console.log(`  h=${h}mm  noeuds=${r.mesh.nodes.length}  elems=${r.mesh.elems.length}  w=${Math.abs(r.wmax).toFixed(4)} mm  (${Date.now() - t0} ms)`);
  }
}

// 8. Cohérence du modèle complet (model.js)
{
  console.log('\n--- Modele complet (model.js) ---');
  const res = PP.Model.run({
    region: rectRegion(1000, 1000),
    thickness: 20,
    meshSize: 30,
    support: { width: 30, type: 'simple', holesSupported: false },
    loads: [{ type: 'zone', shape: 'rect', x: 500, y: 500, w: 1000, h: 1000, force: 10000 }],
    material: { E: 900, nu: 0.3, rho: 0.95e-9, sigmaY: 25 },
    selfWeight: false,
    criteria: { deflectionRatio: 200, safetyFactor: 2 }
  });
  console.log(`  fleche max = ${res.wmax.toFixed(3)} mm ; sigma max = ${res.sigmaMax.toFixed(2)} MPa`);
  console.log(`  reaction totale = ${res.reactionTotal.toFixed(1)} N (charge appliquee ${res.appliedTotal.toFixed(1)} N)`);
  check('Equilibre global (reactions = charges)', res.reactionTotal, res.appliedTotal, 1);
  // Comparaison à la plaque appuyée sur ses bords (portée effective ~ 940 mm)
  console.log(`  coef de securite = ${res.safety.toFixed(2)} ; verdict = ${res.verdict}`);
}

console.log(failures === 0 ? '\nTOUS LES TESTS PASSENT' : `\n${failures} TEST(S) EN ECHEC`);
process.exit(failures === 0 ? 0 : 1);
