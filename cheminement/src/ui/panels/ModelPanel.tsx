/** Panneau « Modèle » : corps importés, arêtes, accrochage, options d'affichage. */
import { useSession } from '../../state/session';
import { useProject } from '../../state/project';

export function ModelPanel() {
  const model = useSession((state) => state.model);
  const visibility = useSession((state) => state.meshVisibility);
  const toggleMesh = useSession((state) => state.toggleMesh);
  const view = useSession((state) => state.view);
  const setView = useSession((state) => state.setView);
  const setSnap = useSession((state) => state.setSnap);
  const settings = useProject((state) => state.project.settings);
  const updateSettings = useProject((state) => state.updateSettings);

  return (
    <div className="panel">
      <h2>Modèle importé</h2>
      {!model && (
        <p className="hint">
          Aucun modèle. Importez un fichier <strong>STEP</strong>, <strong>3MF</strong> ou <strong>STL</strong>,
          ou chargez la démonstration depuis la barre d’outils. Le STEP est tessellé par OpenCascade, ce qui
          donne les vraies arêtes du modèle et permet de s’accrocher aux perçages.
        </p>
      )}

      {model && (
        <>
          <div className="card compact">
            <div className="row" style={{ margin: 0, justifyContent: 'space-between' }}>
              <strong>{model.name}</strong>
              <span className="meta">{model.format.toUpperCase()}</span>
            </div>
            <div className="legend">
              <span>{model.stats.meshes} corps</span>
              <span>{model.stats.triangles.toLocaleString('fr-FR')} triangles</span>
              <span>{model.stats.edges.toLocaleString('fr-FR')} arêtes</span>
              <span>{model.stats.durationMs} ms</span>
            </div>
          </div>

          {model.warnings.length > 0 && (
            <div className="card compact">
              {model.warnings.slice(0, 6).map((warning) => (
                <div key={warning} className="checkline"><span className="severity alerte" />{warning}</div>
              ))}
            </div>
          )}

          <h2>Corps</h2>
          <div className="list">
            {model.meshes.map((mesh) => (
              <button
                key={mesh.id}
                className="item"
                onClick={() => toggleMesh(mesh.id)}
                title="Afficher ou masquer ce corps"
              >
                <span>{visibility[mesh.id] === false ? '☐' : '☑'} {mesh.name}</span>
                <span className="meta">{(mesh.indices.length / 3).toLocaleString('fr-FR')} tri.</span>
              </button>
            ))}
          </div>
        </>
      )}

      <h2>Affichage</h2>
      <label className="checkline">
        <input type="checkbox" checked={view.showModel} onChange={(e) => setView({ showModel: e.target.checked })} />
        Afficher le modèle
      </label>
      <div className="field">
        <label>Opacité</label>
        <input
          type="range" min={0.1} max={1} step={0.05} value={view.modelOpacity}
          onChange={(e) => setView({ modelOpacity: Number(e.target.value) })}
        />
      </div>
      <label className="checkline">
        <input type="checkbox" checked={view.showEdges} onChange={(e) => setView({ showEdges: e.target.checked })} />
        Afficher les arêtes
      </label>
      <label className="checkline">
        <input type="checkbox" checked={view.showGrid} onChange={(e) => setView({ showGrid: e.target.checked })} />
        Grille
      </label>
      <label className="checkline">
        <input type="checkbox" checked={view.showNodes} onChange={(e) => setView({ showNodes: e.target.checked })} />
        Nœuds
      </label>
      <label className="checkline">
        <input type="checkbox" checked={view.showLabels} onChange={(e) => setView({ showLabels: e.target.checked })} />
        Repères des nœuds
      </label>
      <label className="checkline">
        <input type="checkbox" checked={view.showSegmentLabels} onChange={(e) => setView({ showSegmentLabels: e.target.checked })} />
        Cotes des tronçons
      </label>
      <label className="checkline">
        <input type="checkbox" checked={view.showSleeves} onChange={(e) => setView({ showSleeves: e.target.checked })} />
        Gaines
      </label>
      <div className="field">
        <label>Opacité gaines</label>
        <input
          type="range" min={0.2} max={1} step={0.05} value={view.sleeveOpacity}
          onChange={(e) => setView({ sleeveOpacity: Number(e.target.value) })}
        />
      </div>

      <h2>Accrochage</h2>
      <p className="hint">Priorité : centre de perçage, puis sommet, milieu d’arête, arête, face.</p>
      {([
        ['cercle', 'Centre de perçage'],
        ['sommet', 'Sommet'],
        ['milieu', 'Milieu d’arête'],
        ['arete', 'Arête'],
        ['face', 'Face'],
      ] as const).map(([key, label]) => (
        <label key={key} className="checkline">
          <input type="checkbox" checked={view.snap[key]} onChange={(e) => setSnap({ [key]: e.target.checked })} />
          {label}
        </label>
      ))}
      <div className="field">
        <label>Tolérance (px)</label>
        <input
          type="number" min={4} max={40} value={settings.snapPixelRadius}
          onChange={(e) => updateSettings({ snapPixelRadius: Number(e.target.value) })}
        />
      </div>
    </div>
  );
}
