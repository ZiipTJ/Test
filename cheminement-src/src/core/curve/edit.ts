/** Édition d'une polyligne : où insérer un point qu'on vient de poser sur la courbe. */
import { add, closestPointOnSegment, cross, dot, normalize, scale, sub, type Vec3 } from '../math/vec';

/** Rang d'insertion d'un point posé sur la courbe : celui du brin le plus proche.
 *  Renvoie donc un rang compris entre 1 et `points.length - 1`, de sorte que le
 *  nouveau point s'intercale sans jamais déplacer une extrémité. */
export function insertIndexFor(points: readonly Vec3[], position: Vec3): number {
  if (points.length < 2) return points.length;
  let best = 1;
  let bestDistance = Infinity;
  for (let i = 0; i < points.length - 1; i += 1) {
    const { distance } = closestPointOnSegment(position, points[i]!, points[i + 1]!);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i + 1;
    }
  }
  return best;
}

/** Direction de la courbe au point donné : c'est l'axe « le long du fil » du
 *  trièdre de manipulation. */
export function tangentAt(points: readonly Vec3[], index: number): Vec3 {
  const n = points.length;
  if (n < 2) return [1, 0, 0];
  const i = Math.max(0, Math.min(n - 1, index));
  if (i === 0) return normalize(sub(points[1]!, points[0]!));
  if (i === n - 1) return normalize(sub(points[n - 1]!, points[n - 2]!));
  return normalize(sub(points[i + 1]!, points[i - 1]!));
}

/** Trièdre de manipulation : le long du fil, latéral, puis vertical.
 *  Le troisième axe est choisi aussi proche que possible de la verticale du
 *  modèle, pour que « soulever le point » reste un geste évident. */
export function manipulationAxes(tangent: Vec3): { along: Vec3; across: Vec3; up: Vec3 } {
  const along = normalize(tangent);
  const reference: Vec3 = Math.abs(along[2]) > 0.95 ? [1, 0, 0] : [0, 0, 1];
  const across = normalize(cross(along, reference));
  return { along, across, up: cross(across, along) };
}

/** Point de l'axe le plus proche du rayon du curseur : c'est ainsi qu'un
 *  déplacement contraint suit la souris sans quitter son axe. */
export function closestPointOnAxis(
  axisOrigin: Vec3,
  axisDirection: Vec3,
  rayOrigin: Vec3,
  rayDirection: Vec3,
): Vec3 {
  const axis = normalize(axisDirection);
  const ray = normalize(rayDirection);
  const w0 = sub(axisOrigin, rayOrigin);
  const b = dot(axis, ray);
  const denominator = 1 - b * b;
  // Axe vu de bout : aucune projection ne serait fiable, on ne bouge pas.
  if (Math.abs(denominator) < 1e-6) return axisOrigin;
  const s = (b * dot(ray, w0) - dot(axis, w0)) / denominator;
  return add(axisOrigin, scale(axis, s));
}
