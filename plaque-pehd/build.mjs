/* Construit une version autonome en un seul fichier HTML (scripts intégrés).
   Usage : node build.mjs  ->  plaque-pehd-autonome.html */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
let html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');

html = html.replace(/<script src="(js\/[^"]+)"><\/script>/g, (_, src) => {
  const code = fs.readFileSync(path.join(dir, src), 'utf8');
  return `<script>\n/* ===== ${src} ===== */\n${code}\n</script>`;
});

const outFile = path.join(dir, 'plaque-pehd-autonome.html');
fs.writeFileSync(outFile, html);
console.log(`${outFile}  (${(fs.statSync(outFile).size / 1024).toFixed(0)} Ko)`);
