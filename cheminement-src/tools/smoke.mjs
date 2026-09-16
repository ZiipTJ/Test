/** Contrôle de bon fonctionnement dans un vrai navigateur.
 *
 *  Couvre ce que les tests unitaires ne voient pas : le worker d'import, le WASM
 *  OpenCascade, le rendu WebGL, et le geste central — tracer un fil en cliquant
 *  sur la pièce.
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
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });

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
check((await page.locator('canvas').count()) > 0, 'la vue 3D est créée');

await page.getByRole('button', { name: 'Démonstration' }).click();
await page.waitForFunction(
  () => document.querySelector('.statusbar span')?.textContent?.includes('corps'),
  null,
  { timeout: 90_000 },
);
console.log('  ', (await page.locator('.statusbar span').first().textContent())?.trim());
check((await page.locator('ul.wires li').count()) === 7, 'six fils et un toron sont listés');
check(/\d[.,]\d\d m/.test((await page.locator('ul.wires').first().textContent()) ?? ''), 'les longueurs sont calculées');

// Le geste central : créer un fil, le nommer, tracer deux points sur la pièce.
await page.getByRole('button', { name: '+ Nouveau fil' }).click();
await page.locator('.detail input').first().fill('ESSAI');
await page.getByRole('button', { name: 'Tracer le chemin' }).click();
check(await page.locator('.drawbar').isVisible(), 'le bandeau de tracé apparaît');

const box = await page.locator('canvas').boundingBox();
await page.mouse.click(box.x + box.width * 0.35, box.y + box.height * 0.58);
await page.waitForTimeout(250);
await page.mouse.click(box.x + box.width * 0.62, box.y + box.height * 0.66);
await page.waitForTimeout(250);
const pointCount = (await page.locator('.drawbar .count').textContent()) ?? '';
check(/2 points/.test(pointCount), `deux points posés sur la pièce (${pointCount.trim()})`);

await page.locator('.drawbar').getByRole('button', { name: 'Terminer' }).click();
const essai = page.locator('ul.wires li', { hasText: 'ESSAI' });
check(!(await essai.textContent())?.includes('à tracer'), 'le fil tracé a une longueur');

// Réunir deux fils en toron.
await page.locator('ul.wires li', { hasText: 'CAN-H' }).locator('input[type="checkbox"]').check();
await page.locator('ul.wires li', { hasText: 'CAN-L' }).locator('input[type="checkbox"]').check();
await page.getByRole('button', { name: /Réunir 2 fils en toron/ }).click();
// La liste des torons est la seconde : les fils du tronc citent aussi leur toron.
const toronList = page.locator('ul.wires').last();
check((await toronList.locator('li').count()) === 2, 'le second toron est créé');

// L'autre chaîne d'import : 3MF, lu sans DOM dans le worker.
await page.setInputFiles('input[type="file"][accept*=".3mf"]', 'public/demo/platine-cheminement.3mf');
await page.waitForFunction(
  () => document.querySelector('.statusbar span')?.textContent?.includes('.3mf'),
  null,
  { timeout: 60_000 },
);
console.log('  ', (await page.locator('.statusbar span').first().textContent())?.trim());
check(true, 'le modèle 3MF est importé par le worker');

await browser.close();

if (problems.length > 0) {
  console.error('\n' + problems.join('\n'));
  process.exit(1);
}
console.log('\nTout est vert.');
