/** Panneau « Gaines » : pose d'une gaine sur les segments sélectionnés,
 *  choix automatique de la taille et contrôle du remplissage. */
import { SLEEVE_CATALOG, SLEEVE_KIND_LABEL } from '../../core/harness/library';
import type { SleeveKind } from '../../core/harness/types';
import { deriveAll } from '../../state/derived';
import { useProject } from '../../state/project';
import { useSession } from '../../state/session';

const KINDS: SleeveKind[] = ['spiralee', 'annelee', 'tressee', 'thermo', 'ruban'];

export function SleevePanel() {
  const project = useProject((state) => state.project);
  const addSleeve = useProject((state) => state.addSleeve);
  const updateSleeve = useProject((state) => state.updateSleeve);
  const removeSleeve = useProject((state) => state.removeSleeve);
  const assignSleeve = useProject((state) => state.assignSleeve);
  const selection = useSession((state) => state.selection);
  const setStatus = useSession((state) => state.setStatus);
  const derived = deriveAll(project);

  const selectedSegments = selection.filter((item) => item.kind === 'segment').map((item) => item.id);
  const maxBundle = Math.max(
    0,
    ...selectedSegments.map((id) => derived.computation.loads.get(id)?.bundleDiameter ?? 0),
  );

  return (
    <div className="panel">
      <h2>Poser une gaine</h2>
      <p className="hint">
        Sélectionnez un ou plusieurs segments dans la vue (Maj + clic pour en ajouter), puis choisissez le type.
        La taille est prise au catalogue en respectant le taux de remplissage maximal.
      </p>
      <div className="legend">
        <span>{selectedSegments.length} segment(s) sélectionné(s)</span>
        {maxBundle > 0 && <span>toron le plus gros Ø{maxBundle.toFixed(1)} mm</span>}
      </div>
      <div className="row">
        {KINDS.map((kind) => (
          <button
            key={kind}
            className="tool"
            disabled={selectedSegments.length === 0}
            onClick={() => {
              const id = addSleeve(kind, maxBundle, selectedSegments);
              const sleeve = useProject.getState().project.sleeves[id];
              setStatus({
                message: `${SLEEVE_KIND_LABEL[kind]} posée sur ${selectedSegments.length} segment(s)${sleeve ? ` — Ø int. ${sleeve.innerDiameter} mm` : ''}.`,
                tone: 'succes',
              });
            }}
          >
            {SLEEVE_KIND_LABEL[kind]}
          </button>
        ))}
      </div>

      <h2>Gaines du faisceau</h2>
      {Object.keys(project.sleeves).length === 0 && <p className="hint">Aucune gaine posée.</p>}
      {Object.values(project.sleeves).map((sleeve) => {
        const length = sleeve.segmentIds.reduce(
          (sum, id) => sum + (derived.computation.geometry.get(id)?.length ?? 0),
          0,
        );
        const worstFill = Math.max(
          0,
          ...sleeve.segmentIds.map((id) => derived.computation.loads.get(id)?.fill?.ratio ?? 0),
        );
        return (
          <div className="card" key={sleeve.id}>
            <h3>
              <span className="swatch" style={{ background: sleeve.color }} /> {sleeve.name}
            </h3>
            <div className="field">
              <label>Nom</label>
              <input value={sleeve.name} onChange={(event) => updateSleeve(sleeve.id, { name: event.target.value })} />
            </div>
            <div className="field">
              <label>Type</label>
              <select value={sleeve.kind} onChange={(event) => updateSleeve(sleeve.id, { kind: event.target.value as SleeveKind })}>
                {KINDS.map((kind) => <option key={kind} value={kind}>{SLEEVE_KIND_LABEL[kind]}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Référence</label>
              <select
                value={sleeve.ref ?? ''}
                onChange={(event) => {
                  const entry = SLEEVE_CATALOG.find((item) => item.ref === event.target.value);
                  if (entry) {
                    updateSleeve(sleeve.id, {
                      ref: entry.ref, kind: entry.kind, innerDiameter: entry.innerDiameter,
                      wallThickness: entry.wallThickness, pitch: entry.pitch, bandWidth: entry.bandWidth,
                    });
                  }
                }}
              >
                <option value="">— libre —</option>
                {SLEEVE_CATALOG.filter((entry) => entry.kind === sleeve.kind).map((entry) => (
                  <option key={entry.ref} value={entry.ref}>{entry.ref}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Ø intérieur</label>
              <input
                type="number" min={0} step={0.5} value={sleeve.innerDiameter}
                onChange={(event) => updateSleeve(sleeve.id, { innerDiameter: Number(event.target.value) })}
              />
            </div>
            {(sleeve.kind === 'spiralee' || sleeve.kind === 'ruban') && (
              <>
                <div className="field">
                  <label>Pas (mm/tour)</label>
                  <input
                    type="number" min={1} step={1} value={sleeve.pitch}
                    onChange={(event) => updateSleeve(sleeve.id, { pitch: Number(event.target.value) })}
                  />
                </div>
                <div className="field">
                  <label>Largeur de bande</label>
                  <input
                    type="number" min={0.5} step={0.5} value={sleeve.bandWidth}
                    onChange={(event) => updateSleeve(sleeve.id, { bandWidth: Number(event.target.value) })}
                  />
                </div>
              </>
            )}
            <div className="field">
              <label>Couleur</label>
              <input type="color" value={sleeve.color} onChange={(event) => updateSleeve(sleeve.id, { color: event.target.value })} />
            </div>

            <div className="legend">
              <span>{sleeve.segmentIds.length} segment(s)</span>
              <span>{(length / 1000).toFixed(2)} m</span>
              {worstFill > 0 && (
                <span style={{ color: worstFill > project.settings.maxFillRatio ? 'var(--warn)' : 'var(--ok)' }}>
                  remplissage max {(worstFill * 100).toFixed(0)} %
                </span>
              )}
            </div>

            <div className="list">
              {sleeve.segmentIds.map((id) => (
                <button key={id} className="item" onClick={() => assignSleeve(id, null)}>
                  <span>{project.segments[id]?.name ?? id}</span>
                  <span className="meta">retirer</span>
                </button>
              ))}
            </div>

            <div className="row">
              <button
                className="ghost"
                disabled={selectedSegments.length === 0}
                onClick={() => { for (const id of selectedSegments) assignSleeve(id, sleeve.id); }}
              >
                Appliquer à la sélection
              </button>
              <button className="ghost" onClick={() => removeSleeve(sleeve.id)}>Supprimer</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
