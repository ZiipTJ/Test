/** Panneau « Fils » : le tableau de câblage et l'édition des deux tenants.
 *  C'est ici que se saisit ce qui part à l'atelier : repère, section, couleur,
 *  et pour chaque extrémité le connecteur, la cavité, le contact et le joint. */
import { useMemo, useState } from 'react';
import { suggestTerminal, WIRE_CATALOG, WIRE_COLORS } from '../../core/harness/library';
import type { TenantSide } from '../../core/harness/types';
import { deriveAll } from '../../state/derived';
import { useProject } from '../../state/project';
import { isSelected, useSession } from '../../state/session';

function TenantEditor({ wireId, side }: { wireId: string; side: TenantSide }) {
  const project = useProject((state) => state.project);
  const updateTenant = useProject((state) => state.updateTenant);
  const wire = project.wires[wireId];
  if (!wire) return null;

  const tenant = side === 'G' ? wire.tenantG : wire.tenantD;
  const node = tenant.nodeId ? project.nodes[tenant.nodeId] : undefined;
  const connector = node?.connectorId ? project.connectors[node.connectorId] : undefined;

  return (
    <div className="card compact">
      <h3>Tenant {side}</h3>
      <div className="field">
        <label>Nœud</label>
        <select
          value={tenant.nodeId ?? ''}
          onChange={(event) => updateTenant(wireId, side, { nodeId: event.target.value || null })}
        >
          <option value="">— non affecté —</option>
          {Object.values(project.nodes)
            .filter((candidate) => candidate.kind === 'connecteur' || candidate.kind === 'epissure')
            .map((candidate) => (
              <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
            ))}
          <optgroup label="Autres nœuds">
            {Object.values(project.nodes)
              .filter((candidate) => candidate.kind !== 'connecteur' && candidate.kind !== 'epissure')
              .map((candidate) => (
                <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
              ))}
          </optgroup>
        </select>
      </div>
      <div className="field">
        <label>Cavité</label>
        {connector ? (
          <select value={tenant.cavity} onChange={(event) => updateTenant(wireId, side, { cavity: event.target.value })}>
            <option value="">—</option>
            {connector.cavities.map((cavity) => (
              <option key={cavity.code} value={cavity.code}>{cavity.code}{cavity.label ? ` — ${cavity.label}` : ''}</option>
            ))}
          </select>
        ) : (
          <input value={tenant.cavity} onChange={(event) => updateTenant(wireId, side, { cavity: event.target.value })} />
        )}
      </div>
      <div className="field">
        <label>Contact</label>
        <input
          value={tenant.terminalRef ?? ''}
          placeholder={suggestTerminal(wire.sectionMm2)}
          onChange={(event) => updateTenant(wireId, side, { terminalRef: event.target.value })}
        />
      </div>
      <div className="field">
        <label>Joint</label>
        <input value={tenant.sealRef ?? ''} onChange={(event) => updateTenant(wireId, side, { sealRef: event.target.value })} />
      </div>
      <div className="field">
        <label>Dénudage (mm)</label>
        <input
          type="number" min={0} step={0.5} value={tenant.stripLength}
          onChange={(event) => updateTenant(wireId, side, { stripLength: Number(event.target.value) })}
        />
      </div>
      <div className="field">
        <label>Longueur libre</label>
        <input
          type="number" min={0} step={5} value={tenant.tailLength}
          onChange={(event) => updateTenant(wireId, side, { tailLength: Number(event.target.value) })}
          title="Longueur au-delà du dernier nœud du cheminement"
        />
      </div>
      <div className="field">
        <label>Marquage</label>
        <input value={tenant.marking ?? ''} onChange={(event) => updateTenant(wireId, side, { marking: event.target.value })} />
      </div>
    </div>
  );
}

function WireDetails({ wireId }: { wireId: string }) {
  const project = useProject((state) => state.project);
  const updateWire = useProject((state) => state.updateWire);
  const setWireSection = useProject((state) => state.setWireSection);
  const removeWire = useProject((state) => state.removeWire);
  const addWire = useProject((state) => state.addWire);
  const derived = deriveAll(project);
  const wire = project.wires[wireId];
  if (!wire) return null;

  const route = derived.computation.routes.get(wireId);
  const spec = project.specs[wire.specId];

  return (
    <div className="card">
      <h3>
        <span className="swatch" style={{ background: wire.color }} /> {wire.name}
      </h3>

      <div className="field">
        <label>Repère</label>
        <input value={wire.name} onChange={(event) => updateWire(wireId, { name: event.target.value })} />
      </div>
      <div className="field">
        <label>Section (mm²)</label>
        <select value={wire.sectionMm2} onChange={(event) => setWireSection(wireId, Number(event.target.value))}>
          {WIRE_CATALOG.map((entry) => (
            <option key={entry.id} value={entry.sectionMm2}>
              {entry.sectionMm2} mm² — Ø{entry.outerDiameter} — AWG {entry.awg} — {entry.currentRating} A
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Couleur</label>
        <select value={wire.color} onChange={(event) => updateWire(wireId, { color: event.target.value })}>
          {WIRE_COLORS.map((color) => (
            <option key={color.code} value={color.hex}>{color.code} — {color.label}</option>
          ))}
          {!WIRE_COLORS.some((color) => color.hex === wire.color) && <option value={wire.color}>Personnalisée</option>}
        </select>
      </div>
      <div className="field">
        <label>Réseau</label>
        <input value={wire.network ?? ''} onChange={(event) => updateWire(wireId, { network: event.target.value })} />
      </div>
      <div className="field">
        <label>Courant (A)</label>
        <input
          type="number" min={0} step={0.5} value={wire.currentA ?? ''}
          placeholder={spec ? `max ${spec.currentRating}` : ''}
          onChange={(event) => updateWire(wireId, { currentA: event.target.value === '' ? undefined : Number(event.target.value) })}
        />
      </div>
      <div className="field">
        <label>Cheminement</label>
        <select
          value={wire.pathMode}
          onChange={(event) => {
            const mode = event.target.value as 'auto' | 'manuel';
            updateWire(wireId, { pathMode: mode, path: mode === 'manuel' ? route?.nodes ?? [] : [] });
          }}
        >
          <option value="auto">Automatique (plus court chemin)</option>
          <option value="manuel">Imposé</option>
        </select>
      </div>

      {route && (
        <div className="legend">
          <span>{route.nodes.map((id) => project.nodes[id]?.name ?? id).join(' → ') || '—'}</span>
        </div>
      )}
      {route && route.status === 'ok' && (
        <div className="legend">
          <span>Longueur de coupe <strong>{route.totalLength.toFixed(0)} mm</strong></span>
          <span>cheminée {route.routedLength.toFixed(0)}</span>
          <span>tenants {route.tailLength.toFixed(0)}</span>
          {Math.abs(route.positionCorrection) > 0.05 && <span>position {route.positionCorrection >= 0 ? '+' : ''}{route.positionCorrection.toFixed(1)}</span>}
          <span>{route.massGram.toFixed(0)} g</span>
          <span>{route.resistanceMilliOhm.toFixed(1)} mΩ</span>
        </div>
      )}
      {route && route.status !== 'ok' && (
        <p className="hint" style={{ color: 'var(--bad)' }}>{route.message}</p>
      )}

      <div className="row">
        <TenantEditor wireId={wireId} side="G" />
        <TenantEditor wireId={wireId} side="D" />
      </div>

      <div className="row">
        <button
          className="ghost"
          onClick={() =>
            addWire({
              name: `${wire.name}-bis`,
              sectionMm2: wire.sectionMm2,
              color: wire.color,
              network: wire.network,
              tenantG: { ...wire.tenantG, cavity: '' },
              tenantD: { ...wire.tenantD, cavity: '' },
            })
          }
        >
          Dupliquer
        </button>
        <button className="ghost" onClick={() => removeWire(wireId)}>Supprimer</button>
      </div>
    </div>
  );
}

export function WirePanel() {
  const project = useProject((state) => state.project);
  const addWire = useProject((state) => state.addWire);
  const selection = useSession((state) => state.selection);
  const select = useSession((state) => state.select);
  const setView = useSession((state) => state.setView);
  const view = useSession((state) => state.view);
  const derived = deriveAll(project);
  const [filter, setFilter] = useState('');

  const wires = useMemo(() => {
    const list = Object.values(project.wires);
    const needle = filter.trim().toLowerCase();
    if (!needle) return list;
    return list.filter((wire) =>
      [wire.name, wire.network ?? '', String(wire.sectionMm2)].join(' ').toLowerCase().includes(needle),
    );
  }, [project.wires, filter]);

  return (
    <div className="panel">
      <h2>Fils ({Object.keys(project.wires).length})</h2>
      <div className="row">
        <button className="primary" onClick={() => select({ kind: 'wire', id: addWire() })}>Ajouter un fil</button>
        <input placeholder="Filtrer…" value={filter} onChange={(event) => setFilter(event.target.value)} style={{ flex: 1, minWidth: 120 }} />
        <button
          className={`tool${view.bundleDisplay === 'fils' ? ' is-active' : ''}`}
          onClick={() => setView({ bundleDisplay: view.bundleDisplay === 'fils' ? 'toron' : 'fils' })}
          title="Voir chaque fil à sa place dans le toron"
        >
          Voir les fils
        </button>
      </div>

      <table>
        <thead>
          <tr>
            <th>Repère</th>
            <th className="num">mm²</th>
            <th>Tenant G</th>
            <th>Tenant D</th>
            <th className="num">Long.</th>
          </tr>
        </thead>
        <tbody>
          {wires.map((wire) => {
            const route = derived.computation.routes.get(wire.id);
            const g = wire.tenantG.nodeId ? project.nodes[wire.tenantG.nodeId]?.name : null;
            const d = wire.tenantD.nodeId ? project.nodes[wire.tenantD.nodeId]?.name : null;
            return (
              <tr
                key={wire.id}
                className={isSelected(selection, 'wire', wire.id) ? 'is-selected' : ''}
                onClick={() => select({ kind: 'wire', id: wire.id })}
                style={{ cursor: 'pointer' }}
              >
                <td><span className="swatch" style={{ background: wire.color }} /> {wire.name}</td>
                <td className="num">{wire.sectionMm2}</td>
                <td>{g ?? '—'}{wire.tenantG.cavity ? ` / ${wire.tenantG.cavity}` : ''}</td>
                <td>{d ?? '—'}{wire.tenantD.cavity ? ` / ${wire.tenantD.cavity}` : ''}</td>
                <td className="num" style={{ color: route?.status === 'ok' ? undefined : 'var(--bad)' }}>
                  {route?.status === 'ok' ? Math.round(route.totalLength) : '!'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {wires.length === 0 && <p className="hint">Aucun fil ne correspond.</p>}

      <h2>Détail</h2>
      {selection.filter((item) => item.kind === 'wire').length === 0 && (
        <p className="hint">Sélectionnez un fil pour éditer ses tenants.</p>
      )}
      {selection
        .filter((item) => item.kind === 'wire')
        .map((item) => <WireDetails key={item.id} wireId={item.id} />)}
    </div>
  );
}
