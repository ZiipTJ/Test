/** Calcul complet du faisceau : cheminement des fils, charge des segments,
 *  diamètre des torons, longueurs de coupe. Fonction pure, donc testable et
 *  réutilisable telle quelle dans un worker. */
import { dot, type Vec3 } from '../math/vec';
import { parallelFrames, sampleAtStation } from '../curve/path';
import { buildAdjacency, shortestPath, segmentsForNodePath, type Adjacency } from './graph';
import { estimateBundleDiameter, fillRatio, packCircles, type PackedCircle } from './bundle';
import { evaluateAllSegments, type SegmentGeometry } from './evaluate';
import type { HarnessProject, Id, Wire } from './types';

export interface WireRoute {
  wireId: Id;
  nodes: Id[];
  segments: Id[];
  /** Longueur des segments empruntés, mou compris. */
  routedLength: number;
  /** Correction liée à la position du fil dans le toron (coudes extérieurs). */
  positionCorrection: number;
  /** Longueurs libres aux deux tenants. */
  tailLength: number;
  /** Longueur de coupe finale. */
  totalLength: number;
  resistanceMilliOhm: number;
  massGram: number;
  status: 'ok' | 'non-route' | 'tenant-incomplet' | 'chemin-invalide';
  message?: string;
}

export interface SegmentLoad {
  segmentId: Id;
  wireIds: Id[];
  /** Diamètre du toron issu du rangement réel des fils. */
  bundleDiameter: number;
  /** Diamètre estimé par la formule k·√(Σd²), pour comparaison. */
  estimatedDiameter: number;
  /** Position de chaque fil dans la section, en mm, centre du toron en (0,0). */
  positions: Map<Id, PackedCircle>;
  copperSection: number;
  massPerMeter: number;
  fill: { sleeveId: Id; ratio: number; ok: boolean } | null;
  length: number;
}

export interface HarnessComputation {
  geometry: Map<Id, SegmentGeometry>;
  adjacency: Adjacency;
  routes: Map<Id, WireRoute>;
  loads: Map<Id, SegmentLoad>;
  totals: {
    wireCount: number;
    routedWireCount: number;
    wireLength: number;
    copperMass: number;
    routeLength: number;
    sleevedLength: number;
  };
}

function wireMassPerMeter(project: HarnessProject, wire: Wire): number {
  const spec = project.specs[wire.specId];
  if (spec) return spec.massPerMeter;
  // À défaut de catalogue : cuivre (8,96 g/cm³) + isolant estimé par son volume.
  const copper = wire.sectionMm2 * 8.96;
  const insulationArea = Math.max(0, (Math.PI / 4) * wire.outerDiameter ** 2 - wire.sectionMm2);
  return copper + insulationArea * 1.4;
}

function wireResistancePerMeter(project: HarnessProject, wire: Wire): number {
  const spec = project.specs[wire.specId];
  if (spec) return spec.resistancePerMeter;
  return wire.sectionMm2 > 0 ? 17.2 / wire.sectionMm2 : 0;
}

/** Rallonge due à la position du fil hors de la fibre neutre dans les coudes :
 *  un fil à l'extérieur d'un coude parcourt (R + e)·φ au lieu de R·φ. */
function bendCorrection(geometry: SegmentGeometry, offset: PackedCircle | undefined): number {
  if (!offset) return 0;
  const { path } = geometry;
  if (path.corners.length === 0) return 0;
  const frames = parallelFrames(path.points, path.tangents);
  let correction = 0;
  for (const corner of path.corners) {
    if (corner.radius <= 0 || corner.turnAngle <= 0) continue;
    const sample = sampleAtStation(path, corner.station);
    const frame = frames[sample.index] ?? frames[0];
    if (!frame) continue;
    const outward: Vec3 = [-corner.inward[0], -corner.inward[1], -corner.inward[2]];
    const e = offset.x * dot(frame.u, outward) + offset.y * dot(frame.v, outward);
    correction += e * corner.turnAngle;
  }
  return correction;
}

export function computeHarness(project: HarnessProject, tolerance = 0.4): HarnessComputation {
  const geometry = evaluateAllSegments(project, tolerance);
  const adjacency = buildAdjacency(project, geometry);

  /* 1. Cheminement de chaque fil ------------------------------------------- */
  const routes = new Map<Id, WireRoute>();
  const segmentWires = new Map<Id, Id[]>();
  for (const segmentId of Object.keys(project.segments)) segmentWires.set(segmentId, []);

  for (const wire of Object.values(project.wires)) {
    const from = wire.tenantG.nodeId;
    const to = wire.tenantD.nodeId;
    const tailLength = (wire.tenantG.tailLength ?? 0) + (wire.tenantD.tailLength ?? 0);
    const base: WireRoute = {
      wireId: wire.id,
      nodes: [],
      segments: [],
      routedLength: 0,
      positionCorrection: 0,
      tailLength,
      totalLength: tailLength,
      resistanceMilliOhm: 0,
      massGram: 0,
      status: 'ok',
    };

    if (!from || !to || !project.nodes[from] || !project.nodes[to]) {
      routes.set(wire.id, { ...base, status: 'tenant-incomplet', message: 'Tenant G ou D non affecté à un nœud.' });
      continue;
    }

    let nodes: Id[] | null = null;
    let segments: Id[] | null = null;

    if (wire.pathMode === 'manuel' && wire.path.length >= 2) {
      nodes = wire.path.slice();
      segments = segmentsForNodePath(project, nodes);
      if (!segments) {
        routes.set(wire.id, { ...base, status: 'chemin-invalide', message: 'Le chemin imposé n’emprunte pas des segments existants.' });
        continue;
      }
    } else {
      const found = shortestPath(adjacency, from, to);
      if (!found) {
        routes.set(wire.id, { ...base, status: 'non-route', message: 'Aucun cheminement ne relie les deux tenants.' });
        continue;
      }
      nodes = found.nodes;
      segments = found.segments;
    }

    for (const segmentId of segments) segmentWires.get(segmentId)?.push(wire.id);
    routes.set(wire.id, { ...base, nodes, segments });
  }

  /* 2. Charge et diamètre de chaque segment -------------------------------- */
  const loads = new Map<Id, SegmentLoad>();
  for (const segment of Object.values(project.segments)) {
    const wireIds = segmentWires.get(segment.id) ?? [];
    const wires = wireIds.map((id) => project.wires[id]).filter((w): w is Wire => Boolean(w));
    const diameters = wires.map((w) => w.outerDiameter);
    const packing = packCircles(diameters.map((d) => d / 2));
    const positions = new Map<Id, PackedCircle>();
    packing.circles.forEach((circle) => {
      const wire = wires[circle.index];
      if (wire) positions.set(wire.id, circle);
    });

    const bundleDiameter = packing.radius * 2 * project.settings.packingFactor;
    const copperSection = wires.reduce((sum, w) => sum + w.sectionMm2, 0);
    const massPerMeter = wires.reduce((sum, w) => sum + wireMassPerMeter(project, w), 0);

    let fill: SegmentLoad['fill'] = null;
    if (segment.sleeveId) {
      const sleeve = project.sleeves[segment.sleeveId];
      if (sleeve && sleeve.innerDiameter > 0) {
        const ratio = fillRatio(diameters, sleeve.innerDiameter);
        fill = { sleeveId: sleeve.id, ratio, ok: ratio <= project.settings.maxFillRatio };
      }
    }

    loads.set(segment.id, {
      segmentId: segment.id,
      wireIds,
      bundleDiameter,
      estimatedDiameter: estimateBundleDiameter(diameters, project.settings.packingFactor),
      positions,
      copperSection,
      massPerMeter,
      fill,
      length: geometry.get(segment.id)?.length ?? 0,
    });
  }

  /* 3. Longueurs de coupe --------------------------------------------------- */
  let wireLength = 0;
  let copperMass = 0;
  let routedWireCount = 0;

  for (const route of routes.values()) {
    const wire = project.wires[route.wireId];
    if (!wire || route.status !== 'ok') continue;
    let routed = 0;
    let correction = 0;
    for (const segmentId of route.segments) {
      const segment = project.segments[segmentId];
      const geom = geometry.get(segmentId);
      if (!segment || !geom) continue;
      routed += geom.length * (1 + segment.slack);
      if (project.settings.correctLengthByPosition) {
        correction += bendCorrection(geom, loads.get(segmentId)?.positions.get(wire.id));
      }
    }
    route.routedLength = routed;
    route.positionCorrection = correction;
    route.totalLength = routed + correction + route.tailLength;
    route.resistanceMilliOhm = (route.totalLength / 1000) * wireResistancePerMeter(project, wire);
    route.massGram = (route.totalLength / 1000) * wireMassPerMeter(project, wire);
    wireLength += route.totalLength;
    copperMass += route.massGram;
    routedWireCount += 1;
  }

  let routeLength = 0;
  let sleevedLength = 0;
  for (const [segmentId, geom] of geometry) {
    routeLength += geom.length;
    if (project.segments[segmentId]?.sleeveId) sleevedLength += geom.length;
  }

  return {
    geometry,
    adjacency,
    routes,
    loads,
    totals: {
      wireCount: Object.keys(project.wires).length,
      routedWireCount,
      wireLength,
      copperMass,
      routeLength,
      sleevedLength,
    },
  };
}
