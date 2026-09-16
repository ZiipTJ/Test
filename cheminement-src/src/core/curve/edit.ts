/** Édition d'une polyligne : où insérer un point qu'on vient de poser sur la courbe. */
import { closestPointOnSegment, type Vec3 } from '../math/vec';

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
