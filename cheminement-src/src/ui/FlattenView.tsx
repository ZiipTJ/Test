/** Mise à plat : la planche de fabrication.
 *
 *  Le graphe est déplié en conservant la longueur réelle des segments, les
 *  connecteurs reçoivent leur table de câblage (cavité, repère, section, couleur)
 *  et chaque tronçon porte sa longueur, son nombre de fils et sa gaine. Le SVG
 *  produit sert à la fois à l'affichage et à l'export. */
import { useMemo } from 'react';
import { SLEEVE_KIND_LABEL } from '../core/harness/library';
import type { HarnessProject } from '../core/harness/types';
import { downloadSvg } from '../io/project';
import { deriveAll, type DerivedResult } from '../state/derived';
import { useProject } from '../state/project';
import { useSession } from '../state/session';

const escape = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function buildFlattenSvg(project: HarnessProject, derived: DerivedResult): string {
  const { flatten, computation } = derived;
  const positions = new Map(flatten.nodes.map((node) => [node.id, node]));
  const margin = 140;
  // Les tables de câblage sont posées à droite des connecteurs : la planche doit
  // les contenir, sinon elles sortent du cadre à l'export.
  const tableWidth = 210;
  const tallestTable = Math.max(
    0,
    ...flatten.nodes.map((node) => {
      if (project.nodes[node.id]?.kind !== 'connecteur') return 0;
      const count = Object.values(project.wires).filter(
        (wire) => wire.tenantG.nodeId === node.id || wire.tenantD.nodeId === node.id,
      ).length;
      return 30 + count * 13;
    }),
  );
  const width = Math.max(600, flatten.bbox.maxX - flatten.bbox.minX + margin * 2 + tableWidth * 2);
  const height = Math.max(400, flatten.bbox.maxY - flatten.bbox.minY + margin * 2 + tallestTable);
  const offsetX = margin + tableWidth - flatten.bbox.minX;
  const offsetY = margin - flatten.bbox.minY;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width.toFixed(0)} ${height.toFixed(0)}" width="${width.toFixed(0)}" height="${height.toFixed(0)}" font-family="system-ui, sans-serif">`,
  );
  parts.push(`<rect width="100%" height="100%" fill="#ffffff"/>`);
  parts.push(
    `<text x="24" y="38" font-size="20" font-weight="600" fill="#14171c">${escape(project.name)}</text>` +
      `<text x="24" y="58" font-size="12" fill="#5a6270">Mise à plat — longueurs développées en millimètres · ` +
      `${Object.keys(project.wires).length} fils · ${(computation.totals.wireLength / 1000).toFixed(2)} m de fil</text>`,
  );

  /* Tronçons */
  for (const edge of flatten.edges) {
    const a = positions.get(edge.a);
    const b = positions.get(edge.b);
    if (!a || !b) continue;
    const x1 = a.x + offsetX, y1 = a.y + offsetY, x2 = b.x + offsetX, y2 = b.y + offsetY;
    const thickness = Math.max(3, Math.min(26, edge.bundleDiameter));
    const color = edge.sleeve ? edge.sleeve.color : '#3d434d';
    parts.push(
      `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" ` +
        `stroke="${edge.inTree ? color : '#b9bec7'}" stroke-width="${thickness.toFixed(1)}" stroke-linecap="round"` +
        `${edge.inTree ? '' : ' stroke-dasharray="8 6"'}/>`,
    );
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    const label = `${Math.round(edge.length)} mm · ${edge.wireCount} fils · Ø${edge.bundleDiameter.toFixed(1)}`;
    const sleeveLabel = edge.sleeve ? `${SLEEVE_KIND_LABEL[edge.sleeve.kind as keyof typeof SLEEVE_KIND_LABEL]} — ${edge.sleeve.name}` : '';
    parts.push(
      `<g transform="translate(${mx.toFixed(1)},${my.toFixed(1)})">` +
        `<rect x="-62" y="-20" width="124" height="${sleeveLabel ? 32 : 20}" rx="4" fill="#ffffff" fill-opacity="0.9" stroke="#d8dce3"/>` +
        `<text x="0" y="-6" font-size="11" text-anchor="middle" fill="#14171c">${escape(label)}</text>` +
        (sleeveLabel ? `<text x="0" y="7" font-size="9.5" text-anchor="middle" fill="#5a6270">${escape(sleeveLabel)}</text>` : '') +
        `</g>`,
    );
  }

  /* Nœuds et tables de câblage des connecteurs */
  for (const node of flatten.nodes) {
    const x = node.x + offsetX;
    const y = node.y + offsetY;
    const source = project.nodes[node.id];
    if (!source) continue;

    if (source.kind === 'connecteur') {
      const wires = Object.values(project.wires)
        .flatMap((wire) => {
          if (wire.tenantG.nodeId === node.id) return [{ wire, tenant: wire.tenantG, side: 'G' }];
          if (wire.tenantD.nodeId === node.id) return [{ wire, tenant: wire.tenantD, side: 'D' }];
          return [];
        })
        .sort((left, right) => left.tenant.cavity.localeCompare(right.tenant.cavity, 'fr', { numeric: true }));

      const rows = wires.length;
      const boxWidth = 176;
      const boxHeight = 30 + rows * 13;
      // La table est posée du côté opposé au reste de la planche, pour ne pas
      // recouvrir les tronçons.
      const centroidX = flatten.nodes.reduce((sum, item) => sum + item.x, 0) / Math.max(1, flatten.nodes.length);
      const boxX = node.x >= centroidX ? x + 14 : x - 14 - boxWidth;
      parts.push(
        `<g transform="translate(${boxX.toFixed(1)},${(y - boxHeight / 2).toFixed(1)})">` +
          `<rect width="${boxWidth}" height="${boxHeight}" rx="5" fill="#f4f6f9" stroke="#3f7fb0"/>` +
          `<text x="8" y="16" font-size="11.5" font-weight="600" fill="#14171c">${escape(source.name)}</text>` +
          wires
            .map((entry, index) => {
              const ty = 30 + index * 13;
              return (
                `<rect x="8" y="${ty - 8}" width="8" height="8" fill="${entry.wire.color}" stroke="#7a808c" stroke-width="0.5"/>` +
                `<text x="22" y="${ty}" font-size="10" fill="#14171c">${escape(entry.tenant.cavity || '—')} · ${escape(entry.wire.name)} · ${entry.wire.sectionMm2} mm²</text>`
              );
            })
            .join('') +
          `</g>`,
      );
      parts.push(`<rect x="${(x - 9).toFixed(1)}" y="${(y - 9).toFixed(1)}" width="18" height="18" rx="3" fill="#3f7fb0"/>`);
    } else {
      const color = source.kind === 'collier' ? '#5aa469' : source.kind === 'derivation' ? '#d98324' : '#8d94a3';
      parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="7" fill="${color}"/>`);
      parts.push(
        `<text x="${(x + 11).toFixed(1)}" y="${(y + 4).toFixed(1)}" font-size="10.5" fill="#3a414d">${escape(source.name)}</text>`,
      );
    }
  }

  parts.push('</svg>');
  return parts.join('');
}

export function FlattenView() {
  const project = useProject((state) => state.project);
  const setFlattenOpen = useSession((state) => state.setFlattenOpen);
  const derived = deriveAll(project);
  const svg = useMemo(() => buildFlattenSvg(project, derived), [project, derived]);

  return (
    <div className="overlay" onClick={(event) => { if (event.target === event.currentTarget) setFlattenOpen(false); }}>
      <div className="modal">
        <header>
          <h2>Mise à plat — {project.name}</h2>
          <span className="meta">
            {derived.flatten.edges.filter((edge) => !edge.inTree).length > 0
              ? 'Les tronçons en pointillés forment une boucle : leur longueur n’est pas respectée au dessin.'
              : 'Toutes les longueurs sont à l’échelle.'}
          </span>
          <div className="spacer" />
          <button className="ghost" onClick={() => setFlattenOpen(false)}>Fermer</button>
        </header>
        <div className="body" dangerouslySetInnerHTML={{ __html: svg }} />
        <footer>
          <button className="primary" onClick={() => downloadSvg(project, svg)}>Exporter le SVG</button>
          <span className="meta">Imprimable à l’échelle 1 pour servir de gabarit d’atelier.</span>
        </footer>
      </div>
    </div>
  );
}
