/** Détection de repères d'accrochage dans un maillage CAO.
 *
 *  Poser un collier, c'est presque toujours viser un perçage. On reconstruit donc
 *  les boucles d'arêtes fermées et on retient celles qui sont des cercles : leur
 *  centre et leur axe deviennent des points d'accrochage, au même titre qu'un
 *  sommet ou un milieu d'arête. C'est ce qui permet de cliquer « dans le trou »
 *  plutôt qu'à côté.
 */
import type { Vec3 } from '../math/vec';

export interface CircleFeature {
  center: Vec3;
  /** Normale du plan du cercle, non orientée. */
  axis: Vec3;
  radius: number;
  /** Nombre de sommets de la boucle, indicateur de finesse de tessellation. */
  vertexCount: number;
}

export interface FeatureSet {
  circles: CircleFeature[];
  /** Milieux des arêtes droites, pratiques pour centrer un passage. */
  edgeMidpoints: Float32Array;
}

/** Cercles issus des boucles d'arêtes fermées et planes. */
export function detectCircles(
  vertices: Float32Array,
  segments: Uint32Array,
  options: { tolerance?: number; minVertices?: number } = {},
): CircleFeature[] {
  const minVertices = options.minVertices ?? 6;
  const vertexCount = vertices.length / 3;
  if (vertexCount === 0 || segments.length === 0) return [];

  const neighbours: number[][] = Array.from({ length: vertexCount }, () => []);
  for (let i = 0; i < segments.length; i += 2) {
    const a = segments[i]!;
    const b = segments[i + 1]!;
    neighbours[a]?.push(b);
    neighbours[b]?.push(a);
  }

  /** Sommets déjà consommés par un cercle détecté. */
  const consumed = new Uint8Array(vertexCount);
  const circles: CircleFeature[] = [];

  const direction = (from: number, to: number): Vec3 => {
    const dx = vertices[to * 3]! - vertices[from * 3]!;
    const dy = vertices[to * 3 + 1]! - vertices[from * 3 + 1]!;
    const dz = vertices[to * 3 + 2]! - vertices[from * 3 + 2]!;
    const n = Math.hypot(dx, dy, dz) || 1;
    return [dx / n, dy / n, dz / n];
  };

  for (let start = 0; start < vertexCount; start += 1) {
    if (consumed[start] || neighbours[start]!.length < 2) continue;

    /* Parcours du contour. Aux sommets de degré 3 — typiquement la couture d'un
       cylindre qui vient buter sur le cercle — on poursuit par la continuation la
       plus douce, celle qui dévie le moins de la direction courante. */
    const loop: number[] = [start];
    const inLoop = new Set<number>([start]);
    let previous = start;
    let current = neighbours[start]![0]!;
    let closed = false;

    for (let guard = 0; guard < vertexCount + 1; guard += 1) {
      if (current === start) { closed = true; break; }
      if (inLoop.has(current)) break;
      loop.push(current);
      inLoop.add(current);

      const incoming = direction(previous, current);
      let best = -1;
      let bestScore = 0.5; // au-delà de 60° de déviation, ce n'est plus le même contour
      for (const candidate of neighbours[current]!) {
        if (candidate === previous) continue;
        const outgoing = direction(current, candidate);
        const score = incoming[0] * outgoing[0] + incoming[1] * outgoing[1] + incoming[2] * outgoing[2];
        if (score > bestScore) { bestScore = score; best = candidate; }
      }
      if (best < 0) break;
      previous = current;
      current = best;
    }
    if (!closed || loop.length < minVertices) continue;

    /* Centre = barycentre ; on vérifie ensuite l'équidistance et la planéité. */
    let cx = 0, cy = 0, cz = 0;
    for (const index of loop) {
      cx += vertices[index * 3]!;
      cy += vertices[index * 3 + 1]!;
      cz += vertices[index * 3 + 2]!;
    }
    cx /= loop.length; cy /= loop.length; cz /= loop.length;

    let mean = 0;
    const radii: number[] = [];
    for (const index of loop) {
      const r = Math.hypot(vertices[index * 3]! - cx, vertices[index * 3 + 1]! - cy, vertices[index * 3 + 2]! - cz);
      radii.push(r);
      mean += r;
    }
    mean /= loop.length;
    if (mean < 1e-6) continue;

    const tolerance = options.tolerance ?? 0.02;
    let deviation = 0;
    for (const r of radii) deviation = Math.max(deviation, Math.abs(r - mean) / mean);
    if (deviation > tolerance) continue;

    /* Normale : somme des produits vectoriels des rayons consécutifs. */
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < loop.length; i += 1) {
      const a = loop[i]!;
      const b = loop[(i + 1) % loop.length]!;
      const ax = vertices[a * 3]! - cx, ay = vertices[a * 3 + 1]! - cy, az = vertices[a * 3 + 2]! - cz;
      const bx = vertices[b * 3]! - cx, by = vertices[b * 3 + 1]! - cy, bz = vertices[b * 3 + 2]! - cz;
      nx += ay * bz - az * by;
      ny += az * bx - ax * bz;
      nz += ax * by - ay * bx;
    }
    const norm = Math.hypot(nx, ny, nz);
    if (norm < 1e-9) continue;

    // Planéité : aucun sommet ne doit s'écarter du plan moyen.
    let outOfPlane = 0;
    for (const index of loop) {
      const d =
        ((vertices[index * 3]! - cx) * nx + (vertices[index * 3 + 1]! - cy) * ny + (vertices[index * 3 + 2]! - cz) * nz) / norm;
      outOfPlane = Math.max(outOfPlane, Math.abs(d));
    }
    if (outOfPlane > mean * tolerance) continue;

    for (const index of loop) consumed[index] = 1;
    circles.push({
      center: [cx, cy, cz],
      axis: [nx / norm, ny / norm, nz / norm],
      radius: mean,
      vertexCount: loop.length,
    });
  }

  return circles;
}

/** Milieux des arêtes, calculés une fois pour l'accrochage. */
export function edgeMidpoints(vertices: Float32Array, segments: Uint32Array): Float32Array {
  const out = new Float32Array((segments.length / 2) * 3);
  for (let i = 0; i < segments.length; i += 2) {
    const a = segments[i]!;
    const b = segments[i + 1]!;
    const k = (i / 2) * 3;
    out[k] = (vertices[a * 3]! + vertices[b * 3]!) / 2;
    out[k + 1] = (vertices[a * 3 + 1]! + vertices[b * 3 + 1]!) / 2;
    out[k + 2] = (vertices[a * 3 + 2]! + vertices[b * 3 + 2]!) / 2;
  }
  return out;
}

export function detectFeatures(vertices: Float32Array, segments: Uint32Array): FeatureSet {
  return { circles: detectCircles(vertices, segments), edgeMidpoints: edgeMidpoints(vertices, segments) };
}
