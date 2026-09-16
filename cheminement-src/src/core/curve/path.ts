/** Construction de la fibre neutre d'un segment de cheminement.
 *
 *  Un câble ne suit pas une spline quelconque : il part droit du connecteur, suit
 *  des portions rectilignes et raccorde les changements de direction par des arcs
 *  de rayon maîtrisé — c'est exactement ce que contrôle un rayon de coude mini.
 *  On construit donc une polyligne raccordée par arcs tangents, puis on l'échantillonne
 *  à flèche imposée. Le rayon effectivement obtenu à chaque coude est renvoyé : c'est
 *  lui qui sert au contrôle « rayon de courbure » du faisceau.
 */
import {
  add,
  angleBetween,
  cross,
  distance,
  dot,
  type Vec3,
  normalize,
  rotateAround,
  scale,
  sub,
} from '../math/vec';

export interface PathCorner {
  /** Sommet théorique de la polyligne. */
  vertex: Vec3;
  /** Rayon réellement appliqué (mm), réduit si les brins adjacents sont courts. */
  radius: number;
  /** Angle de déviation (rad) : 0 = tout droit. */
  turnAngle: number;
  /** Vrai si le rayon demandé a dû être réduit faute de place. */
  clamped: boolean;
  /** Abscisse curviligne du milieu de l'arc. */
  station: number;
  /** Direction du centre de l'arc depuis la fibre neutre (vers l'intérieur du virage). */
  inward: Vec3;
  /** Axe de rotation de l'arc. */
  axis: Vec3;
}

export interface SampledPath {
  points: Vec3[];
  tangents: Vec3[];
  /** Abscisse curviligne cumulée, même longueur que `points`. */
  stations: number[];
  length: number;
  corners: PathCorner[];
  /** Plus petit rayon de coude effectif ; Infinity si le tracé est rectiligne. */
  minRadius: number;
}

export interface BuildPathOptions {
  /** Rayon de coude unique, ou un rayon par point de contrôle (même longueur
   *  que la polyligne fournie) lorsque les tronçons n'ont pas le même réglage. */
  bendRadius: number | readonly number[];
  /** Flèche maximale admise lors de l'échantillonnage des arcs (mm). */
  tolerance?: number;
  /** Nombre de points mini sur un arc. */
  minArcSteps?: number;
}

const EPS = 1e-7;

/** Supprime les points confondus, en conservant la trace des indices retenus. */
export function cleanPolylineIndexed(points: readonly Vec3[], epsilon = 1e-6): { points: Vec3[]; kept: number[] } {
  const out: Vec3[] = [];
  const kept: number[] = [];
  points.forEach((p, i) => {
    const last = out[out.length - 1];
    if (!last || distance(last, p) > epsilon) {
      out.push(p);
      kept.push(i);
    }
  });
  return { points: out, kept };
}

export function cleanPolyline(points: readonly Vec3[], epsilon = 1e-6): Vec3[] {
  return cleanPolylineIndexed(points, epsilon).points;
}

export function polylineLength(points: readonly Vec3[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += distance(points[i - 1]!, points[i]!);
  return total;
}

/**
 * Raccorde la polyligne par des arcs tangents et l'échantillonne.
 * Renvoie systématiquement au moins deux points, même pour une entrée dégénérée.
 */
export function buildPath(control: readonly Vec3[], options: BuildPathOptions): SampledPath {
  const cleaned = cleanPolylineIndexed(control);
  const pts = cleaned.points;
  if (pts.length < 2) {
    const p = pts[0] ?? ([0, 0, 0] as Vec3);
    return {
      points: [p, p],
      tangents: [[1, 0, 0], [1, 0, 0]],
      stations: [0, 0],
      length: 0,
      corners: [],
      minRadius: Infinity,
    };
  }

  const tolerance = options.tolerance ?? 0.4;
  const minArcSteps = options.minArcSteps ?? 3;
  const radiusList = options.bendRadius;
  const radiusAt = (index: number): number =>
    typeof radiusList === 'number'
      ? Math.max(0, radiusList)
      : Math.max(0, radiusList[cleaned.kept[index] ?? index] ?? 0);

  const n = pts.length;
  const dirs: Vec3[] = [];
  const lens: number[] = [];
  for (let i = 1; i < n; i += 1) {
    const d = sub(pts[i]!, pts[i - 1]!);
    lens.push(Math.hypot(d[0], d[1], d[2]));
    dirs.push(normalize(d));
  }

  // Longueur de tangente souhaitée à chaque sommet intérieur.
  const angles = new Array<number>(n).fill(0);
  const tangentLen = new Array<number>(n).fill(0);
  for (let i = 1; i < n - 1; i += 1) {
    const d1 = dirs[i - 1]!;
    const d2 = dirs[i]!;
    const phi = angleBetween(d1, d2);
    angles[i] = phi;
    // Un demi-tour n'admet pas d'arc tangent : on le laisse en angle vif.
    tangentLen[i] = phi > EPS && phi < Math.PI - 1e-3 ? radiusAt(i) * Math.tan(phi / 2) : 0;
  }

  // Deux coudes voisins doivent tenir dans le brin qui les sépare.
  const clamped = new Array<boolean>(n).fill(false);
  for (let e = 0; e < lens.length; e += 1) {
    const available = lens[e]!;
    const tA = tangentLen[e] ?? 0;
    const tB = tangentLen[e + 1] ?? 0;
    const needed = tA + tB;
    if (needed > available && needed > 0) {
      const k = (available * 0.999) / needed;
      if (tA > 0) { tangentLen[e] = tA * k; clamped[e] = true; }
      if (tB > 0) { tangentLen[e + 1] = tB * k; clamped[e + 1] = true; }
    }
  }

  const points: Vec3[] = [];
  const tangents: Vec3[] = [];
  const corners: PathCorner[] = [];
  let minRadius = Infinity;

  const push = (p: Vec3, t: Vec3) => {
    const prev = points[points.length - 1];
    if (prev && distance(prev, p) < 1e-9) {
      tangents[tangents.length - 1] = t;
      return;
    }
    points.push(p);
    tangents.push(t);
  };

  push(pts[0]!, dirs[0]!);

  for (let i = 1; i < n - 1; i += 1) {
    const d1 = dirs[i - 1]!;
    const d2 = dirs[i]!;
    const phi = angles[i]!;
    const T = tangentLen[i]!;
    const vertex = pts[i]!;

    if (T <= 1e-9 || phi <= EPS) {
      // Brin aligné ou angle vif conservé.
      push(vertex, phi <= EPS ? d1 : d2);
      if (phi > EPS) {
        corners.push({
          vertex,
          radius: 0,
          turnAngle: phi,
          clamped: true,
          station: 0,
          inward: normalize(sub(d2, scale(d1, dot(d1, d2)))),
          axis: normalize(cross(d1, d2)),
        });
      }
      continue;
    }

    const radius = T / Math.tan(phi / 2);
    minRadius = Math.min(minRadius, radius);

    const start = sub(vertex, scale(d1, T));
    const end = add(vertex, scale(d2, T));
    // Normale au brin entrant, dirigée vers l'intérieur du virage.
    const inward = normalize(sub(d2, scale(d1, dot(d1, d2))));
    const center = add(start, scale(inward, radius));
    const axis = normalize(cross(d1, d2));

    // Pas angulaire déduit de la flèche admise.
    const ratio = Math.min(1, tolerance / Math.max(radius, 1e-6));
    const maxStep = ratio >= 1 ? phi : 2 * Math.acos(1 - ratio);
    const steps = Math.max(minArcSteps, Math.min(64, Math.ceil(phi / Math.max(maxStep, 1e-3))));

    push(start, d1);
    const spoke = sub(start, center);
    for (let k = 1; k <= steps; k += 1) {
      const a = (phi * k) / steps;
      const p = add(center, rotateAround(spoke, axis, a));
      const t = rotateAround(d1, axis, a);
      push(p, t);
    }
    push(end, d2);

    corners.push({ vertex, radius, turnAngle: phi, clamped: clamped[i] ?? false, station: 0, inward, axis });
  }

  push(pts[n - 1]!, dirs[dirs.length - 1]!);

  const stations = new Array<number>(points.length).fill(0);
  for (let i = 1; i < points.length; i += 1) {
    stations[i] = stations[i - 1]! + distance(points[i - 1]!, points[i]!);
  }
  const length = stations[stations.length - 1]!;

  // Repère chaque coude sur l'abscisse curviligne (utile aux étiquettes et contrôles).
  for (const corner of corners) {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < points.length; i += 1) {
      const d = distance(points[i]!, corner.vertex);
      if (d < bestDist) { bestDist = d; best = i; }
    }
    corner.station = stations[best]!;
  }

  return { points, tangents, stations, length, corners, minRadius };
}

/** Point et tangente à une abscisse curviligne donnée (interpolation linéaire). */
export function sampleAtStation(path: SampledPath, station: number): { point: Vec3; tangent: Vec3; index: number } {
  const s = Math.max(0, Math.min(path.length, station));
  const stations = path.stations;
  let lo = 0;
  let hi = stations.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (stations[mid]! <= s) lo = mid; else hi = mid;
  }
  const s0 = stations[lo]!;
  const s1 = stations[hi]!;
  const t = s1 - s0 > 1e-12 ? (s - s0) / (s1 - s0) : 0;
  const a = path.points[lo]!;
  const b = path.points[hi]!;
  return {
    point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
    tangent: t < 0.5 ? path.tangents[lo]! : path.tangents[hi]!,
    index: lo,
  };
}

/** Ré-échantillonnage à pas constant : indispensable pour une gaine spiralée
 *  dont le pas doit rester régulier le long du toron. */
export function resampleUniform(path: SampledPath, step: number): { points: Vec3[]; tangents: Vec3[]; stations: number[] } {
  const count = Math.max(2, Math.ceil(path.length / Math.max(step, 1e-3)) + 1);
  const points: Vec3[] = [];
  const tangents: Vec3[] = [];
  const stations: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const s = (path.length * i) / (count - 1);
    const sample = sampleAtStation(path, s);
    points.push(sample.point);
    tangents.push(sample.tangent);
    stations.push(s);
  }
  return { points, tangents, stations };
}

/** Repères parallèles (rotation minimizing frames) le long du tracé.
 *  Sans cela une gaine spiralée se met à vriller dans les coudes. */
export function parallelFrames(points: readonly Vec3[], tangents: readonly Vec3[]): Array<{ t: Vec3; u: Vec3; v: Vec3 }> {
  const frames: Array<{ t: Vec3; u: Vec3; v: Vec3 }> = [];
  const t0 = tangents[0] ?? ([1, 0, 0] as Vec3);
  const ref: Vec3 = Math.abs(t0[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  let u = normalize(cross(ref, t0));
  for (let i = 0; i < points.length; i += 1) {
    const t = tangents[i] ?? t0;
    if (i > 0) {
      const prev = tangents[i - 1] ?? t;
      const axis = cross(prev, t);
      const s = Math.hypot(axis[0], axis[1], axis[2]);
      if (s > 1e-9) {
        const angle = Math.atan2(s, Math.max(-1, Math.min(1, dot(prev, t))));
        u = rotateAround(u, scale(axis, 1 / s), angle);
      }
    }
    // Ré-orthogonalisation : évite la dérive numérique sur les longs tracés.
    u = normalize(sub(u, scale(t, dot(u, t))));
    frames.push({ t, u, v: cross(t, u) });
  }
  return frames;
}

/** Extrait la portion [sStart, sEnd] d'un tracé, en interpolant proprement les
 *  deux extrémités. Sert à redécouper une chaîne raccordée en segments. */
export function slicePath(path: SampledPath, sStart: number, sEnd: number): SampledPath {
  const a = Math.max(0, Math.min(path.length, Math.min(sStart, sEnd)));
  const b = Math.max(0, Math.min(path.length, Math.max(sStart, sEnd)));
  const head = sampleAtStation(path, a);
  const tail = sampleAtStation(path, b);

  const points: Vec3[] = [head.point];
  const tangents: Vec3[] = [head.tangent];
  for (let i = 0; i < path.points.length; i += 1) {
    const s = path.stations[i]!;
    if (s > a + 1e-9 && s < b - 1e-9) {
      points.push(path.points[i]!);
      tangents.push(path.tangents[i]!);
    }
  }
  points.push(tail.point);
  tangents.push(tail.tangent);

  const stations = [0];
  for (let i = 1; i < points.length; i += 1) {
    stations.push(stations[i - 1]! + distance(points[i - 1]!, points[i]!));
  }
  const corners = path.corners
    .filter((c) => c.station >= a - 1e-9 && c.station <= b + 1e-9)
    .map((c) => ({ ...c, station: c.station - a }));
  let minRadius = Infinity;
  for (const c of corners) if (c.radius > 0) minRadius = Math.min(minRadius, c.radius);

  return {
    points,
    tangents,
    stations,
    length: stations[stations.length - 1] ?? 0,
    corners,
    minRadius,
  };
}
