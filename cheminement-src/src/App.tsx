/** Coquille de l'application : barre d'outils, vue 3D, panneaux, barre d'état. */
import { useEffect } from 'react';
import { Viewer } from './viewer/Viewer';
import { Toolbar } from './ui/Toolbar';
import { FlattenView } from './ui/FlattenView';
import { ModelPanel } from './ui/panels/ModelPanel';
import { RoutePanel } from './ui/panels/RoutePanel';
import { WirePanel } from './ui/panels/WirePanel';
import { SleevePanel } from './ui/panels/SleevePanel';
import { ChecksPanel } from './ui/panels/ChecksPanel';
import { BomPanel } from './ui/panels/BomPanel';
import { SettingsPanel } from './ui/panels/SettingsPanel';
import { deriveAll } from './state/derived';
import { projectHistory, useProject } from './state/project';
import { useSession, type PanelKey } from './state/session';

const PANELS: Array<{ key: PanelKey; label: string }> = [
  { key: 'modele', label: 'Modèle' },
  { key: 'cheminement', label: 'Cheminement' },
  { key: 'fils', label: 'Fils' },
  { key: 'gaines', label: 'Gaines' },
  { key: 'controles', label: 'Contrôles' },
  { key: 'nomenclature', label: 'Nomenclature' },
  { key: 'reglages', label: 'Réglages' },
];

function StatusBar() {
  const status = useSession((state) => state.status);
  const importing = useSession((state) => state.importing);
  const tool = useSession((state) => state.tool);
  const routeFrom = useSession((state) => state.routeFrom);
  const project = useProject((state) => state.project);
  const derived = deriveAll(project);

  return (
    <footer className="statusbar">
      {importing ? (
        <>
          <span>{importing.step}…</span>
          <span className="progress"><i style={{ width: `${Math.round(importing.ratio * 100)}%` }} /></span>
        </>
      ) : (
        <span className={status ? `tone-${status.tone}` : ''}>
          {status?.message ?? 'Prêt. Importez un modèle ou chargez la démonstration.'}
        </span>
      )}
      <div className="spacer" />
      {tool === 'route' && <span>{routeFrom ? 'Cliquez le point suivant — Échap pour terminer.' : 'Cliquez le premier point.'}</span>}
      <span><span className="severity erreur" />{derived.checkSummary.erreur}</span>
      <span><span className="severity alerte" />{derived.checkSummary.alerte}</span>
    </footer>
  );
}

function Sidebar() {
  const panel = useSession((state) => state.panel);
  const setPanel = useSession((state) => state.setPanel);
  const project = useProject((state) => state.project);
  const derived = deriveAll(project);

  return (
    <aside className="sidebar">
      <nav className="tabs">
        {PANELS.map((entry) => (
          <button
            key={entry.key}
            className={panel === entry.key ? 'is-active' : ''}
            onClick={() => setPanel(entry.key)}
          >
            {entry.label}
            {entry.key === 'controles' && derived.checkSummary.erreur > 0 && (
              <span className="badge">{derived.checkSummary.erreur}</span>
            )}
          </button>
        ))}
      </nav>
      {panel === 'modele' && <ModelPanel />}
      {panel === 'cheminement' && <RoutePanel />}
      {panel === 'fils' && <WirePanel />}
      {panel === 'gaines' && <SleevePanel />}
      {panel === 'controles' && <ChecksPanel />}
      {panel === 'nomenclature' && <BomPanel />}
      {panel === 'reglages' && <SettingsPanel />}
    </aside>
  );
}

export function App() {
  const flattenOpen = useSession((state) => state.flattenOpen);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      const ctrl = event.ctrlKey || event.metaKey;
      if (ctrl && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) projectHistory.getState().redo();
        else projectHistory.getState().undo();
      } else if (ctrl && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        projectHistory.getState().redo();
      } else if (!ctrl) {
        const shortcuts: Record<string, () => void> = {
          s: () => useSession.getState().setTool('select'),
          n: () => useSession.getState().setTool('node'),
          c: () => useSession.getState().setTool('route'),
          p: () => useSession.getState().setTool('via'),
          m: () => useSession.getState().setTool('measure'),
        };
        shortcuts[event.key.toLowerCase()]?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app">
      <Toolbar />
      <div className="workspace">
        <Viewer />
        <Sidebar />
      </div>
      <StatusBar />
      {flattenOpen && <FlattenView />}
    </div>
  );
}
