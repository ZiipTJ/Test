/** État de session : ce qui ne se sauvegarde pas et n'entre pas dans l'historique
 *  — modèle CAO importé, sélection, outil courant, options d'affichage. */
import { create } from 'zustand';
import type { ImportedModel } from '../io/types';
import type { Id } from '../core/harness/types';

export type Tool =
  | 'select'      // sélection et déplacement
  | 'node'        // poser un nœud sur le modèle
  | 'route'       // enchaîner des nœuds pour tracer le cheminement
  | 'via'         // ajouter un point de passage sur un segment
  | 'measure'     // mesurer entre deux points
  ;

export type SelectionKind = 'node' | 'segment' | 'wire' | 'sleeve' | 'mesh';

export interface Selection {
  kind: SelectionKind;
  id: Id;
}

export type BundleDisplay = 'toron' | 'fils' | 'axe';

export interface SnapModes {
  sommet: boolean;
  arete: boolean;
  milieu: boolean;
  face: boolean;
  cercle: boolean;
}

export interface ViewOptions {
  showModel: boolean;
  modelOpacity: number;
  showEdges: boolean;
  showNodes: boolean;
  /** Noms des nœuds. */
  showLabels: boolean;
  /** Cotes portées par les segments : longueur, nombre de fils, diamètre. */
  showSegmentLabels: boolean;
  bundleDisplay: BundleDisplay;
  showSleeves: boolean;
  sleeveOpacity: number;
  showGrid: boolean;
  snap: SnapModes;
}

export interface MeasureState {
  from: [number, number, number] | null;
  to: [number, number, number] | null;
}

export type PanelKey = 'modele' | 'cheminement' | 'fils' | 'gaines' | 'controles' | 'nomenclature' | 'reglages';

interface SessionState {
  model: ImportedModel | null;
  meshVisibility: Record<string, boolean>;
  importing: { step: string; ratio: number } | null;
  status: { message: string; tone: 'info' | 'succes' | 'alerte' | 'erreur' } | null;

  tool: Tool;
  selection: Selection[];
  hovered: Selection | null;
  /** Nœud d'accroche courant pendant le tracé d'un cheminement. */
  routeFrom: Id | null;
  measure: MeasureState;

  view: ViewOptions;
  panel: PanelKey;
  /** Coupe de toron affichée dans le panneau latéral. */
  inspectedSegment: Id | null;
  flattenOpen: boolean;
  /** Demande de recadrage : la cible et un compteur pour rejouer la même demande. */
  fitRequest: { target: 'modele' | 'faisceau'; nonce: number };

  setModel(model: ImportedModel | null): void;
  toggleMesh(id: string): void;
  setImporting(progress: { step: string; ratio: number } | null): void;
  setStatus(status: SessionState['status']): void;

  setTool(tool: Tool): void;
  select(selection: Selection | null, additive?: boolean): void;
  setHovered(selection: Selection | null): void;
  setRouteFrom(id: Id | null): void;
  setMeasure(measure: MeasureState): void;

  setView(patch: Partial<ViewOptions>): void;
  setSnap(patch: Partial<SnapModes>): void;
  setPanel(panel: PanelKey): void;
  inspectSegment(id: Id | null): void;
  setFlattenOpen(open: boolean): void;
  requestFit(target: 'modele' | 'faisceau'): void;
}

export const useSession = create<SessionState>()((set) => ({
  model: null,
  meshVisibility: {},
  importing: null,
  status: null,

  tool: 'select',
  selection: [],
  hovered: null,
  routeFrom: null,
  measure: { from: null, to: null },

  view: {
    showModel: true,
    modelOpacity: 0.85,
    showEdges: true,
    showNodes: true,
    showLabels: true,
    showSegmentLabels: false,
    bundleDisplay: 'toron',
    showSleeves: true,
    sleeveOpacity: 0.9,
    showGrid: true,
    snap: { sommet: true, arete: true, milieu: true, face: true, cercle: true },
  },
  panel: 'modele',
  inspectedSegment: null,
  flattenOpen: false,
  fitRequest: { target: 'modele', nonce: 0 },

  setModel: (model) =>
    set(() => ({
      model,
      meshVisibility: model ? Object.fromEntries(model.meshes.map((mesh) => [mesh.id, true])) : {},
    })),

  toggleMesh: (id) =>
    set((state) => ({ meshVisibility: { ...state.meshVisibility, [id]: !(state.meshVisibility[id] ?? true) } })),

  setImporting: (importing) => set(() => ({ importing })),
  setStatus: (status) => set(() => ({ status })),

  setTool: (tool) => set(() => ({ tool, routeFrom: null, measure: { from: null, to: null } })),

  select: (selection, additive = false) =>
    set((state) => {
      if (!selection) return { selection: [] };
      if (!additive) return { selection: [selection] };
      const exists = state.selection.some((s) => s.kind === selection.kind && s.id === selection.id);
      return {
        selection: exists
          ? state.selection.filter((s) => !(s.kind === selection.kind && s.id === selection.id))
          : [...state.selection, selection],
      };
    }),

  setHovered: (hovered) => set(() => ({ hovered })),
  setRouteFrom: (routeFrom) => set(() => ({ routeFrom })),
  setMeasure: (measure) => set(() => ({ measure })),

  setView: (patch) => set((state) => ({ view: { ...state.view, ...patch } })),
  setSnap: (patch) => set((state) => ({ view: { ...state.view, snap: { ...state.view.snap, ...patch } } })),
  setPanel: (panel) => set(() => ({ panel })),
  inspectSegment: (inspectedSegment) => set(() => ({ inspectedSegment })),
  setFlattenOpen: (flattenOpen) => set(() => ({ flattenOpen })),
  requestFit: (target) => set((state) => ({ fitRequest: { target, nonce: state.fitRequest.nonce + 1 } })),
}));

export const isSelected = (selection: Selection[], kind: SelectionKind, id: Id): boolean =>
  selection.some((s) => s.kind === kind && s.id === id);
