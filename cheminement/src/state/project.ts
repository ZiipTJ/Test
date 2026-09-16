/** Magasin du projet : c'est la seule source de vérité du faisceau.
 *  Historique annuler/rétablir géré par zundo, mutations écrites en style
 *  impératif grâce à immer. Le modèle CAO importé n'y figure pas : il pèse
 *  lourd et n'a pas à entrer dans l'historique. */
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { temporal } from 'zundo';
import type { Vec3 } from '../core/math/vec';
import {
  connectorFromCatalog,
  findSpecBySection,
  selectSleeve,
  sleeveFromCatalog,
  suggestTerminal,
  WIRE_COLORS,
  type ConnectorCatalogEntry,
} from '../core/harness/library';
import {
  DEFAULT_SETTINGS,
  emptyProject,
  newId,
  type ConnectorDef,
  type HarnessProject,
  type HarnessSettings,
  type Id,
  type RouteNode,
  type RouteSegment,
  type Sleeve,
  type SleeveKind,
  type Tenant,
  type TenantSide,
  type Wire,
} from '../core/harness/types';

interface ProjectState {
  project: HarnessProject;
}

interface ProjectActions {
  replaceProject(project: HarnessProject): void;
  resetProject(name?: string): void;
  renameProject(name: string): void;

  addNode(node: Partial<RouteNode> & { position: Vec3 }): Id;
  updateNode(id: Id, patch: Partial<RouteNode>): void;
  removeNode(id: Id): void;

  addSegment(a: Id, b: Id, patch?: Partial<RouteSegment>): Id | null;
  updateSegment(id: Id, patch: Partial<RouteSegment>): void;
  removeSegment(id: Id): void;
  addVia(segmentId: Id, point: Vec3, index?: number): void;
  removeVia(segmentId: Id, index: number): void;

  addWire(wire?: Partial<Wire>): Id;
  updateWire(id: Id, patch: Partial<Wire>): void;
  updateTenant(id: Id, side: TenantSide, patch: Partial<Tenant>): void;
  setWireSection(id: Id, section: number): void;
  removeWire(id: Id): void;

  addConnector(entry: ConnectorCatalogEntry, name?: string): Id;
  updateConnector(id: Id, patch: Partial<ConnectorDef>): void;
  mountConnector(nodeId: Id, connectorId: Id | undefined): void;

  addSleeve(kind: SleeveKind, bundleDiameter: number, segmentIds: Id[]): Id;
  updateSleeve(id: Id, patch: Partial<Sleeve>): void;
  assignSleeve(segmentId: Id, sleeveId: Id | null): void;
  removeSleeve(id: Id): void;

  updateSettings(patch: Partial<HarnessSettings>): void;
}

export type ProjectStore = ProjectState & ProjectActions;

const defaultTenant = (): Tenant => ({ nodeId: null, cavity: '', stripLength: 6, tailLength: 30 });

function nextName(existing: Iterable<{ name: string }>, prefix: string): string {
  let max = 0;
  for (const item of existing) {
    const match = new RegExp(`^${prefix}\\s*(\\d+)$`).exec(item.name);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `${prefix} ${max + 1}`;
}

export const useProject = create<ProjectStore>()(
  temporal(
    immer((set, get) => ({
      project: emptyProject(),

      replaceProject(project) {
        set((state) => {
          state.project = project;
        });
      },

      resetProject(name) {
        set((state) => {
          state.project = emptyProject(name);
        });
      },

      renameProject(name) {
        set((state) => {
          state.project.name = name;
        });
      },

      /* ------------------------------------------------------------ nœuds */

      addNode(node) {
        const id = node.id ?? newId('nd');
        set((state) => {
          const kind = node.kind ?? 'passage';
          const label = kind === 'connecteur' ? 'Connecteur' : kind === 'collier' ? 'Collier' : kind === 'derivation' ? 'Dérivation' : kind === 'epissure' ? 'Épissure' : 'Point';
          state.project.nodes[id] = {
            id,
            name: node.name ?? nextName(Object.values(state.project.nodes), label),
            kind,
            position: node.position,
            exitLength: node.exitLength ?? (kind === 'connecteur' ? 25 : 0),
            locked: false,
            ...(node.exitDirection ? { exitDirection: node.exitDirection } : {}),
            ...(node.connectorId ? { connectorId: node.connectorId } : {}),
            ...(node.clamp ? { clamp: node.clamp } : {}),
            ...(node.snap ? { snap: node.snap } : {}),
          };
        });
        return id;
      },

      updateNode(id, patch) {
        set((state) => {
          const node = state.project.nodes[id];
          if (node) Object.assign(node, patch);
        });
      },

      removeNode(id) {
        set((state) => {
          delete state.project.nodes[id];
          for (const segment of Object.values(state.project.segments)) {
            if (segment.a === id || segment.b === id) delete state.project.segments[segment.id];
          }
          for (const wire of Object.values(state.project.wires)) {
            if (wire.tenantG.nodeId === id) wire.tenantG.nodeId = null;
            if (wire.tenantD.nodeId === id) wire.tenantD.nodeId = null;
            wire.path = wire.path.filter((nodeId) => nodeId !== id);
          }
          for (const sleeve of Object.values(state.project.sleeves)) {
            sleeve.segmentIds = sleeve.segmentIds.filter((segmentId) => state.project.segments[segmentId]);
          }
        });
      },

      /* --------------------------------------------------------- segments */

      addSegment(a, b, patch) {
        if (a === b) return null;
        const existing = Object.values(get().project.segments).find(
          (segment) => (segment.a === a && segment.b === b) || (segment.a === b && segment.b === a),
        );
        if (existing) return existing.id;
        const id = newId('sg');
        set((state) => {
          state.project.segments[id] = {
            id,
            name: nextName(Object.values(state.project.segments), 'Segment'),
            a,
            b,
            vias: [],
            bendRadius: state.project.settings.defaultBendRadius,
            slack: state.project.settings.defaultSlack,
            locked: false,
            ...patch,
          };
        });
        return id;
      },

      updateSegment(id, patch) {
        set((state) => {
          const segment = state.project.segments[id];
          if (segment) Object.assign(segment, patch);
        });
      },

      removeSegment(id) {
        set((state) => {
          delete state.project.segments[id];
          for (const sleeve of Object.values(state.project.sleeves)) {
            sleeve.segmentIds = sleeve.segmentIds.filter((segmentId) => segmentId !== id);
          }
        });
      },

      addVia(segmentId, point, index) {
        set((state) => {
          const segment = state.project.segments[segmentId];
          if (!segment) return;
          if (index === undefined) segment.vias.push(point);
          else segment.vias.splice(index, 0, point);
        });
      },

      removeVia(segmentId, index) {
        set((state) => {
          state.project.segments[segmentId]?.vias.splice(index, 1);
        });
      },

      /* ------------------------------------------------------------- fils */

      addWire(wire) {
        const id = wire?.id ?? newId('wr');
        set((state) => {
          const section = wire?.sectionMm2 ?? 0.75;
          const spec = findSpecBySection(section);
          state.project.specs[spec.id] = { ...spec };
          const index = Object.keys(state.project.wires).length;
          state.project.wires[id] = {
            id,
            name: wire?.name ?? `F${String(index + 1).padStart(3, '0')}`,
            specId: spec.id,
            sectionMm2: spec.sectionMm2,
            outerDiameter: spec.outerDiameter,
            color: wire?.color ?? WIRE_COLORS[index % WIRE_COLORS.length]!.hex,
            tenantG: { ...defaultTenant(), ...wire?.tenantG },
            tenantD: { ...defaultTenant(), ...wire?.tenantD },
            path: wire?.path ?? [],
            pathMode: wire?.pathMode ?? 'auto',
            ...(wire?.network ? { network: wire.network } : {}),
            ...(wire?.currentA != null ? { currentA: wire.currentA } : {}),
          };
        });
        return id;
      },

      updateWire(id, patch) {
        set((state) => {
          const wire = state.project.wires[id];
          if (wire) Object.assign(wire, patch);
        });
      },

      updateTenant(id, side, patch) {
        set((state) => {
          const wire = state.project.wires[id];
          if (!wire) return;
          Object.assign(side === 'G' ? wire.tenantG : wire.tenantD, patch);
        });
      },

      setWireSection(id, section) {
        set((state) => {
          const wire = state.project.wires[id];
          if (!wire) return;
          const spec = findSpecBySection(section);
          state.project.specs[spec.id] = { ...spec };
          wire.specId = spec.id;
          wire.sectionMm2 = spec.sectionMm2;
          wire.outerDiameter = spec.outerDiameter;
          const terminal = suggestTerminal(spec.sectionMm2);
          if (!wire.tenantG.terminalRef) wire.tenantG.terminalRef = terminal;
          if (!wire.tenantD.terminalRef) wire.tenantD.terminalRef = terminal;
        });
      },

      removeWire(id) {
        set((state) => {
          delete state.project.wires[id];
        });
      },

      /* ------------------------------------------------------ connecteurs */

      addConnector(entry, name) {
        const id = newId('cn');
        set((state) => {
          state.project.connectors[id] = connectorFromCatalog(entry, id, name);
        });
        return id;
      },

      updateConnector(id, patch) {
        set((state) => {
          const connector = state.project.connectors[id];
          if (connector) Object.assign(connector, patch);
        });
      },

      mountConnector(nodeId, connectorId) {
        set((state) => {
          const node = state.project.nodes[nodeId];
          if (!node) return;
          if (connectorId) {
            node.connectorId = connectorId;
            node.kind = 'connecteur';
          } else {
            delete node.connectorId;
          }
        });
      },

      /* ----------------------------------------------------------- gaines */

      addSleeve(kind, bundleDiameter, segmentIds) {
        const id = newId('sl');
        set((state) => {
          const entry = selectSleeve(kind, bundleDiameter, state.project.settings.maxFillRatio);
          const sleeve = entry
            ? sleeveFromCatalog(entry, id, nextName(Object.values(state.project.sleeves), 'Gaine'))
            : {
                id,
                name: nextName(Object.values(state.project.sleeves), 'Gaine'),
                kind,
                color: '#b9bec7',
                innerDiameter: Math.max(4, bundleDiameter * 1.2),
                wallThickness: 0.8,
                pitch: 20,
                bandWidth: 5,
                overlap: 0,
                segmentIds: [],
              };
          sleeve.segmentIds = segmentIds;
          state.project.sleeves[id] = sleeve;
          for (const segmentId of segmentIds) {
            const segment = state.project.segments[segmentId];
            if (segment) segment.sleeveId = id;
          }
        });
        return id;
      },

      updateSleeve(id, patch) {
        set((state) => {
          const sleeve = state.project.sleeves[id];
          if (sleeve) Object.assign(sleeve, patch);
        });
      },

      assignSleeve(segmentId, sleeveId) {
        set((state) => {
          const segment = state.project.segments[segmentId];
          if (!segment) return;
          for (const sleeve of Object.values(state.project.sleeves)) {
            sleeve.segmentIds = sleeve.segmentIds.filter((id) => id !== segmentId);
          }
          if (sleeveId) {
            segment.sleeveId = sleeveId;
            state.project.sleeves[sleeveId]?.segmentIds.push(segmentId);
          } else {
            delete segment.sleeveId;
          }
        });
      },

      removeSleeve(id) {
        set((state) => {
          delete state.project.sleeves[id];
          for (const segment of Object.values(state.project.segments)) {
            if (segment.sleeveId === id) delete segment.sleeveId;
          }
        });
      },

      updateSettings(patch) {
        set((state) => {
          Object.assign(state.project.settings, patch);
        });
      },
    })),
    {
      limit: 120,
      // Seul le projet entre dans l'historique.
      partialize: (state) => ({ project: state.project }) as ProjectStore,
      equality: (a, b) => a.project === b.project,
    },
  ),
);

export const projectHistory = useProject.temporal;

export const DEFAULT_PROJECT_SETTINGS = DEFAULT_SETTINGS;
