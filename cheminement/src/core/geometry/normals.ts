/** Génération de normales pour les maillages qui n'en portent pas (3MF, STL).
 *
 *  Un lissage naïf arrondit les arêtes d'une pièce mécanique ; un rendu à facettes
 *  gâche les surfaces courbes. On reconstruit donc le voisinage réel : les sommets
 *  confondus sont soudés, puis les triangles qui s'y rencontrent sont regroupés par
 *  familles d'orientations voisines. Chaque famille donne un sommet de sortie —
 *  lisse à l'intérieur d'un congé, dédoublé de part et d'autre d'une arête vive.
 */

export interface GeneratedNormals {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

export function generateNormals(
  positions: ArrayLike<number>,
  indices: ArrayLike<number>,
  creaseAngle = 35,
): GeneratedNormals {
  const triangleCount = Math.floor(indices.length / 3);
  const cosThreshold = Math.cos((creaseAngle * Math.PI) / 180);

  /* Soudure par position quantifiée. */
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i]!, y = positions[i + 1]!, z = positions[i + 2]!;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const diagonal = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) || 1;
  const inverse = 1 / (diagonal * 1e-6);

  const vertexCount = Math.floor(positions.length / 3);
  const welded = new Uint32Array(vertexCount);
  const lookup = new Map<string, number>();
  const uniquePositions: number[] = [];
  for (let v = 0; v < vertexCount; v += 1) {
    const x = positions[v * 3]!, y = positions[v * 3 + 1]!, z = positions[v * 3 + 2]!;
    const key = `${Math.round(x * inverse)},${Math.round(y * inverse)},${Math.round(z * inverse)}`;
    let id = lookup.get(key);
    if (id === undefined) {
      id = uniquePositions.length / 3;
      lookup.set(key, id);
      uniquePositions.push(x, y, z);
    }
    welded[v] = id;
  }

  /* Normales de face, pondérées par la surface (aire = norme du produit vectoriel). */
  const faceNormals = new Float32Array(triangleCount * 3);
  const incident: number[][] = Array.from({ length: uniquePositions.length / 3 }, () => []);
  for (let t = 0; t < triangleCount; t += 1) {
    const a = welded[indices[t * 3]!]!;
    const b = welded[indices[t * 3 + 1]!]!;
    const c = welded[indices[t * 3 + 2]!]!;
    const ax = uniquePositions[a * 3]!, ay = uniquePositions[a * 3 + 1]!, az = uniquePositions[a * 3 + 2]!;
    const ux = uniquePositions[b * 3]! - ax, uy = uniquePositions[b * 3 + 1]! - ay, uz = uniquePositions[b * 3 + 2]! - az;
    const vx = uniquePositions[c * 3]! - ax, vy = uniquePositions[c * 3 + 1]! - ay, vz = uniquePositions[c * 3 + 2]! - az;
    faceNormals[t * 3] = uy * vz - uz * vy;
    faceNormals[t * 3 + 1] = uz * vx - ux * vz;
    faceNormals[t * 3 + 2] = ux * vy - uy * vx;
    incident[a]?.push(t);
    incident[b]?.push(t);
    incident[c]?.push(t);
  }

  /* Familles d'orientations autour de chaque sommet soudé. */
  const outPositions: number[] = [];
  const outNormals: number[] = [];
  /** Pour chaque sommet soudé : triangle → index du sommet de sortie. */
  const assignment = new Map<number, number>();

  for (let v = 0; v < incident.length; v += 1) {
    const triangles = incident[v]!;
    if (triangles.length === 0) continue;
    const groups: Array<{ triangles: number[]; nx: number; ny: number; nz: number }> = [];

    for (const t of triangles) {
      let nx = faceNormals[t * 3]!, ny = faceNormals[t * 3 + 1]!, nz = faceNormals[t * 3 + 2]!;
      const len = Math.hypot(nx, ny, nz);
      if (len < 1e-20) continue; // triangle dégénéré
      const ux = nx / len, uy = ny / len, uz = nz / len;
      let target = groups.find((g) => {
        const gl = Math.hypot(g.nx, g.ny, g.nz) || 1;
        return (g.nx / gl) * ux + (g.ny / gl) * uy + (g.nz / gl) * uz >= cosThreshold;
      });
      if (!target) {
        target = { triangles: [], nx: 0, ny: 0, nz: 0 };
        groups.push(target);
      }
      target.triangles.push(t);
      target.nx += nx;
      target.ny += ny;
      target.nz += nz;
    }

    for (const group of groups) {
      const index = outPositions.length / 3;
      outPositions.push(uniquePositions[v * 3]!, uniquePositions[v * 3 + 1]!, uniquePositions[v * 3 + 2]!);
      const len = Math.hypot(group.nx, group.ny, group.nz) || 1;
      outNormals.push(group.nx / len, group.ny / len, group.nz / len);
      for (const t of group.triangles) assignment.set(t * incident.length + v, index);
    }
  }

  const outIndices = new Uint32Array(triangleCount * 3);
  for (let t = 0; t < triangleCount; t += 1) {
    for (let k = 0; k < 3; k += 1) {
      const v = welded[indices[t * 3 + k]!]!;
      outIndices[t * 3 + k] = assignment.get(t * incident.length + v) ?? 0;
    }
  }

  return {
    positions: Float32Array.from(outPositions),
    normals: Float32Array.from(outNormals),
    indices: outIndices,
  };
}
