/** Fabrique les modèles de démonstration et les fixtures de test.
 *
 *  Le STEP est écrit ici, puis relu par OpenCascade : c'est à la fois une
 *  validation du fichier produit et la source de la version 3MF, tessellée par
 *  le même moteur que celui de l'application.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { zipSync, strToU8 } from 'three/examples/jsm/libs/fflate.module.js';
import { box, plateWithHoles, StepWriter } from './step-writer.mjs';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ------------------------------------------------------- modèle de démonstration */

/** Platine percée, deux supports de connecteur et une traverse : de quoi poser un
 *  faisceau qui part d'un support, longe la platine sur ses colliers et rejoint
 *  l'autre support en passant sous la traverse. */
function buildDemo() {
  const writer = new StepWriter();

  const clampHoles = [150, 300, 450, 600].map((x) => ({ x, y: 200, r: 4.25 }));
  const mountHoles = [
    { x: 30, y: 30, r: 5 }, { x: 770, y: 30, r: 5 },
    { x: 30, y: 370, r: 5 }, { x: 770, y: 370, r: 5 },
  ];

  const parts = [
    { name: 'Platine 800x400 ep.10', faces: plateWithHoles(writer, [0, 0, 0], [800, 400, 10], [...clampHoles, ...mountHoles]) },
    { name: 'Support connecteur G', faces: box(writer, [40, 150, 10], [60, 100, 80]) },
    { name: 'Support connecteur D', faces: box(writer, [700, 150, 10], [60, 100, 80]) },
    { name: 'Traverse', faces: box(writer, [200, 40, 10], [400, 40, 50]) },
  ];

  return writer.build(parts, { description: 'Platine de cheminement - demonstration' });
}

/* ------------------------------------------------------------------ export 3MF */

function toThreeMf(meshes) {
  const objects = meshes.map((mesh, index) => {
    const positions = mesh.attributes.position.array;
    const indices = mesh.index.array;
    const vertices = [];
    for (let i = 0; i < positions.length; i += 3) {
      vertices.push(`<vertex x="${positions[i]}" y="${positions[i + 1]}" z="${positions[i + 2]}" />`);
    }
    const triangles = [];
    for (let i = 0; i < indices.length; i += 3) {
      triangles.push(`<triangle v1="${indices[i]}" v2="${indices[i + 1]}" v3="${indices[i + 2]}" />`);
    }
    const name = (mesh.name || `Corps ${index + 1}`).replace(/[<>&"]/g, '');
    return `<object id="${index + 1}" type="model" name="${name}"><mesh><vertices>${vertices.join('')}</vertices><triangles>${triangles.join('')}</triangles></mesh></object>`;
  });

  const items = meshes.map((_, index) => `<item objectid="${index + 1}" />`).join('');
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
 <resources>${objects.join('')}</resources>
 <build>${items}</build>
</model>`;

  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" /><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml" /></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" /></Relationships>'),
    '3D/3dmodel.model': strToU8(model),
  });
}

/* ---------------------------------------------------------------------- écriture */

const step = buildDemo();
for (const directory of ['tests/samples', 'public/demo']) {
  mkdirSync(join(root, directory), { recursive: true });
  writeFileSync(join(root, directory, 'platine-cheminement.step'), step);
}
console.log(`STEP écrit : ${(step.length / 1024).toFixed(0)} Ko`);

const occtimportjs = require('occt-import-js');
const occt = await occtimportjs({ locateFile: () => join(root, 'node_modules/occt-import-js/dist/occt-import-js.wasm') });
const result = occt.ReadStepFile(new Uint8Array(Buffer.from(step, 'utf8')), null);

if (!result.success) {
  console.error('Le STEP produit est refusé par OpenCascade.');
  process.exit(1);
}

const triangles = result.meshes.reduce((sum, m) => sum + m.index.array.length / 3, 0);
const faces = result.meshes.reduce((sum, m) => sum + (m.brep_faces?.length ?? 0), 0);
console.log(`Relu par OpenCascade : ${result.meshes.length} corps, ${faces} faces B-rep, ${triangles} triangles`);
for (const mesh of result.meshes) {
  console.log(`  - ${mesh.name || '(sans nom)'} : ${mesh.index.array.length / 3} triangles, ${mesh.brep_faces?.length ?? 0} faces`);
}

const archive = toThreeMf(result.meshes);
for (const directory of ['tests/samples', 'public/demo']) {
  writeFileSync(join(root, directory, 'platine-cheminement.3mf'), archive);
}
console.log(`3MF écrit : ${(archive.length / 1024).toFixed(0)} Ko`);
