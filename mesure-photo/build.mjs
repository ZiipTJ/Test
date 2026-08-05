/* Construit une version autonome en un seul fichier HTML, utilisable hors serveur
   (double-clic sur le fichier), les modules ES étant bloqués en file://.

   Chaque module est enfermé dans sa propre fonction et ne publie que ce qu'il
   exporte : concaténer les fichiers à plat ferait entrer en collision les noms
   internes identiques d'un module à l'autre (state, setStatus, $…).

   Usage : node build.mjs  ->  mesure-photo-autonome.html */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));

// Ordre de dépendance : un module doit être évalué après ceux qu'il importe.
const ORDER = [
  'js/shared.js', 'js/geometry.js', 'js/triangulate.js', 'js/vision.js', 'js/fitshapes.js',
  'js/carve.js', 'js/mesh3d.js', 'js/step.js', 'js/scene3d.js',
  'js/app3d.js', 'js/app.js',
];

const IMPORT_RE = /^import\s*\{([\s\S]*?)\}\s*from\s*'([^']+)';?[ \t]*$/gm;
const EXPORT_DECL_RE = /^export\s+(?:async\s+)?(const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm;

/** Vérifie qu'aucun module importé ne manque à la liste, et qu'il vient avant. */
function checkOrder() {
  const position = new Map(ORDER.map((f, i) => [f, i]));
  for (const file of ORDER) {
    const raw = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const m of raw.matchAll(IMPORT_RE)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), m[2]));
      if (!position.has(target)) {
        throw new Error(`${file} importe ${target}, absent de ORDER dans build.mjs`);
      }
      if (position.get(target) > position.get(file)) {
        throw new Error(`${file} importe ${target}, qui est évalué après lui : corriger l'ordre dans build.mjs`);
      }
    }
  }
}

function moduleSource(file) {
  const raw = fs.readFileSync(path.join(dir, file), 'utf8');

  const exported = [];
  for (const m of raw.matchAll(EXPORT_DECL_RE)) exported.push(m[2]);
  for (const m of raw.matchAll(/^export\s*\{([^}]*)\};?[ \t]*$/gm)) {
    for (const name of m[1].split(',')) {
      const clean = name.trim().split(/\s+as\s+/).pop().trim();
      if (clean) exported.push(clean);
    }
  }

  const body = raw
    .replace(IMPORT_RE, (_, names, from) => {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), from));
      const clean = names.split(',').map((n) => n.trim()).filter(Boolean).join(', ');
      return `const { ${clean} } = __modules['${target}'];`;
    })
    .replace(/^export\s+(?=(?:async\s+)?(?:const|let|var|function|class)\s)/gm, '')
    .replace(/^export\s*\{[^}]*\};?[ \t]*$/gm, '');

  const unique = [...new Set(exported)];
  return `__modules['${file}'] = (function () {\n${body}\nreturn { ${unique.join(', ')} };\n})();`;
}

checkOrder();

const bundle = [
  '(function () {',
  "'use strict';",
  'const __modules = {};',
  ...ORDER.map((f) => `/* ===== ${f} ===== */\n${moduleSource(f)}`),
  '})();',
].join('\n');

let html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const TAG = '<script type="module" src="js/app.js"></script>';
if (!html.includes(TAG)) throw new Error('Balise de script attendue introuvable dans index.html');
html = html.replace(TAG, `<script>\n${bundle}\n</script>`);

const outFile = path.join(dir, 'mesure-photo-autonome.html');
fs.writeFileSync(outFile, html);
console.log(`${outFile}  (${(fs.statSync(outFile).size / 1024).toFixed(0)} Ko)`);
