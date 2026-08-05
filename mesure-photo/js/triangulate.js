// Triangulation de polygones avec trous (élimination des trous par pont, puis
// découpe en oreilles). Utilisé pour fermer le dessus et le dessous des prismes.

const area2 = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

/** Aire signée : positive si le contour tourne dans le sens trigonométrique. */
export function signedArea(ring) {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

function segmentsProperlyIntersect(p1, p2, p3, p4) {
  const d1 = area2(p3, p4, p1);
  const d2 = area2(p3, p4, p2);
  const d3 = area2(p1, p2, p3);
  const d4 = area2(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Le segment a-b traverse-t-il une arête du contour (hors arêtes partageant un sommet) ? */
function crossesRing(a, b, ring, skipA = -1, skipB = -1) {
  for (let i = 0; i < ring.length; i++) {
    const j = (i + 1) % ring.length;
    if (i === skipA || j === skipA || i === skipB || j === skipB) continue;
    if (segmentsProperlyIntersect(a, b, ring[i], ring[j])) return true;
  }
  return false;
}

/**
 * Relie chaque trou au contour extérieur par un pont, produisant un polygone
 * simple unique. Le pont retenu est le plus court segment qui ne coupe rien.
 */
function eliminateHoles(outer, holes) {
  let ring = outer.slice();

  const sorted = holes
    .map((h) => ({ pts: h, maxX: Math.max(...h.map((p) => p.x)) }))
    .sort((a, b) => b.maxX - a.maxX);

  for (const { pts } of sorted) {
    let best = null;
    for (let hi = 0; hi < pts.length; hi++) {
      for (let oi = 0; oi < ring.length; oi++) {
        const a = pts[hi];
        const b = ring[oi];
        const d = (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
        if (best && d >= best.d) continue;
        if (crossesRing(a, b, ring, oi, oi === 0 ? ring.length - 1 : oi - 1)) continue;
        if (crossesRing(a, b, pts, hi, hi === 0 ? pts.length - 1 : hi - 1)) continue;
        best = { d, hi, oi };
      }
    }
    if (!best) continue; // trou impossible à relier : on l'ignore plutôt que de casser le maillage

    // Insertion : ...outer[oi], hole[hi..], hole[..hi], outer[oi], outer[oi+1]...
    const loop = [];
    for (let k = 0; k <= pts.length; k++) loop.push(pts[(best.hi + k) % pts.length]);
    loop.push(ring[best.oi]);
    ring = ring.slice(0, best.oi + 1).concat(loop, ring.slice(best.oi + 1));
  }
  return ring;
}

const samePoint = (p, q, eps = 1e-9) => Math.abs(p.x - q.x) < eps && Math.abs(p.y - q.y) < eps;

function pointInTriangle(p, a, b, c) {
  const d1 = area2(p, a, b);
  const d2 = area2(p, b, c);
  const d3 = area2(p, c, a);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

/** Découpe en oreilles d'un polygone simple orienté dans le sens trigonométrique. */
function earClip(ring) {
  const n = ring.length;
  const indices = ring.map((_, i) => i);
  const triangles = [];
  let guard = n * n + 100;

  while (indices.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let i = 0; i < indices.length; i++) {
      const i0 = indices[(i - 1 + indices.length) % indices.length];
      const i1 = indices[i];
      const i2 = indices[(i + 1) % indices.length];
      const a = ring[i0];
      const b = ring[i1];
      const c = ring[i2];
      if (area2(a, b, c) <= 0) continue; // sommet réflexe ou plat

      let contains = false;
      for (const k of indices) {
        if (k === i0 || k === i1 || k === i2) continue;
        const p = ring[k];
        // Les ponts vers les trous dupliquent des sommets : un point confondu
        // avec un coin de l'oreille n'est pas un obstacle, sinon plus aucune
        // oreille n'est jamais découpable.
        if (samePoint(p, a) || samePoint(p, b) || samePoint(p, c)) continue;
        if (pointInTriangle(p, a, b, c)) { contains = true; break; }
      }
      if (contains) continue;

      triangles.push([i0, i1, i2]);
      indices.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break; // polygone dégénéré : on s'arrête avec ce qui est fait
  }
  if (indices.length === 3) triangles.push([indices[0], indices[1], indices[2]]);
  return triangles;
}

/**
 * Triangule un contour extérieur et ses trous.
 * Retourne { vertices, triangles } — triangles orientés dans le sens trigonométrique.
 */
export function triangulate(outer, holes = []) {
  if (!outer || outer.length < 3) return { vertices: [], triangles: [] };

  let ext = outer.slice();
  if (signedArea(ext) < 0) ext.reverse();          // extérieur en sens trigonométrique
  const inner = holes
    .filter((h) => h && h.length >= 3)
    .map((h) => (signedArea(h) > 0 ? h.slice().reverse() : h.slice())); // trous en sens horaire

  const ring = inner.length ? eliminateHoles(ext, inner) : ext;
  return { vertices: ring, triangles: earClip(ring) };
}
