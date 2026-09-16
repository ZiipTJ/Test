/** Panneau « Contrôles » : ce qui empêcherait de fabriquer ou de monter. */
import { deriveAll } from '../../state/derived';
import { useProject } from '../../state/project';
import { useSession } from '../../state/session';

export function ChecksPanel() {
  const project = useProject((state) => state.project);
  const select = useSession((state) => state.select);
  const setPanel = useSession((state) => state.setPanel);
  const derived = deriveAll(project);

  return (
    <div className="panel">
      <h2>Contrôles</h2>
      <div className="legend">
        <span><span className="severity erreur" />{derived.checkSummary.erreur} erreur(s)</span>
        <span><span className="severity alerte" />{derived.checkSummary.alerte} alerte(s)</span>
        <span><span className="severity info" />{derived.checkSummary.info} information(s)</span>
      </div>

      {derived.checks.length === 0 && <p className="hint">Rien à signaler.</p>}

      {derived.checks.map((item) => (
        <div
          className="card compact"
          key={item.id}
          style={{ cursor: item.target ? 'pointer' : 'default' }}
          onClick={() => {
            if (!item.target) return;
            const kind = item.target.kind === 'sleeve' ? 'sleeve' : item.target.kind;
            select({ kind, id: item.target.id });
            setPanel(kind === 'wire' ? 'fils' : kind === 'sleeve' ? 'gaines' : 'cheminement');
          }}
        >
          <div><span className={`severity ${item.severity}`} /><strong>{item.title}</strong></div>
          <div className="hint" style={{ margin: '2px 0 0' }}>{item.detail}</div>
        </div>
      ))}
    </div>
  );
}
