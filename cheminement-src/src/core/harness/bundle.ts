/** Formation du toron : positionnement réel des fils dans la section.
 *
 *  Le diamètre d'un toron n'est pas la somme des diamètres. L'usage retient
 *  D ≈ k·√(Σd²), mais cette formule ne dit rien de l'agencement. On range donc
 *  réellement les cercles dans la section (relaxation sous contrainte de
 *  non-recouvrement + attraction vers le centre), ce qui donne à la fois un
 *  diamètre crédible et la position de chaque fil — utile pour dessiner la coupe
 *  et pour corriger la longueur des fils placés à l'extérieur des coudes.
 */

export interface PackedCircle {
  x: number;
  y: number;
  r: number;
  /** Indice dans le tableau de rayons fourni. */
  index: number;
}

export interface PackingResult {
  circles: PackedCircle[];
  /** Rayon du cercle circonscrit, centre ramené en (0,0). */
  radius: number;
}

/** Estimation usuelle du diamètre d'un toron. */
export function estimateBundleDiameter(diameters: readonly number[], packingFactor = 1.15): number {
  if (diameters.length === 0) return 0;
  if (diameters.length === 1) return diameters[0]!;
  let sumSquares = 0;
  for (const d of diameters) sumSquares += d * d;
  return packingFactor * Math.sqrt(sumSquares);
}

const cache = new Map<string, PackingResult>();
const CACHE_LIMIT = 512;

function signature(radii: readonly number[]): string {
  return radii.map((r) => r.toFixed(3)).join(',');
}

/** Rangement des cercles ; le résultat est mis en cache par signature de rayons. */
export function packCircles(radii: readonly number[]): PackingResult {
  if (radii.length === 0) return { circles: [], radius: 0 };
  if (radii.length === 1) return { circles: [{ x: 0, y: 0, r: radii[0]!, index: 0 }], radius: radii[0]! };

  const key = signature(radii);
  const hit = cache.get(key);
  if (hit) return hit;

  const order = radii.map((r, index) => ({ r, index })).sort((a, b) => b.r - a.r);
  const n = order.length;
  const mean = radii.reduce((s, r) => s + r, 0) / n;

  // Semis en spirale de Vogel : départ déterministe et déjà presque compact.
  const circles: PackedCircle[] = order.map((entry, i) => {
    const angle = i * 2.399963229728653;
    const radius = mean * 1.9 * Math.sqrt(i);
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, r: entry.r, index: entry.index };
  });

  /** Une passe de séparation ; renvoie le plus grand recouvrement corrigé.
   *  La correction est répartie selon la surface, pour qu'un gros fil ne soit
   *  pas chassé par un petit. */
  const separate = (relaxation: number): number => {
    let worst = 0;
    for (let i = 0; i < n; i += 1) {
      const a = circles[i]!;
      for (let j = i + 1; j < n; j += 1) {
        const b = circles[j]!;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        const target = a.r + b.r;
        if (d > target - 1e-12) continue;
        if (d < 1e-9) {
          const angle = (i * 2.399963229728653) % (Math.PI * 2);
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          d = 1e-9;
        } else {
          dx /= d;
          dy /= d;
        }
        const overlap = target - d;
        if (overlap > worst) worst = overlap;
        const push = overlap * relaxation;
        const wa = (b.r * b.r) / (a.r * a.r + b.r * b.r);
        const wb = 1 - wa;
        a.x -= dx * push * wa;
        a.y -= dy * push * wa;
        b.x += dx * push * wb;
        b.y += dy * push * wb;
      }
    }
    return worst;
  };

  const iterations = n <= 20 ? 260 : n <= 60 ? 160 : 90;
  for (let step = 0; step < iterations; step += 1) {
    // Attraction vers le centre, d'autant plus faible que la configuration se fige.
    const pull = 0.06 * (1 - step / iterations) + 0.01;
    for (const c of circles) {
      c.x -= c.x * pull;
      c.y -= c.y * pull;
    }
    separate(1);
  }

  // Convergence finale : sans attraction concurrente, les dernières corrections
  // ne se défont plus. Un toron qui se recouvre encore n'aurait aucun sens.
  const scale = Math.max(...radii);
  for (let step = 0; step < 400; step += 1) {
    if (separate(1.05) <= 1e-9 * scale) break;
  }

  // Cercle circonscrit : itération de Bădoiu–Clarkson, qui converge vers le
  // plus petit cercle englobant (c ← c + (support − c)/(k+1)).
  let cx = 0;
  let cy = 0;
  for (const c of circles) { cx += c.x; cy += c.y; }
  cx /= n;
  cy /= n;
  for (let step = 1; step <= 400; step += 1) {
    let far = circles[0]!;
    let best = -Infinity;
    for (const c of circles) {
      const d = Math.hypot(c.x - cx, c.y - cy) + c.r;
      if (d > best) { best = d; far = c; }
    }
    const dx = far.x - cx;
    const dy = far.y - cy;
    const norm = Math.hypot(dx, dy);
    const ux = norm > 1e-12 ? dx / norm : 1;
    const uy = norm > 1e-12 ? dy / norm : 0;
    const supportX = far.x + ux * far.r;
    const supportY = far.y + uy * far.r;
    cx += (supportX - cx) / (step + 1);
    cy += (supportY - cy) / (step + 1);
  }

  let radius = 0;
  for (const c of circles) {
    c.x -= cx;
    c.y -= cy;
    radius = Math.max(radius, Math.hypot(c.x, c.y) + c.r);
  }

  const result: PackingResult = {
    circles: circles.sort((a, b) => a.index - b.index),
    radius,
  };

  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(key, result);
  return result;
}

/** Taux de remplissage d'une gaine : somme des sections de fils / section utile. */
export function fillRatio(diameters: readonly number[], sleeveInnerDiameter: number): number {
  if (sleeveInnerDiameter <= 0) return 0;
  let sumSquares = 0;
  for (const d of diameters) sumSquares += d * d;
  return sumSquares / (sleeveInnerDiameter * sleeveInnerDiameter);
}
