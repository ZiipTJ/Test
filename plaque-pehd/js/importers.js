/* Import de géométrie : STL (binaire + ASCII) et STEP (AP203/AP214, faces planes).
   Objectif : extraire le contour 2D de la grande face de la plaque + son épaisseur. */
(function (root) {
  'use strict';
  const G = root.Geom;

  /* ================= Algèbre 3D ================= */
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const norm = (a) => Math.hypot(a[0], a[1], a[2]);
  const unit = (a) => { const n = norm(a) || 1; return [a[0] / n, a[1] / n, a[2] / n]; };

  /* Base orthonormée d'un plan de normale n. */
  function planeBasis(n) {
    const N = unit(n);
    let ref = Math.abs(N[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const U = unit(cross(ref, N));
    const V = cross(N, U);
    return { N, U, V };
  }

  /* Jacobi : plus petite direction principale d'un nuage (= normale de la plaque). */
  function smallestPrincipalDirection(pts) {
    let cx = 0, cy = 0, cz = 0;
    for (const p of pts) { cx += p[0]; cy += p[1]; cz += p[2]; }
    const n = pts.length || 1;
    cx /= n; cy /= n; cz /= n;
    let a = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (const p of pts) {
      const d = [p[0] - cx, p[1] - cy, p[2] - cz];
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) a[i][j] += d[i] * d[j];
    }
    let v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    for (let sweep = 0; sweep < 60; sweep++) {
      let p = 0, q = 1, best = 0;
      for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++)
        if (Math.abs(a[i][j]) > best) { best = Math.abs(a[i][j]); p = i; q = j; }
      if (best < 1e-12) break;
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      const A = a.map(r => r.slice());
      for (let k = 0; k < 3; k++) {
        A[p][k] = c * a[p][k] - s * a[q][k];
        A[q][k] = s * a[p][k] + c * a[q][k];
      }
      const B = A.map(r => r.slice());
      for (let k = 0; k < 3; k++) {
        B[k][p] = c * A[k][p] - s * A[k][q];
        B[k][q] = s * A[k][p] + c * A[k][q];
      }
      a = B;
      const V2 = v.map(r => r.slice());
      for (let k = 0; k < 3; k++) {
        V2[k][p] = c * v[k][p] - s * v[k][q];
        V2[k][q] = s * v[k][p] + c * v[k][q];
      }
      v = V2;
    }
    let imin = 0;
    for (let i = 1; i < 3; i++) if (a[i][i] < a[imin][imin]) imin = i;
    return unit([v[0][imin], v[1][imin], v[2][imin]]);
  }

  /* ================= STL ================= */
  function parseSTL(buffer) {
    const dv = new DataView(buffer);
    const nTriHeader = buffer.byteLength >= 84 ? dv.getUint32(80, true) : 0;
    const isBinary = buffer.byteLength === 84 + nTriHeader * 50 && nTriHeader > 0;
    const tris = [];
    if (isBinary) {
      let off = 84;
      for (let i = 0; i < nTriHeader; i++) {
        const nx = dv.getFloat32(off, true), ny = dv.getFloat32(off + 4, true), nz = dv.getFloat32(off + 8, true);
        const v = [];
        for (let k = 0; k < 3; k++) {
          const o = off + 12 + k * 12;
          v.push([dv.getFloat32(o, true), dv.getFloat32(o + 4, true), dv.getFloat32(o + 8, true)]);
        }
        tris.push({ n: [nx, ny, nz], v });
        off += 50;
      }
    } else {
      const txt = new TextDecoder().decode(buffer);
      const re = /facet\s+normal\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)[\s\S]*?outer\s+loop([\s\S]*?)endloop/g;
      let m;
      while ((m = re.exec(txt))) {
        const n = [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])];
        const vre = /vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)/g;
        const v = []; let vm;
        while ((vm = vre.exec(m[4]))) v.push([parseFloat(vm[1]), parseFloat(vm[2]), parseFloat(vm[3])]);
        if (v.length === 3) tris.push({ n, v });
      }
    }
    if (!tris.length) throw new Error('Fichier STL illisible ou vide.');
    return tris;
  }

  /* Extrait le contour de la grande face d'une plaque maillée. */
  function plateFromTriangles(tris, opts) {
    opts = opts || {};
    const allPts = [];
    for (const t of tris) for (const v of t.v) allPts.push(v);
    const N0 = smallestPrincipalDirection(allPts);

    // Épaisseur = étendue selon N0
    let hmin = Infinity, hmax = -Infinity;
    for (const p of allPts) { const h = dot(p, N0); if (h < hmin) hmin = h; if (h > hmax) hmax = h; }
    const thickness = hmax - hmin;

    const basis = planeBasis(N0);

    // Sélection de la face supérieure
    function faceLoops(sign) {
      const sel = [];
      for (const t of tris) {
        let n = t.n;
        if (norm(n) < 1e-9) n = cross(sub(t.v[1], t.v[0]), sub(t.v[2], t.v[0]));
        n = unit(n);
        if (dot(n, basis.N) * sign > 0.7) sel.push(t);
      }
      if (!sel.length) return null;
      // Soudure des sommets et extraction des arêtes de bord
      const key = new Map();
      const pts2 = [];
      const tol = Math.max(1e-6, (hmax - hmin) * 1e-3);
      const idOf = (p) => {
        const u = dot(p, basis.U), v = dot(p, basis.V);
        const k = Math.round(u / tol) + '_' + Math.round(v / tol);
        if (key.has(k)) return key.get(k);
        key.set(k, pts2.length); pts2.push([u, v]);
        return pts2.length - 1;
      };
      const edgeCount = new Map();
      for (const t of sel) {
        const a = idOf(t.v[0]), b = idOf(t.v[1]), c = idOf(t.v[2]);
        for (const [i, j] of [[a, b], [b, c], [c, a]]) {
          if (i === j) continue;
          const k = i < j ? i + ',' + j : j + ',' + i;
          edgeCount.set(k, (edgeCount.get(k) || 0) + 1);
        }
      }
      const edges = [];
      for (const [k, c] of edgeCount) if (c === 1) { const [i, j] = k.split(',').map(Number); edges.push([i, j]); }
      if (!edges.length) return null;
      const loops = G.chainEdges(edges, pts2);
      return loops.length ? loops : null;
    }

    let loops = faceLoops(+1) || faceLoops(-1);
    if (!loops) throw new Error("Impossible d'identifier la grande face de la plaque dans ce maillage.");

    const bb0 = G.bbox(loops[0]);
    const tolSimplify = opts.simplifyTol !== undefined
      ? opts.simplifyTol : Math.max(0.05, Math.max(bb0.w, bb0.h) * 2e-4);
    loops = loops.map(l => G.simplifyRing(l, tolSimplify));
    const region = G.ringsToRegion(loops);
    if (!region) throw new Error('Contour de plaque invalide.');
    return { region, thickness, normal: N0, source: 'STL', nTriangles: tris.length };
  }

  function importSTL(buffer, opts) {
    return plateFromTriangles(parseSTL(buffer), opts);
  }

  /* ================= STEP ================= */
  function tokenizeArgs(s) {
    const out = [];
    let depth = 0, cur = '', inStr = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (inStr) { cur += c; if (c === "'") inStr = false; continue; }
      if (c === "'") { inStr = true; cur += c; continue; }
      if (c === '(') { depth++; cur += c; continue; }
      if (c === ')') { depth--; cur += c; continue; }
      if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
      cur += c;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }

  function parseSTEP(text) {
    const ents = new Map();
    // Retire les commentaires /* ... */
    text = text.replace(/\/\*[\s\S]*?\*\//g, ' ');
    const re = /#(\d+)\s*=\s*([A-Z_0-9]+)\s*\(([\s\S]*?)\)\s*;/g;
    let m;
    while ((m = re.exec(text))) {
      ents.set(+m[1], { type: m[2], args: tokenizeArgs(m[3]) });
    }
    // Entités complexes : #12 = ( A(..) B(..) ) ;
    const re2 = /#(\d+)\s*=\s*\(([\s\S]*?)\)\s*;/g;
    while ((m = re2.exec(text))) {
      if (ents.has(+m[1])) continue;
      ents.set(+m[1], { type: 'COMPLEX', args: [], raw: m[2] });
    }
    return ents;
  }

  function stepUnitScale(ents, text) {
    // Détecte pouce / mètre / centimètre ; défaut millimètre.
    for (const [, e] of ents) {
      if (e.type === 'CONVERSION_BASED_UNIT' && /INCH/i.test(e.args.join(','))) return 25.4;
    }
    if (/CONVERSION_BASED_UNIT\s*\(\s*'INCH'/i.test(text)) return 25.4;
    for (const [, e] of ents) {
      if (/SI_UNIT/.test(e.type)) {
        const a = e.args.join(',');
        if (/METRE/.test(a) && !/MILLI|CENTI/.test(a)) return 1000;
        if (/CENTI/.test(a)) return 10;
      }
    }
    return 1;
  }

  function importSTEP(text, opts) {
    opts = opts || {};
    const ents = parseSTEP(text);
    const scale = stepUnitScale(ents, text);
    const ref = (s) => (typeof s === 'string' && s[0] === '#') ? ents.get(+s.slice(1)) : null;
    const refId = (s) => +String(s).slice(1);
    const listRefs = (s) => String(s).replace(/^\(|\)$/g, '').split(',').map(x => x.trim()).filter(x => x[0] === '#');

    const pointCache = new Map();
    function point(id) {
      if (pointCache.has(id)) return pointCache.get(id);
      const e = ents.get(id);
      if (!e) return null;
      let p = null;
      if (e.type === 'CARTESIAN_POINT') {
        const nums = String(e.args[1]).replace(/[()]/g, '').split(',').map(parseFloat);
        p = [(nums[0] || 0) * scale, (nums[1] || 0) * scale, (nums[2] || 0) * scale];
      } else if (e.type === 'VERTEX_POINT') {
        p = point(refId(e.args[1]));
      }
      pointCache.set(id, p);
      return p;
    }
    function direction(id) {
      const e = ents.get(id);
      if (!e) return null;
      if (e.type === 'DIRECTION') {
        const nums = String(e.args[1]).replace(/[()]/g, '').split(',').map(parseFloat);
        return unit([nums[0] || 0, nums[1] || 0, nums[2] || 0]);
      }
      return null;
    }
    function placement(id) {
      const e = ents.get(id);
      if (!e || !/AXIS2_PLACEMENT_3D/.test(e.type)) return null;
      const loc = point(refId(e.args[1]));
      const axis = e.args[2] && e.args[2] !== '$' ? direction(refId(e.args[2])) : [0, 0, 1];
      const refd = e.args[3] && e.args[3] !== '$' ? direction(refId(e.args[3])) : null;
      return { loc, axis: axis || [0, 0, 1], ref: refd };
    }

    /* Discrétise une arête entre deux sommets selon sa courbe support. */
    function edgePoints(edgeCurveId, orientedSense, sagitta) {
      const e = ents.get(edgeCurveId);
      if (!e || e.type !== 'EDGE_CURVE') return null;
      let p1 = point(refId(e.args[1]));
      let p2 = point(refId(e.args[2]));
      const curve = ents.get(refId(e.args[3]));
      const sameSense = /\.T\./.test(e.args[4] || '.T.');
      let sense = sameSense;
      if (!orientedSense) sense = !sense;
      if (!p1 || !p2) return null;
      let pts = [p1];
      if (curve && curve.type === 'CIRCLE') {
        const pl = placement(refId(curve.args[1]));
        const R = parseFloat(curve.args[2]) * scale;
        if (pl && pl.loc) {
          const N = unit(pl.axis);
          let U = pl.ref ? unit(pl.ref) : planeBasis(N).U;
          U = unit(sub(U, [N[0] * dot(U, N), N[1] * dot(U, N), N[2] * dot(U, N)]));
          const V = cross(N, U);
          const ang = (p) => {
            const d = sub(p, pl.loc);
            return Math.atan2(dot(d, V), dot(d, U));
          };
          let a1 = ang(p1), a2 = ang(p2);
          let sweep = a2 - a1;
          const ccw = sameSense;
          if (ccw) { while (sweep <= 1e-9) sweep += 2 * Math.PI; }
          else { while (sweep >= -1e-9) sweep -= 2 * Math.PI; }
          if (Math.abs(Math.hypot(...sub(p1, p2))) < 1e-9) sweep = ccw ? 2 * Math.PI : -2 * Math.PI;
          const sag = sagitta || Math.max(R / 40, 0.2);
          const dTheta = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - Math.min(sag / R, 1))));
          const nSeg = Math.max(2, Math.min(256, Math.ceil(Math.abs(sweep) / Math.max(dTheta, 0.02))));
          for (let i = 1; i < nSeg; i++) {
            const a = a1 + sweep * i / nSeg;
            pts.push([
              pl.loc[0] + R * (U[0] * Math.cos(a) + V[0] * Math.sin(a)),
              pl.loc[1] + R * (U[1] * Math.cos(a) + V[1] * Math.sin(a)),
              pl.loc[2] + R * (U[2] * Math.cos(a) + V[2] * Math.sin(a))]);
          }
        }
      } else if (curve && /B_SPLINE_CURVE/.test(curve.type)) {
        // Approximation par le polygone de contrôle (suffisant pour un contour de plaque)
        const cps = listRefs(curve.args[2] || '()').map(s => point(refId(s))).filter(Boolean);
        if (cps.length > 2) for (let i = 1; i < cps.length - 1; i++) pts.push(cps[i]);
      }
      pts.push(p2);
      if (!sense) pts.reverse();
      return pts;
    }

    /* Boucles d'une face. */
    function boundLoop(boundId, sagitta) {
      const b = ents.get(boundId);
      if (!b || !/FACE_(OUTER_)?BOUND/.test(b.type)) return null;
      const loopE = ents.get(refId(b.args[1]));
      const boundOrient = /\.T\./.test(b.args[2] || '.T.');
      if (!loopE || loopE.type !== 'EDGE_LOOP') return null;
      const oriented = listRefs(loopE.args[1]);
      const pts = [];
      for (const oe of oriented) {
        const o = ents.get(refId(oe));
        if (!o || o.type !== 'ORIENTED_EDGE') continue;
        const sense = /\.T\./.test(o.args[4] || '.T.');
        const ep = edgePoints(refId(o.args[3]), sense, sagitta);
        if (!ep) continue;
        for (const p of ep) {
          if (!pts.length || Math.hypot(...sub(p, pts[pts.length - 1])) > 1e-7) pts.push(p);
        }
      }
      if (pts.length > 2 && Math.hypot(...sub(pts[0], pts[pts.length - 1])) < 1e-7) pts.pop();
      if (pts.length < 3) return null;
      return boundOrient ? pts : pts.reverse();
    }

    /* Toutes les faces planes, la plus grande d'abord. */
    const faces = [];
    for (const [id, e] of ents) {
      if (e.type !== 'ADVANCED_FACE' && e.type !== 'FACE_SURFACE') continue;
      const surf = ents.get(refId(e.args[2]));
      if (!surf || surf.type !== 'PLANE') continue;
      const pl = placement(refId(surf.args[1]));
      if (!pl) continue;
      const bounds = listRefs(e.args[1]);
      const rings3d = [];
      for (const bId of bounds) {
        const lp = boundLoop(refId(bId), opts.sagitta);
        if (lp) rings3d.push({ pts: lp, outer: /OUTER/.test((ents.get(refId(bId)) || {}).type || '') });
      }
      if (!rings3d.length) continue;
      const basis = planeBasis(pl.axis);
      const rings2d = rings3d.map(r => ({
        outer: r.outer,
        ring: r.pts.map(p => [dot(sub(p, pl.loc), basis.U), dot(sub(p, pl.loc), basis.V)])
      }));
      let area = 0;
      for (const r of rings2d) area += (r.outer ? 1 : -1) * Math.abs(G.polygonArea(r.ring));
      faces.push({ id, area: Math.abs(area), rings2d, basis, origin: pl.loc, normal: basis.N });
    }
    if (!faces.length) throw new Error(
      "Aucune face plane exploitable trouvée dans ce STEP. Utilisez un export STL, ou saisissez la géométrie manuellement.");
    faces.sort((a, b) => b.area - a.area);
    const f = faces[0];

    // Épaisseur = écart entre la face retenue et la face parallèle opposée la plus éloignée
    let thickness = 0;
    for (const g of faces) {
      if (Math.abs(Math.abs(dot(g.normal, f.normal)) - 1) > 1e-3) continue;
      const d = Math.abs(dot(sub(g.origin, f.origin), f.normal));
      if (d > thickness && d < Math.sqrt(f.area)) thickness = d;
    }

    const rings = f.rings2d.map(r => r.ring);
    const bb0 = G.bbox(rings[0]);
    const tolSimplify = opts.simplifyTol !== undefined
      ? opts.simplifyTol : Math.max(0.02, Math.max(bb0.w, bb0.h) * 1e-4);
    const region = G.ringsToRegion(rings.map(r => G.simplifyRing(r, tolSimplify)));
    if (!region) throw new Error('Contour STEP invalide.');
    return {
      region, thickness, normal: f.normal, source: 'STEP',
      nFaces: faces.length, unitScale: scale
    };
  }

  /* Géométries paramétriques de secours. */
  function rectangle(a, b) {
    return { region: { outer: [[0, 0], [a, 0], [a, b], [0, b]], holes: [] }, thickness: 0, source: 'manuel' };
  }
  function disc(R, n) {
    const ring = [];
    n = n || 96;
    for (let i = 0; i < n; i++) { const t = 2 * Math.PI * i / n; ring.push([R * Math.cos(t), R * Math.sin(t)]); }
    return { region: { outer: ring, holes: [] }, thickness: 0, source: 'manuel' };
  }

  root.Importers = {
    importSTL, importSTEP, parseSTL, parseSTEP, plateFromTriangles,
    rectangle, disc, planeBasis, smallestPrincipalDirection
  };
})(typeof window !== 'undefined' ? (window.PP = window.PP || {}) : (module.exports = {}));
