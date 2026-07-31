/* Validation de l'import multi-corps, de la mesure d'épaisseur et des contacts.
   Usage : node tests/run-geometry.mjs */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const jsDir = path.join(dir, '..', 'js');
const S = path.join(dir, 'samples');
const sandbox = {
  window: {}, console, Math, Float64Array, Float32Array, Int32Array, Int8Array, Uint8Array,
  DataView, Map, Set, Array, Error, isFinite, isNaN, parseFloat, parseInt, JSON, TextDecoder
};
vm.createContext(sandbox);
for (const f of ['geom.js', 'mesh.js', 'fem.js', 'material.js', 'importers.js', 'solids.js', 'model.js']) {
  vm.runInContext(fs.readFileSync(path.join(jsDir, f), 'utf8'), sandbox, { filename: f });
}
const PP = sandbox.window.PP, G = PP.Geom, So = PP.Solids;

let failures = 0;
function check(name, got, expected, tol) {
  const ok = Math.abs(got - expected) <= tol;
  if (!ok) failures++;
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${name}: ${typeof got === 'number' ? got.toFixed(3) : got} (attendu ${expected} ± ${tol})`);
}
function checkEq(name, got, expected) {
  const ok = got === expected;
  if (!ok) failures++;
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${name}: ${got} (attendu ${expected})`);
}

const load = (f) => f.endsWith('.stl')
  ? PP.Importers.importSTL(fs.readFileSync(path.join(S, f)).buffer.slice(0))
  : PP.Importers.importSTEP(fs.readFileSync(path.join(S, f), 'utf8'));

/* Prépare un import : choisit le panneau, construit le repère, l'empreinte et les autres corps. */
function setup(imp, panelIdx) {
  if (panelIdx === undefined) {
    let best = 0, bs = -1;
    imp.solids.forEach((s, i) => { const sc = So.plateScore(s); if (sc > bs) { bs = sc; best = i; } });
    panelIdx = best;
  }
  const raw = imp.solids[panelIdx];
  const frame = So.frameFor(raw);
  const panel = So.prepare(raw, frame);
  const region = So.footprint(raw, frame);
  const others = imp.solids.filter((_, i) => i !== panelIdx).map(s => So.prepare(s, frame));
  return { panelIdx, raw, frame, panel, region, others, imp };
}

console.log('--- Import multi-corps ---');
{
  const imp = load('assemblage-panneau-sur-bati.stl');
  checkEq('STL assemblage : nombre de corps', imp.solids.length, 6);
  const s = setup(imp);
  checkEq('panneau détecté automatiquement (le plus grand plat)', s.raw.tris.length > 400, true);
  const bb = G.bbox(s.region.outer);
  check('empreinte du panneau (largeur)', Math.max(bb.w, bb.h), 1400, 1);
  check('empreinte du panneau (longueur)', Math.min(bb.w, bb.h), 900, 1);
}
{
  const imp = load('assemblage-panneau-sur-bati.step');
  checkEq('STEP assemblage : nombre de corps', imp.solids.length, 6);
  checkEq('nom du panneau conservé', imp.solids.some(s => s.name === 'PANNEAU_PEHD'), true);
}

console.log('\n--- Mesure de l\'épaisseur ---');
{
  const s = setup(load('plaque-rect-1200x800-ep15.stl'));
  const tf = So.thicknessField(s.panel, s.region, 120);
  check('plaque constante : épaisseur min', tf.min, 15, 0.05);
  check('plaque constante : épaisseur max', tf.max, 15, 0.05);
  checkEq('plaque constante : détectée comme constante', tf.variable, false);
}
{
  const s = setup(load('panneau-fraise-1000x700.stl'));
  const tf = So.thicknessField(s.panel, s.region, 220);
  check('panneau fraisé : épaisseur max (pleine)', tf.max, 25, 0.05);
  check('panneau fraisé : épaisseur min (poche 15 mm)', tf.min, 10, 0.05);
  checkEq('panneau fraisé : détecté comme variable', tf.variable, true);
  // Les sondes sont exprimées en coordonnées absolues puis converties dans le repère du panneau.
  const probe = (x, y) => { const q = So.toFrame([x, y, 0], s.frame); return s.panel.thickness(q[0], q[1]); };
  check('épaisseur au centre de la poche 1 (25-10)', probe(350, 350), 15, 0.05);
  check('épaisseur au centre de la poche 2 (25-15)', probe(775, 350), 10, 0.05);
  check('épaisseur hors poche', probe(60, 60), 25, 0.05);
}
{
  const imp = load('assemblage-panneau-sur-bati.step');
  const idx = imp.solids.findIndex(x => x.name === 'PANNEAU_PEHD');
  const s = setup(imp, idx);
  const tf = So.thicknessField(s.panel, s.region, 200);
  check('STEP panneau fraisé : épaisseur max', tf.max, 25, 0.05);
  check('STEP panneau fraisé : épaisseur min (poche 10 mm)', tf.min, 15, 0.05);
  checkEq('STEP : détecté comme variable', tf.variable, true);
}

console.log('\n--- Détection des contacts ---');
for (const file of ['assemblage-panneau-sur-bati.stl', 'assemblage-panneau-sur-bati.step']) {
  console.log(` ${file}`);
  const imp = load(file);
  const idx = file.endsWith('step') ? imp.solids.findIndex(x => x.name === 'PANNEAU_PEHD') : undefined;
  const s = setup(imp, idx);
  const contacts = So.detectContacts(s.panel, s.others, s.region, { tol: 0.5 });
  const touching = contacts.filter(c => c.cells > 0);
  checkEq('corps en contact détectés', touching.length, 5);
  checkEq('tous en appui par dessous', touching.every(c => c.side === 'dessous'), true);
  // Ossature : 2 traverses 1400x60 + 2 montants 60x780 + 1 entretoise 60x780
  const total = touching.reduce((t, c) => t + c.area, 0);
  const attendu = 2 * 1400 * 60 + 3 * 60 * 780;
  check('aire totale de contact (mm²)', total, attendu, attendu * 0.06);
  console.log('   détail : ' + touching.map(c => `${c.solid.name}=${(c.area / 100).toFixed(0)}cm²`).join(', '));
}

console.log('\n--- Transformations d\'assemblage ---');
{
  const a = load('assemblage-panneau-sur-bati.step');
  const b = load('assemblage-avec-transformations.step');
  checkEq('même nombre de corps avec et sans transformations', b.solids.length, a.solids.length);
  const fa = So.frameFor(a.solids[0]), fb = So.frameFor(b.solids[0]);
  const ba = So.bboxOf(a.solids[0], fa), bb2 = So.bboxOf(b.solids[0], fb);
  check('positions identiques (transformations identité)', bb2.umax - bb2.umin, ba.umax - ba.umin, 0.01);
}

console.log(failures === 0 ? '\nTOUS LES TESTS GEOMETRIE PASSENT' : `\n${failures} TEST(S) EN ECHEC`);
process.exit(failures ? 1 : 0);
