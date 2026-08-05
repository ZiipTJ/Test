/* Construit une version autonome en un seul fichier HTML, utilisable hors serveur
   (double-clic sur le fichier), les modules ES étant bloqués en file://.
   Usage : node build.mjs  ->  mesure-photo-autonome.html */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const ORDER = ['js/geometry.js', 'js/vision.js', 'js/app.js'];

const flatten = (src) => {
  const code = fs.readFileSync(path.join(dir, src), 'utf8');
  return `/* ===== ${src} ===== */\n${code
    .replace(/^import[\s\S]*?from\s+'[^']+';\s*$/gm, '')
    .replace(/^export\s+(const|function|class|let)\b/gm, '$1')
    .replace(/^export\s*\{[^}]*\};\s*$/gm, '')}`;
};

const bundle = `(function () {\n'use strict';\n${ORDER.map(flatten).join('\n')}\n})();`;

let html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
if (!html.includes('<script type="module" src="js/app.js"></script>')) {
  throw new Error('Balise de script attendue introuvable dans index.html');
}
html = html.replace('<script type="module" src="js/app.js"></script>', `<script>\n${bundle}\n</script>`);

const outFile = path.join(dir, 'mesure-photo-autonome.html');
fs.writeFileSync(outFile, html);
console.log(`${outFile}  (${(fs.statSync(outFile).size / 1024).toFixed(0)} Ko)`);
