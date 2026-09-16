/** Coquille de l'application : un bandeau, la vue 3D, le panneau des fils. */
import { useEffect, useRef } from 'react';
import { ACCEPTED_EXTENSIONS, importModel } from './io/importer';
import { downloadProject, downloadWireTable, parseProject } from './io/project';
import { buildDemoProject } from './state/demo';
import { projectHistory, useComputation, useProject } from './state/project';
import { useSession } from './state/session';
import { clearMeshIndexes } from './viewer/snapping';
import { Viewer } from './viewer/Viewer';
import { Panel } from './ui/Panel';

function Header() {
  const geometryInput = useRef<HTMLInputElement>(null);
  const projectInput = useRef<HTMLInputElement>(null);

  const project = useProject((state) => state.project);
  const renameProject = useProject((state) => state.renameProject);
  const replaceProject = useProject((state) => state.replaceProject);
  const computation = useComputation();

  const setModel = useSession((state) => state.setModel);
  const setImporting = useSession((state) => state.setImporting);
  const setStatus = useSession((state) => state.setStatus);
  const showEdges = useSession((state) => state.showEdges);
  const setShowEdges = useSession((state) => state.setShowEdges);

  const loadGeometry = async (file: File) => {
    try {
      setImporting({ step: 'Lecture', ratio: 0 });
      clearMeshIndexes();
      const model = await importModel(file, {}, setImporting);
      setModel(model);
      setStatus({ message: `${file.name} — ${model.stats.meshes} corps, ${model.stats.triangles.toLocaleString('fr-FR')} triangles.`, tone: 'succes' });
    } catch (error) {
      setStatus({ message: error instanceof Error ? error.message : String(error), tone: 'erreur' });
    } finally {
      setImporting(null);
    }
  };

  const loadDemo = async () => {
    replaceProject(buildDemoProject());
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}demo/platine-cheminement.step`);
      if (!response.ok) throw new Error('Modèle de démonstration introuvable.');
      await loadGeometry(new File([await response.blob()], 'platine-cheminement.step'));
    } catch (error) {
      setStatus({ message: error instanceof Error ? error.message : String(error), tone: 'erreur' });
    }
  };

  return (
    <header className="topbar">
      <strong className="brand">Cheminement</strong>
      <input className="title" value={project.name} onChange={(event) => renameProject(event.target.value)} aria-label="Nom du projet" />

      <button onClick={() => geometryInput.current?.click()}>Importer une pièce</button>
      <input ref={geometryInput} type="file" accept={ACCEPTED_EXTENSIONS} hidden
        onChange={(event) => { const file = event.target.files?.[0]; if (file) void loadGeometry(file); event.target.value = ''; }} />
      <button onClick={() => void loadDemo()}>Démonstration</button>

      <span className="spacer" />

      <button className={showEdges ? 'is-on' : ''} onClick={() => setShowEdges(!showEdges)} title="Afficher les arêtes de la pièce">Arêtes</button>
      <button onClick={() => projectInput.current?.click()}>Ouvrir</button>
      <input ref={projectInput} type="file" accept=".json" hidden
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file) return;
          try {
            replaceProject(parseProject(await file.text()));
            setStatus({ message: `Projet « ${file.name} » ouvert.`, tone: 'succes' });
          } catch (error) {
            setStatus({ message: error instanceof Error ? error.message : String(error), tone: 'erreur' });
          }
        }} />
      <button onClick={() => downloadProject(project)}>Enregistrer</button>
      <button onClick={() => downloadWireTable(project, computation)}>Exporter le tableau</button>
    </header>
  );
}

/** Bandeau d'aide : pendant un tracé, puis pendant l'ajustement du tracé. */
function HintBar() {
  const drawing = useSession((state) => state.drawing);
  const setDrawing = useSession((state) => state.setDrawing);
  const selected = useSession((state) => state.selected);
  const snapLabel = useSession((state) => state.snapLabel);
  const drag = useSession((state) => state.drag);
  const model = useSession((state) => state.model);
  const project = useProject((state) => state.project);
  const removeLastPoint = useProject((state) => state.removeLastPoint);

  const find = (target: { kind: 'fil' | 'toron'; id: string }) =>
    target.kind === 'fil'
      ? project.wires.find((wire) => wire.id === target.id)
      : project.torons.find((toron) => toron.id === target.id);

  if (drawing) {
    const holder = find(drawing);
    const count = holder?.points.length ?? 0;
    return (
      <div className="hintbar">
        <strong>{holder?.name}</strong>
        <span className={snapLabel ? 'snap' : ''}>
          {!model
            ? 'Importez d’abord une pièce pour pouvoir cliquer dessus.'
            : snapLabel
              ? `Accrochage : ${snapLabel.toLowerCase()}`
              : 'Cliquez les points sur la pièce.'}
        </span>
        <span className="count">{count} point{count > 1 ? 's' : ''}</span>
        <button disabled={count === 0} onClick={() => removeLastPoint(drawing)}>Annuler le dernier</button>
        <button className="primary" onClick={() => setDrawing(null)}>Terminer</button>
      </div>
    );
  }

  if (!selected) return null;
  const holder = find(selected);
  if (!holder || holder.points.length === 0) return null;

  return (
    <div className="hintbar quiet">
      <strong>{holder.name}</strong>
      <span className={drag ? 'snap' : ''}>
        {drag
          ? snapLabel
            ? `Accrochage : ${snapLabel.toLowerCase()}`
            : 'Relâchez pour poser le point.'
          : 'Glissez un point pour l’ajuster · glissez la courbe pour en ajouter un · double-clic pour en retirer un.'}
      </span>
      <span className="count">{holder.points.length} points</span>
    </div>
  );
}

function StatusBar() {
  const status = useSession((state) => state.status);
  const importing = useSession((state) => state.importing);
  const totals = useComputation().totals;

  return (
    <footer className="statusbar">
      {importing ? (
        <>
          <span>{importing.step}…</span>
          <span className="progress"><i style={{ width: `${Math.round(importing.ratio * 100)}%` }} /></span>
        </>
      ) : (
        <span className={status ? `tone-${status.tone}` : ''}>
          {status?.message ?? 'Créez un fil, donnez-lui son nom et sa section, puis tracez son chemin sur la pièce.'}
        </span>
      )}
      <span className="spacer" />
      <span>{totals.wireCount} fils · {totals.tracedCount} tracés</span>
      <span>{(totals.wireLength / 1000).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m de fil</span>
      <span>{(totals.massGram / 1000).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg</span>
    </footer>
  );
}

export function App() {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) projectHistory.getState().redo();
        else projectHistory.getState().undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app">
      <Header />
      <div className="workspace">
        <div className="stage">
          <Viewer />
          <HintBar />
        </div>
        <Panel />
      </div>
      <StatusBar />
    </div>
  );
}
