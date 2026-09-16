import type { Vec3 } from '../src/core/math/vec';
import { findSpecBySection, sleeveFromCatalog, SLEEVE_CATALOG } from '../src/core/harness/library';
import {
  emptyProject,
  type HarnessProject,
  type Id,
  type RouteNode,
  type RouteSegment,
  type Tenant,
  type Wire,
} from '../src/core/harness/types';

export function node(project: HarnessProject, id: Id, name: string, position: Vec3, extra: Partial<RouteNode> = {}): RouteNode {
  const created: RouteNode = {
    id,
    name,
    kind: 'passage',
    position,
    exitLength: 0,
    locked: false,
    ...extra,
  };
  project.nodes[id] = created;
  return created;
}

export function segment(project: HarnessProject, id: Id, a: Id, b: Id, extra: Partial<RouteSegment> = {}): RouteSegment {
  const created: RouteSegment = {
    id,
    name: id,
    a,
    b,
    vias: [],
    bendRadius: 25,
    slack: 0,
    locked: false,
    ...extra,
  };
  project.segments[id] = created;
  return created;
}

export function tenant(nodeId: Id | null, cavity: string, extra: Partial<Tenant> = {}): Tenant {
  return { nodeId, cavity, stripLength: 6, tailLength: 0, ...extra };
}

export function wire(project: HarnessProject, id: Id, name: string, section: number, g: Tenant, d: Tenant, extra: Partial<Wire> = {}): Wire {
  const spec = findSpecBySection(section);
  project.specs[spec.id] = { ...spec };
  const created: Wire = {
    id,
    name,
    specId: spec.id,
    sectionMm2: spec.sectionMm2,
    outerDiameter: spec.outerDiameter,
    color: '#d0342c',
    tenantG: g,
    tenantD: d,
    path: [],
    pathMode: 'auto',
    ...extra,
  };
  project.wires[id] = created;
  return created;
}

/** Faisceau en T : deux connecteurs, une dérivation, un troisième connecteur. */
export function tHarness(): HarnessProject {
  const project = emptyProject('Faisceau de test');
  project.settings.defaultSlack = 0;

  node(project, 'A', 'Connecteur A', [0, 0, 0], { kind: 'connecteur' });
  node(project, 'B', 'Dérivation B', [300, 0, 0], { kind: 'derivation' });
  node(project, 'C', 'Connecteur C', [600, 0, 0], { kind: 'connecteur' });
  node(project, 'D', 'Connecteur D', [300, 400, 0], { kind: 'connecteur' });

  segment(project, 'AB', 'A', 'B');
  segment(project, 'BC', 'B', 'C');
  segment(project, 'BD', 'B', 'D');

  wire(project, 'w1', '1A', 0.75, tenant('A', '1'), tenant('C', '1'));
  wire(project, 'w2', '2A', 1.5, tenant('A', '2'), tenant('D', '1'));
  wire(project, 'w3', '3A', 2.5, tenant('A', '3'), tenant('D', '2'));

  const sleeve = sleeveFromCatalog(SLEEVE_CATALOG.find((s) => s.kind === 'spiralee' && s.innerDiameter === 8)!, 'sl1', 'Spiralée tronc');
  sleeve.segmentIds = ['AB'];
  project.sleeves['sl1'] = sleeve;
  project.segments['AB']!.sleeveId = 'sl1';

  return project;
}
