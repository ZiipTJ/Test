/** Maillage des torons et des gaines.
 *
 *  Tout part de la fibre neutre échantillonnée et de ses repères parallèles :
 *   - un **tube** à rayon variable donne le toron, la gaine lisse et — en faisant
 *     osciller le rayon — la gaine annelée ;
 *   - un **tube porté par une hélice** donne la gaine spiralée et le ruban de
 *     câblage : c'est bien un profil enroulé autour du toron, pas une texture.
 */
import { cross, normalize, type Vec3 } from '../math/vec';
import { parallelFrames } from '../curve/path';

export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

export type RadiusFunction = (t: number, station: number) => number;

const asFunction = (radius: number | RadiusFunction): RadiusFunction =>
  typeof radius === 'number' ? () => radius : radius;

export const EMPTY_MESH: MeshData = {
  positions: new Float32Array(0),
  normals: new Float32Array(0),
  indices: new Uint32Array(0),
};

/** Tube de section circulaire, éventuellement à rayon variable. */
export function buildTube(
  points: readonly Vec3[],
  tangents: readonly Vec3[],
  radius: number | RadiusFunction,
  radialSegments = 12,
  options: { caps?: boolean } = {},
): MeshData {
  const count = points.length;
  if (count < 2) return EMPTY_MESH;

  const radiusAt = asFunction(radius);
  const frames = parallelFrames(points, tangents);
  const caps = options.caps ?? true;

  const ringCount = count;
  const vertexCount = ringCount * radialSegments + (caps ? 2 : 0);
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);

  let station = 0;
  const stations = new Array<number>(count).fill(0);
  for (let i = 1; i < count; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    station += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    stations[i] = station;
  }
  const total = station || 1;

  for (let i = 0; i < ringCount; i += 1) {
    const frame = frames[i]!;
    const center = points[i]!;
    const r = radiusAt(stations[i]! / total, stations[i]!);
    for (let j = 0; j < radialSegments; j += 1) {
      const angle = (j / radialSegments) * Math.PI * 2;
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      const nx = frame.u[0] * cosine + frame.v[0] * sine;
      const ny = frame.u[1] * cosine + frame.v[1] * sine;
      const nz = frame.u[2] * cosine + frame.v[2] * sine;
      const index = (i * radialSegments + j) * 3;
      positions[index] = center[0] + nx * r;
      positions[index + 1] = center[1] + ny * r;
      positions[index + 2] = center[2] + nz * r;
      normals[index] = nx;
      normals[index + 1] = ny;
      normals[index + 2] = nz;
    }
  }

  const quads = (ringCount - 1) * radialSegments;
  const indices = new Uint32Array(quads * 6 + (caps ? radialSegments * 6 : 0));
  let cursor = 0;
  for (let i = 0; i < ringCount - 1; i += 1) {
    for (let j = 0; j < radialSegments; j += 1) {
      const next = (j + 1) % radialSegments;
      const a = i * radialSegments + j;
      const b = i * radialSegments + next;
      const c = (i + 1) * radialSegments + next;
      const d = (i + 1) * radialSegments + j;
      indices[cursor++] = a; indices[cursor++] = b; indices[cursor++] = c;
      indices[cursor++] = a; indices[cursor++] = c; indices[cursor++] = d;
    }
  }

  if (caps) {
    const startCenter = ringCount * radialSegments;
    const endCenter = startCenter + 1;
    const first = points[0]!;
    const last = points[count - 1]!;
    const startNormal = normalize([-tangents[0]![0], -tangents[0]![1], -tangents[0]![2]]);
    const endNormal = normalize(tangents[count - 1]!);
    positions.set(first, startCenter * 3);
    normals.set(startNormal, startCenter * 3);
    positions.set(last, endCenter * 3);
    normals.set(endNormal, endCenter * 3);
    for (let j = 0; j < radialSegments; j += 1) {
      const next = (j + 1) % radialSegments;
      indices[cursor++] = startCenter; indices[cursor++] = next; indices[cursor++] = j;
      const base = (ringCount - 1) * radialSegments;
      indices[cursor++] = endCenter; indices[cursor++] = base + j; indices[cursor++] = base + next;
    }
  }

  return { positions, normals, indices };
}

/** Hélice enroulée autour de la fibre neutre : gaine spiralée, ruban de câblage.
 *  `pitch` est la longueur parcourue par tour ; `bandRadius` le demi-profil. */
export function buildHelixTube(
  points: readonly Vec3[],
  tangents: readonly Vec3[],
  helixRadius: number | RadiusFunction,
  pitch: number,
  bandRadius: number,
  options: { radialSegments?: number; samplesPerTurn?: number } = {},
): MeshData {
  const count = points.length;
  if (count < 2 || pitch <= 0) return EMPTY_MESH;

  const radiusAt = asFunction(helixRadius);
  const frames = parallelFrames(points, tangents);

  const stations = new Array<number>(count).fill(0);
  for (let i = 1; i < count; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    stations[i] = stations[i - 1]! + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  }
  const total = stations[count - 1]!;
  if (total <= 0) return EMPTY_MESH;

  // Échantillonnage régulier le long du toron, à pas angulaire constant.
  const samplesPerTurn = options.samplesPerTurn ?? 16;
  const turns = total / pitch;
  const samples = Math.max(8, Math.min(6000, Math.ceil(turns * samplesPerTurn)));

  const helixPoints: Vec3[] = [];
  const helixTangents: Vec3[] = [];
  let previous: Vec3 | null = null;

  for (let s = 0; s <= samples; s += 1) {
    const station = (total * s) / samples;
    // Repère interpolé à cette abscisse.
    let index = 0;
    while (index < count - 2 && stations[index + 1]! < station) index += 1;
    const frame = frames[index]!;
    const span = (stations[index + 1]! - stations[index]!) || 1;
    const local = Math.min(1, Math.max(0, (station - stations[index]!) / span));
    const a = points[index]!;
    const b = points[index + 1] ?? a;
    const center: Vec3 = [
      a[0] + (b[0] - a[0]) * local,
      a[1] + (b[1] - a[1]) * local,
      a[2] + (b[2] - a[2]) * local,
    ];
    const angle = (station / pitch) * Math.PI * 2;
    const r = radiusAt(station / total, station);
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const point: Vec3 = [
      center[0] + (frame.u[0] * cosine + frame.v[0] * sine) * r,
      center[1] + (frame.u[1] * cosine + frame.v[1] * sine) * r,
      center[2] + (frame.u[2] * cosine + frame.v[2] * sine) * r,
    ];
    if (previous) {
      helixTangents.push(normalize([point[0] - previous[0], point[1] - previous[1], point[2] - previous[2]]));
    }
    helixPoints.push(point);
    previous = point;
  }
  if (helixTangents.length === 0) return EMPTY_MESH;
  helixTangents.push(helixTangents[helixTangents.length - 1]!);

  return buildTube(helixPoints, helixTangents, bandRadius, options.radialSegments ?? 6, { caps: true });
}

/** Rayon oscillant d'une gaine annelée : les anneaux sont de la géométrie, pas une texture. */
export function corrugatedRadius(baseRadius: number, amplitude: number, pitch: number): RadiusFunction {
  return (_t, station) => baseRadius + amplitude * 0.5 * (1 + Math.sin((station / Math.max(pitch, 0.1)) * Math.PI * 2));
}

/** Repère orthonormé d'une section, pour dessiner la coupe du toron. */
export function sectionBasis(tangent: Vec3): { u: Vec3; v: Vec3 } {
  const t = normalize(tangent);
  const reference: Vec3 = Math.abs(t[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = normalize(cross(reference, t));
  return { u, v: cross(t, u) };
}
