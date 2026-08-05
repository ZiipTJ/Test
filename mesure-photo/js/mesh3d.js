// Construction, contrôle et export de maillages triangulaires.
// Convention de sortie : Z vers le haut, millimètres.

import { triangulate, signedArea } from './triangulate.js';

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const cross = (a, b) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const norm = (a) => Math.hypot(a.x, a.y, a.z);

/** Normale unitaire d'un triangle. */
export function triangleNormal(a, b, c) {
  const n = cross(sub(b, a), sub(c, a));
  const len = norm(n) || 1;
  return { x: n.x / len, y: n.y / len, z: n.z / len };
}

/** Volume signé (théorème de la divergence) — positif si les normales sortent. */
export function meshVolume(mesh) {
  let v = 0;
  for (const [i, j, k] of mesh.triangles) {
    const a = mesh.vertices[i];
    const b = mesh.vertices[j];
    const c = mesh.vertices[k];
    v += dot(a, cross(b, c)) / 6;
  }
  return v;
}

export function meshArea(mesh) {
  let s = 0;
  for (const [i, j, k] of mesh.triangles) {
    const a = mesh.vertices[i];
    s += norm(cross(sub(mesh.vertices[j], a), sub(mesh.vertices[k], a))) / 2;
  }
  return s;
}

export function meshBounds(mesh) {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const p of mesh.vertices) {
    min.x = Math.min(min.x, p.x); max.x = Math.max(max.x, p.x);
    min.y = Math.min(min.y, p.y); max.y = Math.max(max.y, p.y);
    min.z = Math.min(min.z, p.z); max.z = Math.max(max.z, p.z);
  }
  return { min, max, size: { x: max.x - min.x, y: max.y - min.y, z: max.z - min.z } };
}

/**
 * Vérifie que le maillage est fermé : chaque arête doit être parcourue
 * exactement une fois dans chaque sens.
 */
export function checkWatertight(mesh) {
  const edges = new Map();
  for (const [a, b, c] of mesh.triangles) {
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      const key = p < q ? `${p}_${q}` : `${q}_${p}`;
      const dir = p < q ? 1 : -1;
      const cur = edges.get(key) || { count: 0, balance: 0 };
      cur.count++;
      cur.balance += dir;
      edges.set(key, cur);
    }
  }
  let boundary = 0, nonManifold = 0, inconsistent = 0;
  for (const e of edges.values()) {
    if (e.count === 1) boundary++;
    else if (e.count > 2) nonManifold++;
    else if (e.balance !== 0) inconsistent++;
  }
  return { watertight: boundary === 0 && nonManifold === 0 && inconsistent === 0, boundary, nonManifold, inconsistent };
}

/** Applique une échelle uniforme et une conversion de repère. */
export function transformMesh(mesh, fn) {
  return { vertices: mesh.vertices.map(fn), triangles: mesh.triangles };
}

/**
 * Repère du sculptage (Y vertical, pixels) -> repère CAO (Z vertical, mm).
 * Rotation de +90° autour de X : (x, y, z) -> (x, -z, y). Échanger simplement
 * deux axes serait une symétrie et retournerait toutes les faces vers l'intérieur.
 */
export function carveToCad(mesh, mmPerPx) {
  return transformMesh(mesh, (p) => ({ x: p.x * mmPerPx, y: -p.z * mmPerPx, z: p.y * mmPerPx }));
}

/** Ramène le modèle sur Z = 0 et centre X/Y. */
export function centerOnBase(mesh) {
  const b = meshBounds(mesh);
  const cx = (b.min.x + b.max.x) / 2;
  const cy = (b.min.y + b.max.y) / 2;
  return transformMesh(mesh, (p) => ({ x: p.x - cx, y: p.y - cy, z: p.z - b.min.z }));
}

/**
 * Prisme droit à partir d'un contour image (y vers le bas) et de ses trous.
 * `scale` convertit les pixels en millimètres, `thickness` est en millimètres.
 */
export function buildPrism(outerPx, holesPx, thickness, scale = 1) {
  // Repère image (y vers le bas) -> repère CAO (y vers le haut)
  const conv = (ring) => ring.map((p) => ({ x: p.x * scale, y: -p.y * scale }));
  const outer = conv(outerPx);
  const holes = (holesPx || []).map(conv);

  const { vertices: ring2d, triangles: capTris } = triangulate(outer, holes);
  if (!ring2d.length || !capTris.length) return { vertices: [], triangles: [] };

  const vertices = [];
  const bottomOf = new Map();
  const topOf = new Map();
  const keyOf = (p) => `${p.x.toFixed(6)}_${p.y.toFixed(6)}`;

  const addPair = (p) => {
    const key = keyOf(p);
    if (bottomOf.has(key)) return;
    bottomOf.set(key, vertices.length);
    vertices.push({ x: p.x, y: p.y, z: 0 });
    topOf.set(key, vertices.length);
    vertices.push({ x: p.x, y: p.y, z: thickness });
  };
  for (const p of ring2d) addPair(p);

  const triangles = [];
  for (const [a, b, c] of capTris) {
    const ka = keyOf(ring2d[a]);
    const kb = keyOf(ring2d[b]);
    const kc = keyOf(ring2d[c]);
    triangles.push([topOf.get(ka), topOf.get(kb), topOf.get(kc)]);      // dessus, normale +Z
    triangles.push([bottomOf.get(ka), bottomOf.get(kc), bottomOf.get(kb)]); // dessous, normale -Z
  }

  // Parois : chaque anneau est parcouru dans son propre sens (extérieur
  // trigonométrique, trous horaires), ce qui oriente les normales vers l'extérieur.
  const wall = (ring) => {
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i];
      const q = ring[(i + 1) % ring.length];
      const pb = bottomOf.get(keyOf(p));
      const pt = topOf.get(keyOf(p));
      const qb = bottomOf.get(keyOf(q));
      const qt = topOf.get(keyOf(q));
      if (pb == null || qb == null) continue;
      triangles.push([pb, qb, qt], [pb, qt, pt]);
    }
  };
  const ext = signedArea(outer) < 0 ? outer.slice().reverse() : outer.slice();
  wall(ext);
  for (const h of holes) wall(signedArea(h) > 0 ? h.slice().reverse() : h.slice());

  return { vertices, triangles };
}

/** STL binaire. Retourne un Uint8Array. */
export function toBinarySTL(mesh, header = 'mesure-photo') {
  const count = mesh.triangles.length;
  const buffer = new ArrayBuffer(84 + count * 50);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  const text = header.slice(0, 79);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0x7f;
  view.setUint32(80, count, true);

  let off = 84;
  for (const [i, j, k] of mesh.triangles) {
    const a = mesh.vertices[i];
    const b = mesh.vertices[j];
    const c = mesh.vertices[k];
    const n = triangleNormal(a, b, c);
    view.setFloat32(off, n.x, true); view.setFloat32(off + 4, n.y, true); view.setFloat32(off + 8, n.z, true);
    view.setFloat32(off + 12, a.x, true); view.setFloat32(off + 16, a.y, true); view.setFloat32(off + 20, a.z, true);
    view.setFloat32(off + 24, b.x, true); view.setFloat32(off + 28, b.y, true); view.setFloat32(off + 32, b.z, true);
    view.setFloat32(off + 36, c.x, true); view.setFloat32(off + 40, c.y, true); view.setFloat32(off + 44, c.z, true);
    view.setUint16(off + 48, 0, true);
    off += 50;
  }
  return bytes;
}

/** STL ASCII, pratique pour relire le fichier à la main. */
export function toAsciiSTL(mesh, name = 'mesure_photo') {
  const out = [`solid ${name}`];
  const f = (v) => v.toExponential(6);
  for (const [i, j, k] of mesh.triangles) {
    const a = mesh.vertices[i];
    const b = mesh.vertices[j];
    const c = mesh.vertices[k];
    const n = triangleNormal(a, b, c);
    out.push(`  facet normal ${f(n.x)} ${f(n.y)} ${f(n.z)}`);
    out.push('    outer loop');
    for (const p of [a, b, c]) out.push(`      vertex ${f(p.x)} ${f(p.y)} ${f(p.z)}`);
    out.push('    endloop');
    out.push('  endfacet');
  }
  out.push(`endsolid ${name}`);
  return out.join('\n');
}
