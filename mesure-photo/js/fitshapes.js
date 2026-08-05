// Décomposition d'un contour en primitives : segments droits et arcs de cercle.
// C'est ce qui permet de lire directement les rayons de congé d'une pièce
// (R12,5 dans un coin) au lieu d'un nuage de points.
//
// Chaîne : rééchantillonnage à pas constant -> courbure locale par cercle
// circonscrit -> lissage -> classement droite/arc -> découpe aux ruptures de
// rayon -> réajustement aux moindres carrés de chaque morceau.

/** Rééchantillonne un contour fermé à pas constant (longueur d'arc). */
export function resampleClosed(points, spacing = 2) {
  if (points.length < 3) return points.slice();
  const pts = points.slice();
  const out = [];
  let carry = 0;

  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    let t = carry;
    while (t < len) {
      out.push({ x: a.x + (dx * t) / len, y: a.y + (dy * t) / len });
      t += spacing;
    }
    carry = t - len;
  }
  return out.length >= 3 ? out : pts;
}

/** Moyenne glissante circulaire sur les coordonnées. */
function smoothClosed(points, radius) {
  if (radius <= 0) return points.slice();
  const n = points.length;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    let sx = 0, sy = 0, c = 0;
    for (let k = -radius; k <= radius; k++) {
      const p = points[(i + k + n * 2) % n];
      sx += p.x; sy += p.y; c++;
    }
    out[i] = { x: sx / c, y: sy / c };
  }
  return out;
}

/**
 * Courbure signée en chaque point, par cercle circonscrit à (p[i-w], p[i], p[i+w]).
 * Le signe indique le sens de virage (utile pour distinguer congé et dégagement).
 */
export function curvatureProfile(points, window = 8) {
  const n = points.length;
  const k = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = points[(i - window + n * 2) % n];
    const b = points[i];
    const c = points[(i + window) % n];
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const ab = Math.hypot(b.x - a.x, b.y - a.y);
    const bc = Math.hypot(c.x - b.x, c.y - b.y);
    const ca = Math.hypot(a.x - c.x, a.y - c.y);
    const denom = ab * bc * ca;
    k[i] = denom < 1e-9 ? 0 : (2 * cross) / denom;
  }
  return k;
}

function smoothSignal(values, radius) {
  const n = values.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0, c = 0;
    for (let j = -radius; j <= radius; j++) {
      s += values[(i + j + n * 2) % n];
      c++;
    }
    out[i] = s / c;
  }
  return out;
}

/** Ajustement de cercle aux moindres carrés (méthode de Kåsa). */
export function fitCircle(points) {
  const n = points.length;
  if (n < 3) return null;
  let mx = 0, my = 0;
  for (const p of points) { mx += p.x; my += p.y; }
  mx /= n; my /= n;

  let Suu = 0, Suv = 0, Svv = 0, Suuu = 0, Svvv = 0, Suvv = 0, Svuu = 0;
  for (const p of points) {
    const u = p.x - mx;
    const v = p.y - my;
    Suu += u * u; Svv += v * v; Suv += u * v;
    Suuu += u * u * u; Svvv += v * v * v;
    Suvv += u * v * v; Svuu += v * u * u;
  }
  const det = Suu * Svv - Suv * Suv;
  if (Math.abs(det) < 1e-12) return null;

  const c1 = (Suuu + Suvv) / 2;
  const c2 = (Svvv + Svuu) / 2;
  const uc = (c1 * Svv - c2 * Suv) / det;
  const vc = (c2 * Suu - c1 * Suv) / det;
  const radius = Math.sqrt(uc * uc + vc * vc + (Suu + Svv) / n);

  const center = { x: uc + mx, y: vc + my };
  let rms = 0;
  for (const p of points) rms += (Math.hypot(p.x - center.x, p.y - center.y) - radius) ** 2;
  return { center, radius, rms: Math.sqrt(rms / n) };
}

/** Ajustement de droite (axe principal). */
export function fitLine(points) {
  const n = points.length;
  if (n < 2) return null;
  let mx = 0, my = 0;
  for (const p of points) { mx += p.x; my += p.y; }
  mx /= n; my /= n;

  let sxx = 0, syy = 0, sxy = 0;
  for (const p of points) {
    const dx = p.x - mx;
    const dy = p.y - my;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const dir = { x: Math.cos(theta), y: Math.sin(theta) };

  let tMin = Infinity, tMax = -Infinity, rms = 0;
  for (const p of points) {
    const t = (p.x - mx) * dir.x + (p.y - my) * dir.y;
    const d = -(p.x - mx) * dir.y + (p.y - my) * dir.x;
    rms += d * d;
    if (t < tMin) tMin = t;
    if (t > tMax) tMax = t;
  }
  let a = { x: mx + dir.x * tMin, y: my + dir.y * tMin };
  let b = { x: mx + dir.x * tMax, y: my + dir.y * tMax };
  // Orienter la droite dans le sens de parcours du contour : l'axe principal
  // sort trié par projection, ce qui peut inverser début et fin — et fausser
  // ensuite le raccordement avec les arcs voisins.
  const first = points[0];
  if (Math.hypot(first.x - b.x, first.y - b.y) < Math.hypot(first.x - a.x, first.y - a.y)) {
    const tmp = a; a = b; b = tmp;
  }

  return {
    a,
    b,
    length: tMax - tMin,
    angle: theta,
    rms: Math.sqrt(rms / n),
  };
}

/** Balayage angulaire cumulé le long des points : robuste au-delà de 180°. */
function accumulatedSweep(points, center) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a0 = Math.atan2(points[i - 1].y - center.y, points[i - 1].x - center.x);
    const a1 = Math.atan2(points[i].y - center.y, points[i].x - center.x);
    let d = a1 - a0;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    total += d;
  }
  return total;
}

/** Ramène `value` à ±2kπ près le plus proche de `reference`. */
function nearestSweep(value, reference) {
  let best = value;
  for (let k = -2; k <= 2; k++) {
    const candidate = value + k * 2 * Math.PI;
    if (Math.abs(candidate - reference) < Math.abs(best - reference)) best = candidate;
  }
  return best;
}

/** Découpe une suite d'indices en tronçons de classe homogène (droite / arc). */
function groupRuns(labels) {
  const n = labels.length;
  const runs = [];
  let start = 0;
  for (let i = 1; i <= n; i++) {
    if (i === n || labels[i] !== labels[start]) {
      runs.push({ kind: labels[start], start, end: i - 1 });
      start = i;
    }
  }
  // Contour fermé : recoller le dernier tronçon au premier s'ils sont de même classe
  if (runs.length > 1 && runs[0].kind === runs[runs.length - 1].kind) {
    const last = runs.pop();
    runs[0] = { kind: runs[0].kind, start: last.start - n, end: runs[0].end };
  }
  return runs;
}

/** Coupe un tronçon d'arc là où le rayon change franchement. */
function splitOnRadiusChange(run, kappa, n, ratio = 0.45) {
  const idx = [];
  for (let i = run.start; i <= run.end; i++) idx.push((i + n * 2) % n);
  const values = idx.map((i) => Math.abs(kappa[i]));
  const pieces = [];
  let startPos = 0;
  let ref = values[0];

  for (let p = 1; p < values.length; p++) {
    const v = values[p];
    if (ref > 1e-9 && Math.abs(v - ref) / ref > ratio) {
      pieces.push({ kind: run.kind, start: run.start + startPos, end: run.start + p - 1 });
      startPos = p;
      ref = v;
    } else {
      // moyenne glissante de référence, pour suivre une dérive douce
      ref = ref * 0.85 + v * 0.15;
    }
  }
  pieces.push({ kind: run.kind, start: run.start + startPos, end: run.end });
  return pieces;
}

/**
 * Décompose un contour fermé en droites et arcs.
 *
 * @param contour points du contour (pixels)
 * @param options.spacing        pas de rééchantillonnage (px)
 * @param options.window         demi-fenêtre de calcul de courbure (points)
 * @param options.minLength      longueur minimale d'une primitive retenue (px)
 * @param options.straightFactor un tronçon est droit si son rayon dépasse
 *                               straightFactor × la diagonale de la pièce
 * @returns { primitives, resampled, kappa }
 */
export function fitPrimitives(contour, options = {}) {
  const spacing = options.spacing || 2;
  const minLength = options.minLength || 8;
  const straightFactor = options.straightFactor || 1.2;

  const raw = resampleClosed(contour, spacing);
  if (raw.length < 12) return { primitives: [], resampled: raw, kappa: new Float64Array(0) };
  // Le lissage stabilise le découpage. Il rabote légèrement les congés serrés,
  // mais ajuster sur les points bruts fait bien pire : l'ajustement de cercle
  // est biaisé vers le bas sur un arc court et crénelé par la pixellisation.
  // Le réglage `smooth` permet de l'abaisser quand les congés sont petits.
  const pts = smoothClosed(raw, Math.max(0, Math.round((options.smooth ?? 2))));

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const diag = Math.hypot(maxX - minX, maxY - minY);

  const window = options.window || Math.max(4, Math.round(pts.length / 60));
  const kappa = smoothSignal(curvatureProfile(pts, window), Math.max(1, Math.round(window / 2)));

  // Un point est « droit » si le rayon local dépasse une fraction de la pièce.
  const kappaLine = 1 / (straightFactor * diag);
  const labels = Array.from(kappa, (k) => (Math.abs(k) < kappaLine ? 'line' : 'arc'));

  const n = pts.length;
  let runs = groupRuns(labels);
  const split = [];
  for (const run of runs) {
    if (run.kind === 'arc') split.push(...splitOnRadiusChange(run, kappa, n));
    else split.push(run);
  }

  // Les tronçons trop courts sont absorbés par leur voisin plutôt que jetés :
  // les abandonner laisserait des trous dans le contour et amputerait le
  // balayage des arcs.
  const runLength = (run) => Math.abs(run.end - run.start + 1) * spacing;
  while (split.length > 1) {
    let shortest = -1;
    for (let i = 0; i < split.length; i++) {
      if (runLength(split[i]) >= minLength) continue;
      if (shortest < 0 || runLength(split[i]) < runLength(split[shortest])) shortest = i;
    }
    if (shortest < 0) break;

    // Fusionner avec le voisin contigu *en indice* : au point de bouclage du
    // contour, joindre le dernier tronçon au premier casserait l'ordre.
    const short = split[shortest];
    const targetIdx = shortest > 0 ? shortest - 1 : 1;
    const target = split[targetIdx];
    // La nature du tronçon le plus long l'emporte : une pointe d'arc parasite
    // ne doit pas transformer un long méplat en courbe, ni l'inverse.
    const kind = runLength(target) >= runLength(short) ? target.kind : short.kind;
    split[targetIdx] = shortest > 0
      ? { kind, start: target.start, end: short.end }
      : { kind, start: short.start, end: target.end };
    split.splice(shortest, 1);
  }

  const primitives = [];
  for (const run of split) {
    const idx = [];
    for (let i = run.start; i <= run.end; i++) idx.push((i + n * 2) % n);
    if (idx.length < 3) continue;
    const segment = idx.map((i) => pts[i]);

    let length = 0;
    for (let i = 1; i < segment.length; i++) length += Math.hypot(segment[i].x - segment[i - 1].x, segment[i].y - segment[i - 1].y);

    if (run.kind === 'line') {
      const line = fitLine(segment);
      if (line) primitives.push({ type: 'line', ...line, points: segment });
      continue;
    }

    const circle = fitCircle(segment);
    if (!circle || !isFinite(circle.radius)) continue;
    // Un « arc » de très grand rayon est en réalité une droite.
    if (circle.radius > straightFactor * diag) {
      const line = fitLine(segment);
      if (line) primitives.push({ type: 'line', ...line, points: segment });
      continue;
    }

    const angleOf = (p) => Math.atan2(p.y - circle.center.y, p.x - circle.center.x);
    const a0 = angleOf(segment[0]);
    const a1 = angleOf(segment[segment.length - 1]);
    const meanK = idx.reduce((s, i) => s + kappa[i], 0) / idx.length;
    // Le balayage cumulé le long des points reste juste au-delà d'un demi-tour,
    // là où la seule différence des angles extrêmes devient ambiguë.
    const sweep = accumulatedSweep(segment, circle.center);

    primitives.push({
      type: 'arc',
      center: circle.center,
      radius: circle.radius,
      rms: circle.rms,
      startAngle: a0,
      endAngle: a1,
      sweep,
      length,
      concave: meanK < 0,
      points: segment,
    });
  }

  const merged = absorbTiny(mergeSimilar(primitives), minLength, options.minSweepDeg ?? 15);
  refineBoundaries(merged, options.refine ?? 2);
  snapTangency(merged);

  // Un contour fermé décrit par un seul arc est un cercle entier : son balayage
  // vaut un tour, et non la portion couverte par les points échantillonnés.
  if (merged.length === 1 && merged[0].type === 'arc') {
    const arc = merged[0];
    arc.sweep = Math.sign(arc.sweep || 1) * 2 * Math.PI;
    arc.length = 2 * Math.PI * arc.radius;
    arc.full = true;
  }

  return { primitives: merged, resampled: raw, smoothed: pts, kappa, diag };
}

/**
 * Recale les frontières entre primitives voisines de nature différente.
 *
 * Le classement par courbure est flou près d'un raccordement : les points de la
 * zone de tangence sont presque droits et presque courbes à la fois. Happés par
 * l'arc, ils l'aplatissent et gonflent son rayon — l'effet est net sur les coins
 * obtus, dont le congé ne balaie que quelques degrés. On rend donc chaque point
 * de la zone de doute à la primitive qui l'explique le mieux, puis on réajuste.
 */
function refineBoundaries(primitives, iterations = 2) {
  const n = primitives.length;
  if (n < 2 || iterations <= 0) return primitives;

  for (let iter = 0; iter < iterations; iter++) {
    for (let i = 0; i < n; i++) {
      const A = primitives[i];
      const B = primitives[(i + 1) % n];
      if (!A || !B || A === B || A.type === B.type) continue;

      const m = Math.min(24, Math.floor(A.points.length / 2), Math.floor(B.points.length / 2));
      if (m < 3) continue;

      const zone = A.points.slice(A.points.length - m).concat(B.points.slice(0, m));
      const keepA = A.points.slice(0, A.points.length - m);
      const keepB = B.points.slice(m);

      // Coût d'une coupure : somme des écarts, chaque point étant rendu à la
      // primitive qui le contient le mieux.
      let bestSplit = m;
      let bestCost = Infinity;
      for (let s = 0; s <= zone.length; s++) {
        let cost = 0;
        for (let k = 0; k < zone.length; k++) {
          cost += residual(k < s ? A : B, [zone[k]]);
        }
        if (cost < bestCost) { bestCost = cost; bestSplit = s; }
      }

      const newA = keepA.concat(zone.slice(0, bestSplit));
      const newB = zone.slice(bestSplit).concat(keepB);
      if (newA.length < 4 || newB.length < 4) continue;

      const fitA = refit(A.type, newA);
      const fitB = refit(B.type, newB);
      if (!fitA || !fitB) continue;
      primitives[i] = fitA;
      primitives[(i + 1) % n] = fitB;
    }
  }
  return primitives;
}

/** Reconstruit une primitive à partir d'un nuage de points et d'un type imposé. */
function refit(type, points) {
  if (type === 'line') {
    const l = fitLine(points);
    return l ? { type: 'line', ...l, points } : null;
  }
  const c = fitCircle(points);
  if (!c || !isFinite(c.radius)) return null;
  const ang = (p) => Math.atan2(p.y - c.center.y, p.x - c.center.x);
  const sweep = accumulatedSweep(points, c.center);
  return {
    type: 'arc',
    center: c.center,
    radius: c.radius,
    rms: c.rms,
    startAngle: ang(points[0]),
    endAngle: ang(points[points.length - 1]),
    sweep,
    length: Math.abs(sweep) * c.radius,
    concave: sweep < 0,
    points,
  };
}

/** Écart moyen d'un nuage de points à une primitive déjà ajustée. */
function residual(primitive, points) {
  if (primitive.type === 'arc') {
    let s = 0;
    for (const p of points) s += Math.abs(Math.hypot(p.x - primitive.center.x, p.y - primitive.center.y) - primitive.radius);
    return s / points.length;
  }
  const dx = primitive.b.x - primitive.a.x;
  const dy = primitive.b.y - primitive.a.y;
  const len = Math.hypot(dx, dy) || 1;
  let s = 0;
  for (const p of points) s += Math.abs((p.x - primitive.a.x) * dy - (p.y - primitive.a.y) * dx) / len;
  return s / points.length;
}

/**
 * Réabsorbe les primitives insignifiantes. Un arc de quelques degrés n'a pas de
 * rayon exploitable : trop court, l'ajustement de cercle est mal conditionné et
 * sort une valeur arbitraire. On le rend au voisin qui explique le mieux ses
 * points, plutôt que de le publier comme un rayon de la pièce.
 */
function absorbTiny(primitives, minLength, minSweepDeg) {
  let list = primitives.slice();
  const tiny = (p) => (p.type === 'arc'
    ? Math.abs((p.sweep * 180) / Math.PI) < minSweepDeg
    : p.length < minLength);

  let guard = list.length * 3;
  while (list.length > 1 && guard-- > 0) {
    const idx = list.findIndex(tiny);
    if (idx < 0) break;

    const cur = list[idx];
    const prevIdx = (idx - 1 + list.length) % list.length;
    const nextIdx = (idx + 1) % list.length;
    const prev = list[prevIdx];
    const next = list[nextIdx];

    const usePrev = prevIdx !== idx && (nextIdx === idx || residual(prev, cur.points) <= residual(next, cur.points));
    const host = usePrev ? prev : next;
    const hostIdx = usePrev ? prevIdx : nextIdx;
    const points = usePrev ? host.points.concat(cur.points) : cur.points.concat(host.points);

    const rebuilt = refit(host.type, points);
    if (!rebuilt) break;
    list[hostIdx] = rebuilt;
    list.splice(idx, 1);
  }
  return list;
}

/**
 * Fusionne les primitives voisines qui décrivent la même chose : un cercle
 * entier découpé en tronçons, ou une droite coupée en deux par du bruit.
 */
function mergeSimilar(primitives, radiusTol = 0.18, angleTol = 4) {
  let list = primitives.slice();
  let changed = true;

  while (changed && list.length > 1) {
    changed = false;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      const b = list[(i + 1) % list.length];
      if (a === b) continue;

      let fused = null;
      if (a.type === 'arc' && b.type === 'arc' && a.concave === b.concave) {
        const dr = Math.abs(a.radius - b.radius) / Math.max(a.radius, b.radius);
        const dc = Math.hypot(a.center.x - b.center.x, a.center.y - b.center.y);
        const similar = dr < radiusTol && dc < 0.3 * Math.max(a.radius, b.radius);
        const pts = a.points.concat(b.points);
        const c = fitCircle(pts);
        // Deux arcs voisins fusionnent s'ils se ressemblent, mais aussi — et
        // surtout — si un cercle unique explique bien leurs points réunis :
        // un même congé coupé en deux par le bruit donne deux rayons très
        // différents alors qu'un seul cercle les décrit parfaitement.
        const explained = c && c.rms < Math.max(1.2, 0.03 * c.radius);
        if (explained || (similar && c && c.rms < Math.max(2, 0.05 * c.radius))) {
          fused = { ...a, center: c.center, radius: c.radius, rms: c.rms, points: pts };
          const ang = (p) => Math.atan2(p.y - c.center.y, p.x - c.center.x);
          fused.startAngle = ang(pts[0]);
          fused.endAngle = ang(pts[pts.length - 1]);
          fused.sweep = accumulatedSweep(pts, c.center);
          fused.length = Math.abs(fused.sweep) * c.radius;
        }
      } else if (a.type === 'line' && b.type === 'line') {
        let da = Math.abs(((a.angle - b.angle) * 180) / Math.PI) % 180;
        if (da > 90) da = 180 - da;
        if (da < angleTol) {
          const pts = a.points.concat(b.points);
          const l = fitLine(pts);
          if (l && l.rms < 1.5) fused = { type: 'line', ...l, points: pts };
        }
      }

      if (fused) {
        const j = (i + 1) % list.length;
        list[i] = fused;
        list.splice(j, 1);
        changed = true;
        break;
      }
    }
  }
  return list;
}

/**
 * Cale les frontières sur la tangence. Les points proches d'un raccordement
 * sont ambigus : ni franchement droits ni franchement courbes, ils se font
 * absorber par l'arc et raccourcissent le méplat. Or pour un congé tangent, le
 * point de raccordement est exactement le projeté du centre de l'arc sur la
 * droite — ce qui donne la vraie longueur du méplat et le vrai balayage.
 */
function snapTangency(primitives) {
  const n = primitives.length;
  if (n < 2) return primitives;

  const project = (line, point) => {
    const dx = line.b.x - line.a.x;
    const dy = line.b.y - line.a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-9) return { ...line.a };
    const t = ((point.x - line.a.x) * dx + (point.y - line.a.y) * dy) / len2;
    return { x: line.a.x + dx * t, y: line.a.y + dy * t };
  };
  const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);

  for (let i = 0; i < n; i++) {
    const prev = primitives[(i - 1 + n) % n];
    const cur = primitives[i];
    const next = primitives[(i + 1) % n];
    if (cur.type !== 'line') continue;

    for (const [neighbour, isNext] of [[prev, false], [next, true]]) {
      if (!neighbour || neighbour.type !== 'arc') continue;
      const tangent = project(cur, neighbour.center);
      // On ne déplace l'extrémité que si le point de tangence reste proche :
      // au-delà, la géométrie n'est pas un vrai raccordement tangent.
      const end = isNext ? cur.b : cur.a;
      if (dist(tangent, end) > 0.6 * neighbour.radius + 4) continue;
      if (isNext) cur.b = tangent;
      else cur.a = tangent;
    }
    cur.length = dist(cur.a, cur.b);
  }

  // Les arcs reprennent leur étendue entre les tangences retenues.
  for (let i = 0; i < n; i++) {
    const cur = primitives[i];
    if (cur.type !== 'arc') continue;
    const prev = primitives[(i - 1 + n) % n];
    const next = primitives[(i + 1) % n];
    const ang = (p) => Math.atan2(p.y - cur.center.y, p.x - cur.center.x);
    const reference = cur.sweep;
    if (prev && prev.type === 'line') cur.startAngle = ang(prev.b);
    if (next && next.type === 'line') cur.endAngle = ang(next.a);
    // On garde la détermination la plus proche du balayage déjà mesuré sur les
    // points : les angles extrêmes seuls sont définis à un tour près.
    cur.sweep = nearestSweep(cur.endAngle - cur.startAngle, reference);
    cur.length = Math.abs(cur.sweep) * cur.radius;
  }
  return primitives;
}

/**
 * Regroupe les arcs de rayon voisin : « 4 congés R12,5 » se lit mieux que
 * quatre lignes presque identiques.
 * @param tolerance écart relatif admis pour considérer deux rayons identiques
 */
export function groupRadii(primitives, tolerance = 0.12) {
  const arcs = primitives.filter((p) => p.type === 'arc').sort((a, b) => a.radius - b.radius);
  const groups = [];
  for (const arc of arcs) {
    const g = groups.find((x) => Math.abs(arc.radius - x.mean) / x.mean <= tolerance);
    if (g) {
      g.items.push(arc);
      g.mean = g.items.reduce((s, a) => s + a.radius, 0) / g.items.length;
    } else {
      groups.push({ mean: arc.radius, items: [arc] });
    }
  }
  return groups
    .map((g) => ({
      radius: g.mean,
      count: g.items.length,
      min: Math.min(...g.items.map((a) => a.radius)),
      max: Math.max(...g.items.map((a) => a.radius)),
      totalSweep: g.items.reduce((s, a) => s + Math.abs(a.sweep), 0),
      items: g.items,
    }))
    .sort((a, b) => b.count - a.count || a.radius - b.radius);
}
