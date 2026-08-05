// Tests du prédécoupage manuel : zone de recherche tracée, pinceaux inclure /
// exclure. Chaque cas est un cas où la détection automatique seule échoue.
// Lancement : node tests/runroi.mjs

import { analyzeImage, buildMask } from '../js/vision.js';

let failures = 0;
let checks = 0;
const check = (label, ok, detail = '') => {
  checks++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failures++;
};
const near = (label, actual, expected, tol) => {
  const d = Math.abs(actual - expected);
  check(`${label} ≈ ${expected} (±${tol})`, d <= tol, `mesuré ${actual.toFixed(1)}, écart ${d.toFixed(1)}`);
};

function blank(w, h, level = 255) {
  const data = new Uint8ClampedArray(w * h * 4).fill(level);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  return { data, width: w, height: h };
}
function box(img, x0, y0, x1, y1, level) {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * img.width + x) * 4;
      img.data[i] = level; img.data[i + 1] = level; img.data[i + 2] = level;
    }
  }
}
function roiBox(w, h, x0, y0, x1, y1) {
  const roi = new Uint8Array(w * h);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) roi[y * w + x] = 1;
  return roi;
}

// --- 1. La zone isole l'objet voulu parmi plusieurs ---------------------------
console.log('\n1. Deux objets : la zone tracée désigne lequel mesurer');
{
  const img = blank(600, 400);
  box(img, 60, 120, 260, 280, 40);    // objet A 200 × 160
  box(img, 340, 150, 540, 250, 40);   // objet B 200 × 100
  const auto = analyzeImage(img);
  check('sans zone : deux objets détectés', auto.objects.length === 2, `${auto.objects.length}`);

  const roi = roiBox(600, 400, 320, 130, 560, 270);
  const guided = analyzeImage(img, { roi });
  check('avec zone : un seul objet', guided.objects.length === 1, `${guided.objects.length}`);
  near('largeur de l\'objet visé', guided.main.px.length, 200, 3);
  near('hauteur de l\'objet visé', guided.main.px.width, 100, 3);
}

// --- 2. Objet clair sur fond clair : le seuil local sauve la détection --------
console.log('\n2. Objet très clair (246) sur fond blanc (255) — cas du chrome');
{
  const img = blank(500, 400);
  box(img, 150, 120, 350, 280, 246);   // 9 niveaux d'écart seulement
  const auto = analyzeImage(img);
  check('sans zone : la détection échoue',
    !auto.main || Math.abs(auto.main.px.length - 200) > 10,
    auto.main ? `détecté ${auto.main.px.length.toFixed(0)} px` : 'aucun objet');

  const roi = roiBox(500, 400, 120, 90, 380, 310);
  const guided = analyzeImage(img, { roi });
  check('avec zone : objet détecté', !!guided.main);
  if (guided.main) {
    near('largeur', guided.main.px.length, 200, 4);
    near('hauteur', guided.main.px.width, 160, 4);
  }
}

// --- 3. Le fond de référence est celui qui entoure la zone -------------------
console.log('\n3. Fond non uniforme : la référence est prise autour de la zone');
{
  const img = blank(600, 400, 255);
  box(img, 0, 0, 600, 60, 90);        // bandeau sombre en haut de la photo
  box(img, 200, 150, 400, 300, 120);  // l'objet
  const sansZone = buildMask(img, {});
  const roi = roiBox(600, 400, 170, 120, 430, 330);
  const avecZone = buildMask(img, { roi });
  check('fond mesuré ≈ blanc malgré le bandeau sombre',
    Math.abs(avecZone.backgroundLuminance - 255) < 3,
    `${avecZone.backgroundLuminance.toFixed(0)} (sans zone : ${sansZone.backgroundLuminance.toFixed(0)})`);

  const res = analyzeImage(img, { roi });
  near('largeur de l\'objet', res.main.px.length, 200, 4);
}

// --- 4. Pinceau « inclure » : rattraper une partie manquée -------------------
console.log('\n4. Pinceau inclure : une zone claire de l\'objet est rattachée');
{
  const img = blank(500, 400);
  box(img, 150, 150, 350, 250, 40);    // corps sombre, bien détecté
  box(img, 350, 180, 420, 220, 250);   // appendice presque blanc, invisible
  const auto = analyzeImage(img);
  near('sans pinceau : largeur limitée au corps', auto.main.px.length, 200, 4);

  const include = new Uint8Array(500 * 400);
  for (let y = 180; y < 220; y++) for (let x = 350; x < 420; x++) include[y * 500 + x] = 1;
  const guided = analyzeImage(img, { include });
  near('avec pinceau : appendice inclus', guided.main.px.length, 270, 4);
}

// --- 5. Pinceau « exclure » : retirer une ombre portée -----------------------
console.log('\n5. Pinceau exclure : l\'ombre portée est retirée de l\'objet');
{
  const img = blank(500, 400);
  box(img, 120, 140, 320, 260, 40);    // objet
  box(img, 320, 140, 400, 260, 170);   // ombre attenante, plus claire
  // Seuil manuel généreux : c'est la situation où l'on a dû monter la
  // sensibilité pour attraper l'objet, et où l'ombre passe avec.
  const opts = { tolerance: 60, autoThreshold: false };
  const auto = analyzeImage(img, opts);
  check('sans pinceau : l\'ombre est avalée', auto.main.px.length > 240,
    `${auto.main.px.length.toFixed(0)} px`);

  const exclude = new Uint8Array(500 * 400);
  for (let y = 130; y < 270; y++) for (let x = 321; x < 410; x++) exclude[y * 500 + x] = 1;
  const guided = analyzeImage(img, { ...opts, exclude });
  near('avec pinceau : objet seul', guided.main.px.length, 200, 4);
}

// --- 6. Prédécoupage complet au pinceau --------------------------------------
console.log('\n6. Prédécoupage intégral : le pinceau seul définit la pièce');
{
  const img = blank(500, 400, 250);    // presque rien à détecter
  const include = new Uint8Array(500 * 400);
  for (let y = 100; y < 300; y++) for (let x = 100; x < 400; x++) include[y * 500 + x] = 1;
  const res = analyzeImage(img, { include });
  check('objet défini par le seul pinceau', !!res.main);
  near('largeur', res.main.px.length, 300, 3);
  near('hauteur', res.main.px.width, 200, 3);
}

// --- 7. Le prédécoupage ne dégrade pas le cas nominal ------------------------
console.log('\n7. Sans zone ni pinceau, le comportement est inchangé');
{
  const img = blank(600, 400);
  box(img, 100, 100, 500, 300, 40);
  const a = analyzeImage(img);
  const b = analyzeImage(img, { roi: null, include: null, exclude: null });
  check('résultats identiques', a.main.px.length === b.main.px.length && a.threshold === b.threshold,
    `${a.main.px.length} / ${b.main.px.length}`);
  near('largeur', a.main.px.length, 400, 3);
}

// --- 8. Masques de taille incohérente : ignorés proprement --------------------
console.log('\n8. Un masque de mauvaise taille est ignoré sans planter');
{
  const img = blank(400, 300);
  box(img, 80, 80, 320, 220, 40);
  const res = analyzeImage(img, { roi: new Uint8Array(10), include: new Uint8Array(5) });
  check('analyse aboutie', !!res.main);
  near('largeur', res.main.px.length, 240, 3);
}

console.log(`\n${checks - failures}/${checks} vérifications passées.`);
if (failures) {
  console.error(`${failures} échec(s).`);
  process.exit(1);
}
