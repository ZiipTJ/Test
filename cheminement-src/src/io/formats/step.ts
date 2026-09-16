/** Conversion du résultat OpenCascade en maillages bruts.
 *  Isolé du worker pour être testable directement en Node. */
import type { OcctNode, OcctResult } from 'occt-import-js';
import { faceIdsFromRanges } from '../../core/geometry/edges';
import type { RawImportMesh } from '../postprocess';

/** Noms hiérarchiques issus de l'arbre d'assemblage. */
export function collectNames(node: OcctNode | undefined, prefix: string, out: Map<number, string>): void {
  if (!node) return;
  const name = node.name ? (prefix ? `${prefix} / ${node.name}` : node.name) : prefix;
  for (const index of node.meshes ?? []) out.set(index, name || `Corps ${index + 1}`);
  for (const child of node.children ?? []) collectNames(child, name, out);
}

export function occtResultToRaw(result: OcctResult): { raw: RawImportMesh[]; warnings: string[] } {
  if (!result.success || !result.meshes) {
    throw new Error(
      'OpenCascade n’a pas pu lire ce fichier. Vérifiez qu’il contient bien une géométrie exportée (produit et représentation de forme).',
    );
  }

  const names = new Map<number, string>();
  collectNames(result.root, '', names);

  const warnings: string[] = [];
  const raw = result.meshes.map((mesh, index): RawImportMesh => {
    const indices = Uint32Array.from(mesh.index.array);
    const faceIds = mesh.brep_faces?.length ? faceIdsFromRanges(mesh.brep_faces, indices.length / 3) : null;
    if (!faceIds) {
      warnings.push(`Corps « ${mesh.name || index + 1} » sans découpage de faces : arêtes déduites de l’angle.`);
    }
    return {
      id: `step-${index}`,
      name: mesh.name || names.get(index) || `Corps ${index + 1}`,
      positions: Float32Array.from(mesh.attributes.position.array),
      indices,
      normals: mesh.attributes.normal ? Float32Array.from(mesh.attributes.normal.array) : null,
      faceIds,
      color: mesh.color,
    };
  });

  return { raw, warnings };
}
