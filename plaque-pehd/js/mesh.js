/* Maillage triangulaire d'une région 2D (contour + trous).
   Delaunay (Bowyer-Watson) sur une nuée de points contour + intérieur. */
(function (root) {
  'use strict';
  const G = root.Geom;

  function circumcircle(ax, ay, bx, by, cx, cy) {
    const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    if (Math.abs(d) < 1e-14) return null;
    const a2 = ax * ax + ay * ay, b2 = bx * bx + by * by, c2 = cx * cx + cy * cy;
    const ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d;
    const uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
    const r2 = (ux - ax) * (ux - ax) + (uy - ay) * (uy - ay);
    return { x: ux, y: uy, r2 };
  }

  /* Triangulation de Delaunay d'un nuage de points. Renvoie des triplets d'indices. */
  function delaunay(points) {
    const n = points.length;
    if (n < 3) return [];
    const bb = G.bbox(points);
    const dmax = Math.max(bb.w, bb.h) || 1;
    const midx = (bb.xmin + bb.xmax) / 2, midy = (bb.ymin + bb.ymax) / 2;
    const pts = points.slice();
    pts.push([midx - 20 * dmax, midy - dmax]);
    pts.push([midx, midy + 20 * dmax]);
    pts.push([midx + 20 * dmax, midy - dmax]);
    const s0 = n, s1 = n + 1, s2 = n + 2;

    let tris = [{ v: [s0, s1, s2], cc: circumcircle(pts[s0][0], pts[s0][1], pts[s1][0], pts[s1][1], pts[s2][0], pts[s2][1]) }];

    // Insertion dans un ordre spatialement cohérent (tri par cellule) pour la vitesse.
    const order = [];
    for (let i = 0; i < n; i++) order.push(i);
    const cell = Math.max(dmax / Math.max(4, Math.sqrt(n) / 2), 1e-9);
    order.sort((i, j) => {
      const ri = Math.floor((pts[i][1] - bb.ymin) / cell), rj = Math.floor((pts[j][1] - bb.ymin) / cell);
      if (ri !== rj) return ri - rj;
      return (ri % 2 === 0) ? pts[i][0] - pts[j][0] : pts[j][0] - pts[i][0];
    });

    const edgeCount = new Map();
    for (const pi of order) {
      const px = pts[pi][0], py = pts[pi][1];
      edgeCount.clear();
      const keep = [];
      for (const t of tris) {
        const cc = t.cc;
        if (cc && (px - cc.x) * (px - cc.x) + (py - cc.y) * (py - cc.y) <= cc.r2 * (1 + 1e-12)) {
          const v = t.v;
          for (let e = 0; e < 3; e++) {
            const a = v[e], b = v[(e + 1) % 3];
            const k = a < b ? a + ',' + b : b + ',' + a;
            edgeCount.set(k, (edgeCount.get(k) || 0) + 1);
          }
        } else keep.push(t);
      }
      tris = keep;
      for (const [k, c] of edgeCount) {
        if (c !== 1) continue;
        const [a, b] = k.split(',').map(Number);
        const cc = circumcircle(pts[a][0], pts[a][1], pts[b][0], pts[b][1], px, py);
        if (cc) tris.push({ v: [a, b, pi], cc });
      }
    }

    const out = [];
    for (const t of tris) {
      if (t.v[0] >= n || t.v[1] >= n || t.v[2] >= n) continue;
      out.push(t.v);
    }
    return out;
  }

  /* Génère le maillage de la région. h = taille de maille cible (mm). */
  function meshRegion(region, h) {
    const rings = [region.outer].concat(region.holes);
    const pts = [];
    const boundaryFlag = [];
    for (const ring of rings) {
      const rs = G.resampleRing(ring, h);
      for (const p of rs) { pts.push([p[0], p[1]]); boundaryFlag.push(true); }
    }
    const nB = pts.length;

    // Points intérieurs sur grille hexagonale, écartés du bord.
    const bb = G.bbox(region.outer);
    const dy = h * Math.sqrt(3) / 2;
    const minDist = h * 0.62;
    for (let j = 0, y = bb.ymin + dy * 0.5; y < bb.ymax; j++, y = bb.ymin + dy * (j + 0.5)) {
      const off = (j % 2) ? h / 2 : 0;
      for (let x = bb.xmin + off + h * 0.5; x < bb.xmax; x += h) {
        if (!G.pointInRegion(x, y, region)) continue;
        if (G.distToBoundary(x, y, region) < minDist) continue;
        pts.push([x, y]); boundaryFlag.push(false);
      }
    }

    const tris = delaunay(pts).filter(t => {
      const cx = (pts[t[0]][0] + pts[t[1]][0] + pts[t[2]][0]) / 3;
      const cy = (pts[t[0]][1] + pts[t[1]][1] + pts[t[2]][1]) / 3;
      if (!G.pointInRegion(cx, cy, region)) return false;
      const a = area2(pts, t);
      return a > 1e-9 * h * h;
    });

    // Oriente en sens direct (aire > 0)
    for (const t of tris) {
      if (signedArea(pts, t) < 0) { const s = t[1]; t[1] = t[2]; t[2] = s; }
    }

    // Supprime les nœuds orphelins
    const used = new Array(pts.length).fill(false);
    for (const t of tris) { used[t[0]] = used[t[1]] = used[t[2]] = true; }
    const remap = new Array(pts.length).fill(-1);
    const nodes = [], isBoundary = [];
    for (let i = 0; i < pts.length; i++) {
      if (!used[i]) continue;
      remap[i] = nodes.length;
      nodes.push(pts[i]);
      isBoundary.push(i < nB);
    }
    const elems = tris.map(t => [remap[t[0]], remap[t[1]], remap[t[2]]]);

    return { nodes, elems, isBoundary, h };
  }

  function signedArea(pts, t) {
    const [a, b, c] = t;
    return ((pts[b][0] - pts[a][0]) * (pts[c][1] - pts[a][1]) - (pts[c][0] - pts[a][0]) * (pts[b][1] - pts[a][1])) / 2;
  }
  function area2(pts, t) { return Math.abs(signedArea(pts, t)); }

  function meshQuality(mesh) {
    let minAng = 180, tot = 0;
    for (const t of mesh.elems) {
      const p = t.map(i => mesh.nodes[i]);
      for (let k = 0; k < 3; k++) {
        const a = p[k], b = p[(k + 1) % 3], c = p[(k + 2) % 3];
        const u = [b[0] - a[0], b[1] - a[1]], v = [c[0] - a[0], c[1] - a[1]];
        const ang = Math.acos(Math.max(-1, Math.min(1,
          (u[0] * v[0] + u[1] * v[1]) / (Math.hypot(u[0], u[1]) * Math.hypot(v[0], v[1]) || 1)))) * 180 / Math.PI;
        if (ang < minAng) minAng = ang;
      }
      tot += Math.abs(signedArea(mesh.nodes, t));
    }
    return { minAngle: minAng, area: tot };
  }

  root.Mesh = { delaunay, meshRegion, meshQuality, signedArea };
})(typeof window !== 'undefined' ? (window.PP = window.PP || {}) : (module.exports = {}));
