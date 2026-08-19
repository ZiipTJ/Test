/* Algèbre 3D minimale : vecteurs, quaternions, matrices 4x4 colonne-major (WebGL).
   Aucune dépendance : le fichier est chargé tel quel par le navigateur et par Node. */
(function (root) {
  'use strict';

  /* ================= Vec3 ================= */
  const V = {
    add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    len: (a) => Math.hypot(a[0], a[1], a[2]),
    dist: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
    unit(a) { const n = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / n, a[1] / n, a[2] / n]; },
    lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
    /* Un vecteur unitaire quelconque orthogonal à n. */
    perp(n) {
      const r = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
      return V.unit(V.cross(r, n));
    }
  };

  /* ================= Quaternions [x,y,z,w] ================= */
  const Q = {
    id: () => [0, 0, 0, 1],
    fromAxisAngle(axis, ang) {
      const a = V.unit(axis), s = Math.sin(ang / 2);
      return [a[0] * s, a[1] * s, a[2] * s, Math.cos(ang / 2)];
    },
    mul(a, b) {
      return [
        a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
        a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
        a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
        a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
    },
    unit(q) { const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return [q[0] / n, q[1] / n, q[2] / n, q[3] / n]; },
    rotate(q, v) {
      const t = V.mul(V.cross([q[0], q[1], q[2]], v), 2);
      return V.add(V.add(v, V.mul(t, q[3])), V.cross([q[0], q[1], q[2]], t));
    },
    /* Angles de rotation extrinsèques XYZ, en degrés — pour l'affichage. */
    toEulerDeg(q) {
      const [x, y, z, w] = q;
      const sy = 2 * (w * y - z * x);
      const p = Math.abs(sy) >= 1 ? Math.sign(sy) * Math.PI / 2 : Math.asin(sy);
      const r = Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y));
      const yaw = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
      const d = 180 / Math.PI;
      return [r * d, p * d, yaw * d];
    },
    fromEulerDeg(e) {
      const r = e.map(a => a * Math.PI / 180);
      let q = Q.fromAxisAngle([0, 0, 1], r[2]);
      q = Q.mul(q, Q.fromAxisAngle([0, 1, 0], r[1]));
      q = Q.mul(q, Q.fromAxisAngle([1, 0, 0], r[0]));
      return Q.unit(q);
    }
  };

  /* ================= Mat4 (colonne-major) ================= */
  const M = {
    identity: () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
    mul(a, b) {
      const o = new Float32Array(16);
      for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
        let s = 0;
        for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
        o[c * 4 + r] = s;
      }
      return o;
    },
    translation(t) {
      const m = M.identity();
      m[12] = t[0]; m[13] = t[1]; m[14] = t[2];
      return m;
    },
    scaling(s) {
      const m = M.identity();
      m[0] = s; m[5] = s; m[10] = s;
      return m;
    },
    fromQuat(q) {
      const [x, y, z, w] = Q.unit(q);
      return new Float32Array([
        1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
        2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
        2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0,
        0, 0, 0, 1]);
    },
    /* Composition d'un acteur : translation, puis rotation autour du pivot. */
    compose(offset, quat, pivot) {
      const R = M.fromQuat(quat);
      const T1 = M.translation([offset[0] + pivot[0], offset[1] + pivot[1], offset[2] + pivot[2]]);
      const T0 = M.translation([-pivot[0], -pivot[1], -pivot[2]]);
      return M.mul(M.mul(T1, R), T0);
    },
    apply(m, p) {
      const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15] || 1;
      return [
        (m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12]) / w,
        (m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13]) / w,
        (m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]) / w];
    },
    applyDir(m, p) {
      return [
        m[0] * p[0] + m[4] * p[1] + m[8] * p[2],
        m[1] * p[0] + m[5] * p[1] + m[9] * p[2],
        m[2] * p[0] + m[6] * p[1] + m[10] * p[2]];
    },
    perspective(fovyRad, aspect, near, far) {
      const f = 1 / Math.tan(fovyRad / 2);
      const m = new Float32Array(16);
      m[0] = f / aspect; m[5] = f; m[11] = -1;
      m[10] = (far + near) / (near - far);
      m[14] = 2 * far * near / (near - far);
      return m;
    },
    ortho(l, r, b, t, n, f) {
      const m = M.identity();
      m[0] = 2 / (r - l); m[5] = 2 / (t - b); m[10] = -2 / (f - n);
      m[12] = -(r + l) / (r - l); m[13] = -(t + b) / (t - b); m[14] = -(f + n) / (f - n);
      return m;
    },
    lookAt(eye, target, up) {
      const z = V.unit(V.sub(eye, target));
      let x = V.cross(up, z);
      if (V.len(x) < 1e-8) x = V.cross([0, 0, 1], z);
      x = V.unit(x);
      const y = V.cross(z, x);
      return new Float32Array([
        x[0], y[0], z[0], 0,
        x[1], y[1], z[1], 0,
        x[2], y[2], z[2], 0,
        -V.dot(x, eye), -V.dot(y, eye), -V.dot(z, eye), 1]);
    },
    invert(a) {
      const m = a, o = new Float32Array(16);
      const b00 = m[0] * m[5] - m[1] * m[4], b01 = m[0] * m[6] - m[2] * m[4];
      const b02 = m[0] * m[7] - m[3] * m[4], b03 = m[1] * m[6] - m[2] * m[5];
      const b04 = m[1] * m[7] - m[3] * m[5], b05 = m[2] * m[7] - m[3] * m[6];
      const b06 = m[8] * m[13] - m[9] * m[12], b07 = m[8] * m[14] - m[10] * m[12];
      const b08 = m[8] * m[15] - m[11] * m[12], b09 = m[9] * m[14] - m[10] * m[13];
      const b10 = m[9] * m[15] - m[11] * m[13], b11 = m[10] * m[15] - m[11] * m[14];
      let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
      if (!det) return M.identity();
      det = 1 / det;
      o[0] = (m[5] * b11 - m[6] * b10 + m[7] * b09) * det;
      o[1] = (m[2] * b10 - m[1] * b11 - m[3] * b09) * det;
      o[2] = (m[13] * b05 - m[14] * b04 + m[15] * b03) * det;
      o[3] = (m[10] * b04 - m[9] * b05 - m[11] * b03) * det;
      o[4] = (m[6] * b08 - m[4] * b11 - m[7] * b07) * det;
      o[5] = (m[0] * b11 - m[2] * b08 + m[3] * b07) * det;
      o[6] = (m[14] * b02 - m[12] * b05 - m[15] * b01) * det;
      o[7] = (m[8] * b05 - m[10] * b02 + m[11] * b01) * det;
      o[8] = (m[4] * b10 - m[5] * b08 + m[7] * b06) * det;
      o[9] = (m[1] * b08 - m[0] * b10 - m[3] * b06) * det;
      o[10] = (m[12] * b04 - m[13] * b02 + m[15] * b00) * det;
      o[11] = (m[9] * b02 - m[8] * b04 - m[11] * b00) * det;
      o[12] = (m[5] * b07 - m[4] * b09 - m[6] * b06) * det;
      o[13] = (m[0] * b09 - m[1] * b07 + m[2] * b06) * det;
      o[14] = (m[13] * b01 - m[12] * b03 - m[14] * b00) * det;
      o[15] = (m[8] * b03 - m[9] * b01 + m[10] * b00) * det;
      return o;
    },
    transpose(a) {
      const o = new Float32Array(16);
      for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) o[c * 4 + r] = a[r * 4 + c];
      return o;
    },
    /* Matrice des normales = transposée de l'inverse (bloc 3x3, ici en 4x4). */
    normalMatrix: (m) => M.transpose(M.invert(m))
  };

  /* ================= Géométrie de picking ================= */
  /* Point de la droite (o,d) le plus proche de la droite (o2,d2). Retourne les
     paramètres (t, s) ; null si les droites sont parallèles. */
  function closestBetweenLines(o1, d1, o2, d2) {
    const a = V.dot(d1, d1), b = V.dot(d1, d2), c = V.dot(d2, d2);
    const w = V.sub(o1, o2);
    const d = V.dot(d1, w), e = V.dot(d2, w);
    const den = a * c - b * b;
    if (Math.abs(den) < 1e-12) return null;
    return { t: (b * e - c * d) / den, s: (a * e - b * d) / den };
  }

  /* Intersection rayon / plan (point p, normale n). */
  function rayPlane(o, d, p, n) {
    const den = V.dot(d, n);
    if (Math.abs(den) < 1e-12) return null;
    const t = V.dot(V.sub(p, o), n) / den;
    return t < 0 ? null : V.add(o, V.mul(d, t));
  }

  /* Intersection rayon / triangle (Möller–Trumbore). Retourne t ou null. */
  function rayTriangle(o, d, a, b, c) {
    const e1 = V.sub(b, a), e2 = V.sub(c, a);
    const h = V.cross(d, e2), det = V.dot(e1, h);
    if (Math.abs(det) < 1e-12) return null;
    const f = 1 / det, s = V.sub(o, a);
    const u = f * V.dot(s, h);
    if (u < -1e-9 || u > 1 + 1e-9) return null;
    const q = V.cross(s, e1);
    const v = f * V.dot(d, q);
    if (v < -1e-9 || u + v > 1 + 1e-9) return null;
    const t = f * V.dot(e2, q);
    return t > 1e-9 ? t : null;
  }

  root.M3D = { V, Q, M, closestBetweenLines, rayPlane, rayTriangle };
})(typeof window !== 'undefined' ? (window.SWC = window.SWC || {}) : (module.exports = {}));
