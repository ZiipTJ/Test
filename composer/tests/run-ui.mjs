/* Tests d'interface : rendu WebGL, import depuis le navigateur, manipulateur,
   lignes de position neutre, enregistrement et relecture d'une vue.

   Lancement : node composer/tests/run-ui.mjs [--shots dossier]
   Nécessite Playwright ; le test s'annonce ignoré s'il est absent. */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const repo = join(root, '..');
const shotsIdx = process.argv.indexOf('--shots');
const shots = shotsIdx > 0 ? process.argv[shotsIdx + 1] : null;

/* Playwright peut être installé localement ou globalement (npm i -g playwright). */
let chromium;
for (const nom of ['playwright', 'playwright-core']) {
  try { ({ chromium } = await import(nom)); break; } catch { /* module suivant */ }
}
if (!chromium) {
  try {
    const { execSync } = await import('node:child_process');
    const { pathToFileURL } = await import('node:url');
    const global = execSync('npm root -g', { encoding: 'utf8' }).trim();
    ({ chromium } = await import(pathToFileURL(join(global, 'playwright', 'index.mjs')).href));
  } catch { /* absent */ }
}
if (!chromium) {
  console.log("Playwright absent : tests d'interface ignorés (npm i -g playwright).");
  process.exit(0);
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };
const server = createServer(async (req, res) => {
  const p = join(root, normalize(decodeURI(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, ''));
  try {
    const data = await readFile(p.endsWith('/') ? join(p, 'index.html') : p);
    res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404); res.end('non trouvé'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/index.html`;

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail !== undefined ? ' — ' + detail : ''}`); }
};

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
});
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
const errs = [];
page.on('pageerror', e => errs.push('exception : ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('console : ' + m.text()); });
await page.goto(base);
await page.waitForTimeout(300);

const shot = async (nom) => { if (shots) await page.screenshot({ path: join(shots, nom + '.png') }); };
const sel = () => page.evaluate(() => {
  const a = SWC.debug.scene.selected()[0];
  return a ? { nom: a.name, offset: a.offset.map(v => +v.toFixed(2)), quat: a.quat.map(v => +v.toFixed(3)) } : null;
});

console.log('\nChargement');
check('contexte WebGL créé', await page.evaluate(() => !!SWC.debug.view.gl));

console.log('\nAssemblage de démonstration');
await page.click('#btn-demo');
await page.waitForTimeout(400);
check('7 acteurs listés', (await page.$$('#arbre .acteur')).length === 7);
await shot('01-demo');

console.log('\nImport de fichiers');
for (const [f, attendu] of [
  ['composer/tests/samples/deux-boites.3mf', 2],
  ['composer/tests/samples/cylindre-d60-h40.step', 1],
  ['plaque-pehd/tests/samples/assemblage-panneau-sur-bati.step', 6]
]) {
  const chemin = join(repo, f);
  if (!existsSync(chemin)) { console.log(`  (${f} absent, ignoré)`); continue; }
  await page.goto(base);
  await page.setInputFiles('#fichier', chemin);
  await page.waitForTimeout(1200);
  const n = (await page.$$('#arbre .acteur')).length;
  check(`${f.split('/').pop()} : ${attendu} acteur(s)`, n === attendu, String(n));
}
/* Le 3MF vérifie au passage la lecture ZIP et les transformations de placement. */
await page.goto(base);
await page.setInputFiles('#fichier', join(repo, 'composer/tests/samples/deux-boites.3mf'));
await page.waitForTimeout(900);
const bb = await page.evaluate(() => SWC.debug.scene.bbox(false));
check('3MF : capot placé par transformation', Math.abs(bb.max[2] - 35) < 1e-3, JSON.stringify(bb.max));

console.log('\nManipulateur');
await page.goto(base);
await page.click('#btn-demo');
await page.waitForTimeout(400);
const zone = await page.locator('#vue').boundingBox();
const cible = await page.evaluate(() => {
  const d = SWC.debug;
  d.scene.select(d.scene.actors.find(a => a.name === 'Capot'), false);
  d.gizmo.update();
  const g = d.gizmo;
  return {
    axeZ: d.view.project([g.pivot[0], g.pivot[1], g.pivot[2] + g.scale() * 0.7]),
    x: d.view.project([g.pivot[0] + g.scale(), g.pivot[1], g.pivot[2]]),
    y: d.view.project([g.pivot[0], g.pivot[1] + g.scale(), g.pivot[2]])
  };
});
await page.waitForTimeout(150);
check('acteur sélectionné', (await sel()).nom === 'Capot');

await page.mouse.move(zone.x + cible.axeZ[0], zone.y + cible.axeZ[1]);
await page.waitForTimeout(120);
await page.mouse.down();
await page.mouse.move(zone.x + cible.axeZ[0], zone.y + cible.axeZ[1] - 120, { steps: 12 });
await page.waitForTimeout(120);
await shot('02-translation');
await page.mouse.up();
const apresT = await sel();
check('translation sur Z uniquement', apresT.offset[2] > 20 && Math.abs(apresT.offset[0]) < 1e-6 && Math.abs(apresT.offset[1]) < 1e-6,
  JSON.stringify(apresT.offset));
check('ligne de position neutre tracée', await page.evaluate(() => {
  SWC.debug.scene.buildLines();
  return SWC.debug.scene.lineBuf.count > 0;
}));

await page.click('#m-rot');
await page.waitForTimeout(150);
const anneau = await page.evaluate(() => {
  const d = SWC.debug; d.gizmo.update();
  const g = d.gizmo, s = g.scale();
  return { a: d.view.project([g.pivot[0] + s, g.pivot[1], g.pivot[2]]), b: d.view.project([g.pivot[0], g.pivot[1] + s, g.pivot[2]]) };
});
await page.mouse.move(zone.x + anneau.a[0], zone.y + anneau.a[1]);
await page.waitForTimeout(120);
await page.mouse.down();
await page.mouse.move(zone.x + anneau.b[0], zone.y + anneau.b[1], { steps: 16 });
await page.waitForTimeout(120);
await shot('03-rotation');
await page.mouse.up();
const apresR = await sel();
check('rotation de 90° autour de Z', Math.abs(apresR.quat[2] - Math.SQRT1_2) < 0.02 && Math.abs(apresR.quat[3] - Math.SQRT1_2) < 0.02,
  JSON.stringify(apresR.quat));

await page.keyboard.press('Control+z');
await page.keyboard.press('Control+z');
await page.waitForTimeout(200);
const apresAnnul = await sel();
check('annulation : retour au neutre',
  apresAnnul.offset.every(v => Math.abs(v) < 1e-6) && Math.abs(apresAnnul.quat[3] - 1) < 1e-6,
  JSON.stringify(apresAnnul));

console.log('\nEnregistrement et relecture d\'une vue');
await page.evaluate(() => {
  const d = SWC.debug;
  const a = d.scene.actors.find(x => x.name === 'Capot');
  a.offset = [0, 0, 120];
  window.__vue = JSON.stringify(d.scene.toJSON());
  d.scene.resetActor(a);
});
const relu = await page.evaluate(() => {
  const d = SWC.debug;
  d.scene.applyJSON(JSON.parse(window.__vue));
  return d.scene.actors.find(x => x.name === 'Capot').offset;
});
check('positions restituées', Math.abs(relu[2] - 120) < 1e-9, JSON.stringify(relu));

console.log('\nJournal du navigateur');
check('aucune erreur', errs.length === 0, errs.join(' | '));

await browser.close();
server.close();
console.log(`\n${pass} test(s) réussis, ${fail} échec(s).`);
process.exit(fail ? 1 : 0);
