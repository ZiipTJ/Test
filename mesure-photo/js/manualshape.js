// Forme définie à la main par une suite de points cliqués sur le contour.
//
// Deux points de méthode importants :
//
// 1. Relier les points par des segments droits interdirait toute lecture de
//    rayon : la courbure serait nulle partout et infinie aux sommets. On fait
//    donc passer une spline de Catmull-Rom centripète par les points, ce qui
//    redonne une courbure continue exploitable par la décomposition en arcs.
// 2. La variante centripète (alpha = 0,5) est choisie pour sa propriété
//    d'absence de boucle ni de rebroussement, y compris quand deux points
//    cliqués sont très proches — ce qui arrive vite à la main.

import { minAreaRect, feretMax, polygonPerimeter, polygonArea, simplifyClosed } from './geometry.js';

/**
 * Échantillonne un contour fermé passant par les points.
 * @param smooth 0 = polygone à segments droits, 1 = spline lissée
 */
export function sampleClosedPath(points, { smooth = 1, spacing = 2 } = {}) {
  const n = points.length;
  if (n < 3) return points.slice();

  const out = [];
  const at = (i) => points[(i % n + n) % n];

  for (let i = 0; i < n; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);

    const segLen = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const steps = Math.max(2, Math.ceil(segLen / spacing));

    // Paramétrage centripète : t_{k+1} = t_k + |p_{k+1} - p_k|^0.5
    const d = (a, b) => Math.sqrt(Math.hypot(b.x - a.x, b.y - a.y)) || 1e-6;
    const t0 = 0;
    const t1 = t0 + d(p0, p1);
    const t2 = t1 + d(p1, p2);
    const t3 = t2 + d(p2, p3);

    for (let s = 0; s < steps; s++) {
      const u = s / steps;
      const t = t1 + (t2 - t1) * u;

      // Interpolation de Barry-Goldman
      const lerp = (a, b, ta, tb) => {
        const w = (t - ta) / (tb - ta || 1e-6);
        return { x: a.x + (b.x - a.x) * w, y: a.y + (b.y - a.y) * w };
      };
      const a1 = lerp(p0, p1, t0, t1);
      const a2 = lerp(p1, p2, t1, t2);
      const a3 = lerp(p2, p3, t2, t3);
      const b1 = { x: a1.x + (a2.x - a1.x) * ((t - t0) / (t2 - t0 || 1e-6)), y: a1.y + (a2.y - a1.y) * ((t - t0) / (t2 - t0 || 1e-6)) };
      const b2 = { x: a2.x + (a3.x - a2.x) * ((t - t1) / (t3 - t1 || 1e-6)), y: a2.y + (a3.y - a2.y) * ((t - t1) / (t3 - t1 || 1e-6)) };
      const spline = {
        x: b1.x + (b2.x - b1.x) * ((t - t1) / (t2 - t1 || 1e-6)),
        y: b1.y + (b2.y - b1.y) * ((t - t1) / (t2 - t1 || 1e-6)),
      };

      const straight = { x: p1.x + (p2.x - p1.x) * u, y: p1.y + (p2.y - p1.y) * u };
      out.push({
        x: straight.x + (spline.x - straight.x) * smooth,
        y: straight.y + (spline.y - straight.y) * smooth,
      });
    }
  }
  return out;
}

/** Rasterise un polygone fermé dans un masque (règle pair-impair). */
export function rasterizePolygon(points, width, height) {
  const mask = new Uint8Array(width * height);
  if (points.length < 3) return mask;

  let minY = Infinity, maxY = -Infinity;
  for (const p of points) {
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  for (let y = Math.max(0, Math.floor(minY)); y <= Math.min(height - 1, Math.ceil(maxY)); y++) {
    const xs = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) {
        xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.round(xs[k]));
      const to = Math.min(width - 1, Math.round(xs[k + 1]));
      for (let x = from; x <= to; x++) mask[y * width + x] = 1;
    }
  }
  return mask;
}

/**
 * Construit un objet mesurable à partir des points cliqués, dans la même forme
 * que ceux produits par la détection automatique — les panneaux de cotes, de
 * rayons et l'export 3D s'en servent sans rien savoir de leur origine.
 */
export function shapeFromPoints(points, options = {}) {
  if (!points || points.length < 3) return null;
  const contour = sampleClosedPath(points, {
    smooth: options.smooth ?? 1,
    spacing: options.spacing ?? 2,
  });
  if (contour.length < 8) return null;

  const rect = minAreaRect(contour);
  const feret = feretMax(contour);
  const perimeter = polygonPerimeter(contour);
  const area = polygonArea(contour);

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of contour) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }

  const rectArea = rect ? rect.width * rect.height : 0;
  return {
    id: -1,
    manual: true,
    contour,
    outline: simplifyClosed(contour, 1.0),
    holes: [],
    hull: [],
    rect,
    feret,
    touchesBorder: false,
    px: {
      length: rect ? rect.width : 0,
      width: rect ? rect.height : 0,
      angle: rect ? rect.angle : 0,
      bboxWidth: maxX - minX,
      bboxHeight: maxY - minY,
      diagonal: feret.length,
      perimeter,
      areaNet: area,
      areaGross: area,
      holeArea: 0,
      equivalentDiameter: Math.sqrt((4 * area) / Math.PI),
    },
    ratios: {
      fill: rectArea ? area / rectArea : 0,
      circularity: perimeter ? (4 * Math.PI * area) / (perimeter * perimeter) : 0,
      holes: 0,
    },
  };
}
