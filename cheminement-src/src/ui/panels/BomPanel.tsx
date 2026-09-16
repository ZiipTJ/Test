/** Panneau « Nomenclature » : liste de coupe et achats, exportables en CSV. */
import { useState } from 'react';
import { downloadBom, downloadCutList } from '../../io/project';
import { deriveAll } from '../../state/derived';
import { useProject } from '../../state/project';
import { useSession } from '../../state/session';

export function BomPanel() {
  const project = useProject((state) => state.project);
  const select = useSession((state) => state.select);
  const derived = deriveAll(project);
  const [tab, setTab] = useState<'coupe' | 'nomenclature'>('coupe');

  const totals = derived.computation.totals;

  return (
    <div className="panel">
      <h2>Synthèse</h2>
      <div className="legend">
        <span>{totals.wireCount} fils ({totals.routedWireCount} cheminés)</span>
        <span>{(totals.wireLength / 1000).toFixed(2)} m de fil</span>
        <span>{(totals.copperMass / 1000).toFixed(2)} kg</span>
        <span>{(totals.routeLength / 1000).toFixed(2)} m de cheminement</span>
        <span>{(totals.sleevedLength / 1000).toFixed(2)} m gainés</span>
      </div>

      <div className="row">
        <button className={`tool${tab === 'coupe' ? ' is-active' : ''}`} onClick={() => setTab('coupe')}>Liste de coupe</button>
        <button className={`tool${tab === 'nomenclature' ? ' is-active' : ''}`} onClick={() => setTab('nomenclature')}>Nomenclature</button>
        <div className="spacer" />
        <button
          className="primary"
          onClick={() => (tab === 'coupe' ? downloadCutList(project, derived.cutList) : downloadBom(project, derived.bom))}
        >
          Exporter CSV
        </button>
      </div>

      {tab === 'coupe' ? (
        <table>
          <thead>
            <tr>
              <th>Repère</th>
              <th className="num">mm²</th>
              <th className="num">Long.</th>
              <th>Tenant G</th>
              <th>Tenant D</th>
            </tr>
          </thead>
          <tbody>
            {derived.cutList.map((row) => (
              <tr key={row.wireId} onClick={() => select({ kind: 'wire', id: row.wireId })} style={{ cursor: 'pointer' }}>
                <td><span className="swatch" style={{ background: row.couleur }} /> {row.repere}</td>
                <td className="num">{row.section}</td>
                <td className="num">{row.statut === 'ok' ? Math.round(row.longueur) : '—'}</td>
                <td>{row.tenantG.connecteur} / {row.tenantG.cavite}<br /><span className="meta">{row.tenantG.contact}</span></td>
                <td>{row.tenantD.connecteur} / {row.tenantD.cavite}<br /><span className="meta">{row.tenantD.contact}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Famille</th>
              <th>Référence</th>
              <th className="num">Qté</th>
              <th>Unité</th>
            </tr>
          </thead>
          <tbody>
            {derived.bom.map((line, index) => (
              <tr key={`${line.famille}-${line.reference}-${index}`}>
                <td>{line.famille}</td>
                <td>{line.reference}<br /><span className="meta">{line.designation}</span></td>
                <td className="num">{line.unite === 'u' ? line.quantite : line.quantite.toFixed(2)}</td>
                <td>{line.unite}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {derived.cutList.length === 0 && <p className="hint">Aucun fil dans le faisceau.</p>}
    </div>
  );
}
