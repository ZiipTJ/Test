/* Éléments finis de plaque mince en flexion — triangle DKT (Batoz).
   3 nœuds x 3 ddl : w (mm), betax, betay (rad).
   Unités : mm, N, MPa (N/mm²). */
(function (root) {
  'use strict';

  /* ---------- Matrice de comportement flexion ---------- */
  function bendingD(E, nu, t) {
    const f = E * t * t * t / (12 * (1 - nu * nu));
    return [
      [f, f * nu, 0],
      [f * nu, f, 0],
      [0, 0, f * (1 - nu) / 2]
    ];
  }

  /* ---------- Matrice B du DKT en un point (xi, eta) ---------- */
  function dktGeom(x1, y1, x2, y2, x3, y3) {
    const x23 = x2 - x3, y23 = y2 - y3;
    const x31 = x3 - x1, y31 = y3 - y1;
    const x12 = x1 - x2, y12 = y1 - y2;
    const l23 = x23 * x23 + y23 * y23;
    const l31 = x31 * x31 + y31 * y31;
    const l12 = x12 * x12 + y12 * y12;
    const A = 0.5 * (x31 * y12 - x12 * y31);
    return {
      x23, y23, x31, y31, x12, y12, A,
      P4: -6 * x23 / l23, P5: -6 * x31 / l31, P6: -6 * x12 / l12,
      t4: -6 * y23 / l23, t5: -6 * y31 / l31, t6: -6 * y12 / l12,
      q4: 3 * x23 * y23 / l23, q5: 3 * x31 * y31 / l31, q6: 3 * x12 * y12 / l12,
      r4: 3 * y23 * y23 / l23, r5: 3 * y31 * y31 / l31, r6: 3 * y12 * y12 / l12
    };
  }

  function dktB(g, xi, eta) {
    const { P4, P5, P6, t4, t5, t6, q4, q5, q6, r4, r5, r6 } = g;
    const Hxx = new Float64Array(9), Hxe = new Float64Array(9);
    const Hyx = new Float64Array(9), Hye = new Float64Array(9);

    // dHx/dxi
    Hxx[0] = P6 * (1 - 2 * xi) + (P5 - P6) * eta;
    Hxx[1] = q6 * (1 - 2 * xi) - (q5 + q6) * eta;
    Hxx[2] = -4 + 6 * (xi + eta) + r6 * (1 - 2 * xi) - eta * (r5 + r6);
    Hxx[3] = -P6 * (1 - 2 * xi) + eta * (P4 + P6);
    Hxx[4] = q6 * (1 - 2 * xi) - eta * (q6 - q4);
    Hxx[5] = -2 + 6 * xi + r6 * (1 - 2 * xi) + eta * (r4 - r6);
    Hxx[6] = -eta * (P5 + P4);
    Hxx[7] = eta * (q4 - q5);
    Hxx[8] = eta * (r4 - r5);

    // dHx/deta
    Hxe[0] = -P5 * (1 - 2 * eta) - xi * (P6 - P5);
    Hxe[1] = q5 * (1 - 2 * eta) - xi * (q5 + q6);
    Hxe[2] = -4 + 6 * (xi + eta) + r5 * (1 - 2 * eta) - xi * (r5 + r6);
    Hxe[3] = xi * (P4 + P6);
    Hxe[4] = xi * (q4 - q6);
    Hxe[5] = xi * (r4 - r6);
    Hxe[6] = P5 * (1 - 2 * eta) - xi * (P4 + P5);
    Hxe[7] = q5 * (1 - 2 * eta) + xi * (q4 - q5);
    Hxe[8] = -2 + 6 * eta + r5 * (1 - 2 * eta) + xi * (r4 - r5);

    // dHy/dxi
    Hyx[0] = t6 * (1 - 2 * xi) + (t5 - t6) * eta;
    Hyx[1] = 1 + r6 * (1 - 2 * xi) - (r5 + r6) * eta;
    Hyx[2] = -q6 * (1 - 2 * xi) + eta * (q5 + q6);
    Hyx[3] = -t6 * (1 - 2 * xi) + eta * (t4 + t6);
    Hyx[4] = -1 + r6 * (1 - 2 * xi) + eta * (r4 - r6);
    Hyx[5] = -q6 * (1 - 2 * xi) - eta * (q4 - q6);
    Hyx[6] = -eta * (t4 + t5);
    Hyx[7] = eta * (r4 - r5);
    Hyx[8] = -eta * (q4 - q5);

    // dHy/deta
    Hye[0] = -t5 * (1 - 2 * eta) - xi * (t6 - t5);
    Hye[1] = 1 + r5 * (1 - 2 * eta) - xi * (r5 + r6);
    Hye[2] = -q5 * (1 - 2 * eta) + xi * (q5 + q6);
    Hye[3] = xi * (t4 + t6);
    Hye[4] = xi * (r4 - r6);
    Hye[5] = -xi * (q4 - q6);
    Hye[6] = t5 * (1 - 2 * eta) - xi * (t4 + t5);
    Hye[7] = -1 + r5 * (1 - 2 * eta) + xi * (r4 - r5);
    Hye[8] = -q5 * (1 - 2 * eta) - xi * (q4 - q5);

    const c = 1 / (2 * g.A);
    const B = [new Float64Array(9), new Float64Array(9), new Float64Array(9)];
    for (let i = 0; i < 9; i++) {
      B[0][i] = c * (g.y31 * Hxx[i] + g.y12 * Hxe[i]);
      B[1][i] = c * (-g.x31 * Hyx[i] - g.x12 * Hye[i]);
      B[2][i] = c * (-g.x31 * Hxx[i] - g.x12 * Hxe[i] + g.y31 * Hyx[i] + g.y12 * Hye[i]);
    }
    return B;
  }

  const GP = [[0.5, 0.0], [0.5, 0.5], [0.0, 0.5]]; // intégration 3 points milieux

  /* Matrice de rigidité élémentaire 9x9 (tableau plat ligne par ligne). */
  function dktStiffness(x1, y1, x2, y2, x3, y3, D) {
    const g = dktGeom(x1, y1, x2, y2, x3, y3);
    const Ke = new Float64Array(81);
    const w = Math.abs(g.A) / 3;
    for (const [xi, eta] of GP) {
      const B = dktB(g, xi, eta);
      // DB = D * B  (3x9)
      const DB = [new Float64Array(9), new Float64Array(9), new Float64Array(9)];
      for (let i = 0; i < 3; i++)
        for (let j = 0; j < 9; j++)
          DB[i][j] = D[i][0] * B[0][j] + D[i][1] * B[1][j] + D[i][2] * B[2][j];
      for (let a = 0; a < 9; a++)
        for (let b = a; b < 9; b++) {
          const v = w * (B[0][a] * DB[0][b] + B[1][a] * DB[1][b] + B[2][a] * DB[2][b]);
          Ke[a * 9 + b] += v;
          if (a !== b) Ke[b * 9 + a] += v;
        }
    }
    return Ke;
  }

  /* Moments (Mx, My, Mxy) au centre de l'élément, N.mm/mm. */
  function elementMoments(x1, y1, x2, y2, x3, y3, D, ue) {
    const g = dktGeom(x1, y1, x2, y2, x3, y3);
    const M = [0, 0, 0];
    for (const [xi, eta] of GP) {
      const B = dktB(g, xi, eta);
      for (let i = 0; i < 3; i++) {
        let k0 = 0, k1 = 0, k2 = 0;
        for (let j = 0; j < 9; j++) { k0 += B[0][j] * ue[j]; k1 += B[1][j] * ue[j]; k2 += B[2][j] * ue[j]; }
        M[i] += (D[i][0] * k0 + D[i][1] * k1 + D[i][2] * k2) / 3;
      }
    }
    return M;
  }

  /* ---------- Renumérotation Cuthill-McKee inverse ---------- */
  function rcmOrder(nNodes, elems) {
    const adj = Array.from({ length: nNodes }, () => new Set());
    for (const t of elems) {
      for (let i = 0; i < 3; i++)
        for (let j = 0; j < 3; j++)
          if (i !== j) adj[t[i]].add(t[j]);
    }
    const deg = adj.map(s => s.size);
    const visited = new Array(nNodes).fill(false);
    const order = [];
    for (;;) {
      let start = -1;
      for (let i = 0; i < nNodes; i++) if (!visited[i] && (start < 0 || deg[i] < deg[start])) start = i;
      if (start < 0) break;
      const queue = [start];
      visited[start] = true;
      while (queue.length) {
        const v = queue.shift();
        order.push(v);
        const nbrs = [...adj[v]].filter(n => !visited[n]).sort((a, b) => deg[a] - deg[b]);
        for (const n of nbrs) { visited[n] = true; queue.push(n); }
      }
    }
    order.reverse();
    const perm = new Int32Array(nNodes); // ancien -> nouveau
    for (let i = 0; i < order.length; i++) perm[order[i]] = i;
    return perm;
  }

  /* ---------- Solveur skyline LDL^T ---------- */
  function Skyline(n, minCol) {
    this.n = n;
    this.diagIdx = new Int32Array(n);
    let p = 0;
    this.colHeight = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const h = i - minCol[i];
      this.colHeight[i] = h;
      p += h + 1;
      this.diagIdx[i] = p - 1; // position de A(i,i)
    }
    this.a = new Float64Array(p);
  }
  Skyline.prototype.add = function (i, j, v) {
    if (j < i) { const t = i; i = j; j = t; }   // stocke la partie sup. par colonnes
    const idx = this.diagIdx[j] - (j - i);
    if (idx < (j > 0 ? this.diagIdx[j - 1] + 1 : 0)) throw new Error('skyline overflow');
    this.a[idx] += v;
  };
  Skyline.prototype.get = function (i, j) {
    if (j < i) { const t = i; i = j; j = t; }
    if (j - i > this.colHeight[j]) return 0;
    return this.a[this.diagIdx[j] - (j - i)];
  };
  /* Factorisation LDL^T en place (colonne par colonne, format skyline). */
  Skyline.prototype.factorize = function () {
    const n = this.n, a = this.a, di = this.diagIdx, ch = this.colHeight;
    for (let j = 0; j < n; j++) {
      const jstart = j - ch[j];
      for (let i = jstart; i < j; i++) {
        const istart = i - ch[i];
        const k0 = Math.max(jstart, istart);
        let s = a[di[j] - (j - i)];
        for (let k = k0; k < i; k++) s -= a[di[i] - (i - k)] * a[di[j] - (j - k)];
        a[di[j] - (j - i)] = s;
      }
      let d = a[di[j]];
      for (let i = jstart; i < j; i++) {
        const u = a[di[j] - (j - i)];
        const l = u / a[di[i]];
        d -= l * u;
        a[di[j] - (j - i)] = l;
      }
      if (!(Math.abs(d) > 1e-300)) d = 1e-300;
      a[di[j]] = d;
    }
  };
  Skyline.prototype.solve = function (b) {
    const n = this.n, a = this.a, di = this.diagIdx, ch = this.colHeight;
    const x = Float64Array.from(b);
    for (let j = 0; j < n; j++) {              // L y = b
      const jstart = j - ch[j];
      let s = x[j];
      for (let i = jstart; i < j; i++) s -= a[di[j] - (j - i)] * x[i];
      x[j] = s;
    }
    for (let j = 0; j < n; j++) x[j] /= a[di[j]];   // D
    for (let j = n - 1; j >= 0; j--) {          // L^T x = y
      const jstart = j - ch[j];
      const xj = x[j];
      for (let i = jstart; i < j; i++) x[i] -= a[di[j] - (j - i)] * xj;
    }
    return x;
  };

  /* ---------- Assemblage et résolution ---------- */
  /*
    mesh    : {nodes:[[x,y]], elems:[[i,j,k]]}
    D       : matrice 3x3
    F       : Float64Array(3*nNodes) forces nodales
    fixed   : Int8Array(3*nNodes), 1 = ddl bloqué
  */
  function solve(mesh, D, F, fixed) {
    const nN = mesh.nodes.length;
    const nd = 3 * nN;
    const perm = rcmOrder(nN, mesh.elems);
    const dofOf = (node, k) => 3 * perm[node] + k;

    // Hauteurs de colonnes
    const minCol = new Int32Array(nd);
    for (let i = 0; i < nd; i++) minCol[i] = i;
    for (const t of mesh.elems) {
      let lo = Infinity;
      const dofs = [];
      for (const nId of t) for (let k = 0; k < 3; k++) { const d = dofOf(nId, k); dofs.push(d); if (d < lo) lo = d; }
      for (const d of dofs) if (lo < minCol[d]) minCol[d] = lo;
    }
    const K = new Skyline(nd, minCol);

    for (const t of mesh.elems) {
      const [i, j, k] = t;
      const p1 = mesh.nodes[i], p2 = mesh.nodes[j], p3 = mesh.nodes[k];
      const Ke = dktStiffness(p1[0], p1[1], p2[0], p2[1], p3[0], p3[1], D);
      const dofs = [
        dofOf(i, 0), dofOf(i, 1), dofOf(i, 2),
        dofOf(j, 0), dofOf(j, 1), dofOf(j, 2),
        dofOf(k, 0), dofOf(k, 1), dofOf(k, 2)];
      for (let a = 0; a < 9; a++) {
        for (let b = a; b < 9; b++) {
          const v = Ke[a * 9 + b];
          if (v === 0) continue;
          K.add(dofs[a], dofs[b], v);
        }
      }
    }

    // Conditions aux limites par pénalisation forte (préserve la structure skyline)
    let kmax = 0;
    for (let i = 0; i < nd; i++) { const d = K.get(i, i); if (d > kmax) kmax = d; }
    const pen = kmax * 1e10 || 1e10;
    const Fp = new Float64Array(nd);
    for (let n = 0; n < nN; n++)
      for (let k = 0; k < 3; k++) Fp[dofOf(n, k)] = F[3 * n + k];
    for (let n = 0; n < nN; n++)
      for (let k = 0; k < 3; k++)
        if (fixed[3 * n + k]) { const d = dofOf(n, k); K.add(d, d, pen); Fp[d] = 0; }

    K.factorize();
    const xp = K.solve(Fp);

    const u = new Float64Array(nd);
    for (let n = 0; n < nN; n++)
      for (let k = 0; k < 3; k++) u[3 * n + k] = xp[dofOf(n, k)];
    return u;
  }

  /* Post-traitement : moments par élément puis lissage aux nœuds. */
  function postprocess(mesh, D, u, t) {
    const nE = mesh.elems.length, nN = mesh.nodes.length;
    const Me = new Array(nE);
    for (let e = 0; e < nE; e++) {
      const [i, j, k] = mesh.elems[e];
      const p1 = mesh.nodes[i], p2 = mesh.nodes[j], p3 = mesh.nodes[k];
      const ue = new Float64Array(9);
      const ids = [i, j, k];
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) ue[3 * a + b] = u[3 * ids[a] + b];
      Me[e] = elementMoments(p1[0], p1[1], p2[0], p2[1], p3[0], p3[1], D, ue);
    }
    // Lissage surfacique (pondération par aire)
    const acc = new Float64Array(nN * 3), wsum = new Float64Array(nN);
    for (let e = 0; e < nE; e++) {
      const [i, j, k] = mesh.elems[e];
      const p1 = mesh.nodes[i], p2 = mesh.nodes[j], p3 = mesh.nodes[k];
      const A = Math.abs((p2[0] - p1[0]) * (p3[1] - p1[1]) - (p3[0] - p1[0]) * (p2[1] - p1[1])) / 2;
      for (const n of [i, j, k]) {
        acc[3 * n] += Me[e][0] * A; acc[3 * n + 1] += Me[e][1] * A; acc[3 * n + 2] += Me[e][2] * A;
        wsum[n] += A;
      }
    }
    const Mn = new Float64Array(nN * 3);
    for (let n = 0; n < nN; n++) {
      const w = wsum[n] || 1;
      Mn[3 * n] = acc[3 * n] / w; Mn[3 * n + 1] = acc[3 * n + 1] / w; Mn[3 * n + 2] = acc[3 * n + 2] / w;
    }
    // Contrainte de peau : sigma = 6 M / t^2, von Mises en surface
    const sec = 6 / (t * t);
    const vm = new Float64Array(nN);
    let vmMax = 0;
    for (let n = 0; n < nN; n++) {
      const sx = Mn[3 * n] * sec, sy = Mn[3 * n + 1] * sec, sxy = Mn[3 * n + 2] * sec;
      const v = Math.sqrt(sx * sx - sx * sy + sy * sy + 3 * sxy * sxy);
      vm[n] = v;
      if (v > vmMax) vmMax = v;
    }
    return { momentsElem: Me, momentsNode: Mn, vonMises: vm, vonMisesMax: vmMax };
  }

  root.Fem = {
    bendingD, dktStiffness, elementMoments, solve, postprocess, Skyline, rcmOrder, dktGeom, dktB
  };
})(typeof window !== 'undefined' ? (window.PP = window.PP || {}) : (module.exports = {}));
