/** Barre d'outils : fichier, historique, outils de tracé, options d'affichage. */
import { useRef } from 'react';
import { ACCEPTED_EXTENSIONS, importModel } from '../io/importer';
import { downloadProject, parseProject } from '../io/project';
import { clearMeshIndexes } from '../viewer/snapping';
import { buildDemoProject } from '../state/demo';
import { projectHistory, useProject } from '../state/project';
import { useSession, type Tool } from '../state/session';

const TOOLS: Array<{ id: Tool; label: string; hint: string }> = [
  { id: 'select', label: 'Sélection', hint: 'Sélectionner. Alt + clic déplace le nœud sélectionné sur le point accroché.' },
  { id: 'node', label: 'Nœud', hint: 'Poser un nœud sur le modèle (collier dans un perçage).' },
  { id: 'route', label: 'Cheminement', hint: 'Enchaîner les points du cheminement. Échap pour terminer.' },
  { id: 'via', label: 'Point de passage', hint: 'Ajouter un point de passage au segment sélectionné.' },
  { id: 'measure', label: 'Mesure', hint: 'Mesurer entre deux points accrochés.' },
];

export function Toolbar() {
  const fileInput = useRef<HTMLInputElement>(null);
  const projectInput = useRef<HTMLInputElement>(null);

  const project = useProject((state) => state.project);
  const renameProject = useProject((state) => state.renameProject);
  const replaceProject = useProject((state) => state.replaceProject);
  const resetProject = useProject((state) => state.resetProject);

  const tool = useSession((state) => state.tool);
  const setTool = useSession((state) => state.setTool);
  const view = useSession((state) => state.view);
  const setView = useSession((state) => state.setView);
  const setModel = useSession((state) => state.setModel);
  const setImporting = useSession((state) => state.setImporting);
  const setStatus = useSession((state) => state.setStatus);
  const setFlattenOpen = useSession((state) => state.setFlattenOpen);
  const requestFit = useSession((state) => state.requestFit);

  const handleGeometry = async (file: File) => {
    try {
      setImporting({ step: 'Préparation', ratio: 0 });
      clearMeshIndexes();
      const model = await importModel(file, {}, (progress) => setImporting(progress));
      setModel(model);
      setStatus({
        message: `${file.name} : ${model.stats.meshes} corps, ${model.stats.triangles.toLocaleString('fr-FR')} triangles, ${model.stats.edges.toLocaleString('fr-FR')} arêtes en ${model.stats.durationMs} ms.`,
        tone: 'succes',
      });
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
      const blob = await response.blob();
      await handleGeometry(new File([blob], 'platine-cheminement.step'));
    } catch (error) {
      setStatus({
        message: `Faisceau de démonstration chargé, sans son modèle CAO (${error instanceof Error ? error.message : error}).`,
        tone: 'alerte',
      });
    }
  };

  return (
    <header className="topbar">
      <div className="brand">
        <h1>Cheminement</h1>
        <span>routage de faisceaux électriques</span>
      </div>

      <input
        className="project-name"
        value={project.name}
        onChange={(event) => renameProject(event.target.value)}
        aria-label="Nom du projet"
      />

      <div className="toolgroup">
        <button className="tool" onClick={() => fileInput.current?.click()}>Importer STEP / 3MF…</button>
        <input
          ref={fileInput}
          type="file"
          accept={ACCEPTED_EXTENSIONS}
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleGeometry(file);
            event.target.value = '';
          }}
        />
        <button className="tool" onClick={() => void loadDemo()}>Démonstration</button>
      </div>

      <div className="toolgroup">
        <button className="tool" onClick={() => downloadProject(project)}>Enregistrer</button>
        <button className="tool" onClick={() => projectInput.current?.click()}>Ouvrir…</button>
        <input
          ref={projectInput}
          type="file"
          accept=".json"
          hidden
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
          }}
        />
        <button className="tool" onClick={() => { resetProject(); setStatus({ message: 'Nouveau faisceau.', tone: 'info' }); }}>Nouveau</button>
      </div>

      <div className="toolgroup">
        <button className="tool" title="Annuler (Ctrl+Z)" onClick={() => projectHistory.getState().undo()}>↶</button>
        <button className="tool" title="Rétablir (Ctrl+Y)" onClick={() => projectHistory.getState().redo()}>↷</button>
      </div>

      <div className="toolgroup">
        {TOOLS.map((entry) => (
          <button
            key={entry.id}
            className={`tool${tool === entry.id ? ' is-active' : ''}`}
            title={entry.hint}
            onClick={() => setTool(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className="spacer" />

      <div className="toolgroup">
        <button
          className={`tool${view.showEdges ? ' is-active' : ''}`}
          title="Afficher les arêtes du modèle"
          onClick={() => setView({ showEdges: !view.showEdges })}
        >
          Arêtes
        </button>
        <button
          className={`tool${view.showModel ? ' is-active' : ''}`}
          onClick={() => setView({ showModel: !view.showModel })}
        >
          Modèle
        </button>
        <button
          className={`tool${view.showLabels ? ' is-active' : ''}`}
          title="Noms des nœuds"
          onClick={() => setView({ showLabels: !view.showLabels })}
        >
          Repères
        </button>
        <button
          className={`tool${view.showSegmentLabels ? ' is-active' : ''}`}
          title="Longueur, nombre de fils et diamètre de chaque tronçon"
          onClick={() => setView({ showSegmentLabels: !view.showSegmentLabels })}
        >
          Cotes
        </button>
        <select
          className="tool"
          value={view.bundleDisplay}
          onChange={(event) => setView({ bundleDisplay: event.target.value as typeof view.bundleDisplay })}
          title="Représentation du faisceau"
        >
          <option value="toron">Toron</option>
          <option value="fils">Fils détaillés</option>
          <option value="axe">Axe seul</option>
        </select>
        <button className="tool" title="Cadrer sur le modèle" onClick={() => requestFit('modele')}>Cadrer</button>
        <button className="tool" title="Cadrer sur le faisceau" onClick={() => requestFit('faisceau')}>Cadrer le faisceau</button>
        <button className="tool" onClick={() => setFlattenOpen(true)}>Mise à plat</button>
      </div>
    </header>
  );
}
