/** Algèbre 3D sur des tuples, volontairement sans dépendance à three.js :
 *  tout `core/` reste testable en Node et sérialisable tel quel en JSON. */
/** Tuple mutable : le modèle est manipulé par immer, qui refuse les tuples
 *  figés. Les fonctions de ce module ne modifient jamais leurs arguments. */
export type Vec3 = [number, number, number];
export type Vec2 = [number, number];

export const v3 = (x: number, y: number, z: number): Vec3 => [x, y, z];
export const ZERO: Vec3 = [0, 0, 0];

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const neg = (a: Vec3): Vec3 => [-a[0], -a[1], -a[2]];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const distance = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

export function normalize(a: Vec3): Vec3 {
  const n = Math.hypot(a[0], a[1], a[2]);
  return n > 1e-12 ? [a[0] / n, a[1] / n, a[2] / n] : [0, 0, 0];
}

export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

/** Angle non signé entre deux directions, robuste près de 0 et de π. */
export function angleBetween(a: Vec3, b: Vec3): number {
  const u = normalize(a);
  const w = normalize(b);
  return Math.atan2(length(cross(u, w)), clamp(dot(u, w), -1, 1));
}

/** Rotation de Rodrigues autour d'un axe unitaire. */
export function rotateAround(v: Vec3, axis: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return add(add(scale(v, c), scale(cross(axis, v), s)), scale(axis, dot(axis, v) * (1 - c)));
}

/** Repère orthonormé dont le troisième vecteur est la direction fournie. */
export function basisFromNormal(n: Vec3): { u: Vec3; v: Vec3; n: Vec3 } {
  const N = normalize(n);
  const ref: Vec3 = Math.abs(N[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = normalize(cross(ref, N));
  return { u, v: cross(N, u), n: N };
}

/** Projection d'un point sur un segment, renvoyée avec son abscisse normalisée. */
export function closestPointOnSegment(p: Vec3, a: Vec3, b: Vec3): { point: Vec3; t: number; distance: number } {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 < 1e-18) return { point: a, t: 0, distance: distance(p, a) };
  const t = clamp(dot(sub(p, a), ab) / l2, 0, 1);
  const point = add(a, scale(ab, t));
  return { point, t, distance: distance(p, point) };
}

export interface Box3 {
  min: Vec3;
  max: Vec3;
}

export function boxFromPoints(points: Iterable<Vec3>): Box3 {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity;
  let x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (const p of points) {
    if (p[0] < x0) x0 = p[0];
    if (p[1] < y0) y0 = p[1];
    if (p[2] < z0) z0 = p[2];
    if (p[0] > x1) x1 = p[0];
    if (p[1] > y1) y1 = p[1];
    if (p[2] > z1) z1 = p[2];
  }
  if (!Number.isFinite(x0)) return { min: ZERO, max: ZERO };
  return { min: [x0, y0, z0], max: [x1, y1, z1] };
}

export const boxCenter = (b: Box3): Vec3 => scale(add(b.min, b.max), 0.5);
export const boxSize = (b: Box3): Vec3 => sub(b.max, b.min);
export const boxDiagonal = (b: Box3): number => length(boxSize(b)) || 1;
