/* Géométrie 2D : polygones, contours, distances.
   Toutes les longueurs sont en millimètres. */
(function (root) {
  'use strict';

  function polygonArea(pts) {
    let a = 0;
    for (let i = 0, n = pts.length; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n];
      a += p[0] * q[1] - q[0] * p[1];
    }
    return a / 2;
  }

  function polygonCentroid(pts) {
    let a = 0, cx = 0, cy = 0;
    for (let i = 0, n = pts.length; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n];
      const f = p[0] * q[1] - q[0] * p[1];
      a += f; cx += (p[0] + q[0]) * f; cy += (p[1] + q[1]) * f;
    }
    a /= 2;
    if (Math.abs(a) < 1e-12) return [pts[0][0], pts[0][1]];
    return [cx / (6 * a), cy / (6 * a)];
  }

  function bbox(pts) {
    let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
    for (const p of pts) {
      if (p[0] < xmin) xmin = p[0];
      if (p[0] > xmax) xmax = p[0];
      if (p[1] < ymin) ymin = p[1];
      if (p[1] > ymax) ymax = p[1];
    }
    return { xmin, ymin, xmax, ymax, w: xmax - xmin, h: ymax - ymin };
  }

  /* Point dans un anneau (règle pair/impair, robuste aux sommets). */
  function pointInRing(x, y, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1];
      const xj = ring[j][0], yj = ring[j][1];
      if ((yi > y) !== (yj > y)) {
        const xInt = (xj - xi) * (y - yi) / (yj - yi) + xi;
        if (x < xInt) inside = !inside;
      }
    }
    return inside;
  }

  /* Un « Region » = contour extérieur + trous. */
  function pointInRegion(x, y, region) {
    if (!pointInRing(x, y, region.outer)) return false;
    for (const h of region.holes) if (pointInRing(x, y, h)) return false;
    return true;
  }

  function distPointSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    if (l2 < 1e-18) return Math.hypot(px - ax, py - ay);
    let t = ((px - ax) * dx + (py - ay) * dy) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  /* Distance d'un point au bord de la région (contour ext. + trous). */
  function distToBoundary(x, y, region) {
    let d = Infinity;
    const rings = [region.outer].concat(region.holes);
    for (const ring of rings) {
      for (let i = 0, n = ring.length; i < n; i++) {
        const a = ring[i], b = ring[(i + 1) % n];
        const dd = distPointSegment(x, y, a[0], a[1], b[0], b[1]);
        if (dd < d) d = dd;
      }
    }
    return d;
  }

  function ringPerimeter(ring) {
    let p = 0;
    for (let i = 0, n = ring.length; i < n; i++) {
      const a = ring[i], b = ring[(i + 1) % n];
      p += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    return p;
  }

  /* Rééchantillonne un anneau fermé à un pas ~h (garde les sommets vifs). */
  function resampleRing(ring, h, keepAngleDeg) {
    const keepCos = Math.cos((keepAngleDeg === undefined ? 25 : keepAngleDeg) * Math.PI / 180);
    const n = ring.length;
    const corner = new Array(n).fill(false);
    for (let i = 0; i < n; i++) {
      const p = ring[(i - 1 + n) % n], c = ring[i], q = ring[(i + 1) % n];
      const ux = c[0] - p[0], uy = c[1] - p[1], vx = q[0] - c[0], vy = q[1] - c[1];
      const lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
      if (lu < 1e-9 || lv < 1e-9) { corner[i] = true; continue; }
      const cosA = (ux * vx + uy * vy) / (lu * lv);
      corner[i] = cosA < keepCos;
    }
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = ring[i], b = ring[(i + 1) % n];
      out.push([a[0], a[1]]);
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const k = Math.max(1, Math.round(L / h));
      for (let j = 1; j < k; j++) {
        const t = j / k;
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
    // Supprime les doublons trop proches, sauf les angles vifs déjà inclus.
    const cleaned = [];
    for (const p of out) {
      if (!cleaned.length) { cleaned.push(p); continue; }
      const q = cleaned[cleaned.length - 1];
      if (Math.hypot(p[0] - q[0], p[1] - q[1]) > h * 0.15) cleaned.push(p);
    }
    if (cleaned.length > 2) {
      const f = cleaned[0], l = cleaned[cleaned.length - 1];
      if (Math.hypot(f[0] - l[0], f[1] - l[1]) < h * 0.15) cleaned.pop();
    }
    return cleaned;
  }

  /* Simplification Douglas-Peucker d'un anneau fermé. */
  function simplifyRing(ring, tol) {
    if (ring.length < 4) return ring.slice();
    function dp(pts, first, last, keep) {
      let maxD = -1, idx = -1;
      const a = pts[first], b = pts[last];
      for (let i = first + 1; i < last; i++) {
        const d = distPointSegment(pts[i][0], pts[i][1], a[0], a[1], b[0], b[1]);
        if (d > maxD) { maxD = d; idx = i; }
      }
      if (maxD > tol) { dp(pts, first, idx, keep); keep[idx] = true; dp(pts, idx, last, keep); }
    }
    const pts = ring.concat([ring[0]]);
    const keep = new Array(pts.length).fill(false);
    keep[0] = keep[pts.length - 1] = true;
    dp(pts, 0, pts.length - 1, keep);
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) if (keep[i]) out.push(pts[i]);
    return out.length >= 3 ? out : ring.slice();
  }

  /* Chaîne des arêtes de bord (paires d'indices de sommets) en anneaux fermés. */
  function chainEdges(edges, points) {
    const adj = new Map();
    const add = (a, b) => {
      if (!adj.has(a)) adj.set(a, []);
      adj.get(a).push(b);
    };
    for (const [a, b] of edges) { add(a, b); add(b, a); }
    const used = new Set();
    const key = (a, b) => (a < b ? a + '_' + b : b + '_' + a);
    const loops = [];
    for (const [a, b] of edges) {
      if (used.has(key(a, b))) continue;
      const loop = [a];
      used.add(key(a, b));
      let prev = a, cur = b;
      let guard = 0;
      while (cur !== a && guard++ < edges.length * 3) {
        loop.push(cur);
        const nbrs = adj.get(cur) || [];
        let next = -1;
        for (const nb of nbrs) {
          if (nb === prev) continue;
          if (used.has(key(cur, nb))) continue;
          next = nb; break;
        }
        if (next < 0) break;
        used.add(key(cur, next));
        prev = cur; cur = next;
      }
      if (loop.length >= 3) loops.push(loop.map(i => [points[i][0], points[i][1]]));
    }
    return loops;
  }

  /* Construit une région (contour + trous) à partir d'anneaux quelconques. */
  function ringsToRegion(rings) {
    const valid = rings.filter(r => r.length >= 3 && Math.abs(polygonArea(r)) > 1e-6);
    if (!valid.length) return null;
    valid.sort((a, b) => Math.abs(polygonArea(b)) - Math.abs(polygonArea(a)));
    const outer = valid[0];
    const holes = [];
    for (let i = 1; i < valid.length; i++) {
      const c = polygonCentroid(valid[i]);
      if (pointInRing(c[0], c[1], outer)) holes.push(valid[i]);
    }
    const ccw = (r) => (polygonArea(r) < 0 ? r.slice().reverse() : r);
    const cw = (r) => (polygonArea(r) > 0 ? r.slice().reverse() : r);
    return { outer: ccw(outer), holes: holes.map(cw) };
  }

  function regionArea(region) {
    let a = Math.abs(polygonArea(region.outer));
    for (const h of region.holes) a -= Math.abs(polygonArea(h));
    return a;
  }

  root.Geom = {
    polygonArea, polygonCentroid, bbox, pointInRing, pointInRegion,
    distPointSegment, distToBoundary, ringPerimeter, resampleRing,
    simplifyRing, chainEdges, ringsToRegion, regionArea
  };
})(typeof window !== 'undefined' ? (window.PP = window.PP || {}) : (module.exports = {}));
