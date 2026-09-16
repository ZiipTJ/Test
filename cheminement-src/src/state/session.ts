/** État de session : le modèle importé et ce qui est en cours à l'écran.
 *  Rien de tout cela ne se sauvegarde ni n'entre dans l'historique. */
import { create } from 'zustand';
import type { ImportedModel } from '../io/types';
import type { Id } from '../core/harness/types';

/** Ce dont on trace le chemin en ce moment. */
export interface DrawTarget {
  kind: 'fil' | 'toron';
  id: Id;
}

interface SessionState {
  model: ImportedModel | null;
  importing: { step: string; ratio: number } | null;
  status: { message: string; tone: 'info' | 'succes' | 'erreur' } | null;

  /** Fil ou toron affiché dans le panneau de droite. */
  selected: { kind: 'fil' | 'toron'; id: Id } | null;
  /** Fils cochés, en attente d'être réunis en toron. */
  checked: Id[];
  drawing: DrawTarget | null;
  /** Ce que vise l'accrochage sous le curseur, affiché dans le bandeau de tracé. */
  snapLabel: string | null;
  showEdges: boolean;

  setModel(model: ImportedModel | null): void;
  setImporting(progress: SessionState['importing']): void;
  setStatus(status: SessionState['status']): void;
  select(selected: SessionState['selected']): void;
  toggleChecked(id: Id): void;
  clearChecked(): void;
  setDrawing(target: DrawTarget | null): void;
  setSnapLabel(label: string | null): void;
  setShowEdges(value: boolean): void;
}

export const useSession = create<SessionState>()((set) => ({
  model: null,
  importing: null,
  status: null,
  selected: null,
  checked: [],
  drawing: null,
  snapLabel: null,
  showEdges: true,

  setModel: (model) => set(() => ({ model })),
  setImporting: (importing) => set(() => ({ importing })),
  setStatus: (status) => set(() => ({ status })),
  select: (selected) => set(() => ({ selected, drawing: null, snapLabel: null })),
  toggleChecked: (id) =>
    set((state) => ({
      checked: state.checked.includes(id) ? state.checked.filter((item) => item !== id) : [...state.checked, id],
    })),
  clearChecked: () => set(() => ({ checked: [] })),
  setDrawing: (drawing) => set(() => ({ drawing, snapLabel: null })),
  setSnapLabel: (snapLabel) => set((state) => (state.snapLabel === snapLabel ? state : { snapLabel })),
  setShowEdges: (showEdges) => set(() => ({ showEdges })),
}));
