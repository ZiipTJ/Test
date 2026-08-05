// Primitives géométriques 2D utilisées par la mesure d'objet sur photo.
// Toutes les fonctions travaillent sur des points {x, y} en pixels.

/** Enveloppe convexe (monotone chain d'Andrew), sens trigonométrique, sans point dupliqué. */
export function convexHull(points) {
  if (points.length < 3) return points.slice();
  const pts = points.slice().sort((a, b) => (a.x - b.x) || (a.y - b.y));
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/**
 * Rectangle d'aire minimale contenant les points (rotating calipers simplifié :
 * un côté du rectangle optimal est toujours porté par une arête de l'enveloppe).
 * Retourne {cx, cy, width, height, angle, corners} — width >= height, angle en radians.
 */
export function minAreaRect(points) {
  const hull = convexHull(points);
  if (hull.length === 0) return null;
  if (hull.length < 3) {
    const [a, b] = hull.length === 2 ? hull : [hull[0], hull[0]];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    return {
      cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2,
      width: len, height: 0,
      angle: Math.atan2(b.y - a.y, b.x - a.x),
      corners: [a, b, b, a],
    };
  }

  let best = null;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const edge = Math.atan2(b.y - a.y, b.x - a.x);
    const cos = Math.cos(-edge);
    const sin = Math.sin(-edge);

    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const p of hull) {
      const u = p.x * cos - p.y * sin;
      const v = p.x * sin + p.y * cos;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    const w = maxU - minU;
    const h = maxV - minV;
    const area = w * h;
    if (!best || area < best.area) best = { area, edge, minU, maxU, minV, maxV, w, h };
  }

  // Retour dans le repère image.
  const cos = Math.cos(best.edge);
  const sin = Math.sin(best.edge);
  const toImage = (u, v) => ({ x: u * cos - v * sin, y: u * sin + v * cos });
  const corners = [
    toImage(best.minU, best.minV),
    toImage(best.maxU, best.minV),
    toImage(best.maxU, best.maxV),
    toImage(best.minU, best.maxV),
  ];
  const center = toImage((best.minU + best.maxU) / 2, (best.minV + best.maxV) / 2);

  const long = Math.max(best.w, best.h);
  const short = Math.min(best.w, best.h);
  const angle = best.w >= best.h ? best.edge : best.edge + Math.PI / 2;

  return { cx: center.x, cy: center.y, width: long, height: short, angle, corners };
}

/** Diamètre de Feret maximal (plus grande distance entre deux points) + les deux points. */
export function feretMax(points) {
  const hull = convexHull(points);
  let best = { length: 0, a: hull[0] || null, b: hull[0] || null };
  for (let i = 0; i < hull.length; i++) {
    for (let j = i + 1; j < hull.length; j++) {
      const d = Math.hypot(hull[i].x - hull[j].x, hull[i].y - hull[j].y);
      if (d > best.length) best = { length: d, a: hull[i], b: hull[j] };
    }
  }
  return best;
}

/** Longueur d'une polyligne fermée. */
export function polygonPerimeter(points) {
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

/** Aire signée -> aire absolue d'un polygone (formule du lacet). */
export function polygonArea(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/**
 * Simplification Douglas-Peucker d'une polyligne fermée : réduit le contour
 * pixellisé à une forme lisible sans déformer les dimensions.
 */
export function simplifyClosed(points, tolerance) {
  if (points.length < 4 || tolerance <= 0) return points.slice();
  const open = points.slice();
  const keep = new Uint8Array(open.length);
  keep[0] = 1;
  keep[open.length - 1] = 1;

  const stack = [[0, open.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop();
    let maxDist = -1;
    let index = -1;
    const a = open[start];
    const b = open[end];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const norm = Math.hypot(dx, dy) || 1;
    for (let i = start + 1; i < end; i++) {
      const p = open[i];
      const dist = Math.abs(dy * (p.x - a.x) - dx * (p.y - a.y)) / norm;
      if (dist > maxDist) {
        maxDist = dist;
        index = i;
      }
    }
    if (maxDist > tolerance && index > 0) {
      keep[index] = 1;
      stack.push([start, index], [index, end]);
    }
  }
  return open.filter((_, i) => keep[i]);
}
