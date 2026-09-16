/** Tout ce que l'application calcule : chemins, longueurs, poids, torons.
 *  Fonction pure, mémorisée en amont sur l'identité du projet. */
import { buildPath, type SampledPath } from '../curve/path';
import { packCircles, type PackedCircle } from './bundle';
import type { Id, Project, Toron, Wire } from './types';

export interface WireResult {
  wireId: Id;
  /** Chemin suivi : le sien, ou celui de son toron. */
  path: SampledPath | null;
  /** Longueur de coupe : chemin + mou + longueurs libres. */
  length: number;
  /** Longueur du chemin seul, sans mou ni extrémités. */
  pathLength: number;
  massGram: number;
  resistanceMilliOhm: number;
  /** Place du fil dans la section de son toron, en millimètres. */
  offset: PackedCircle | null;
  ready: boolean;
}

export interface ToronResult {
  toronId: Id;
  path: SampledPath | null;
  /** Diamètre extérieur du toron, issu du rangement réel des fils. */
  diameter: number;
  length: number;
  wireIds: Id[];
  offsets: Map<Id, PackedCircle>;
  massPerMeter: number;
  sectionMm2: number;
}

export interface Computation {
  wires: Map<Id, WireResult>;
  torons: Map<Id, ToronResult>;
  totals: {
    wireCount: number;
    tracedCount: number;
    wireLength: number;
    massGram: number;
  };
}

const MIN_POINTS = 2;

function pathOf(points: readonly { length: number }[] | readonly number[][] | null, bendRadius: number): SampledPath | null {
  if (!points || points.length < MIN_POINTS) return null;
  return buildPath(points as never, { bendRadius });
}

export function toronOf(project: Project, wire: Wire): Toron | undefined {
  return wire.toronId ? project.torons.find((toron) => toron.id === wire.toronId) : undefined;
}

export function compute(project: Project): Computation {
  const wires = new Map<Id, WireResult>();
  const torons = new Map<Id, ToronResult>();
  const byId = new Map(project.wires.map((wire) => [wire.id, wire]));

  /* Torons : un chemin commun, et les fils rangés dans la section. */
  for (const toron of project.torons) {
    const members = toron.wireIds.map((id) => byId.get(id)).filter((wire): wire is Wire => Boolean(wire));
    const packing = packCircles(members.map((wire) => wire.outerDiameter / 2));
    const offsets = new Map<Id, PackedCircle>();
    packing.circles.forEach((circle) => {
      const wire = members[circle.index];
      if (wire) offsets.set(wire.id, circle);
    });
    const path = pathOf(toron.points, toron.bendRadius);
    torons.set(toron.id, {
      toronId: toron.id,
      path,
      // Un toron n'est jamais parfaitement serré : 15 % de foisonnement.
      diameter: packing.radius * 2 * 1.15,
      length: path?.length ?? 0,
      wireIds: members.map((wire) => wire.id),
      offsets,
      massPerMeter: members.reduce((sum, wire) => sum + wire.massPerMeter, 0),
      sectionMm2: members.reduce((sum, wire) => sum + wire.sectionMm2, 0),
    });
  }

  /* Fils : chemin propre, ou celui du toron qui les porte. */
  let wireLength = 0;
  let massGram = 0;
  let tracedCount = 0;

  for (const wire of project.wires) {
    const toron = toronOf(project, wire);
    const toronResult = toron ? torons.get(toron.id) : undefined;
    const path = toronResult ? toronResult.path : pathOf(wire.points, wire.bendRadius);
    const pathLength = path?.length ?? 0;
    const length = path ? pathLength * (1 + wire.slack) + wire.tails * 2 : 0;

    const result: WireResult = {
      wireId: wire.id,
      path,
      pathLength,
      length,
      massGram: (length / 1000) * wire.massPerMeter,
      resistanceMilliOhm: (length / 1000) * wire.resistancePerMeter,
      offset: toronResult?.offsets.get(wire.id) ?? null,
      ready: Boolean(path),
    };
    wires.set(wire.id, result);

    if (result.ready) {
      tracedCount += 1;
      wireLength += length;
      massGram += result.massGram;
    }
  }

  return {
    wires,
    torons,
    totals: { wireCount: project.wires.length, tracedCount, wireLength, massGram },
  };
}
