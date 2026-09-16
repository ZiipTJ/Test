/** Magasin du projet : les fils, les torons, et rien d'autre.
 *  Historique annuler/rétablir par zundo, mutations par immer. */
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { temporal } from 'zundo';
import type { Vec3 } from '../core/math/vec';
import { gradeForSection, WIRE_COLORS } from '../core/harness/library';
import { emptyProject, newId, type Id, type Project, type SleeveKind, type Toron, type Wire } from '../core/harness/types';

/** Ce dont on modifie le chemin : un fil libre, ou un toron. */
export interface PathTarget {
  kind: 'fil' | 'toron';
  id: Id;
}

interface ProjectActions {
  replaceProject(project: Project): void;
  resetProject(name?: string): void;
  renameProject(name: string): void;

  addWire(): Id;
  updateWire(id: Id, patch: Partial<Wire>): void;
  setSection(id: Id, section: number): void;
  removeWire(id: Id): void;

  /** Ajoute un point au chemin du fil, ou à celui de son toron. */
  addPoint(target: PathTarget, point: Vec3): void;
  removeLastPoint(target: PathTarget): void;
  clearPath(target: PathTarget): void;
  /** Déplace un point existant : c'est le geste d'ajustement du tracé. */
  movePoint(target: PathTarget, index: number, position: Vec3): void;
  /** Insère un point entre deux autres, pour infléchir la courbe. */
  insertPoint(target: PathTarget, index: number, position: Vec3): void;
  removePoint(target: PathTarget, index: number): void;

  groupToron(wireIds: Id[]): Id | null;
  ungroupToron(id: Id): void;
  updateToron(id: Id, patch: Partial<Toron>): void;
  setSleeve(id: Id, sleeve: SleeveKind): void;
}

export type ProjectStore = { project: Project } & ProjectActions;

function nextWireName(wires: readonly Wire[]): string {
  let max = 0;
  for (const wire of wires) {
    const match = /^F(\d+)$/.exec(wire.name.trim());
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `F${max + 1}`;
}

export const useProject = create<ProjectStore>()(
  temporal(
    immer((set, get) => ({
      project: emptyProject(),

      replaceProject: (project) => set((state) => { state.project = project; }),
      resetProject: (name) => set((state) => { state.project = emptyProject(name); }),
      renameProject: (name) => set((state) => { state.project.name = name; }),

      addWire() {
        const id = newId('f');
        set((state) => {
          const grade = gradeForSection(0.75);
          state.project.wires.push({
            id,
            name: nextWireName(state.project.wires),
            sectionMm2: grade.sectionMm2,
            color: WIRE_COLORS[state.project.wires.length % WIRE_COLORS.length]!.hex,
            outerDiameter: grade.outerDiameter,
            massPerMeter: grade.massPerMeter,
            resistancePerMeter: grade.resistancePerMeter,
            points: [],
            from: '',
            to: '',
            bendRadius: 30,
            slack: 0.03,
            tails: 0,
          });
        });
        return id;
      },

      updateWire: (id, patch) =>
        set((state) => {
          const wire = state.project.wires.find((item) => item.id === id);
          if (wire) Object.assign(wire, patch);
        }),

      /** Changer la section réaligne diamètre, masse et résistance sur le catalogue. */
      setSection: (id, section) =>
        set((state) => {
          const wire = state.project.wires.find((item) => item.id === id);
          if (!wire) return;
          const grade = gradeForSection(section);
          wire.sectionMm2 = grade.sectionMm2;
          wire.outerDiameter = grade.outerDiameter;
          wire.massPerMeter = grade.massPerMeter;
          wire.resistancePerMeter = grade.resistancePerMeter;
        }),

      removeWire: (id) =>
        set((state) => {
          state.project.wires = state.project.wires.filter((wire) => wire.id !== id);
          for (const toron of state.project.torons) {
            toron.wireIds = toron.wireIds.filter((wireId) => wireId !== id);
          }
          // Un toron vidé de ses fils n'a plus lieu d'être.
          state.project.torons = state.project.torons.filter((toron) => toron.wireIds.length > 0);
        }),

      addPoint: (target, point) =>
        set((state) => {
          const holder = target.kind === 'fil'
            ? state.project.wires.find((wire) => wire.id === target.id)
            : state.project.torons.find((toron) => toron.id === target.id);
          holder?.points.push(point);
        }),

      removeLastPoint: (target) =>
        set((state) => {
          const holder = target.kind === 'fil'
            ? state.project.wires.find((wire) => wire.id === target.id)
            : state.project.torons.find((toron) => toron.id === target.id);
          holder?.points.pop();
        }),

      clearPath: (target) =>
        set((state) => {
          const holder = target.kind === 'fil'
            ? state.project.wires.find((wire) => wire.id === target.id)
            : state.project.torons.find((toron) => toron.id === target.id);
          if (holder) holder.points = [];
        }),

      movePoint: (target, index, position) =>
        set((state) => {
          const holder = target.kind === 'fil'
            ? state.project.wires.find((wire) => wire.id === target.id)
            : state.project.torons.find((toron) => toron.id === target.id);
          if (holder?.points[index]) holder.points[index] = position;
        }),

      insertPoint: (target, index, position) =>
        set((state) => {
          const holder = target.kind === 'fil'
            ? state.project.wires.find((wire) => wire.id === target.id)
            : state.project.torons.find((toron) => toron.id === target.id);
          if (!holder) return;
          const at = Math.max(0, Math.min(holder.points.length, index));
          holder.points.splice(at, 0, position);
        }),

      removePoint: (target, index) =>
        set((state) => {
          const holder = target.kind === 'fil'
            ? state.project.wires.find((wire) => wire.id === target.id)
            : state.project.torons.find((toron) => toron.id === target.id);
          holder?.points.splice(index, 1);
        }),

      /** Réunit des fils : ils suivent désormais un chemin commun, repris du
       *  premier d'entre eux qui en avait déjà un. */
      groupToron(wireIds) {
        if (wireIds.length < 2) return null;
        const id = newId('t');
        set((state) => {
          const members = state.project.wires.filter((wire) => wireIds.includes(wire.id));
          if (members.length < 2) return;
          const reference = members.find((wire) => wire.points.length >= 2);
          const index = state.project.torons.length + 1;
          state.project.torons.push({
            id,
            name: `Toron ${index}`,
            wireIds: members.map((wire) => wire.id),
            points: reference ? reference.points.map((point) => [...point] as Vec3) : [],
            sleeve: 'spiralee',
            bendRadius: Math.max(...members.map((wire) => wire.bendRadius)),
            color: '#9aa2ae',
          });
          for (const wire of members) {
            // Le fil sort de son toron précédent, s'il en avait un.
            const previous = state.project.torons.find((toron) => toron.id === wire.toronId);
            if (previous) previous.wireIds = previous.wireIds.filter((wireId) => wireId !== wire.id);
            wire.toronId = id;
          }
          state.project.torons = state.project.torons.filter(
            (toron) => toron.id === id || toron.wireIds.length > 0,
          );
        });
        return id;
      },

      ungroupToron: (id) =>
        set((state) => {
          const toron = state.project.torons.find((item) => item.id === id);
          if (!toron) return;
          for (const wire of state.project.wires) {
            if (wire.toronId !== id) continue;
            delete wire.toronId;
            // Chaque fil repart avec le chemin du toron s'il n'en avait pas.
            if (wire.points.length < 2) wire.points = toron.points.map((point) => [...point] as Vec3);
          }
          state.project.torons = state.project.torons.filter((item) => item.id !== id);
        }),

      updateToron: (id, patch) =>
        set((state) => {
          const toron = state.project.torons.find((item) => item.id === id);
          if (toron) Object.assign(toron, patch);
        }),

      setSleeve: (id, sleeve) =>
        set((state) => {
          const toron = state.project.torons.find((item) => item.id === id);
          if (toron) toron.sleeve = sleeve;
        }),
    })),
    {
      limit: 120,
      partialize: (state) => ({ project: state.project }) as ProjectStore,
      equality: (a, b) => a.project === b.project,
    },
  ),
);

export const projectHistory = useProject.temporal;

/** Résultats dérivés, mémorisés sur l'identité du projet : immer en produit un
 *  nouveau à chaque modification, comparer les références suffit. */
import { compute, type Computation } from '../core/harness/compute';

let cache: { project: Project; result: Computation } | null = null;

export function useComputation(): Computation {
  const project = useProject((state) => state.project);
  if (cache?.project === project) return cache.result;
  const result = compute(project);
  cache = { project, result };
  return result;
}
