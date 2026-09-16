/** Liste de coupe et nomenclature : ce qu'on remet à l'atelier et aux achats. */
import { SLEEVE_KIND_LABEL } from './library';
import type { HarnessComputation } from './routing';
import type { HarnessProject, Id, Tenant } from './types';

export interface TenantView {
  connecteur: string;
  cavite: string;
  contact: string;
  joint: string;
  denudage: number;
  marquage: string;
}

export interface CutListRow {
  wireId: Id;
  repere: string;
  reference: string;
  section: number;
  diametre: number;
  couleur: string;
  reseau: string;
  longueur: number;
  cheminement: string;
  tenantG: TenantView;
  tenantD: TenantView;
  masse: number;
  resistance: number;
  statut: string;
}

function tenantView(project: HarnessProject, tenant: Tenant): TenantView {
  const node = tenant.nodeId ? project.nodes[tenant.nodeId] : undefined;
  const connector = node?.connectorId ? project.connectors[node.connectorId] : undefined;
  return {
    connecteur: node ? `${node.name}${connector ? ` (${connector.ref})` : ''}` : '—',
    cavite: tenant.cavity || '—',
    contact: tenant.terminalRef || '—',
    joint: tenant.sealRef || '—',
    denudage: tenant.stripLength ?? 0,
    marquage: tenant.marking || '',
  };
}

export function buildCutList(project: HarnessProject, computation: HarnessComputation): CutListRow[] {
  const rows: CutListRow[] = [];
  for (const wire of Object.values(project.wires)) {
    const route = computation.routes.get(wire.id);
    const spec = project.specs[wire.specId];
    rows.push({
      wireId: wire.id,
      repere: wire.name,
      reference: spec?.ref ?? `${wire.sectionMm2} mm²`,
      section: wire.sectionMm2,
      diametre: wire.outerDiameter,
      couleur: wire.color,
      reseau: wire.network ?? '',
      longueur: route?.totalLength ?? 0,
      cheminement: (route?.nodes ?? []).map((id) => project.nodes[id]?.name ?? id).join(' → '),
      tenantG: tenantView(project, wire.tenantG),
      tenantD: tenantView(project, wire.tenantD),
      masse: route?.massGram ?? 0,
      resistance: route?.resistanceMilliOhm ?? 0,
      statut: route?.status ?? 'non-route',
    });
  }
  return rows.sort((a, b) => a.repere.localeCompare(b.repere, 'fr', { numeric: true }));
}

export type BomFamily = 'Fil' | 'Gaine' | 'Connecteur' | 'Contact' | 'Joint' | 'Collier';

export interface BomLine {
  famille: BomFamily;
  reference: string;
  designation: string;
  quantite: number;
  unite: 'm' | 'u' | 'g';
  detail?: string;
}

export function buildBom(project: HarnessProject, computation: HarnessComputation): BomLine[] {
  const lines: BomLine[] = [];

  /* Fils : cumulés par référence catalogue. */
  const wireTotals = new Map<string, { length: number; count: number; mass: number; designation: string }>();
  for (const wire of Object.values(project.wires)) {
    const route = computation.routes.get(wire.id);
    if (!route || route.status !== 'ok') continue;
    const spec = project.specs[wire.specId];
    const key = `${spec?.ref ?? wire.sectionMm2} / ${wire.color}`;
    const entry = wireTotals.get(key) ?? {
      length: 0,
      count: 0,
      mass: 0,
      designation: `${spec?.ref ?? `${wire.sectionMm2} mm²`} — couleur ${wire.color}`,
    };
    entry.length += route.totalLength / 1000;
    entry.mass += route.massGram;
    entry.count += 1;
    wireTotals.set(key, entry);
  }
  for (const [ref, entry] of wireTotals) {
    lines.push({
      famille: 'Fil',
      reference: ref,
      designation: entry.designation,
      quantite: entry.length,
      unite: 'm',
      detail: `${entry.count} brin(s), ${entry.mass.toFixed(0)} g`,
    });
  }

  /* Gaines : longueur de chaque référence, cumulée sur ses segments. */
  const sleeveTotals = new Map<Id, number>();
  for (const segment of Object.values(project.segments)) {
    if (!segment.sleeveId) continue;
    const length = computation.geometry.get(segment.id)?.length ?? 0;
    sleeveTotals.set(segment.sleeveId, (sleeveTotals.get(segment.sleeveId) ?? 0) + length);
  }
  for (const [sleeveId, length] of sleeveTotals) {
    const sleeve = project.sleeves[sleeveId];
    if (!sleeve) continue;
    lines.push({
      famille: 'Gaine',
      reference: sleeve.ref ?? sleeve.name,
      designation: `${SLEEVE_KIND_LABEL[sleeve.kind]} Ø int. ${sleeve.innerDiameter} mm`,
      quantite: length / 1000,
      unite: 'm',
      detail: sleeve.name,
    });
  }

  /* Connecteurs montés sur les nœuds. */
  const connectorCount = new Map<Id, number>();
  const clampCount = new Map<string, number>();
  for (const node of Object.values(project.nodes)) {
    if (node.connectorId) connectorCount.set(node.connectorId, (connectorCount.get(node.connectorId) ?? 0) + 1);
    if (node.kind === 'collier' && node.clamp) {
      const key = `${node.clamp.ref} Ø${node.clamp.innerDiameter}`;
      clampCount.set(key, (clampCount.get(key) ?? 0) + 1);
    }
  }
  for (const [connectorId, quantity] of connectorCount) {
    const connector = project.connectors[connectorId];
    if (!connector) continue;
    lines.push({
      famille: 'Connecteur',
      reference: connector.ref,
      designation: `${connector.name} — ${connector.cavities.length} voies (${connector.gender})`,
      quantite: quantity,
      unite: 'u',
    });
  }
  for (const [ref, quantity] of clampCount) {
    lines.push({ famille: 'Collier', reference: ref, designation: 'Collier / clip de maintien', quantite: quantity, unite: 'u' });
  }

  /* Contacts et joints : un par tenant renseigné. */
  const terminals = new Map<string, number>();
  const seals = new Map<string, number>();
  for (const wire of Object.values(project.wires)) {
    for (const tenant of [wire.tenantG, wire.tenantD]) {
      if (tenant.terminalRef) terminals.set(tenant.terminalRef, (terminals.get(tenant.terminalRef) ?? 0) + 1);
      if (tenant.sealRef) seals.set(tenant.sealRef, (seals.get(tenant.sealRef) ?? 0) + 1);
    }
  }
  for (const [ref, quantity] of terminals) {
    lines.push({ famille: 'Contact', reference: ref, designation: 'Contact serti', quantite: quantity, unite: 'u' });
  }
  for (const [ref, quantity] of seals) {
    lines.push({ famille: 'Joint', reference: ref, designation: 'Joint d’étanchéité', quantite: quantity, unite: 'u' });
  }

  const order: Record<BomFamily, number> = { Fil: 0, Gaine: 1, Connecteur: 2, Contact: 3, Joint: 4, Collier: 5 };
  return lines.sort((a, b) => order[a.famille] - order[b.famille] || a.reference.localeCompare(b.reference, 'fr'));
}
