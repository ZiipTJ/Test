/** Copie le moteur OpenCascade (glue JS + WASM) dans public/wasm.
 *  Le worker le charge par `importScripts`, ce qui évite de faire passer un
 *  module Emscripten UMD à travers le bundler. */
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'node_modules', 'occt-import-js', 'dist');
const target = join(root, 'public', 'wasm');

mkdirSync(target, { recursive: true });
for (const file of ['occt-import-js.js', 'occt-import-js.wasm', 'license.occt.txt', 'license.occt-import-js.txt']) {
  copyFileSync(join(source, file), join(target, file));
}
console.log(`occt-import-js copié dans ${target}`);
