/** Panneau de droite : la liste des fils, et le détail de celui qu'on a choisi. */
import { WIRE_COLORS, WIRE_GRADES } from '../core/harness/library';
import { SLEEVE_LABEL, type SleeveKind, type Toron, type Wire } from '../core/harness/types';
import { useComputation, useProject } from '../state/project';
import { useSession } from '../state/session';

const metres = (mm: number): string => `${(mm / 1000).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m`;
const nombre = (value: number, decimals = 1): string =>
  value.toLocaleString('fr-FR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function WireDetail({ wire }: { wire: Wire }) {
  const project = useProject((state) => state.project);
  const updateWire = useProject((state) => state.updateWire);
  const setSection = useProject((state) => state.setSection);
  const removeWire = useProject((state) => state.removeWire);
  const clearPath = useProject((state) => state.clearPath);
  const drawing = useSession((state) => state.drawing);
  const setDrawing = useSession((state) => state.setDrawing);
  const select = useSession((state) => state.select);
  const result = useComputation().wires.get(wire.id);
  const toron = project.torons.find((item) => item.id === wire.toronId);

  return (
    <div className="detail">
      <Field label="Nom">
        <input value={wire.name} onChange={(event) => updateWire(wire.id, { name: event.target.value })} />
      </Field>

      <div className="pair">
        <Field label="Section">
          <select value={wire.sectionMm2} onChange={(event) => setSection(wire.id, Number(event.target.value))}>
            {WIRE_GRADES.map((grade) => (
              <option key={grade.sectionMm2} value={grade.sectionMm2}>{grade.sectionMm2} mm²</option>
            ))}
          </select>
        </Field>
        <Field label="Couleur">
          <select value={wire.color} onChange={(event) => updateWire(wire.id, { color: event.target.value })}>
            {WIRE_COLORS.map((color) => <option key={color.hex} value={color.hex}>{color.label}</option>)}
            {!WIRE_COLORS.some((color) => color.hex === wire.color) && <option value={wire.color}>Autre</option>}
          </select>
        </Field>
      </div>

      <div className="pair">
        <Field label="De"><input value={wire.from} placeholder="connecteur, borne…" onChange={(event) => updateWire(wire.id, { from: event.target.value })} /></Field>
        <Field label="Vers"><input value={wire.to} placeholder="connecteur, borne…" onChange={(event) => updateWire(wire.id, { to: event.target.value })} /></Field>
      </div>

      {toron ? (
        <p className="note">
          Ce fil suit le chemin du <button className="link" onClick={() => select({ kind: 'toron', id: toron.id })}>{toron.name}</button>.
        </p>
      ) : (
        <div className="actions">
          <button
            className={drawing?.id === wire.id ? 'primary' : 'action'}
            onClick={() => setDrawing(drawing?.id === wire.id ? null : { kind: 'fil', id: wire.id })}
          >
            {drawing?.id === wire.id ? 'Terminer le tracé' : wire.points.length > 0 ? 'Continuer le tracé' : 'Tracer le chemin'}
          </button>
          {wire.points.length > 0 && (
            <button className="action" onClick={() => clearPath({ kind: 'fil', id: wire.id })}>Effacer</button>
          )}
        </div>
      )}

      <dl className="results">
        <div><dt>Longueur</dt><dd>{result?.ready ? metres(result.length) : '—'}</dd></div>
        <div><dt>Poids</dt><dd>{result?.ready ? `${Math.round(result.massGram)} g` : '—'}</dd></div>
        <div><dt>Résistance</dt><dd>{result?.ready ? `${nombre(result.resistanceMilliOhm)} mΩ` : '—'}</dd></div>
      </dl>

      <details className="more">
        <summary>Ajuster</summary>
        <div className="pair">
          <Field label="Masse (g/m)">
            <input type="number" min={0} step={0.1} value={wire.massPerMeter}
              onChange={(event) => updateWire(wire.id, { massPerMeter: Number(event.target.value) })} />
          </Field>
          <Field label="Ø ext. (mm)">
            <input type="number" min={0.1} step={0.1} value={wire.outerDiameter}
              onChange={(event) => updateWire(wire.id, { outerDiameter: Number(event.target.value) })} />
          </Field>
        </div>
        <div className="pair">
          <Field label="Mou (%)">
            <input type="number" min={0} max={50} step={0.5} value={Number((wire.slack * 100).toFixed(1))}
              onChange={(event) => updateWire(wire.id, { slack: Number(event.target.value) / 100 })} />
          </Field>
          <Field label="Rab (mm)">
            <input type="number" min={0} step={10} value={wire.tails}
              onChange={(event) => updateWire(wire.id, { tails: Number(event.target.value) })} />
          </Field>
        </div>
        <Field label="Rayon de coude (mm)">
          <input type="number" min={1} step={5} value={wire.bendRadius}
            onChange={(event) => updateWire(wire.id, { bendRadius: Number(event.target.value) })} />
        </Field>
        <Field label="Note">
          <input value={wire.note ?? ''} onChange={(event) => updateWire(wire.id, { note: event.target.value })} />
        </Field>
      </details>

      <button className="danger" onClick={() => { removeWire(wire.id); select(null); }}>Supprimer ce fil</button>
    </div>
  );
}

function ToronDetail({ toron }: { toron: Toron }) {
  const project = useProject((state) => state.project);
  const updateToron = useProject((state) => state.updateToron);
  const setSleeve = useProject((state) => state.setSleeve);
  const ungroup = useProject((state) => state.ungroupToron);
  const clearPath = useProject((state) => state.clearPath);
  const drawing = useSession((state) => state.drawing);
  const setDrawing = useSession((state) => state.setDrawing);
  const select = useSession((state) => state.select);
  const result = useComputation().torons.get(toron.id);

  return (
    <div className="detail">
      <Field label="Nom">
        <input value={toron.name} onChange={(event) => updateToron(toron.id, { name: event.target.value })} />
      </Field>
      <Field label="Gaine">
        <select value={toron.sleeve} onChange={(event) => setSleeve(toron.id, event.target.value as SleeveKind)}>
          {(Object.keys(SLEEVE_LABEL) as SleeveKind[]).map((kind) => (
            <option key={kind} value={kind}>{SLEEVE_LABEL[kind]}</option>
          ))}
        </select>
      </Field>

      <div className="actions">
        <button
          className={drawing?.id === toron.id ? 'primary' : 'action'}
          onClick={() => setDrawing(drawing?.id === toron.id ? null : { kind: 'toron', id: toron.id })}
        >
          {drawing?.id === toron.id ? 'Terminer le tracé' : toron.points.length > 0 ? 'Continuer le tracé' : 'Tracer le chemin'}
        </button>
        {toron.points.length > 0 && (
          <button className="action" onClick={() => clearPath({ kind: 'toron', id: toron.id })}>Effacer</button>
        )}
      </div>

      <dl className="results">
        <div><dt>Longueur</dt><dd>{result?.path ? metres(result.length) : '—'}</dd></div>
        <div><dt>Diamètre</dt><dd>{result ? `${nombre(result.diameter)} mm` : '—'}</dd></div>
        <div><dt>Fils</dt><dd>{toron.wireIds.length}</dd></div>
      </dl>

      <ul className="members">
        {toron.wireIds.map((id) => {
          const wire = project.wires.find((item) => item.id === id);
          if (!wire) return null;
          return (
            <li key={id}>
              <button className="link" onClick={() => select({ kind: 'fil', id })}>
                <i className="chip" style={{ background: wire.color }} />
                {wire.name} · {wire.sectionMm2} mm²
              </button>
            </li>
          );
        })}
      </ul>

      <button className="danger" onClick={() => { ungroup(toron.id); select(null); }}>Séparer les fils</button>
    </div>
  );
}

export function Panel() {
  const project = useProject((state) => state.project);
  const addWire = useProject((state) => state.addWire);
  const groupToron = useProject((state) => state.groupToron);
  const computation = useComputation();
  const selected = useSession((state) => state.selected);
  const select = useSession((state) => state.select);
  const checked = useSession((state) => state.checked);
  const toggleChecked = useSession((state) => state.toggleChecked);
  const clearChecked = useSession((state) => state.clearChecked);
  const setStatus = useSession((state) => state.setStatus);

  const selectedWire = selected?.kind === 'fil' ? project.wires.find((wire) => wire.id === selected.id) : undefined;
  const selectedToron = selected?.kind === 'toron' ? project.torons.find((toron) => toron.id === selected.id) : undefined;

  return (
    <aside className="panel">
      <header>
        <h2>Fils</h2>
        <button className="primary" onClick={() => select({ kind: 'fil', id: addWire() })}>+ Nouveau fil</button>
      </header>

      <ul className="wires">
        {project.wires.map((wire) => {
          const result = computation.wires.get(wire.id);
          const toron = project.torons.find((item) => item.id === wire.toronId);
          return (
            <li key={wire.id} className={selected?.kind === 'fil' && selected.id === wire.id ? 'is-selected' : ''}>
              <input
                type="checkbox"
                checked={checked.includes(wire.id)}
                onChange={() => toggleChecked(wire.id)}
                aria-label={`Choisir ${wire.name} pour un toron`}
              />
              <button onClick={() => select({ kind: 'fil', id: wire.id })}>
                <i className="chip" style={{ background: wire.color }} />
                <span className="name">{wire.name}</span>
                <span className="meta">{wire.sectionMm2} mm²</span>
                <span className="meta right">
                  {result?.ready ? metres(result.length) : 'à tracer'}
                  {toron ? ` · ${toron.name}` : ''}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {project.wires.length === 0 && (
        <p className="note">Commencez par créer un fil, donnez-lui son nom et sa section, puis tracez son chemin sur la pièce.</p>
      )}

      {checked.length >= 2 && (
        <button
          className="primary wide"
          onClick={() => {
            const id = groupToron(checked);
            clearChecked();
            if (id) {
              select({ kind: 'toron', id });
              setStatus({ message: 'Toron créé : les fils suivent désormais un chemin commun.', tone: 'succes' });
            }
          }}
        >
          Réunir {checked.length} fils en toron
        </button>
      )}

      {project.torons.length > 0 && (
        <>
          <h2 className="section">Torons</h2>
          <ul className="wires">
            {project.torons.map((toron) => {
              const result = computation.torons.get(toron.id);
              return (
                <li key={toron.id} className={selected?.kind === 'toron' && selected.id === toron.id ? 'is-selected' : ''}>
                  <span className="spacer-check" />
                  <button onClick={() => select({ kind: 'toron', id: toron.id })}>
                    <i className="chip" style={{ background: '#9aa2ae' }} />
                    <span className="name">{toron.name}</span>
                    <span className="meta">{toron.wireIds.length} fils</span>
                    <span className="meta right">{result?.path ? metres(result.length) : 'à tracer'}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {selectedWire && <WireDetail wire={selectedWire} />}
      {selectedToron && <ToronDetail toron={selectedToron} />}
    </aside>
  );
}
