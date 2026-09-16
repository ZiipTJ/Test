/** Évaluation géométrique du cheminement.
 *
 *  Un câble ne « casse » pas en traversant un simple point de passage : il faut
 *  donc raccorder le tracé **au travers** des nœuds de degré 2, puis redécouper
 *  le résultat segment par segment. On construit ainsi des chaînes continues
 *  (suites de segments soudés par des nœuds de passage), on les raccorde par
 *  arcs en une fois, et on redistribue la géométrie obtenue sur chaque segment.
 */
import { add, distance, scale, type Vec3 } from '../math/vec';
import { buildPath, slicePath, type SampledPath } from '../curve/path';
import type { HarnessProject, Id, RouteNode, RouteSegment } from './types';

export interface SegmentGeometry {
  id: Id;
  /** Fibre neutre orientée du nœud `a` vers le nœud `b` du segment. */
  path: SampledPath;
  /** Longueur retenue : longueur imposée si l'utilisateur en a saisi une. */
  length: number;
  /** Longueur purement géométrique de la fibre neutre. */
  geometricLength: number;
}

/** Un nœud est « lisse » quand le toron le traverse sans rupture : deux segments
 *  exactement, aucune direction de sortie imposée, et pas une extrémité de faisceau. */
function isSmoothJunction(node: RouteNode, degree: number): boolean {
  if (degree !== 2) return false;
  if (node.exitDirection) return false;
  return node.kind === 'passage' || node.kind === 'collier';
}

interface Chain {
  nodes: Id[];
  segments: Id[];
}

function buildChains(project: HarnessProject): Chain[] {
  const incident = new Map<Id, Array<{ segmentId: Id; other: Id }>>();
  for (const nodeId of Object.keys(project.nodes)) incident.set(nodeId, []);
  for (const segment of Object.values(project.segments)) {
    incident.get(segment.a)?.push({ segmentId: segment.id, other: segment.b });
    incident.get(segment.b)?.push({ segmentId: segment.id, other: segment.a });
  }

  const smooth = new Set<Id>();
  for (const [nodeId, edges] of incident) {
    const node = project.nodes[nodeId];
    if (node && isSmoothJunction(node, edges.length)) smooth.add(nodeId);
  }

  const used = new Set<Id>();
  const chains: Chain[] = [];

  for (const segment of Object.values(project.segments)) {
    if (used.has(segment.id)) continue;
    used.add(segment.id);
    const nodes = [segment.a, segment.b];
    const segments = [segment.id];

    // Prolongement de part et d'autre tant qu'on traverse des nœuds lisses.
    const extend = (fromEnd: boolean) => {
      for (;;) {
        const tip = fromEnd ? nodes[nodes.length - 1]! : nodes[0]!;
        if (!smooth.has(tip)) return;
        const next = (incident.get(tip) ?? []).find((e) => !used.has(e.segmentId));
        if (!next) return;
        // Une boucle fermée s'arrête d'elle-même quand elle revient au départ.
        if (next.other === (fromEnd ? nodes[0] : nodes[nodes.length - 1])) return;
        used.add(next.segmentId);
        if (fromEnd) {
          nodes.push(next.other);
          segments.push(next.segmentId);
        } else {
          nodes.unshift(next.other);
          segments.unshift(next.segmentId);
        }
      }
    };
    extend(true);
    extend(false);

    chains.push({ nodes, segments });
  }

  return chains;
}

/** Retourne le tracé pour qu'il aille de `b` vers `a`. */
function reversePath(path: SampledPath): SampledPath {
  const points = path.points.slice().reverse();
  const tangents = path.tangents.slice().reverse().map((t): Vec3 => [-t[0], -t[1], -t[2]]);
  const stations = [0];
  for (let i = 1; i < points.length; i += 1) {
    stations.push(stations[i - 1]! + distance(points[i - 1]!, points[i]!));
  }
  const total = stations[stations.length - 1] ?? 0;
  return {
    points,
    tangents,
    stations,
    length: total,
    corners: path.corners
      .map((c) => ({ ...c, station: path.length - c.station, axis: [-c.axis[0], -c.axis[1], -c.axis[2]] as Vec3 }))
      .reverse(),
    minRadius: path.minRadius,
  };
}

/** Points de contrôle d'un segment isolé (brins de sortie et points de passage). */
export function segmentControlPoints(project: HarnessProject, segment: RouteSegment): Vec3[] {
  const a = project.nodes[segment.a];
  const b = project.nodes[segment.b];
  if (!a || !b) return [];
  const points: Vec3[] = [a.position];
  if (a.exitDirection && a.exitLength > 0) points.push(add(a.position, scale(a.exitDirection, a.exitLength)));
  for (const via of segment.vias) points.push(via);
  if (b.exitDirection && b.exitLength > 0) points.push(add(b.position, scale(b.exitDirection, b.exitLength)));
  points.push(b.position);
  return points;
}

function finalLength(segment: RouteSegment, geometricLength: number): number {
  return segment.overrideLength != null && segment.overrideLength > 0 ? segment.overrideLength : geometricLength;
}

/** Évalue une chaîne complète puis répartit la géométrie sur ses segments. */
function evaluateChain(
  project: HarnessProject,
  chain: Chain,
  tolerance: number,
  out: Map<Id, SegmentGeometry>,
): void {
  const control: Vec3[] = [];
  const radii: number[] = [];
  /** Index, dans `control`, du point représentant chaque nœud de la chaîne. */
  const nodeControlIndex: number[] = [];

  const push = (point: Vec3, radius: number): number => {
    control.push(point);
    radii.push(radius);
    return control.length - 1;
  };

  for (let i = 0; i < chain.nodes.length; i += 1) {
    const node = project.nodes[chain.nodes[i]!];
    if (!node) return;
    const prevSegment = i > 0 ? project.segments[chain.segments[i - 1]!] : undefined;
    const nextSegment = i < chain.segments.length ? project.segments[chain.segments[i]!] : undefined;
    const radius = Math.min(
      prevSegment?.bendRadius ?? Infinity,
      nextSegment?.bendRadius ?? Infinity,
    );
    const safeRadius = Number.isFinite(radius) ? radius : 0;

    // Brin rectiligne imposé en entrée de nœud (arrivée sur un connecteur).
    if (i > 0 && node.exitDirection && node.exitLength > 0) {
      push(add(node.position, scale(node.exitDirection, node.exitLength)), safeRadius);
    }
    nodeControlIndex.push(push(node.position, safeRadius));
    if (i < chain.nodes.length - 1 && node.exitDirection && node.exitLength > 0) {
      push(add(node.position, scale(node.exitDirection, node.exitLength)), safeRadius);
    }

    // Points de passage du segment qui suit, dans le sens de parcours.
    if (nextSegment) {
      const forward = nextSegment.a === node.id;
      const vias = forward ? nextSegment.vias : nextSegment.vias.slice().reverse();
      for (const via of vias) push(via, nextSegment.bendRadius);
    }
  }

  const path = buildPath(control, { bendRadius: radii, tolerance });

  // Abscisse curviligne de chaque nœud : le sommet théorique a disparu sous l'arc,
  // on retient donc le coude correspondant, sinon le point le plus proche.
  const stationOfNode = chain.nodes.map((nodeId, i) => {
    if (i === 0) return 0;
    if (i === chain.nodes.length - 1) return path.length;
    const position = control[nodeControlIndex[i]!]!;
    const corner = path.corners.find((c) => distance(c.vertex, position) < 1e-6);
    if (corner) return corner.station;
    let best = 0;
    let bestDistance = Infinity;
    for (let k = 0; k < path.points.length; k += 1) {
      const d = distance(path.points[k]!, position);
      if (d < bestDistance) { bestDistance = d; best = k; }
    }
    return path.stations[best]!;
  });

  for (let i = 0; i < chain.segments.length; i += 1) {
    const segment = project.segments[chain.segments[i]!];
    if (!segment) continue;
    let piece = slicePath(path, stationOfNode[i]!, stationOfNode[i + 1]!);
    // La chaîne peut parcourir le segment à l'envers : on réoriente sur a → b.
    if (segment.a !== chain.nodes[i]) piece = reversePath(piece);
    out.set(segment.id, {
      id: segment.id,
      path: piece,
      geometricLength: piece.length,
      length: finalLength(segment, piece.length),
    });
  }
}

/** Évalue un segment seul, sans tenir compte de ses voisins. */
export function evaluateSegment(project: HarnessProject, segment: RouteSegment, tolerance = 0.4): SegmentGeometry {
  const path = buildPath(segmentControlPoints(project, segment), {
    bendRadius: segment.bendRadius,
    tolerance,
  });
  return {
    id: segment.id,
    path,
    geometricLength: path.length,
    length: finalLength(segment, path.length),
  };
}

export function evaluateAllSegments(project: HarnessProject, tolerance = 0.4): Map<Id, SegmentGeometry> {
  const out = new Map<Id, SegmentGeometry>();
  for (const chain of buildChains(project)) {
    evaluateChain(project, chain, tolerance, out);
  }
  // Filet de sécurité : tout segment qu'une chaîne n'aurait pas couvert.
  for (const segment of Object.values(project.segments)) {
    if (!out.has(segment.id)) out.set(segment.id, evaluateSegment(project, segment, tolerance));
  }
  return out;
}
