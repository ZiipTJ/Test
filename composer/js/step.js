/* Tessellation STEP (AP203/AP214/AP242).

   Le fichier décrit des surfaces exactes : on les facettise pour l'affichage.
   Surfaces traitées : plan, cylindre, cône, sphère, tore. Les surfaces gauches
   (B-splines) sont signalées et ignorées — pour une pièce entièrement gauche,
   l'export STL ou 3MF reste la voie sûre.

   Méthode : les arêtes sont discrétisées en 3D, projetées dans l'espace des
   paramètres (u,v) de la surface porteuse, triangulées par découpe d'oreilles,
   puis chaque triangle est raffiné tant que la corde s'écarte trop de la
   surface réelle. */
(function (root) {
  'use strict';
  const { V } = root.M3D || require('./m3d.js').M3D;

  /* ================= Analyse lexicale ================= */
  function splitArgs(s) {
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

  function parseEntities(text) {
    const ents = new Map();
    text = text.replace(/\/\*[\s\S]*?\*\//g, ' ');
    const re = /#(\d+)\s*=\s*([A-Z_0-9]+)\s*\(([\s\S]*?)\)\s*;/g;
    let m;
    while ((m = re.exec(text))) ents.set(+m[1], { type: m[2], args: splitArgs(m[3]) });
    const re2 = /#(\d+)\s*=\s*\(([\s\S]*?)\)\s*;/g;
    while ((m = re2.exec(text))) {
      if (!ents.has(+m[1])) ents.set(+m[1], { type: 'COMPLEX', args: [], raw: m[2] });
    }
    return ents;
  }

  /* ================= Découpe d'oreilles avec trous (2D) ================= */
  const area2 = (poly) => {
    let a = 0;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++)
      a += (poly[j][0] - poly[i][0]) * (poly[j][1] + poly[i][1]);
    return a / 2;
  };

  /* Qualité d'un triangle : 4*sqrt(3)*aire / somme des carrés des côtés.
     Vaut 1 pour l'équilatéral, tend vers 0 pour un triangle dégénéré. */
  function earQuality(a, b, c) {
    const ab = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
    const bc = (c[0] - b[0]) ** 2 + (c[1] - b[1]) ** 2;
    const ca = (a[0] - c[0]) ** 2 + (a[1] - c[1]) ** 2;
    const cr = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const s = ab + bc + ca;
    return s > 0 ? 2 * Math.sqrt(3) * cr / s : 0;
  }

  const same2 = (p, q) => Math.abs(p[0] - q[0]) < 1e-12 && Math.abs(p[1] - q[1]) < 1e-12;

  function pointInTriangle(p, a, b, c) {
    const d1 = (p[0] - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (p[1] - b[1]);
    const d2 = (p[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (p[1] - c[1]);
    const d3 = (p[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (p[1] - a[1]);
    const neg = (d1 < 0) || (d2 < 0) || (d3 < 0);
    const pos = (d1 > 0) || (d2 > 0) || (d3 > 0);
    return !(neg && pos);
  }

  /* Raccorde chaque trou au contour extérieur par un pont, comme le fait un
     mailleur classique : le polygone devient simplement connexe. */
  function bridgeHoles(outer, holes) {
    let poly = outer.slice();
    const sorted = holes.slice().sort((h1, h2) => Math.max(...h2.map(p => p[0])) - Math.max(...h1.map(p => p[0])));
    for (const holeRaw of sorted) {
      const hole = holeRaw.slice();
      let hi = 0;
      for (let i = 1; i < hole.length; i++) if (hole[i][0] > hole[hi][0]) hi = i;
      const H = hole[hi];
      /* Sommet du contour visible depuis H : le plus proche vers la droite. */
      let best = -1, bestD = Infinity;
      for (let i = 0; i < poly.length; i++) {
        const d = (poly[i][0] - H[0]) ** 2 + (poly[i][1] - H[1]) ** 2;
        if (poly[i][0] < H[0] - 1e-12) continue;
        let blocked = false;
        for (let k = 0, j = poly.length - 1; k < poly.length && !blocked; j = k++) {
          if (k === i || j === i) continue;
          blocked = segmentsCross(H, poly[i], poly[j], poly[k]);
        }
        if (!blocked && d < bestD) { bestD = d; best = i; }
      }
      if (best < 0) {
        best = 0; bestD = Infinity;
        for (let i = 0; i < poly.length; i++) {
          const d = (poly[i][0] - H[0]) ** 2 + (poly[i][1] - H[1]) ** 2;
          if (d < bestD) { bestD = d; best = i; }
        }
      }
      const rotated = hole.slice(hi).concat(hole.slice(0, hi));
      poly = poly.slice(0, best + 1)
        .concat(rotated, [rotated[0]], poly.slice(best));
    }
    return poly;
  }

  function segmentsCross(a, b, c, d) {
    const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
    const o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b);
    return o1 !== o2 && o3 !== o4 && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0;
  }

  /* Triangule un contour (+ trous) en 2D. Retourne des triplets d'indices dans
     le tableau de points renvoyé. */
  function triangulate(outer, holes) {
    if (outer.length < 3) return { pts: [], tris: [] };
    let ring = outer.slice();
    if (area2(ring) < 0) ring.reverse();
    const hs = (holes || []).map(h => { const c = h.slice(); if (area2(c) > 0) c.reverse(); return c; })
      .filter(h => h.length >= 3);
    const pts = hs.length ? bridgeHoles(ring, hs) : ring;
    const n = pts.length;
    const idx = [...Array(n).keys()];
    const tris = [];
    let guard = 0;
    while (idx.length > 3 && guard++ < n * n + 100) {
      /* On coupe l'oreille la plus « ronde » et non la première venue : sur un
         contour riche en points alignés (un cylindre déplié, par exemple), cela
         évite les éventails de triangles très allongés, dont la corde s'écarte
         beaucoup de la surface réelle. */
      let bestI = -1, bestQ = -Infinity;
      for (let i = 0; i < idx.length; i++) {
        const ia = idx[(i + idx.length - 1) % idx.length], ib = idx[i], ic = idx[(i + 1) % idx.length];
        const a = pts[ia], b = pts[ib], c = pts[ic];
        const cr = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
        if (cr <= 1e-14) continue;                       // sommet réflexe ou plat
        let ok = true;
        for (const j of idx) {
          if (j === ia || j === ib || j === ic) continue;
          const p = pts[j];
          /* Les ponts vers les trous dupliquent des sommets : un point confondu
             avec un coin de l'oreille ne doit pas la bloquer. */
          if (same2(p, a) || same2(p, b) || same2(p, c)) continue;
          if (pointInTriangle(p, a, b, c)) { ok = false; break; }
        }
        if (!ok) continue;
        const q = earQuality(a, b, c);
        if (q > bestQ) { bestQ = q; bestI = i; }
      }
      if (bestI < 0) break;                               // contour dégénéré : on s'arrête
      const ia = idx[(bestI + idx.length - 1) % idx.length], ib = idx[bestI], ic = idx[(bestI + 1) % idx.length];
      tris.push([ia, ib, ic]);
      idx.splice(bestI, 1);
    }
    if (idx.length === 3) tris.push([idx[0], idx[1], idx[2]]);
    return { pts, tris };
  }

  /* ================= Importateur ================= */
  function importSTEP(text, opts) {
    opts = opts || {};
    const ents = parseEntities(text);
    const warnings = [];
    const refId = (s) => +String(s).slice(1);
    const refs = (s) => String(s).replace(/^\(|\)$/g, '').split(',').map(x => x.trim()).filter(x => x[0] === '#');
    const nums = (s) => String(s).replace(/[()]/g, '').split(',').map(parseFloat).filter(x => isFinite(x));
    const label = (s) => (String(s).match(/^'(.*)'$/) || [, ''])[1];
    const get = (id) => ents.get(id);

    /* --- Unités --- */
    let scale = 1;
    for (const [, e] of ents) {
      if (e.type === 'CONVERSION_BASED_UNIT' && /INCH/i.test(e.args.join(','))) { scale = 25.4; break; }
      if (/LENGTH_UNIT|SI_UNIT/.test(e.type)) {
        const a = e.args.join(',');
        if (/METRE/.test(a)) {
          if (/MILLI/.test(a)) scale = 1;
          else if (/CENTI/.test(a)) scale = 10;
          else scale = 1000;
        }
      }
    }

    /* --- Primitives --- */
    const ptCache = new Map();
    function point(id) {
      if (ptCache.has(id)) return ptCache.get(id);
      const e = get(id);
      let p = null;
      if (e && e.type === 'CARTESIAN_POINT') { const n = nums(e.args[1]); p = [(n[0] || 0) * scale, (n[1] || 0) * scale, (n[2] || 0) * scale]; }
      else if (e && e.type === 'VERTEX_POINT') p = point(refId(e.args[1]));
      ptCache.set(id, p);
      return p;
    }
    function direction(id) {
      const e = get(id);
      if (!e || e.type !== 'DIRECTION') return null;
      const n = nums(e.args[1]);
      return V.unit([n[0] || 0, n[1] || 0, n[2] || 0]);
    }
    /* Repère local d'un AXIS2_PLACEMENT_3D : origine O, axe Z=N, axes X=U, Y=W. */
    function frame(id) {
      const e = get(id);
      if (!e || !/AXIS2_PLACEMENT_3D/.test(e.type)) return null;
      const O = point(refId(e.args[1])) || [0, 0, 0];
      const N = (e.args[2] && e.args[2] !== '$' && direction(refId(e.args[2]))) || [0, 0, 1];
      let U = (e.args[3] && e.args[3] !== '$' && direction(refId(e.args[3]))) || V.perp(N);
      U = V.unit(V.sub(U, V.mul(N, V.dot(U, N))));
      return { O, N, U, W: V.cross(N, U) };
    }

    /* --- Courbes --- */
    const TWO_PI = Math.PI * 2;
    function circlePoints(fr, R, p1, p2, sense, sag) {
      const ang = (p) => { const d = V.sub(p, fr.O); return Math.atan2(V.dot(d, fr.W), V.dot(d, fr.U)); };
      const a1 = ang(p1);
      let sweep = ang(p2) - a1;
      if (sense) { while (sweep <= 1e-9) sweep += TWO_PI; } else { while (sweep >= -1e-9) sweep -= TWO_PI; }
      if (V.dist(p1, p2) < 1e-7 * Math.max(1, R)) sweep = sense ? TWO_PI : -TWO_PI;
      const s = sag || Math.max(R / 60, 1e-3);
      const dTheta = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - Math.min(s / Math.max(R, 1e-9), 1))));
      const n = Math.max(2, Math.min(360, Math.ceil(Math.abs(sweep) / Math.max(dTheta, 0.02))));
      const out = [];
      for (let i = 1; i < n; i++) {
        const a = a1 + sweep * i / n;
        out.push(V.add(fr.O, V.add(V.mul(fr.U, R * Math.cos(a)), V.mul(fr.W, R * Math.sin(a)))));
      }
      return out;
    }

    /* Évaluation B-spline (de Boor), rationnelle ou non. */
    function bsplineSampler(curve) {
      let deg = parseInt(curve.args[1], 10);
      let cps = refs(curve.args[2]).map(s => point(refId(s)));
      let knots = null, mult = null, weights = null;
      if (curve.type === 'B_SPLINE_CURVE_WITH_KNOTS') {
        mult = nums(curve.args[6]); knots = nums(curve.args[7]);
      } else if (/RATIONAL/.test(curve.type) || curve.type === 'COMPLEX') {
        return null;
      }
      if (!cps.length || cps.some(p => !p)) return null;
      if (!knots || !mult) {                                   // Bézier ou uniforme : approximation par le polygone
        return { poly: cps };
      }
      const U = [];
      for (let i = 0; i < knots.length; i++) for (let k = 0; k < mult[i]; k++) U.push(knots[i]);
      if (U.length !== cps.length + deg + 1) return { poly: cps };
      const evalAt = (u) => {
        let k = deg;
        while (k < cps.length - 1 && u >= U[k + 1]) k++;
        const d = [];
        for (let j = 0; j <= deg; j++) d.push(cps[k - deg + j].slice());
        for (let r = 1; r <= deg; r++) {
          for (let j = deg; j >= r; j--) {
            const i = k - deg + j;
            const den = U[i + deg - r + 1] - U[i];
            const a = den > 1e-12 ? (u - U[i]) / den : 0;
            d[j] = V.add(V.mul(d[j - 1], 1 - a), V.mul(d[j], a));
          }
        }
        return d[deg];
      };
      return { evalAt, u0: U[deg], u1: U[U.length - deg - 1] };
    }

    let nSplineCurves = 0;
    function edgePoints(edgeId, sense, sag) {
      const e = get(edgeId);
      if (!e || e.type !== 'EDGE_CURVE') return null;
      const p1 = point(refId(e.args[1])), p2 = point(refId(e.args[2]));
      if (!p1 || !p2) return null;
      const curve = get(refId(e.args[3]));
      const same = /\.T\./.test(e.args[4] || '.T.');
      const pts = [p1];
      if (curve && curve.type === 'CIRCLE') {
        const fr = frame(refId(curve.args[1]));
        if (fr) pts.push(...circlePoints(fr, parseFloat(curve.args[2]) * scale, p1, p2, same, sag));
      } else if (curve && curve.type === 'ELLIPSE') {
        const fr = frame(refId(curve.args[1]));
        const a = parseFloat(curve.args[2]) * scale, b = parseFloat(curve.args[3]) * scale;
        if (fr) {
          const ang = (p) => { const d = V.sub(p, fr.O); return Math.atan2(V.dot(d, fr.W) / b, V.dot(d, fr.U) / a); };
          const a1 = ang(p1);
          let sweep = ang(p2) - a1;
          if (same) { while (sweep <= 1e-9) sweep += TWO_PI; } else { while (sweep >= -1e-9) sweep -= TWO_PI; }
          if (V.dist(p1, p2) < 1e-7) sweep = same ? TWO_PI : -TWO_PI;
          const n = Math.max(8, Math.ceil(Math.abs(sweep) / 0.15));
          for (let i = 1; i < n; i++) {
            const t = a1 + sweep * i / n;
            pts.push(V.add(fr.O, V.add(V.mul(fr.U, a * Math.cos(t)), V.mul(fr.W, b * Math.sin(t)))));
          }
        }
      } else if (curve && /B_SPLINE_CURVE/.test(curve.type)) {
        nSplineCurves++;
        const s = bsplineSampler(curve);
        if (s && s.evalAt) {
          const n = Math.max(8, Math.min(64, Math.ceil(V.dist(p1, p2) / Math.max(sag || 0.5, 1e-3))));
          for (let i = 1; i < n; i++) pts.push(s.evalAt(s.u0 + (s.u1 - s.u0) * i / n));
        } else if (s && s.poly) {
          for (let i = 1; i < s.poly.length - 1; i++) pts.push(s.poly[i]);
        }
      }
      pts.push(p2);
      if (!same) pts.reverse();
      if (!sense) pts.reverse();
      return pts;
    }

    function loopPoints(boundId, sag) {
      const b = get(boundId);
      if (!b || !/FACE_(OUTER_)?BOUND/.test(b.type)) return null;
      const lp = get(refId(b.args[1]));
      if (!lp || lp.type !== 'EDGE_LOOP') return null;
      const orient = /\.T\./.test(b.args[2] || '.T.');
      const pts = [];
      for (const oe of refs(lp.args[1])) {
        const o = get(refId(oe));
        if (!o || o.type !== 'ORIENTED_EDGE') continue;
        const ep = edgePoints(refId(o.args[3]), /\.T\./.test(o.args[4] || '.T.'), sag);
        if (!ep) continue;
        for (const p of ep) if (!pts.length || V.dist(p, pts[pts.length - 1]) > 1e-7) pts.push(p);
      }
      while (pts.length > 2 && V.dist(pts[0], pts[pts.length - 1]) < 1e-7) pts.pop();
      if (pts.length < 3) return null;
      return orient ? pts : pts.reverse();
    }

    /* --- Surfaces : paramétrage (u,v) <-> 3D --- */
    function surfaceOf(id) {
      const s = get(id);
      if (!s) return null;
      if (s.type === 'PLANE') {
        const fr = frame(refId(s.args[1]));
        if (!fr) return null;
        return {
          kind: 'plane', normalAt: () => fr.N, periodU: 0,
          toUV: (p) => { const d = V.sub(p, fr.O); return [V.dot(d, fr.U), V.dot(d, fr.W)]; },
          toXYZ: (u, v) => V.add(fr.O, V.add(V.mul(fr.U, u), V.mul(fr.W, v)))
        };
      }
      if (s.type === 'CYLINDRICAL_SURFACE') {
        const fr = frame(refId(s.args[1]));
        const R = parseFloat(s.args[2]) * scale;
        if (!fr) return null;
        return {
          kind: 'cylinder', periodU: TWO_PI * R,
          normalAt: (p) => { const d = V.sub(p, fr.O); return V.unit(V.sub(d, V.mul(fr.N, V.dot(d, fr.N)))); },
          toUV: (p) => {
            const d = V.sub(p, fr.O);
            return [Math.atan2(V.dot(d, fr.W), V.dot(d, fr.U)) * R, V.dot(d, fr.N)];
          },
          toXYZ: (u, v) => {
            const a = u / (R || 1);
            return V.add(fr.O, V.add(V.add(V.mul(fr.U, R * Math.cos(a)), V.mul(fr.W, R * Math.sin(a))), V.mul(fr.N, v)));
          }
        };
      }
      if (s.type === 'CONICAL_SURFACE') {
        const fr = frame(refId(s.args[1]));
        const R = parseFloat(s.args[2]) * scale, half = parseFloat(s.args[3]);
        if (!fr) return null;
        const k = Math.tan(half);
        const Rref = Math.max(R, 1e-6);
        return {
          kind: 'cone', periodU: TWO_PI * Rref,
          normalAt: (p) => {
            const d = V.sub(p, fr.O);
            const rad = V.unit(V.sub(d, V.mul(fr.N, V.dot(d, fr.N))));
            return V.unit(V.sub(rad, V.mul(fr.N, k)));
          },
          toUV: (p) => {
            const d = V.sub(p, fr.O);
            return [Math.atan2(V.dot(d, fr.W), V.dot(d, fr.U)) * Rref, V.dot(d, fr.N)];
          },
          toXYZ: (u, v) => {
            const a = u / Rref, r = R + v * k;
            return V.add(fr.O, V.add(V.add(V.mul(fr.U, r * Math.cos(a)), V.mul(fr.W, r * Math.sin(a))), V.mul(fr.N, v)));
          }
        };
      }
      if (s.type === 'SPHERICAL_SURFACE') {
        const fr = frame(refId(s.args[1]));
        const R = parseFloat(s.args[2]) * scale;
        if (!fr) return null;
        return {
          kind: 'sphere', periodU: TWO_PI * R, rangeV: [-Math.PI * R / 2, Math.PI * R / 2],
          normalAt: (p) => V.unit(V.sub(p, fr.O)),
          toUV: (p) => {
            const d = V.sub(p, fr.O);
            const z = V.dot(d, fr.N);
            return [Math.atan2(V.dot(d, fr.W), V.dot(d, fr.U)) * R, Math.asin(Math.max(-1, Math.min(1, z / (R || 1)))) * R];
          },
          toXYZ: (u, v) => {
            const a = u / (R || 1), ph = v / (R || 1);
            const r = R * Math.cos(ph);
            return V.add(fr.O, V.add(V.add(V.mul(fr.U, r * Math.cos(a)), V.mul(fr.W, r * Math.sin(a))), V.mul(fr.N, R * Math.sin(ph))));
          }
        };
      }
      if (s.type === 'TOROIDAL_SURFACE') {
        const fr = frame(refId(s.args[1]));
        const R1 = parseFloat(s.args[2]) * scale, R2 = parseFloat(s.args[3]) * scale;
        if (!fr) return null;
        return {
          kind: 'torus', periodU: TWO_PI * Math.max(R1, 1e-6), rangeV: [-Math.PI * R2, Math.PI * R2],
          normalAt: (p) => {
            const d = V.sub(p, fr.O);
            const rad = V.sub(d, V.mul(fr.N, V.dot(d, fr.N)));
            const c = V.add(fr.O, V.mul(V.unit(rad), R1));
            return V.unit(V.sub(p, c));
          },
          toUV: (p) => {
            const d = V.sub(p, fr.O);
            const x = V.dot(d, fr.U), y = V.dot(d, fr.W), z = V.dot(d, fr.N);
            const a = Math.atan2(y, x);
            return [a * Math.max(R1, 1e-6), Math.atan2(z, Math.hypot(x, y) - R1) * Math.max(R2, 1e-6)];
          },
          toXYZ: (u, v) => {
            const a = u / Math.max(R1, 1e-6), b = v / Math.max(R2, 1e-6);
            const r = R1 + R2 * Math.cos(b);
            return V.add(fr.O, V.add(V.add(V.mul(fr.U, r * Math.cos(a)), V.mul(fr.W, r * Math.sin(a))), V.mul(fr.N, R2 * Math.sin(b))));
          }
        };
      }
      return null;                                   // B-spline & co.
    }

    /* Déroule la coordonnée périodique le long du contour pour éviter le saut
       de couture (±π) qui replierait le polygone sur lui-même. */
    function unwrap(uv, period) {
      if (!period) return uv;
      const out = [uv[0].slice()];
      for (let i = 1; i < uv.length; i++) {
        let u = uv[i][0];
        const prev = out[i - 1][0];
        while (u - prev > period / 2) u -= period;
        while (prev - u > period / 2) u += period;
        out.push([u, uv[i][1]]);
      }
      /* Contour fermé : le retour au point de départ doit boucler proprement. */
      const closeGap = out[0][0] - out[out.length - 1][0];
      if (Math.abs(Math.abs(closeGap) - period) < period * 0.02) {
        // La couture est franchie une fois : c'est le cas normal d'une face pleine.
      }
      return out;
    }

    const tol = opts.tolerance || 0.15;              // écart de corde admis, en mm

    /* Densifie un contour dans l'espace des paramètres : tant qu'un segment
       s'écarte de la surface de plus que la tolérance, on le coupe en deux. */
    function densifyRing(surf, ring, tol) {
      const out = [];
      const split = (P, Q, depth) => {
        if (depth >= 6) return;
        const m = [(P[0] + Q[0]) / 2, (P[1] + Q[1]) / 2];
        const p3 = surf.toXYZ(P[0], P[1]), q3 = surf.toXYZ(Q[0], Q[1]);
        if (V.dist(surf.toXYZ(m[0], m[1]), V.lerp(p3, q3, 0.5)) <= tol) return;
        split(P, m, depth + 1);
        out.push(m);
        split(m, Q, depth + 1);
      };
      for (let i = 0; i < ring.length; i++) {
        const A = ring[i], B = ring[(i + 1) % ring.length];
        out.push(A);
        split(A, B, 0);
      }
      return out;
    }

    /* Filet de sécurité : un triangle dont la corde s'écarte encore trop de la
       surface est découpé en quatre (pas de sommet en T ainsi introduit). */
    function refine(surf, tri, out, depth) {
      const [A, B, C] = tri;
      if (depth < 3 && surf.kind !== 'plane') {
        const mid = (P, Q) => [(P[0] + Q[0]) / 2, (P[1] + Q[1]) / 2];
        const err = (P, Q) => {
          const m = mid(P, Q);
          return V.dist(surf.toXYZ(m[0], m[1]), V.lerp(surf.toXYZ(P[0], P[1]), surf.toXYZ(Q[0], Q[1]), 0.5));
        };
        if (Math.max(err(A, B), err(B, C), err(C, A)) > tol) {
          const ab = mid(A, B), bc = mid(B, C), ca = mid(C, A);
          refine(surf, [A, ab, ca], out, depth + 1);
          refine(surf, [ab, B, bc], out, depth + 1);
          refine(surf, [ca, bc, C], out, depth + 1);
          refine(surf, [ab, bc, ca], out, depth + 1);
          return;
        }
      }
      out.push(tri);
    }

    /* Face fermée sur elle-même : son contour ne contient que des coutures ou
       des pôles et se réduit, dans l'espace des paramètres, à un segment. On
       reconstruit alors la surface entière (tube, sphère, tore) par une grille. */
    function closedPatch(surf, vmin, vmax) {
      const per = surf.periodU;
      if (!per) return null;
      const Rc = per / TWO_PI;
      const step = Math.max(per / 512, Math.min(per / 12, Math.sqrt(Math.max(8 * Rc * tol, 1e-9))));
      if (surf.rangeV) { vmin = surf.rangeV[0]; vmax = surf.rangeV[1]; }
      if (!(vmax - vmin > 1e-9)) return null;
      const nu = Math.max(12, Math.min(512, Math.ceil(per / step)));
      const curvedV = surf.kind === 'sphere' || surf.kind === 'torus';
      const nv = curvedV ? Math.max(6, Math.min(256, Math.ceil((vmax - vmin) / step))) : 1;
      const out = [];
      for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
        const u0 = per * i / nu, u1 = per * (i + 1) / nu;
        const v0 = vmin + (vmax - vmin) * j / nv, v1 = vmin + (vmax - vmin) * (j + 1) / nv;
        out.push([[u0, v0], [u1, v0], [u1, v1]], [[u0, v0], [u1, v1], [u0, v1]]);
      }
      return out;
    }

    let nSkipped = 0, nClosed = 0;
    function faceTriangles(faceId) {
      const e = get(faceId);
      if (!e || (e.type !== 'ADVANCED_FACE' && e.type !== 'FACE_SURFACE')) return null;
      const surf = surfaceOf(refId(e.args[2]));
      if (!surf) { nSkipped++; return null; }
      const sameSense = /\.T\./.test(e.args[3] || '.T.');
      const bounds = [];
      for (const bId of refs(e.args[1])) {
        const pts = loopPoints(refId(bId), Math.min(tol, 0.5));
        if (!pts) continue;
        const b = get(refId(bId));
        bounds.push({ pts, outer: /OUTER/.test(b.type) });
      }
      if (!bounds.length) return null;
      /* Le contour extérieur est celui de plus grande étendue si rien ne le dit. */
      if (!bounds.some(b => b.outer)) {
        let bi = 0, bs = -1;
        bounds.forEach((b, i) => {
          const uv = b.pts.map(p => surf.toUV(p));
          const s = Math.abs(area2(unwrap(uv, surf.periodU)));
          if (s > bs) { bs = s; bi = i; }
        });
        bounds[bi].outer = true;
      }
      const outerB = bounds.find(b => b.outer);
      const outerUV = unwrap(outerB.pts.map(p => surf.toUV(p)), surf.periodU);
      let closed = null;
      if (Math.abs(area2(outerUV)) < 1e-9) {
        const vs = outerUV.map(p => p[1]);
        closed = closedPatch(surf, Math.min(...vs), Math.max(...vs));
        if (!closed) { nSkipped++; return null; }
        nClosed++;
      }
      /* Les trous sont recalés dans la même période que le contour. */
      const uCenter = outerUV.reduce((s, p) => s + p[0], 0) / outerUV.length;
      const holes = bounds.filter(b => b !== outerB).map(b => {
        let uv = unwrap(b.pts.map(p => surf.toUV(p)), surf.periodU);
        if (surf.periodU) {
          const c = uv.reduce((s, p) => s + p[0], 0) / uv.length;
          const shift = Math.round((uCenter - c) / surf.periodU) * surf.periodU;
          if (shift) uv = uv.map(p => [p[0] + shift, p[1]]);
        }
        return uv;
      });

      const densify = (ring) => surf.kind === 'plane' ? ring : densifyRing(surf, ring, tol);
      const refined = [];
      if (closed) {
        for (const t of closed) refined.push(t);
      } else {
        const { pts, tris } = triangulate(densify(outerUV), holes.map(densify));
        if (!tris.length) { nSkipped++; return null; }
        for (const t of tris) refine(surf, [pts[t[0]], pts[t[1]], pts[t[2]]], refined, 0);
      }

      const buf = [];
      for (const t of refined) {
        let P = t.map(uv => surf.toXYZ(uv[0], uv[1]));
        const n = V.cross(V.sub(P[1], P[0]), V.sub(P[2], P[0]));
        if (V.len(n) < 1e-12) continue;                 // triangle dégénéré (pôle)
        /* Orientation cohérente avec la normale de la face. */
        const ref = surf.normalAt(P[0]);
        const want = sameSense ? 1 : -1;
        if (V.dot(n, ref) * want < 0) P = [P[0], P[2], P[1]];
        for (const q of P) buf.push(q[0], q[1], q[2]);
      }
      return buf.length ? Float32Array.from(buf) : null;
    }

    /* --- Transformations d'assemblage --- */
    const IDENT = { r: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], t: [0, 0, 0] };
    const applyM = (M, p) => [
      M.r[0][0] * p[0] + M.r[0][1] * p[1] + M.r[0][2] * p[2] + M.t[0],
      M.r[1][0] * p[0] + M.r[1][1] * p[1] + M.r[1][2] * p[2] + M.t[1],
      M.r[2][0] * p[0] + M.r[2][1] * p[1] + M.r[2][2] * p[2] + M.t[2]];
    function mulM(A, B) {
      const r = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++)
        r[i][j] = A.r[i][0] * B.r[0][j] + A.r[i][1] * B.r[1][j] + A.r[i][2] * B.r[2][j];
      return { r, t: applyM(A, B.t) };
    }
    function invM(A) {
      const r = [[A.r[0][0], A.r[1][0], A.r[2][0]], [A.r[0][1], A.r[1][1], A.r[2][1]], [A.r[0][2], A.r[1][2], A.r[2][2]]];
      const t = [0, 1, 2].map(i => -(r[i][0] * A.t[0] + r[i][1] * A.t[1] + r[i][2] * A.t[2]));
      return { r, t };
    }
    const isIdentity = (M) => Math.abs(M.t[0]) + Math.abs(M.t[1]) + Math.abs(M.t[2]) < 1e-9 &&
      Math.abs(M.r[0][0] - 1) + Math.abs(M.r[1][1] - 1) + Math.abs(M.r[2][2] - 1) < 1e-9;
    function frameMatrix(id) {
      const fr = frame(id);
      if (!fr) return IDENT;
      return { r: [[fr.U[0], fr.W[0], fr.N[0]], [fr.U[1], fr.W[1], fr.N[1]], [fr.U[2], fr.W[2], fr.N[2]]], t: fr.O };
    }

    const repOfItem = new Map();
    for (const [id, e] of ents) {
      if (!/SHAPE_REPRESENTATION|REPRESENTATION$/.test(e.type)) continue;
      for (const it of refs(e.args[1] || '()')) repOfItem.set(refId(it), id);
    }
    const parentOf = new Map();
    let nTransforms = 0;
    for (const [, e] of ents) {
      if (e.type !== 'COMPLEX' || !/REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION/.test(e.raw || '')) continue;
      const rr = (e.raw.match(/REPRESENTATION_RELATIONSHIP\s*\(([^)]*)\)/) || [])[1];
      const tr = (e.raw.match(/REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION\s*\(([^)]*)\)/) || [])[1];
      if (!rr || !tr) continue;
      const a = splitArgs(rr), b = splitArgs(tr)[0];
      const child = refId(a[2]), parent = refId(a[3]);
      const idt = get(refId(b));
      let M = IDENT;
      if (idt && idt.type === 'ITEM_DEFINED_TRANSFORMATION') {
        M = mulM(frameMatrix(refId(idt.args[3])), invM(frameMatrix(refId(idt.args[2]))));
        if (!isIdentity(M)) nTransforms++;
      }
      parentOf.set(child, { parent, M });
    }
    function absoluteMatrix(repId) {
      let M = IDENT, cur = repId, guard = 0;
      while (parentOf.has(cur) && guard++ < 50) {
        const p = parentOf.get(cur);
        M = mulM(p.M, M);
        cur = p.parent;
      }
      return M;
    }

    /* --- Noms de pièces : PRODUCT -> SHAPE_REPRESENTATION --- */
    const nameOfRep = new Map();
    for (const [, e] of ents) {
      if (e.type !== 'SHAPE_DEFINITION_REPRESENTATION') continue;
      const pds = get(refId(e.args[0])), rep = refId(e.args[1]);
      if (!pds) continue;
      let n = '';
      const pd = get(refId(pds.args[2] !== undefined ? pds.args[2] : pds.args[1]));
      const pdf = pd && get(refId(pd.args[2] || pd.args[1] || '#0'));
      const prod = pdf && pdf.args ? get(refId(pdf.args[2] || pdf.args[0] || '#0')) : null;
      if (prod && prod.type === 'PRODUCT') n = label(prod.args[1]) || label(prod.args[0]);
      if (n) nameOfRep.set(rep, n);
    }

    /* --- Corps --- */
    const shells = [];
    for (const [id, e] of ents) {
      if (e.type === 'MANIFOLD_SOLID_BREP' || e.type === 'BREP_WITH_VOIDS')
        shells.push({ id, name: label(e.args[0]), shellIds: [refId(e.args[1])] });
      else if (e.type === 'SHELL_BASED_SURFACE_MODEL')
        shells.push({ id, name: label(e.args[0]), shellIds: refs(e.args[1]).map(refId) });
    }

    const actors = [];
    const addActor = (name, chunks, M) => {
      const total = chunks.reduce((s, c) => s + c.length, 0);
      if (!total) return;
      const tris = new Float32Array(total);
      let o = 0;
      for (const c of chunks) { tris.set(c, o); o += c.length; }
      if (M && !isIdentity(M)) {
        for (let i = 0; i < tris.length; i += 3) {
          const p = applyM(M, [tris[i], tris[i + 1], tris[i + 2]]);
          tris[i] = p[0]; tris[i + 1] = p[1]; tris[i + 2] = p[2];
        }
      }
      actors.push({ name: name || `Corps ${actors.length + 1}`, tris });
    };

    if (shells.length) {
      for (const sh of shells) {
        const chunks = [];
        for (const sid of sh.shellIds) {
          const shell = get(sid);
          if (!shell || !/SHELL/.test(shell.type)) continue;
          for (const f of refs(shell.args[1])) {
            const t = faceTriangles(refId(f));
            if (t) chunks.push(t);
          }
        }
        const repId = repOfItem.get(sh.id);
        addActor(sh.name || nameOfRep.get(repId) || null, chunks, absoluteMatrix(repId));
      }
    } else {
      const chunks = [];
      for (const [id, e] of ents) {
        if (e.type !== 'ADVANCED_FACE' && e.type !== 'FACE_SURFACE') continue;
        const t = faceTriangles(id);
        if (t) chunks.push(t);
      }
      addActor('Corps 1', chunks, null);
    }

    if (!actors.length)
      throw new Error("Aucune face exploitable dans ce STEP (surfaces gauches uniquement ?). Essayez un export STL ou 3MF.");
    if (nSkipped)
      warnings.push(`${nSkipped} face(s) non facettisées : surfaces gauches (B-splines) ou contours dégénérés. ` +
        `La forme reste lisible, mais des zones peuvent manquer. Un export STL/3MF les inclurait.`);
    if (nTransforms)
      warnings.push(`${nTransforms} transformation(s) d'assemblage appliquées. Vérifiez visuellement le positionnement relatif des pièces.`);
    if (nClosed)
      warnings.push(`${nClosed} face(s) fermées (tube, sphère, tore) reconstruites en entier : leur contour ne portait que des coutures.`);
    if (nSplineCurves)
      warnings.push(`${nSplineCurves} arête(s) B-spline approchées par segments.`);

    return { actors, source: 'STEP', warnings, unitScale: scale };
  }

  root.Step = { importSTEP, parseEntities, triangulate, splitArgs };
})(typeof window !== 'undefined' ? (window.SWC = window.SWC || {}) : (module.exports = {}));
