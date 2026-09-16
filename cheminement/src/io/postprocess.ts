/** Mise en forme commune à tous les formats : orientation, normales, arêtes.
 *  Exécuté dans le worker, juste avant de rendre la main à l'application. */
import { extractEdges } from '../core/geometry/edges';
import { generateNormals } from '../core/geometry/normals';
import type { ImportedMesh, ImportOptions, ImportStats } from './types';

export interface RawImportMesh {
  id: string;
  name: string;
  positions: Float32Array;
  indices: Uint32Array;
  normals?: Float32Array | null;
  faceIds?: Int32Array | null;
  color?: [number, number, number] | null;
}

/** Bascule un repère Y-haut vers le Z-haut interne : (x, y, z) → (x, −z, y). */
function toZUp(positions: Float32Array): void {
  for (let i = 0; i < positions.length; i += 3) {
    const y = positions[i + 1]!;
    const z = positions[i + 2]!;
    positions[i + 1] = -z;
    positions[i + 2] = y;
  }
}

export function finalizeMeshes(
  raw: RawImportMesh[],
  options: ImportOptions,
): { meshes: ImportedMesh[]; stats: Omit<ImportStats, 'durationMs'>; transfer: ArrayBuffer[] } {
  const meshes: ImportedMesh[] = [];
  const transfer: ArrayBuffer[] = [];
  let triangles = 0;
  let edges = 0;

  for (const entry of raw) {
    if (entry.indices.length === 0) continue;

    let positions = entry.positions;
    let indices = entry.indices;
    let normals = entry.normals ?? null;

    if (options.upAxis === 'Y') {
      positions = positions.slice();
      toZUp(positions);
      if (normals) {
        normals = normals.slice();
        toZUp(normals);
      }
    }

    if (!normals || normals.length !== positions.length) {
      const generated = generateNormals(positions, indices, options.creaseAngle + 10);
      positions = generated.positions;
      normals = generated.normals;
      indices = generated.indices;
    }

    const extracted = extractEdges(positions, indices, {
      creaseAngle: options.creaseAngle,
      faceIds: entry.faceIds ?? null,
    });

    meshes.push({
      id: entry.id,
      name: entry.name,
      positions,
      normals,
      indices,
      faceIds: entry.faceIds ?? null,
      color: entry.color ?? null,
      edgePositions: extracted.positions,
      weldedVertices: extracted.vertices,
    });

    triangles += indices.length / 3;
    edges += extracted.count;
    transfer.push(positions.buffer as ArrayBuffer, normals.buffer as ArrayBuffer, indices.buffer as ArrayBuffer);
    transfer.push(extracted.positions.buffer as ArrayBuffer, extracted.vertices.buffer as ArrayBuffer);
    if (entry.faceIds) transfer.push(entry.faceIds.buffer as ArrayBuffer);
  }

  return { meshes, stats: { meshes: meshes.length, triangles, edges }, transfer };
}
