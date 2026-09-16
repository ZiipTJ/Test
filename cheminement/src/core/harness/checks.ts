/** Contrôles de conception : ce qui bloquerait la fabrication ou le montage. */
import type { HarnessComputation } from './routing';
import { SLEEVE_KIND_LABEL } from './library';
import type { HarnessProject, Id } from './types';

export type Severity = 'erreur' | 'alerte' | 'info';

export interface CheckItem {
  id: string;
  severity: Severity;
  code: string;
  title: string;
  detail: string;
  target?: { kind: 'wire' | 'segment' | 'node' | 'sleeve'; id: Id };
}

export function runChecks(project: HarnessProject, computation: HarnessComputation): CheckItem[] {
  const items: CheckItem[] = [];
  const push = (item: Omit<CheckItem, 'id'>) =>
    items.push({ ...item, id: `${item.code}:${item.target?.id ?? 'global'}:${items.length}` });

  /* --- Cheminement des fils ------------------------------------------------ */
  for (const route of computation.routes.values()) {
    const wire = project.wires[route.wireId];
    if (!wire) continue;
    if (route.status !== 'ok') {
      push({
        severity: 'erreur',
        code: 'FIL-ROUTE',
        title: `Fil ${wire.name} non cheminé`,
        detail: route.message ?? 'Cheminement impossible.',
        target: { kind: 'wire', id: wire.id },
      });
    }
  }

  /* --- Repères en double --------------------------------------------------- */
  const byName = new Map<string, Id[]>();
  for (const wire of Object.values(project.wires)) {
    const key = wire.name.trim().toLowerCase();
    if (!key) continue;
    const list = byName.get(key) ?? [];
    list.push(wire.id);
    byName.set(key, list);
  }
  for (const [name, ids] of byName) {
    if (ids.length > 1) {
      push({
        severity: 'alerte',
        code: 'FIL-DOUBLON',
        title: `Repère « ${name} » utilisé ${ids.length} fois`,
        detail: 'Un repère de fil doit être unique pour le marquage et la traçabilité.',
        target: { kind: 'wire', id: ids[0]! },
      });
    }
  }

  /* --- Cavités : occupation, existence ------------------------------------- */
  const cavityUse = new Map<string, Id[]>();
  for (const wire of Object.values(project.wires)) {
    for (const side of ['G', 'D'] as const) {
      const tenant = side === 'G' ? wire.tenantG : wire.tenantD;
      if (!tenant.nodeId) continue;
      const node = project.nodes[tenant.nodeId];
      if (!node) continue;

      if (node.kind !== 'connecteur' && node.kind !== 'epissure') {
        push({
          severity: 'alerte',
          code: 'TENANT-NOEUD',
          title: `Tenant ${side} du fil ${wire.name} sur un nœud « ${node.kind} »`,
          detail: 'Un tenant se raccorde normalement sur un connecteur ou une épissure.',
          target: { kind: 'wire', id: wire.id },
        });
      }

      if (!tenant.cavity) {
        push({
          severity: 'alerte',
          code: 'CAVITE-VIDE',
          title: `Cavité non renseignée (fil ${wire.name}, tenant ${side})`,
          detail: `Nœud ${node.name}.`,
          target: { kind: 'wire', id: wire.id },
        });
        continue;
      }

      const key = `${tenant.nodeId}|${tenant.cavity}`;
      const list = cavityUse.get(key) ?? [];
      list.push(wire.id);
      cavityUse.set(key, list);

      const connector = node.connectorId ? project.connectors[node.connectorId] : undefined;
      if (connector && !connector.cavities.some((c) => c.code === tenant.cavity)) {
        push({
          severity: 'erreur',
          code: 'CAVITE-INCONNUE',
          title: `Cavité ${tenant.cavity} absente du connecteur ${connector.ref}`,
          detail: `Fil ${wire.name}, tenant ${side}. Cavités disponibles : ${connector.cavities.map((c) => c.code).join(', ')}.`,
          target: { kind: 'wire', id: wire.id },
        });
      }
    }
  }
  for (const [key, ids] of cavityUse) {
    if (ids.length > 1) {
      const [nodeId, cavity] = key.split('|');
      const node = nodeId ? project.nodes[nodeId] : undefined;
      // Une épissure regroupe volontairement plusieurs fils : ce n'est pas un défaut.
      if (node?.kind === 'epissure') continue;
      push({
        severity: 'erreur',
        code: 'CAVITE-OCCUPEE',
        title: `Cavité ${cavity} de ${node?.name ?? '?'} affectée à ${ids.length} fils`,
        detail: `Fils : ${ids.map((id) => project.wires[id]?.name ?? id).join(', ')}.`,
        target: { kind: 'node', id: nodeId ?? '' },
      });
    }
  }

  /* --- Courant admissible --------------------------------------------------- */
  for (const wire of Object.values(project.wires)) {
    const spec = project.specs[wire.specId];
    if (!spec || wire.currentA == null) continue;
    if (wire.currentA > spec.currentRating) {
      push({
        severity: 'erreur',
        code: 'FIL-COURANT',
        title: `Section insuffisante sur ${wire.name}`,
        detail: `${wire.currentA} A demandés pour ${spec.currentRating} A admissibles en ${wire.sectionMm2} mm².`,
        target: { kind: 'wire', id: wire.id },
      });
    } else if (wire.currentA > spec.currentRating * 0.8) {
      push({
        severity: 'alerte',
        code: 'FIL-COURANT-LIMITE',
        title: `Fil ${wire.name} proche de son courant admissible`,
        detail: `${wire.currentA} A pour ${spec.currentRating} A admissibles.`,
        target: { kind: 'wire', id: wire.id },
      });
    }
  }

  /* --- Segments : rayon de coude, gaine, charge ----------------------------- */
  for (const segment of Object.values(project.segments)) {
    const geom = computation.geometry.get(segment.id);
    const load = computation.loads.get(segment.id);
    if (!geom || !load) continue;

    if (geom.geometricLength < 1e-3) {
      push({
        severity: 'alerte',
        code: 'SEG-NUL',
        title: `Segment ${segment.name} de longueur nulle`,
        detail: 'Les deux nœuds sont confondus.',
        target: { kind: 'segment', id: segment.id },
      });
    }

    if (load.wireIds.length === 0) {
      push({
        severity: 'info',
        code: 'SEG-VIDE',
        title: `Aucun fil sur ${segment.name}`,
        detail: 'Le segment ne transporte aucun fil : gaine et longueur inutiles.',
        target: { kind: 'segment', id: segment.id },
      });
    }

    // Rayon mini exigé : le plus contraignant entre le toron et chacun de ses fils.
    let requiredRadius = load.bundleDiameter * project.settings.bundleMinBendFactor;
    let driver = 'toron';
    for (const wireId of load.wireIds) {
      const wire = project.wires[wireId];
      if (!wire) continue;
      const spec = project.specs[wire.specId];
      const factor = spec?.minBendFactor ?? 5;
      const needed = wire.outerDiameter * factor;
      if (needed > requiredRadius) {
        requiredRadius = needed;
        driver = `fil ${wire.name}`;
      }
    }

    for (const corner of geom.path.corners) {
      if (corner.turnAngle <= 1e-3) continue;
      if (corner.radius <= 1e-6) {
        push({
          severity: 'erreur',
          code: 'COUDE-VIF',
          title: `Angle vif sur ${segment.name}`,
          detail: `Déviation de ${((corner.turnAngle * 180) / Math.PI).toFixed(0)}° sans rayon : allonger les brins voisins ou ajouter un point de passage.`,
          target: { kind: 'segment', id: segment.id },
        });
      } else if (requiredRadius > 0 && corner.radius < requiredRadius) {
        push({
          severity: corner.radius < requiredRadius * 0.7 ? 'erreur' : 'alerte',
          code: 'COUDE-RAYON',
          title: `Rayon de coude insuffisant sur ${segment.name}`,
          detail: `${corner.radius.toFixed(1)} mm obtenus pour ${requiredRadius.toFixed(1)} mm exigés par le ${driver}${corner.clamped ? ' (rayon réduit faute de longueur droite disponible)' : ''}.`,
          target: { kind: 'segment', id: segment.id },
        });
      }
    }

    const sleeve = segment.sleeveId ? project.sleeves[segment.sleeveId] : undefined;
    if (sleeve && sleeve.innerDiameter > 0) {
      if (load.bundleDiameter > sleeve.innerDiameter) {
        push({
          severity: 'erreur',
          code: 'GAINE-PETITE',
          title: `${SLEEVE_KIND_LABEL[sleeve.kind]} trop petite sur ${segment.name}`,
          detail: `Toron Ø${load.bundleDiameter.toFixed(1)} mm dans une gaine Ø int. ${sleeve.innerDiameter} mm.`,
          target: { kind: 'sleeve', id: sleeve.id },
        });
      } else if (load.fill && !load.fill.ok) {
        push({
          severity: 'alerte',
          code: 'GAINE-REMPLISSAGE',
          title: `Remplissage de ${(load.fill.ratio * 100).toFixed(0)} % sur ${segment.name}`,
          detail: `Au-delà des ${(project.settings.maxFillRatio * 100).toFixed(0)} % admis : passage et rayon de courbure difficiles.`,
          target: { kind: 'sleeve', id: sleeve.id },
        });
      }
    }
  }

  /* --- Colliers ------------------------------------------------------------- */
  for (const node of Object.values(project.nodes)) {
    if (node.kind !== 'collier' || !node.clamp) continue;
    let maxBundle = 0;
    for (const segment of Object.values(project.segments)) {
      if (segment.a !== node.id && segment.b !== node.id) continue;
      maxBundle = Math.max(maxBundle, computation.loads.get(segment.id)?.bundleDiameter ?? 0);
    }
    if (maxBundle > node.clamp.innerDiameter) {
      push({
        severity: 'erreur',
        code: 'COLLIER-PETIT',
        title: `Collier ${node.name} trop petit`,
        detail: `Toron Ø${maxBundle.toFixed(1)} mm pour un collier Ø${node.clamp.innerDiameter} mm.`,
        target: { kind: 'node', id: node.id },
      });
    }
  }

  /* --- Topologie ------------------------------------------------------------ */
  for (const [nodeId, edges] of computation.adjacency) {
    if (edges.length === 0) {
      push({
        severity: 'alerte',
        code: 'NOEUD-ISOLE',
        title: `Nœud ${project.nodes[nodeId]?.name ?? nodeId} isolé`,
        detail: 'Aucun segment ne part de ce nœud.',
        target: { kind: 'node', id: nodeId },
      });
    }
  }

  const order: Record<Severity, number> = { erreur: 0, alerte: 1, info: 2 };
  return items.sort((a, b) => order[a.severity] - order[b.severity]);
}

export function summarizeChecks(items: readonly CheckItem[]): Record<Severity, number> {
  const out: Record<Severity, number> = { erreur: 0, alerte: 0, info: 0 };
  for (const item of items) out[item.severity] += 1;
  return out;
}
