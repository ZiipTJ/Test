/* Import de géométrie : STL (binaire + ASCII) et STEP (AP203/AP214).
   Un fichier peut contenir plusieurs corps : chacun est restitué séparément,
   le panneau PEHD étant ensuite désigné par l'utilisateur. */
(function (root) {
  'use strict';
  const G = root.Geom;

  /* ================= Algèbre 3D ================= */
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const norm = (a) => Math.hypot(a[0], a[1], a[2]);
  const unit = (a) => { const n = norm(a) || 1; return [a[0] / n, a[1] / n, a[2] / n]; };

  function planeBasis(n) {
    const N = unit(n);
    const ref = Math.abs(N[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const U = unit(cross(ref, N));
    const V = cross(N, U);
    return { N, U, V };
  }

  /* Direction principale de plus petite étendue : normale d'une plaque. */
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
        tris.push({ n: [nx, ny, nz], v, group: 0 });
        off += 50;
      }
    } else {
      const txt = new TextDecoder().decode(buffer);
      let group = -1;
      const names = [];
      const re = /(solid\s+([^\r\n]*))|(facet\s+normal\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)[\s\S]*?outer\s+loop([\s\S]*?)endloop)/g;
      let m;
      while ((m = re.exec(txt))) {
        if (m[1] !== undefined) { group++; names.push((m[2] || '').trim()); continue; }
        const n = [parseFloat(m[4]), parseFloat(m[5]), parseFloat(m[6])];
        const vre = /vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)/g;
        const v = []; let vm;
        while ((vm = vre.exec(m[7]))) v.push([parseFloat(vm[1]), parseFloat(vm[2]), parseFloat(vm[3])]);
        if (v.length === 3) tris.push({ n, v, group: Math.max(0, group) });
      }
      if (names.length) tris.names = names;
    }
    if (!tris.length) throw new Error('Fichier STL illisible ou vide.');
    return tris;
  }

  /* Sépare une soupe de triangles en corps distincts.
     1. Si le fichier ASCII déclare plusieurs blocs `solid`, ils font foi.
     2. Sinon, composantes connexes par arête partagée : deux pièces qui ne se
        touchent que par une face ou un sommet restent distinctes. Deux pièces
        collées le long d'une arête commune sont vues comme un seul corps —
        limite intrinsèque du STL, que le format STEP ne présente pas. */
  function splitSolids(tris) {
    if (tris.names && tris.names.length > 1) {
      const byGroup = new Map();
      for (const t of tris) {
        if (!byGroup.has(t.group)) byGroup.set(t.group, []);
        byGroup.get(t.group).push(t);
      }
      const out = [];
      for (const [g, list] of byGroup)
        if (list.length >= 4) out.push({ name: tris.names[g] || `Corps ${out.length + 1}`, tris: list });
      if (out.length > 1) return out.sort((a, b) => b.tris.length - a.tris.length);
    }
    let size = 0;
    const bb = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    for (const t of tris) for (const v of t.v) for (let k = 0; k < 3; k++) {
      if (v[k] < bb.min[k]) bb.min[k] = v[k];
      if (v[k] > bb.max[k]) bb.max[k] = v[k];
    }
    for (let k = 0; k < 3; k++) size = Math.max(size, bb.max[k] - bb.min[k]);
    const tol = (size || 1) * 1e-6;
    const vid = new Map();
    const idOf = (p) => {
      const k = Math.round(p[0] / tol) + '_' + Math.round(p[1] / tol) + '_' + Math.round(p[2] / tol);
      let i = vid.get(k);
      if (i === undefined) { i = vid.size; vid.set(k, i); }
      return i;
    };
    const triV = tris.map(t => t.v.map(idOf));
    const parent = new Int32Array(tris.length).map((_, i) => i);
    const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    const union = (x, y) => { const a = find(x), b = find(y); if (a !== b) parent[a] = b; };
    const edgeOwner = new Map();
    triV.forEach((tv, i) => {
      for (let k = 0; k < 3; k++) {
        const a = tv[k], b = tv[(k + 1) % 3];
        const key = a < b ? a + ',' + b : b + ',' + a;
        const prev = edgeOwner.get(key);
        if (prev === undefined) edgeOwner.set(key, i); else union(prev, i);
      }
    });
    const groups = new Map();
    tris.forEach((t, i) => {
      const r = find(i);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(t);
    });
    const solids = [...groups.values()]
      .filter(g => g.length >= 4)
      .sort((a, b) => b.length - a.length)
      .map((g, i) => ({ name: `Corps ${i + 1}`, tris: g }));
    return solids.length ? solids : [{ name: 'Corps 1', tris }];
  }

  function importSTL(buffer) {
    const tris = parseSTL(buffer);
    const solids = splitSolids(tris);
    solids.forEach((s, i) => { if (!s.name) s.name = `Corps ${i + 1}`; });
    return { solids, source: 'STL', warnings: [], nTriangles: tris.length };
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
    text = text.replace(/\/\*[\s\S]*?\*\//g, ' ');
    const re = /#(\d+)\s*=\s*([A-Z_0-9]+)\s*\(([\s\S]*?)\)\s*;/g;
    let m;
    while ((m = re.exec(text))) ents.set(+m[1], { type: m[2], args: tokenizeArgs(m[3]) });
    const re2 = /#(\d+)\s*=\s*\(([\s\S]*?)\)\s*;/g;
    while ((m = re2.exec(text))) {
      if (ents.has(+m[1])) continue;
      ents.set(+m[1], { type: 'COMPLEX', args: [], raw: m[2] });
    }
    return ents;
  }

  function stepUnitScale(ents, text) {
    for (const [, e] of ents)
      if (e.type === 'CONVERSION_BASED_UNIT' && /INCH/i.test(e.args.join(','))) return 25.4;
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

  /* --- Matrices 4x3 (rotation + translation) --- */
  const IDENT = { r: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], t: [0, 0, 0] };
  function applyM(M, p) {
    return [
      M.r[0][0] * p[0] + M.r[0][1] * p[1] + M.r[0][2] * p[2] + M.t[0],
      M.r[1][0] * p[0] + M.r[1][1] * p[1] + M.r[1][2] * p[2] + M.t[1],
      M.r[2][0] * p[0] + M.r[2][1] * p[1] + M.r[2][2] * p[2] + M.t[2]];
  }
  function mulM(A, B) {  // A ∘ B
    const r = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++)
      r[i][j] = A.r[i][0] * B.r[0][j] + A.r[i][1] * B.r[1][j] + A.r[i][2] * B.r[2][j];
    return { r, t: applyM(A, B.t) };
  }
  function invM(A) {
    const r = [[A.r[0][0], A.r[1][0], A.r[2][0]], [A.r[0][1], A.r[1][1], A.r[2][1]], [A.r[0][2], A.r[1][2], A.r[2][2]]];
    const t = [
      -(r[0][0] * A.t[0] + r[0][1] * A.t[1] + r[0][2] * A.t[2]),
      -(r[1][0] * A.t[0] + r[1][1] * A.t[1] + r[1][2] * A.t[2]),
      -(r[2][0] * A.t[0] + r[2][1] * A.t[1] + r[2][2] * A.t[2])];
    return { r, t };
  }
  const isIdentity = (M) => Math.abs(M.t[0]) + Math.abs(M.t[1]) + Math.abs(M.t[2]) < 1e-9 &&
    Math.abs(M.r[0][0] - 1) + Math.abs(M.r[1][1] - 1) + Math.abs(M.r[2][2] - 1) < 1e-9;

  function importSTEP(text, opts) {
    opts = opts || {};
    const ents = parseSTEP(text);
    const scale = stepUnitScale(ents, text);
    const warnings = [];
    const refId = (s) => +String(s).slice(1);
    const listRefs = (s) => String(s).replace(/^\(|\)$/g, '').split(',').map(x => x.trim()).filter(x => x[0] === '#');
    const label = (s) => (String(s).match(/^'(.*)'$/) || [, ''])[1];

    const pointCache = new Map();
    function point(id) {
      if (pointCache.has(id)) return pointCache.get(id);
      const e = ents.get(id);
      let p = null;
      if (e && e.type === 'CARTESIAN_POINT') {
        const nums = String(e.args[1]).replace(/[()]/g, '').split(',').map(parseFloat);
        p = [(nums[0] || 0) * scale, (nums[1] || 0) * scale, (nums[2] || 0) * scale];
      } else if (e && e.type === 'VERTEX_POINT') p = point(refId(e.args[1]));
      pointCache.set(id, p);
      return p;
    }
    function direction(id) {
      const e = ents.get(id);
      if (!e || e.type !== 'DIRECTION') return null;
      const nums = String(e.args[1]).replace(/[()]/g, '').split(',').map(parseFloat);
      return unit([nums[0] || 0, nums[1] || 0, nums[2] || 0]);
    }
    function placement(id) {
      const e = ents.get(id);
      if (!e || !/AXIS2_PLACEMENT_3D/.test(e.type)) return null;
      const loc = point(refId(e.args[1]));
      const axis = e.args[2] && e.args[2] !== '$' ? direction(refId(e.args[2])) : [0, 0, 1];
      const refd = e.args[3] && e.args[3] !== '$' ? direction(refId(e.args[3])) : null;
      return { loc: loc || [0, 0, 0], axis: axis || [0, 0, 1], ref: refd };
    }
    function placementMatrix(id) {
      const pl = placement(id);
      if (!pl) return IDENT;
      const N = unit(pl.axis);
      let U = pl.ref ? unit(pl.ref) : planeBasis(N).U;
      U = unit(sub(U, [N[0] * dot(U, N), N[1] * dot(U, N), N[2] * dot(U, N)]));
      const V = cross(N, U);
      return { r: [[U[0], V[0], N[0]], [U[1], V[1], N[1]], [U[2], V[2], N[2]]], t: pl.loc };
    }

    /* --- Discrétisation des arêtes --- */
    function edgePoints(edgeCurveId, orientedSense, sagitta) {
      const e = ents.get(edgeCurveId);
      if (!e || e.type !== 'EDGE_CURVE') return null;
      const p1 = point(refId(e.args[1])), p2 = point(refId(e.args[2]));
      const curve = ents.get(refId(e.args[3]));
      const sameSense = /\.T\./.test(e.args[4] || '.T.');
      let sense = sameSense;
      if (!orientedSense) sense = !sense;
      if (!p1 || !p2) return null;
      const pts = [p1];
      if (curve && curve.type === 'CIRCLE') {
        const pl = placement(refId(curve.args[1]));
        const R = parseFloat(curve.args[2]) * scale;
        if (pl) {
          const N = unit(pl.axis);
          let U = pl.ref ? unit(pl.ref) : planeBasis(N).U;
          U = unit(sub(U, [N[0] * dot(U, N), N[1] * dot(U, N), N[2] * dot(U, N)]));
          const V = cross(N, U);
          const ang = (p) => { const d = sub(p, pl.loc); return Math.atan2(dot(d, V), dot(d, U)); };
          const a1 = ang(p1), a2 = ang(p2);
          let sweep = a2 - a1;
          if (sameSense) { while (sweep <= 1e-9) sweep += 2 * Math.PI; }
          else { while (sweep >= -1e-9) sweep -= 2 * Math.PI; }
          if (norm(sub(p1, p2)) < 1e-9) sweep = sameSense ? 2 * Math.PI : -2 * Math.PI;
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
        const cps = listRefs(curve.args[2] || '()').map(s => point(refId(s))).filter(Boolean);
        if (cps.length > 2) for (let i = 1; i < cps.length - 1; i++) pts.push(cps[i]);
      }
      pts.push(p2);
      if (!sense) pts.reverse();
      return pts;
    }

    function boundLoop(boundId, sagitta) {
      const b = ents.get(boundId);
      if (!b || !/FACE_(OUTER_)?BOUND/.test(b.type)) return null;
      const loopE = ents.get(refId(b.args[1]));
      const boundOrient = /\.T\./.test(b.args[2] || '.T.');
      if (!loopE || loopE.type !== 'EDGE_LOOP') return null;
      const pts = [];
      for (const oe of listRefs(loopE.args[1])) {
        const o = ents.get(refId(oe));
        if (!o || o.type !== 'ORIENTED_EDGE') continue;
        const ep = edgePoints(refId(o.args[3]), /\.T\./.test(o.args[4] || '.T.'), sagitta);
        if (!ep) continue;
        for (const p of ep) if (!pts.length || norm(sub(p, pts[pts.length - 1])) > 1e-7) pts.push(p);
      }
      if (pts.length > 2 && norm(sub(pts[0], pts[pts.length - 1])) < 1e-7) pts.pop();
      if (pts.length < 3) return null;
      return boundOrient ? pts : pts.reverse();
    }

    /* --- Faces planes d'une face avancée --- */
    let nCurved = 0;
    function planarFace(faceId) {
      const e = ents.get(faceId);
      if (!e || (e.type !== 'ADVANCED_FACE' && e.type !== 'FACE_SURFACE')) return null;
      const surf = ents.get(refId(e.args[2]));
      if (!surf || surf.type !== 'PLANE') { nCurved++; return null; }
      const pl = placement(refId(surf.args[1]));
      if (!pl) return null;
      const faceSense = /\.T\./.test(e.args[3] || '.T.');
      const loops = [];
      for (const bId of listRefs(e.args[1])) {
        const lp = boundLoop(refId(bId), opts.sagitta);
        if (lp) loops.push({ pts: lp, outer: /OUTER/.test((ents.get(refId(bId)) || {}).type || '') });
      }
      if (!loops.length) return null;
      loops.sort((a, b) => (b.outer ? 1 : 0) - (a.outer ? 1 : 0));
      const N = unit(pl.axis);
      return { normal: faceSense ? N : [-N[0], -N[1], -N[2]], loops: loops.map(l => l.pts) };
    }

    /* --- Corps : coques fermées --- */
    const shells = [];
    for (const [id, e] of ents) {
      if (e.type === 'MANIFOLD_SOLID_BREP' || e.type === 'BREP_WITH_VOIDS') {
        shells.push({ id, name: label(e.args[0]), shellIds: [refId(e.args[1])] });
      } else if (e.type === 'SHELL_BASED_SURFACE_MODEL') {
        shells.push({ id, name: label(e.args[0]), shellIds: listRefs(e.args[1]).map(refId) });
      }
    }
    if (!shells.length) {
      // Pas de structure de corps : on prend toutes les faces comme un corps unique.
      const faces = [];
      for (const [id, e] of ents) if (e.type === 'ADVANCED_FACE' || e.type === 'FACE_SURFACE') {
        const f = planarFace(id);
        if (f) faces.push(f);
      }
      if (!faces.length) throw new Error(
        "Aucune face plane exploitable dans ce STEP. Essayez un export STL, ou saisissez la géométrie manuellement.");
      return { solids: [{ name: 'Corps 1', faces }], source: 'STEP', warnings, unitScale: scale, nCurved };
    }

    /* --- Transformations d'assemblage --- */
    const repOfItem = new Map();          // item -> représentation
    const repItems = new Map();
    for (const [id, e] of ents) {
      if (!/SHAPE_REPRESENTATION|REPRESENTATION$/.test(e.type)) continue;
      const items = listRefs(e.args[1] || '()').map(refId);
      if (!items.length) continue;
      repItems.set(id, items);
      for (const it of items) repOfItem.set(it, id);
    }
    const parentOf = new Map();           // rep enfant -> {parent, M}
    let nTransforms = 0;
    for (const [, e] of ents) {
      let a = null;
      if (e.type === 'COMPLEX' && /REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION/.test(e.raw || '')) {
        const rr = (e.raw.match(/REPRESENTATION_RELATIONSHIP\s*\(([^)]*)\)/) || [])[1];
        const tr = (e.raw.match(/REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION\s*\(([^)]*)\)/) || [])[1];
        if (rr && tr) a = { reps: tokenizeArgs(rr), trans: tokenizeArgs(tr)[0] };
      }
      if (!a) continue;
      const child = refId(a.reps[2]), parent = refId(a.reps[3]);
      const idt = ents.get(refId(a.trans));
      let M = IDENT;
      if (idt && idt.type === 'ITEM_DEFINED_TRANSFORMATION') {
        const M1 = placementMatrix(refId(idt.args[2]));
        const M2 = placementMatrix(refId(idt.args[3]));
        M = mulM(M2, invM(M1));
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

    /* --- Noms de pièces --- */
    const productNames = [];
    for (const [, e] of ents) if (e.type === 'PRODUCT') productNames.push(label(e.args[0]));

    const solids = [];
    for (const sh of shells) {
      const faceIds = [];
      for (const sid of sh.shellIds) {
        const shell = ents.get(sid);
        if (!shell || !/SHELL/.test(shell.type)) continue;
        for (const f of listRefs(shell.args[1])) faceIds.push(refId(f));
      }
      const faces = [];
      for (const fid of faceIds) { const f = planarFace(fid); if (f) faces.push(f); }
      if (!faces.length) continue;
      const M = absoluteMatrix(repOfItem.get(sh.id));
      if (!isIdentity(M)) for (const f of faces) {
        f.loops = f.loops.map(l => l.map(p => applyM(M, p)));
        f.normal = unit(applyM({ r: M.r, t: [0, 0, 0] }, f.normal));
      }
      solids.push({
        name: sh.name || productNames[solids.length] || `Corps ${solids.length + 1}`,
        faces, nFaces: faceIds.length
      });
    }
    if (!solids.length) throw new Error(
      "Aucun corps exploitable dans ce STEP. Essayez un export STL.");

    if (nTransforms > 0) warnings.push(
      `Assemblage : ${nTransforms} transformation(s) de positionnement ont été appliquées. ` +
      `Vérifiez visuellement dans l'onglet « Assemblage » que les pièces sont bien placées les unes ` +
      `par rapport aux autres — les conventions de transformation varient d'un logiciel de CAO à l'autre. ` +
      `En cas de doute, exportez l'assemblage en STL, qui ne présente pas cette ambiguïté.`);
    if (nCurved > 0) warnings.push(
      `${nCurved} face(s) non planes (cylindres, congés, surfaces gauches) ont été ignorées pour la ` +
      `mesure d'épaisseur et la détection des contacts. Sur des pièces d'ossature usuelles l'effet est nul, ` +
      `mais un corps entièrement courbe ne sera pas détecté.`);

    return { solids, source: 'STEP', warnings, unitScale: scale, nCurved };
  }

  /* ================= Géométries paramétriques ================= */
  function extrudeRegion(region, thickness, name) {
    const tris = [];
    const m = root.Mesh.meshRegion(region, Math.max(Math.hypot(
      G.bbox(region.outer).w, G.bbox(region.outer).h) / 18, 5));
    const push = (a, b, c) => {
      const n = cross(sub(b, a), sub(c, a));
      tris.push({ n: unit(n), v: [a, b, c] });
    };
    const top = (i) => [m.nodes[i][0], m.nodes[i][1], thickness];
    const bot = (i) => [m.nodes[i][0], m.nodes[i][1], 0];
    for (const t of m.elems) {
      push(top(t[0]), top(t[1]), top(t[2]));
      push(bot(t[0]), bot(t[2]), bot(t[1]));
    }
    const cnt = new Map();
    for (const t of m.elems) for (let k = 0; k < 3; k++) {
      const a = t[k], b = t[(k + 1) % 3];
      const key = a < b ? a + ',' + b : b + ',' + a;
      cnt.set(key, (cnt.get(key) || 0) + 1);
    }
    for (const [key, c] of cnt) {
      if (c !== 1) continue;
      const [a, b] = key.split(',').map(Number);
      push(bot(a), bot(b), top(b));
      push(bot(a), top(b), top(a));
    }
    return { name: name || 'Panneau', tris };
  }

  function rectangle(a, b, t) {
    t = t || 20;
    return {
      solids: [extrudeRegion({ outer: [[0, 0], [a, 0], [a, b], [0, b]], holes: [] }, t, `Rectangle ${a}×${b}`)],
      source: 'manuel', warnings: []
    };
  }
  function disc(R, t, n) {
    t = t || 20;
    const ring = [];
    n = n || 96;
    for (let i = 0; i < n; i++) { const a = 2 * Math.PI * i / n; ring.push([R * Math.cos(a), R * Math.sin(a)]); }
    return { solids: [extrudeRegion({ outer: ring, holes: [] }, t, `Disque Ø${2 * R}`)], source: 'manuel', warnings: [] };
  }

  root.Importers = {
    importSTL, importSTEP, parseSTL, parseSTEP, splitSolids,
    rectangle, disc, extrudeRegion, planeBasis, smallestPrincipalDirection
  };
})(typeof window !== 'undefined' ? (window.PP = window.PP || {}) : (module.exports = {}));
