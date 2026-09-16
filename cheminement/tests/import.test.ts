/** Test d'intégration de la chaîne d'import, du fichier jusqu'aux arêtes.
 *  Il tourne sur le modèle de démonstration produit par `npm run fixtures`,
 *  relu par le vrai moteur OpenCascade. */
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import type { OcctModule } from 'occt-import-js';
import { detectCircles } from '../src/core/geometry/features';
import { occtResultToRaw } from '../src/io/formats/step';
import { parseThreeMf } from '../src/io/formats/threemf';
import { finalizeMeshes } from '../src/io/postprocess';
import { DEFAULT_IMPORT_OPTIONS } from '../src/io/types';

const require = createRequire(import.meta.url);
const samples = join(__dirname, 'samples');

let occt: OcctModule;

beforeAll(async () => {
  const factory = require('occt-import-js');
  occt = await factory({
    locateFile: () => join(__dirname, '..', 'node_modules/occt-import-js/dist/occt-import-js.wasm'),
  });
}, 30_000);

describe('import STEP', () => {
  it('lit les quatre corps nommés de la platine de démonstration', () => {
    const buffer = readFileSync(join(samples, 'platine-cheminement.step'));
    const { raw } = occtResultToRaw(occt.ReadStepFile(new Uint8Array(buffer), null));

    expect(raw).toHaveLength(4);
    expect(raw.map((m) => m.name)).toEqual([
      'Platine 800x400 ep.10',
      'Support connecteur G',
      'Support connecteur D',
      'Traverse',
    ]);
    // La platine porte 22 faces B-rep : 2 plans, 4 chants, 8 perçages en deux moitiés.
    const plate = raw[0]!;
    expect(new Set(Array.from(plate.faceIds!)).size).toBe(22);
  });

  it('produit des arêtes topologiques exactes sur un support parallélépipédique', () => {
    const buffer = readFileSync(join(samples, 'platine-cheminement.step'));
    const { raw } = occtResultToRaw(occt.ReadStepFile(new Uint8Array(buffer), null));
    const { meshes, stats } = finalizeMeshes(raw, DEFAULT_IMPORT_OPTIONS);

    const support = meshes.find((m) => m.name === 'Support connecteur G')!;
    // Un pavé : 12 arêtes, 8 sommets, 12 triangles.
    expect(support.edgePositions.length / 6).toBe(12);
    expect(support.weldedVertices.length / 3).toBe(8);
    expect(stats.meshes).toBe(4);
    expect(stats.triangles).toBeGreaterThan(400);
  });

  it('trouve les contours de perçage de la platine', () => {
    const buffer = readFileSync(join(samples, 'platine-cheminement.step'));
    const { raw } = occtResultToRaw(occt.ReadStepFile(new Uint8Array(buffer), null));
    const { meshes } = finalizeMeshes(raw, DEFAULT_IMPORT_OPTIONS);
    const plate = meshes.find((m) => m.name.startsWith('Platine'))!;

    // Les sommets des cercles de perçage sont à 4,25 mm du centre du trou visé.
    const target = { x: 150, y: 200 };
    let onCircle = 0;
    for (let i = 0; i < plate.weldedVertices.length; i += 3) {
      const dx = plate.weldedVertices[i]! - target.x;
      const dy = plate.weldedVertices[i + 1]! - target.y;
      if (Math.abs(Math.hypot(dx, dy) - 4.25) < 0.2) onCircle += 1;
    }
    // Deux contours (dessus et dessous), au moins quelques points chacun.
    expect(onCircle).toBeGreaterThanOrEqual(8);
  });

  it('refuse un fichier vide avec un message explicite', () => {
    expect(() => occtResultToRaw(occt.ReadStepFile(new Uint8Array([1, 2, 3]), null))).toThrow(/OpenCascade/);
  });
});

describe('import 3MF', () => {
  it('relit la version 3MF du même modèle', () => {
    const buffer = readFileSync(join(samples, 'platine-cheminement.3mf'));
    const document = parseThreeMf(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer);

    expect(document.meshes).toHaveLength(4);
    expect(document.meshes.map((m) => m.name)).toContain('Support connecteur G');

    const { meshes } = finalizeMeshes(
      document.meshes.map((mesh, index) => ({
        id: `3mf-${index}`,
        name: mesh.name,
        positions: mesh.positions,
        indices: mesh.indices,
        normals: null,
        faceIds: null,
        color: mesh.color,
      })),
      DEFAULT_IMPORT_OPTIONS,
    );

    // Sans topologie, les arêtes viennent de l'angle dièdre : un pavé en garde 12.
    const support = meshes.find((m) => m.name === 'Support connecteur G')!;
    expect(support.edgePositions.length / 6).toBe(12);
  });
});

describe('repères d’accrochage', () => {
  it('retrouve les seize contours de perçage de la platine', () => {
    const buffer = readFileSync(join(samples, 'platine-cheminement.step'));
    const { raw } = occtResultToRaw(occt.ReadStepFile(new Uint8Array(buffer), null));
    const { meshes } = finalizeMeshes(raw, DEFAULT_IMPORT_OPTIONS);
    const plate = meshes.find((m) => m.name.startsWith('Platine'))!;

    const circles = detectCircles(plate.weldedVertices, plate.edgeSegments);
    // Huit perçages, vus du dessus et du dessous.
    expect(circles).toHaveLength(16);
    // Quatre trous de collier Ø8,5 et quatre trous de fixation Ø10.
    const radii = circles.map((c) => Number(c.radius.toFixed(2))).sort((a, b) => a - b);
    expect(radii.filter((r) => Math.abs(r - 4.25) < 0.05)).toHaveLength(8);
    expect(radii.filter((r) => Math.abs(r - 5) < 0.05)).toHaveLength(8);
    // Les axes sont verticaux et les centres aux cotes du modèle.
    for (const circle of circles) expect(Math.abs(circle.axis[2]!)).toBeCloseTo(1, 3);
    const clampHole = circles.find((c) => Math.abs(c.center[0]! - 300) < 0.1 && Math.abs(c.center[1]! - 200) < 0.1);
    expect(clampHole).toBeDefined();
  });
});

