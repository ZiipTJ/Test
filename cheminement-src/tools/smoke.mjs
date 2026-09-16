/** Contrôle de bon fonctionnement dans un vrai navigateur.
 *
 *  Sert de garde-fou sur ce que les tests unitaires ne voient pas : le worker
 *  d'import, le WASM OpenCascade, le rendu WebGL et l'enchaînement des panneaux.
 *
 *    npm run build && npx vite preview --port 4173 &
 *    node tools/smoke.mjs [url]
 */
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:4173/';
const executablePath = process.env.CHROMIUM_PATH ?? undefined;

const browser = await chromium.launch({
  ...(executablePath ? { executablePath } : {}),
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });

const problems = [];
page.on('pageerror', (error) => problems.push(`erreur de page : ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error') problems.push(`console : ${message.text()}`);
});

const check = (condition, label) => {
  if (!condition) problems.push(`échec : ${label}`);
  console.log(`${condition ? '✓' : '✗'} ${label}`);
};

await page.goto(url, { waitUntil: 'networkidle' });
check(await page.locator('canvas').count() > 0, 'la vue 3D est créée');

await page.getByRole('button', { name: 'Démonstration' }).click();
await page.waitForFunction(
  () => document.querySelector('.statusbar span')?.textContent?.includes('triangles'),
  null,
  { timeout: 90_000 },
);
const status = (await page.locator('.statusbar span').first().textContent()) ?? '';
console.log('  ', status.trim());
check(/corps/.test(status), 'le modèle STEP est importé par le worker');

const readout = (await page.locator('.viewer-readout').textContent()) ?? '';
check(/10 fils/.test(readout), 'le faisceau de démonstration est chargé');
check(/m de fil/.test(readout), 'les longueurs de fil sont calculées');

// L'autre chaîne d'import : 3MF, lu sans DOM dans le worker.
await page.setInputFiles('input[type="file"][accept*=".3mf"]', 'public/demo/platine-cheminement.3mf');
await page.waitForFunction(
  () => document.querySelector('.statusbar span')?.textContent?.includes('.3mf'),
  null,
  { timeout: 60_000 },
);
const status3mf = (await page.locator('.statusbar span').first().textContent()) ?? '';
console.log('  ', status3mf.trim());
check(/4 corps/.test(status3mf), 'le modèle 3MF est importé par le worker');

await page.locator('.tabs button', { hasText: 'Contrôles' }).first().click();
const findings = await page.locator('.panel .card').count();
check(findings === 0, `la démonstration ne déclenche aucun contrôle (${findings})`);

await page.locator('.tabs button', { hasText: 'Nomenclature' }).first().click();
check((await page.locator('.panel table tbody tr').count()) >= 10, 'la liste de coupe est remplie');

await page.getByRole('button', { name: 'Mise à plat' }).click();
check((await page.locator('.modal .body svg').count()) === 1, 'la mise à plat est produite');
await page.getByRole('button', { name: 'Fermer' }).click();

await browser.close();

if (problems.length > 0) {
  console.error('\n' + problems.join('\n'));
  process.exit(1);
}
console.log('\nTout est vert.');
