/** Panneau « Cheminement » : nœuds, segments, et propriétés de la sélection. */
import { CONNECTOR_CATALOG } from '../../core/harness/library';
import type { NodeKind } from '../../core/harness/types';
import { deriveAll } from '../../state/derived';
import { useProject } from '../../state/project';
import { isSelected, useSession } from '../../state/session';
import { SectionView } from '../SectionView';

const KIND_LABEL: Record<NodeKind, string> = {
  connecteur: 'Connecteur',
  derivation: 'Dérivation',
  collier: 'Collier',
  epissure: 'Épissure',
  passage: 'Passage',
};

function NodeProperties({ nodeId }: { nodeId: string }) {
  const project = useProject((state) => state.project);
  const updateNode = useProject((state) => state.updateNode);
  const removeNode = useProject((state) => state.removeNode);
  const mountConnector = useProject((state) => state.mountConnector);
  const addConnector = useProject((state) => state.addConnector);
  const node = project.nodes[nodeId];
  if (!node) return null;

  return (
    <div className="card">
      <h3>{node.name}</h3>
      <div className="field">
        <label>Nom</label>
        <input value={node.name} onChange={(e) => updateNode(nodeId, { name: e.target.value })} />
      </div>
      <div className="field">
        <label>Type</label>
        <select value={node.kind} onChange={(e) => updateNode(nodeId, { kind: e.target.value as NodeKind })}>
          {Object.entries(KIND_LABEL).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>
      {(['X', 'Y', 'Z'] as const).map((axis, index) => (
        <div className="field" key={axis}>
          <label>{axis} (mm)</label>
          <input
            type="number" step={0.5} value={Number(node.position[index]!.toFixed(3))}
            onChange={(e) => {
              const position = [...node.position] as [number, number, number];
              position[index] = Number(e.target.value);
              updateNode(nodeId, { position });
            }}
          />
        </div>
      ))}
      <div className="field">
        <label>Brin de sortie</label>
        <input
          type="number" min={0} step={5} value={node.exitLength}
          onChange={(e) => updateNode(nodeId, { exitLength: Number(e.target.value) })}
          title="Longueur droite imposée en sortie, avant tout coude"
        />
      </div>
      <div className="row">
        {(['+X', '-X', '+Y', '-Y', '+Z', '-Z'] as const).map((axis) => {
          const map: Record<string, [number, number, number]> = {
            '+X': [1, 0, 0], '-X': [-1, 0, 0], '+Y': [0, 1, 0], '-Y': [0, -1, 0], '+Z': [0, 0, 1], '-Z': [0, 0, -1],
          };
          const current = node.exitDirection;
          const target = map[axis]!;
          const active = current && current.every((value, i) => Math.abs(value - target[i]!) < 1e-6);
          return (
            <button
              key={axis}
              className={`tool${active ? ' is-active' : ''}`}
              onClick={() => updateNode(nodeId, { exitDirection: active ? undefined : target })}
              title="Direction de sortie imposée"
            >
              {axis}
            </button>
          );
        })}
      </div>

      {node.kind === 'connecteur' && (
        <div className="field">
          <label>Connecteur</label>
          <select
            value={node.connectorId ?? ''}
            onChange={(e) => {
              const value = e.target.value;
              if (value.startsWith('catalogue:')) {
                const entry = CONNECTOR_CATALOG[Number(value.split(':')[1])];
                if (entry) mountConnector(nodeId, addConnector(entry, `${entry.name} — ${node.name}`));
              } else {
                mountConnector(nodeId, value || undefined);
              }
            }}
          >
            <option value="">— aucun —</option>
            {Object.values(project.connectors).map((connector) => (
              <option key={connector.id} value={connector.id}>{connector.name} ({connector.ref})</option>
            ))}
            <optgroup label="Ajouter au catalogue">
              {CONNECTOR_CATALOG.map((entry, index) => (
                <option key={entry.ref} value={`catalogue:${index}`}>{entry.name} — {entry.ref}</option>
              ))}
            </optgroup>
          </select>
        </div>
      )}

      {node.kind === 'collier' && (
        <>
          <div className="field">
            <label>Référence collier</label>
            <input
              value={node.clamp?.ref ?? ''}
              onChange={(e) => updateNode(nodeId, { clamp: { ref: e.target.value, innerDiameter: node.clamp?.innerDiameter ?? 20 } })}
            />
          </div>
          <div className="field">
            <label>Ø intérieur</label>
            <input
              type="number" min={2} step={1} value={node.clamp?.innerDiameter ?? 20}
              onChange={(e) => updateNode(nodeId, { clamp: { ref: node.clamp?.ref ?? 'Collier', innerDiameter: Number(e.target.value) } })}
            />
          </div>
        </>
      )}

      {node.snap && (
        <p className="hint">
          Accroché sur « {node.snap.kind} »{node.snap.radius ? ` Ø${(node.snap.radius * 2).toFixed(1)} mm` : ''}.
        </p>
      )}

      <div className="row">
        <button className="ghost" onClick={() => removeNode(nodeId)}>Supprimer le nœud</button>
      </div>
    </div>
  );
}

function SegmentProperties({ segmentId }: { segmentId: string }) {
  const project = useProject((state) => state.project);
  const updateSegment = useProject((state) => state.updateSegment);
  const removeSegment = useProject((state) => state.removeSegment);
  const removeVia = useProject((state) => state.removeVia);
  const derived = deriveAll(project);
  const segment = project.segments[segmentId];
  const geometry = derived.computation.geometry.get(segmentId);
  const load = derived.computation.loads.get(segmentId);
  if (!segment || !geometry || !load) return null;

  return (
    <div className="card">
      <h3>{segment.name}</h3>
      <div className="legend">
        <span>{project.nodes[segment.a]?.name} → {project.nodes[segment.b]?.name}</span>
      </div>
      <div className="field">
        <label>Nom</label>
        <input value={segment.name} onChange={(e) => updateSegment(segmentId, { name: e.target.value })} />
      </div>
      <div className="field">
        <label>Rayon de coude</label>
        <input
          type="number" min={0} step={5} value={segment.bendRadius}
          onChange={(e) => updateSegment(segmentId, { bendRadius: Number(e.target.value) })}
        />
      </div>
      <div className="field">
        <label>Mou (%)</label>
        <input
          type="number" min={0} max={50} step={0.5} value={Number((segment.slack * 100).toFixed(1))}
          onChange={(e) => updateSegment(segmentId, { slack: Number(e.target.value) / 100 })}
        />
      </div>
      <div className="field">
        <label>Longueur imposée</label>
        <input
          type="number" min={0} step={1} value={segment.overrideLength ?? 0}
          onChange={(e) => updateSegment(segmentId, { overrideLength: Number(e.target.value) || undefined })}
          title="0 = longueur géométrique"
        />
      </div>
      <div className="legend">
        <span>Géométrie {geometry.geometricLength.toFixed(1)} mm</span>
        <span>Retenue {geometry.length.toFixed(1)} mm</span>
        <span>Rayon mini {Number.isFinite(geometry.path.minRadius) ? `${geometry.path.minRadius.toFixed(1)} mm` : '—'}</span>
        <span>{geometry.path.corners.length} coude(s)</span>
      </div>

      {segment.vias.length > 0 && (
        <>
          <h3 style={{ marginTop: 10 }}>Points de passage</h3>
          <div className="list">
            {segment.vias.map((via, index) => (
              <button key={index} className="item" onClick={() => removeVia(segmentId, index)}>
                <span>{via.map((value) => value.toFixed(0)).join(' · ')}</span>
                <span className="meta">retirer</span>
              </button>
            ))}
          </div>
        </>
      )}

      <h3 style={{ marginTop: 10 }}>Coupe du toron</h3>
      <SectionView segmentId={segmentId} size={230} />

      <div className="row">
        <button className="ghost" onClick={() => removeSegment(segmentId)}>Supprimer le segment</button>
      </div>
    </div>
  );
}

export function RoutePanel() {
  const project = useProject((state) => state.project);
  const addNode = useProject((state) => state.addNode);
  const selection = useSession((state) => state.selection);
  const select = useSession((state) => state.select);
  const inspect = useSession((state) => state.inspectSegment);
  const derived = deriveAll(project);

  const nodes = Object.values(project.nodes);
  const segments = Object.values(project.segments);

  return (
    <div className="panel">
      <h2>Nœuds ({nodes.length})</h2>
      <p className="hint">
        Outil <strong>Nœud</strong> ou <strong>Cheminement</strong> puis clic sur le modèle. Un clic au centre d’un
        perçage pose directement un collier.
      </p>
      <div className="list">
        {nodes.map((node) => (
          <button
            key={node.id}
            className={`item${isSelected(selection, 'node', node.id) ? ' is-active' : ''}`}
            onClick={() => select({ kind: 'node', id: node.id })}
          >
            <span>{node.name}</span>
            <span className="meta">{KIND_LABEL[node.kind]}</span>
          </button>
        ))}
        {nodes.length === 0 && <p className="hint">Aucun nœud.</p>}
      </div>
      <div className="row">
        <button className="ghost" onClick={() => addNode({ position: [0, 0, 0] })}>Ajouter un nœud à l’origine</button>
      </div>

      <h2>Segments ({segments.length})</h2>
      <div className="list">
        {segments.map((segment) => {
          const load = derived.computation.loads.get(segment.id);
          return (
            <button
              key={segment.id}
              className={`item${isSelected(selection, 'segment', segment.id) ? ' is-active' : ''}`}
              onClick={() => { select({ kind: 'segment', id: segment.id }); inspect(segment.id); }}
            >
              <span>{segment.name}</span>
              <span className="meta">
                {Math.round(derived.computation.geometry.get(segment.id)?.length ?? 0)} mm · {load?.wireIds.length ?? 0} fils · Ø{(load?.bundleDiameter ?? 0).toFixed(1)}
              </span>
            </button>
          );
        })}
        {segments.length === 0 && <p className="hint">Aucun segment.</p>}
      </div>

      <h2>Propriétés</h2>
      {selection.length === 0 && <p className="hint">Sélectionnez un nœud ou un segment.</p>}
      {selection.map((item) =>
        item.kind === 'node' ? (
          <NodeProperties key={item.id} nodeId={item.id} />
        ) : item.kind === 'segment' ? (
          <SegmentProperties key={item.id} segmentId={item.id} />
        ) : null,
      )}
    </div>
  );
}
