/** Extraction des arêtes d'un maillage.
 *
 *  Deux sources d'arêtes se complètent :
 *   - les **arêtes topologiques** : la tessellation OpenCascade numérote ses faces
 *     B-rep, donc une arête séparant deux faces différentes est une vraie arête du
 *     modèle — y compris sur un congé, là où l'angle dièdre ne dit rien ;
 *   - les **arêtes vives** : pour un maillage sans topologie (3MF, STL), on retombe
 *     sur le critère d'angle dièdre, complété par les bords libres.
 *
 *  La tessellation duplique les sommets d'une face à l'autre (normales distinctes) :
 *  on ré-identifie donc les sommets par leur position quantifiée, sinon aucune arête
 *  partagée ne serait détectée.
 */

export interface EdgeExtractionOptions {
  /** Angle dièdre au-delà duquel une arête est considérée vive (degrés). */
  creaseAngle?: number;
  /** Pas de quantification des positions ; déduit de la taille du modèle si absent. */
  weldTolerance?: number;
  /** Numéro de face B-rep par triangle. */
  faceIds?: Int32Array | Uint32Array | null;
}

export interface EdgeExtractionResult {
  /** Paires de points, prêtes pour un rendu en LINES. */
  positions: Float32Array;
  count: number;
  /** Indices canoniques des extrémités, utiles à l'accrochage. */
  segments: Uint32Array;
  /** Sommets canoniques (dédupliqués), pour l'accrochage aux sommets. */
  vertices: Float32Array;
}

function triangleNormal(
  p: ArrayLike<number>,
  a: number,
  b: number,
  c: number,
): [number, number, number] {
  const ax = p[a * 3]!, ay = p[a * 3 + 1]!, az = p[a * 3 + 2]!;
  const bx = p[b * 3]!, by = p[b * 3 + 1]!, bz = p[b * 3 + 2]!;
  const cx = p[c * 3]!, cy = p[c * 3 + 1]!, cz = p[c * 3 + 2]!;
  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const vx = cx - ax, vy = cy - ay, vz = cz - az;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

export function extractEdges(
  positions: ArrayLike<number>,
  indices: ArrayLike<number>,
  options: EdgeExtractionOptions = {},
): EdgeExtractionResult {
  const creaseAngle = options.creaseAngle ?? 25;
  const cosThreshold = Math.cos((creaseAngle * Math.PI) / 180);
  const faceIds = options.faceIds ?? null;

  // Tolérance de soudure : proportionnelle à la taille du modèle.
  let tolerance = options.weldTolerance ?? 0;
  if (tolerance <= 0) {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i]!, y = positions[i + 1]!, z = positions[i + 2]!;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    const diagonal = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) || 1;
    tolerance = diagonal * 1e-6;
  }
  const inverse = 1 / tolerance;

  /* 1. Soudure des sommets par position quantifiée. */
  const canonical = new Uint32Array(positions.length / 3);
  const lookup = new Map<string, number>();
  const vertexList: number[] = [];
  for (let v = 0; v < canonical.length; v += 1) {
    const x = positions[v * 3]!, y = positions[v * 3 + 1]!, z = positions[v * 3 + 2]!;
    const key = `${Math.round(x * inverse)},${Math.round(y * inverse)},${Math.round(z * inverse)}`;
    let id = lookup.get(key);
    if (id === undefined) {
      id = vertexList.length / 3;
      lookup.set(key, id);
      vertexList.push(x, y, z);
    }
    canonical[v] = id;
  }

  /* 2. Recensement des arêtes et de leurs triangles adjacents. */
  interface EdgeRecord {
    a: number;
    b: number;
    count: number;
    firstFace: number;
    splitsFaces: boolean;
    nx: number; ny: number; nz: number;
    sharp: boolean;
  }
  const edges = new Map<number, EdgeRecord>();
  const vertexCount = vertexList.length / 3;
  const keyOf = (a: number, b: number) => (a < b ? a * vertexCount + b : b * vertexCount + a);

  const triangleCount = Math.floor(indices.length / 3);
  for (let t = 0; t < triangleCount; t += 1) {
    const i0 = indices[t * 3]!, i1 = indices[t * 3 + 1]!, i2 = indices[t * 3 + 2]!;
    const normal = triangleNormal(positions, i0, i1, i2);
    const face = faceIds ? faceIds[t] ?? -1 : -1;
    const corners = [canonical[i0]!, canonical[i1]!, canonical[i2]!];
    for (let e = 0; e < 3; e += 1) {
      const a = corners[e]!;
      const b = corners[(e + 1) % 3]!;
      if (a === b) continue;
      const key = keyOf(a, b);
      const existing = edges.get(key);
      if (!existing) {
        edges.set(key, {
          a, b, count: 1, firstFace: face, splitsFaces: false,
          nx: normal[0], ny: normal[1], nz: normal[2], sharp: false,
        });
      } else {
        existing.count += 1;
        if (face !== existing.firstFace) existing.splitsFaces = true;
        const cos = existing.nx * normal[0] + existing.ny * normal[1] + existing.nz * normal[2];
        if (cos < cosThreshold) existing.sharp = true;
      }
    }
  }

  /* 3. Sélection : bord libre, changement de face B-rep, ou arête vive. */
  const segments: number[] = [];
  for (const edge of edges.values()) {
    const keep = edge.count === 1 || edge.splitsFaces || edge.sharp;
    if (keep) segments.push(edge.a, edge.b);
  }

  const out = new Float32Array(segments.length * 3);
  for (let i = 0; i < segments.length; i += 1) {
    const v = segments[i]!;
    out[i * 3] = vertexList[v * 3]!;
    out[i * 3 + 1] = vertexList[v * 3 + 1]!;
    out[i * 3 + 2] = vertexList[v * 3 + 2]!;
  }

  return {
    positions: out,
    count: segments.length / 2,
    segments: Uint32Array.from(segments),
    vertices: Float32Array.from(vertexList),
  };
}

/** Numéro de face B-rep par triangle, à partir des plages renvoyées par OpenCascade. */
export function faceIdsFromRanges(
  ranges: ReadonlyArray<{ first: number; last: number }>,
  triangleCount: number,
): Int32Array {
  const ids = new Int32Array(triangleCount).fill(-1);
  ranges.forEach((range, faceIndex) => {
    for (let t = range.first; t <= range.last && t < triangleCount; t += 1) ids[t] = faceIndex;
  });
  return ids;
}
