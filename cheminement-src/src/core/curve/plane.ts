/** Plan de travail.
 *
 *  Un clic ne donne qu'un rayon : sans plan de référence, il n'a pas de position
 *  dans l'espace dès qu'il sort de la pièce, et un déplacement libre se met à
 *  suivre la caméra. Le plan de travail lève cette ambiguïté : il est pris sur la
 *  face que l'on vient de toucher, et tout ce qui se pose hors matière se pose
 *  dedans.
 */
import { add, dot, normalize, scale, sub, type Vec3 } from '../math/vec';

export interface Plane {
  origin: Vec3;
  /** Normale unitaire. */
  normal: Vec3;
}

export const GROUND_PLANE: Plane = { origin: [0, 0, 0], normal: [0, 0, 1] };

/** Distance signée d'un point au plan. */
export function distanceToPlane(point: Vec3, plane: Plane): number {
  return dot(sub(point, plane.origin), plane.normal);
}

export function projectOnPlane(point: Vec3, plane: Plane): Vec3 {
  return sub(point, scale(plane.normal, distanceToPlane(point, plane)));
}

/** Intersection d'un rayon et du plan ; nulle si le rayon lui est parallèle ou
 *  si le plan est derrière la caméra. */
export function intersectRayPlane(origin: Vec3, direction: Vec3, plane: Plane): Vec3 | null {
  const ray = normalize(direction);
  const denominator = dot(ray, plane.normal);
  if (Math.abs(denominator) < 1e-6) return null;
  const t = dot(sub(plane.origin, origin), plane.normal) / denominator;
  if (t <= 0) return null;
  return add(origin, scale(ray, t));
}

const round = (value: number): string => {
  const fixed = Math.abs(value) < 0.05 ? 0 : value;
  return fixed.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
};

/** Libellé lisible : c'est ce qui dit à l'utilisateur dans quel plan il travaille. */
export function describePlane(plane: Plane): string {
  const [nx, ny, nz] = plane.normal;
  if (Math.abs(nz) > 0.95) return `plan horizontal Z = ${round(plane.origin[2])} mm`;
  if (Math.abs(nx) > 0.95) return `plan vertical X = ${round(plane.origin[0])} mm`;
  if (Math.abs(ny) > 0.95) return `plan vertical Y = ${round(plane.origin[1])} mm`;
  return 'plan incliné';
}

/** Plan parallèle passant par un autre point : c'est celui dans lequel on
 *  continue un tracé, ou dans lequel un point se déplace. */
export function planeThrough(point: Vec3, plane: Plane): Plane {
  return { origin: point, normal: plane.normal };
}
