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

// 8. Épaisseur variable : plaque en flexion cylindrique contre poutre à inertie variable.
//    Bande de portée L appuyée sur ses deux bords, très longue transversalement :
//    au milieu de la largeur, la plaque fléchit comme une poutre de rigidité D(x).
{
  console.log('\n--- Epaisseur variable ---');
  const L = 600, W = 2400, q = 0.02, t1 = 24, t2 = 14;
  const tAt = (x) => (x < L / 2 ? t1 : t2);
  const Dx = (x) => E * Math.pow(tAt(x), 3) / (12 * (1 - nu * nu));

  // Référence : M(x) = q x (L-x) / 2 (isostatique, indépendant de l'inertie),
  // puis w'' = -M/D intégré deux fois avec w(0) = w(L) = 0.
  const nInt = 200000, dx = L / nInt;
  const f = new Float64Array(nInt + 1);
  for (let i = 0; i <= nInt; i++) {
    const x = i * dx;
    f[i] = -(q * x * (L - x) / 2) / Dx(x);
  }
  const wRef = (x) => {
    let s = 0;
    const n = Math.round(x / dx);
    for (let i = 0; i < n; i++) s += ((x - i * dx) * f[i] + (x - (i + 1) * dx) * f[i + 1]) / 2 * dx;
    return s;
  };
  let s2 = 0;
  for (let i = 0; i < nInt; i++) s2 += ((L - i * dx) * f[i] + (L - (i + 1) * dx) * f[i + 1]) / 2 * dx;
  const C = -s2 / L;
  let refMax = 0, refX = 0;
  for (let i = 0; i <= 400; i++) {
    const x = L * i / 400;
    const w = wRef(x) + C * x;
    if (Math.abs(w) > Math.abs(refMax)) { refMax = w; refX = x; }
  }

  /* Calcul plaque : seuls les deux bords x=0 et x=L sont appuyés, de sorte que la
     bande soit en flexion cylindrique au milieu de sa largeur. */
  const mesh = PP.Mesh.meshRegion(rectRegion(L, W), 15);
  const nN = mesh.nodes.length, nE = mesh.elems.length;
  const elemD = new Array(nE);
  for (let e = 0; e < nE; e++) {
    const el = mesh.elems[e];
    const cx = (mesh.nodes[el[0]][0] + mesh.nodes[el[1]][0] + mesh.nodes[el[2]][0]) / 3;
    elemD[e] = PP.Fem.bendingD(E, nu, tAt(cx));
  }
  const Fv = new Float64Array(3 * nN), fixed = new Int8Array(3 * nN);
  uniformLoad(q)(mesh, Fv);
  for (let n = 0; n < nN; n++) {
    const x = mesh.nodes[n][0];
    if (x < 1e-6 || x > L - 1e-6) fixed[3 * n] = 1;
  }
  const uu = PP.Fem.solve(mesh, elemD, Fv, fixed);
  let wPlate = 0;
  for (let n = 0; n < nN; n++) {
    if (Math.abs(mesh.nodes[n][1] - W / 2) > 40) continue;
    if (Math.abs(uu[3 * n]) > Math.abs(wPlate)) wPlate = uu[3 * n];
  }
  console.log(`  epaisseurs ${t1}/${t2} mm ; reference poutre = ${Math.abs(refMax).toFixed(4)} mm a x=${refX.toFixed(0)} mm`);
  check('Plaque a epaisseur variable (flexion cylindrique)', Math.abs(wPlate), Math.abs(refMax), 3);

  // Contrôle croisé : un champ d'épaisseur constant doit redonner le calcul à épaisseur unique.
  const resField = PP.Model.run({
    region: rectRegion(1000, 1000), thicknessField: { at: () => 20, min: 20, max: 20 },
    meshSize: 40, support: { width: 0, type: 'simple', mode: 'contour' },
    loads: [{ type: 'zone', shape: 'rect', x: 500, y: 500, w: 1000, h: 1000, force: 5000 }],
    material: { E, nu, rho: 0, sigmaY: 25 }, selfWeight: false,
    criteria: { deflectionRatio: 200, safetyFactor: 2 }
  });
  const resScalar = PP.Model.run({
    region: rectRegion(1000, 1000), thickness: 20,
    meshSize: 40, support: { width: 0, type: 'simple', mode: 'contour' },
    loads: [{ type: 'zone', shape: 'rect', x: 500, y: 500, w: 1000, h: 1000, force: 5000 }],
    material: { E, nu, rho: 0, sigmaY: 25 }, selfWeight: false,
    criteria: { deflectionRatio: 200, safetyFactor: 2 }
  });
  check('Champ constant identique au calcul a epaisseur unique (fleche)',
    Math.abs(resField.wmax), Math.abs(resScalar.wmax), 0.01);
  check('Champ constant identique au calcul a epaisseur unique (contrainte)',
    resField.sigmaMax, resScalar.sigmaMax, 0.01);
}

// 9. Chaîne complète (model.js) contre la solution analytique :
//    appui sur le contour seul, charge uniforme, plaque carrée.
{
  const opts = {
    region: rectRegion(a, a), thickness: t, meshSize: 25,
    support: { width: 0, type: 'simple', mode: 'contour' },
    loads: [{ type: 'zone', shape: 'rect', x: a / 2, y: a / 2, w: a, h: a, force: q * a * a }],
    material: { E, nu, rho: 0, sigmaY: 25 }, selfWeight: false,
    criteria: { deflectionRatio: 200, safetyFactor: 2 }
  };
  // Appuis bilatéraux : c'est l'hypothèse de la solution de référence (coins maintenus).
  const res = PP.Model.run(Object.assign({ unilateral: false }, opts));
  check('Chaine complete : carre appuye sur son contour', Math.abs(res.wmax), 0.00406 * q * Math.pow(a, 4) / Dp, 3);
  check('Chaine complete : equilibre', res.reactionTotal, q * a * a, 1);

  /* Contact unilatéral : les coins d'une plaque simplement posée se soulèvent, ce que
     la solution classique ignore en supposant des coins maintenus. La flèche doit donc
     être plus forte, et des nœuds doivent être libérés. */
  const uni = PP.Model.run(opts);
  const ratio = Math.abs(uni.wmax) / Math.abs(res.wmax);
  console.log(`  coins libres : ${uni.released} noeuds decolles, fleche x${ratio.toFixed(3)} ` +
    `(${Math.abs(res.wmax).toFixed(2)} -> ${Math.abs(uni.wmax).toFixed(2)} mm, ${uni.iterations} iterations)`);
  if (!(uni.released > 0 && ratio > 1.02 && ratio < 1.3)) {
    failures++;
    console.log('FAIL  Soulevement des coins non conforme aux attentes');
  } else console.log('OK    Soulevement des coins pris en compte (fleche majoree, equilibre conserve)');
  check('Contact unilateral : equilibre conserve', uni.reactionTotal, q * a * a, 1);
}

// 10. Cohérence du modèle complet (model.js)
{
  console.log('\n--- Modele complet (model.js) ---');
  const res = PP.Model.run({
    region: rectRegion(1000, 1000),
    thickness: 20,
    meshSize: 30,
    support: { width: 30, type: 'simple', holesSupported: false, mode: 'contour' },
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
