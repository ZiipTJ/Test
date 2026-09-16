import { describe, expect, it } from 'vitest';
import { extractEdges, faceIdsFromRanges } from '../src/core/geometry/edges';

/** Cube 20 mm, sommets dupliqués par face comme le fait une tessellation CAO. */
function cube(size = 20): { positions: Float32Array; indices: Uint32Array; faceIds: Int32Array } {
  const h = size / 2;
  const corners: Array<[number, number, number]> = [
    [-h, -h, -h], [h, -h, -h], [h, h, -h], [-h, h, -h],
    [-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h],
  ];
  const quads: Array<[number, number, number, number]> = [
    [0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7],
  ];
  const positions: number[] = [];
  const indices: number[] = [];
  const faceIds: number[] = [];
  quads.forEach((quad, face) => {
    const base = positions.length / 3;
    for (const c of quad) positions.push(...corners[c]!);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    faceIds.push(face, face);
  });
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices), faceIds: new Int32Array(faceIds) };
}

describe('extractEdges', () => {
  it('retrouve les 12 arêtes d’un cube malgré les sommets dupliqués', () => {
    const { positions, indices, faceIds } = cube();
    const result = extractEdges(positions, indices, { faceIds });
    expect(result.count).toBe(12);
    expect(result.vertices.length / 3).toBe(8);
    expect(result.positions.length).toBe(12 * 2 * 3);
  });

  it('retrouve les mêmes arêtes sans information de face, par l’angle dièdre', () => {
    const { positions, indices } = cube();
    expect(extractEdges(positions, indices, { creaseAngle: 25 }).count).toBe(12);
  });

  it('garde une arête entre deux faces B-rep tangentes, que l’angle ignorerait', () => {
    // Deux triangles coplanaires : aucun angle vif, mais deux faces distinctes.
    const positions = new Float32Array([0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 0, 0, 10, 10, 0, 0, 10, 0]);
    const indices = new Uint32Array([0, 1, 2, 3, 4, 5]);
    expect(extractEdges(positions, indices, { creaseAngle: 25 }).count).toBe(4);
    const withFaces = extractEdges(positions, indices, { faceIds: new Int32Array([0, 1]) });
    expect(withFaces.count).toBe(5); // les 4 bords libres, plus la diagonale partagée
  });

  it('signale les bords libres d’une surface ouverte', () => {
    const positions = new Float32Array([0, 0, 0, 10, 0, 0, 10, 10, 0]);
    const indices = new Uint32Array([0, 1, 2]);
    expect(extractEdges(positions, indices).count).toBe(3);
  });

  it('convertit les plages de faces OpenCascade en numéro par triangle', () => {
    const ids = faceIdsFromRanges([{ first: 0, last: 1 }, { first: 2, last: 4 }], 5);
    expect(Array.from(ids)).toEqual([0, 0, 1, 1, 1]);
  });
});
