/* Préparation d'un maillage pour l'affichage :
   - normales lissées par recouvrement, avec conservation des arêtes vives ;
   - arêtes caractéristiques (silhouette et plis) pour le rendu « technique » ;
   - boîte englobante et centre, qui servent de pivot et d'ancrage aux lignes. */
(function (root) {
  'use strict';
  const { V } = root.M3D || require('./m3d.js').M3D;

  const SMOOTH_COS = Math.cos(40 * Math.PI / 180);   // au-delà, l'arête reste vive
  const FEATURE_COS = Math.cos(24 * Math.PI / 180);  // en-deçà, l'arête est tracée

  function build(tris) {
    const nTri = tris.length / 9;
    const bb = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    for (let i = 0; i < tris.length; i += 3) for (let k = 0; k < 3; k++) {
      if (tris[i + k] < bb.min[k]) bb.min[k] = tris[i + k];
      if (tris[i + k] > bb.max[k]) bb.max[k] = tris[i + k];
    }
    const diag = V.dist(bb.min, bb.max) || 1;
    const q = diag * 1e-6;                            // pas de fusion des sommets
    const key = (x, y, z) => `${Math.round(x / q)},${Math.round(y / q)},${Math.round(z / q)}`;

    /* Normales de face. */
    const fn = new Float32Array(nTri * 3);
    for (let t = 0; t < nTri; t++) {
      const o = t * 9;
      const a = [tris[o], tris[o + 1], tris[o + 2]];
      const b = [tris[o + 3], tris[o + 4], tris[o + 5]];
      const c = [tris[o + 6], tris[o + 7], tris[o + 8]];
      const n = V.unit(V.cross(V.sub(b, a), V.sub(c, a)));
      fn[t * 3] = n[0]; fn[t * 3 + 1] = n[1]; fn[t * 3 + 2] = n[2];
    }

    /* Sommets fusionnés : liste des faces incidentes. */
    const vmap = new Map();
    const vidx = new Int32Array(nTri * 3);
    for (let t = 0; t < nTri; t++) for (let k = 0; k < 3; k++) {
      const o = t * 9 + k * 3;
      const kk = key(tris[o], tris[o + 1], tris[o + 2]);
      let e = vmap.get(kk);
      if (!e) { e = { faces: [] }; vmap.set(kk, e); }
      e.faces.push(t);
      vidx[t * 3 + k] = 0;
      e.id = e.id === undefined ? vmap.size - 1 : e.id;
      vidx[t * 3 + k] = e.id;
    }
    const vfaces = [];
    for (const e of vmap.values()) vfaces[e.id] = e.faces;

    /* Normales lissées : on ne moyenne que les faces proches en orientation. */
    const normals = new Float32Array(nTri * 9);
    for (let t = 0; t < nTri; t++) {
      const nf = [fn[t * 3], fn[t * 3 + 1], fn[t * 3 + 2]];
      for (let k = 0; k < 3; k++) {
        let acc = [0, 0, 0];
        for (const f of vfaces[vidx[t * 3 + k]]) {
          const nn = [fn[f * 3], fn[f * 3 + 1], fn[f * 3 + 2]];
          if (V.dot(nn, nf) >= SMOOTH_COS) acc = V.add(acc, nn);
        }
        const n = V.len(acc) > 1e-9 ? V.unit(acc) : nf;
        normals[t * 9 + k * 3] = n[0];
        normals[t * 9 + k * 3 + 1] = n[1];
        normals[t * 9 + k * 3 + 2] = n[2];
      }
    }

    /* Arêtes caractéristiques : bord libre, ou pli marqué entre deux faces. */
    const edges = new Map();
    for (let t = 0; t < nTri; t++) for (let k = 0; k < 3; k++) {
      const a = vidx[t * 3 + k], b = vidx[t * 3 + (k + 1) % 3];
      if (a === b) continue;
      const kk = a < b ? `${a}_${b}` : `${b}_${a}`;
      const cur = edges.get(kk);
      if (cur) cur.f.push(t);
      else edges.set(kk, { f: [t], o: t * 9 + k * 3, o2: t * 9 + ((k + 1) % 3) * 3 });
    }
    const lines = [];
    for (const e of edges.values()) {
      let draw = e.f.length !== 2;
      if (!draw) {
        const n1 = [fn[e.f[0] * 3], fn[e.f[0] * 3 + 1], fn[e.f[0] * 3 + 2]];
        const n2 = [fn[e.f[1] * 3], fn[e.f[1] * 3 + 1], fn[e.f[1] * 3 + 2]];
        draw = V.dot(n1, n2) < FEATURE_COS;
      }
      if (!draw) continue;
      lines.push(tris[e.o], tris[e.o + 1], tris[e.o + 2], tris[e.o2], tris[e.o2 + 1], tris[e.o2 + 2]);
    }

    const center = [(bb.min[0] + bb.max[0]) / 2, (bb.min[1] + bb.max[1]) / 2, (bb.min[2] + bb.max[2]) / 2];
    return {
      position: tris, normal: normals, edges: Float32Array.from(lines),
      bbox: bb, center, diag, nTri
    };
  }

  root.Mesh = { build };
})(typeof window !== 'undefined' ? (window.SWC = window.SWC || {}) : (module.exports = {}));
