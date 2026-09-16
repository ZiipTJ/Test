/** Faisceau de démonstration, calé sur la platine livrée dans public/demo.
 *  Il sert de point de départ pour comprendre l'outil sans rien saisir. */
import { CONNECTOR_CATALOG, findSpecBySection, SLEEVE_CATALOG, sleeveFromCatalog, suggestTerminal } from '../core/harness/library';
import { emptyProject, newId, type HarnessProject, type Id } from '../core/harness/types';
import type { Vec3 } from '../core/math/vec';

interface WireSeed {
  name: string;
  section: number;
  color: string;
  network: string;
  from: [Id, string];
  to: [Id, string];
  current?: number;
}

export function buildDemoProject(): HarnessProject {
  const project = emptyProject('Faisceau platine — démonstration');

  const connectorA = newId('cn');
  project.connectors[connectorA] = { ...CONNECTOR_CATALOG[4]!, id: connectorA, name: 'Connecteur A (support G)', color: '#4a5260', gender: 'femelle', cavities: Array.from({ length: 12 }, (_, i) => ({ code: String(i + 1) })) };
  const connectorB = newId('cn');
  project.connectors[connectorB] = { ...CONNECTOR_CATALOG[2]!, id: connectorB, name: 'Connecteur B (traverse)', color: '#4a5260', gender: 'femelle', cavities: Array.from({ length: 6 }, (_, i) => ({ code: String(i + 1) })) };
  const connectorC = newId('cn');
  project.connectors[connectorC] = { ...CONNECTOR_CATALOG[4]!, id: connectorC, name: 'Connecteur C (support D)', color: '#4a5260', gender: 'male', cavities: Array.from({ length: 12 }, (_, i) => ({ code: String(i + 1) })) };

  const node = (name: string, position: Vec3, kind: HarnessProject['nodes'][string]['kind'], extra: Partial<HarnessProject['nodes'][string]> = {}): Id => {
    const id = newId('nd');
    project.nodes[id] = { id, name, kind, position, exitLength: 0, locked: false, ...extra };
    return id;
  };

  // Connecteurs posés sur les deux supports, sortie horizontale imposée.
  const A = node('Connecteur A', [100, 200, 60], 'connecteur', {
    connectorId: connectorA, exitDirection: [1, 0, 0], exitLength: 40,
  });
  const C = node('Connecteur C', [700, 200, 60], 'connecteur', {
    connectorId: connectorC, exitDirection: [-1, 0, 0], exitLength: 40,
  });
  const B = node('Connecteur B', [400, 60, 60], 'connecteur', {
    connectorId: connectorB, exitDirection: [0, 1, 0], exitLength: 30,
  });

  // Colliers vissés dans les perçages de la platine (x = 300 et 600, y = 200).
  const clamps = [300, 600].map((x, index) =>
    node(`Collier ${index + 1}`, [x, 200, 10], 'collier', {
      clamp: { ref: 'Collier Ø20 embase', innerDiameter: 20 },
      snap: { kind: 'centre-cercle', radius: 4.25, axis: [0, 0, 1] },
    }),
  );
  // La dérivation est elle aussi vissée dans un perçage.
  const branch = node('Dérivation', [450, 200, 10], 'derivation');

  const segment = (a: Id, b: Id, name: string, vias: Vec3[] = [], bendRadius = 30): Id => {
    const id = newId('sg');
    project.segments[id] = { id, name, a, b, vias, bendRadius, slack: 0.03, locked: false };
    return id;
  };

  // Le rayon de coude du tronc tient compte de son diamètre : 8 fils font un
  // toron d'environ Ø11, soit 45 mm de rayon mini à 4 × Ø.
  const trunk = [
    segment(A, clamps[0]!, 'Tronc A → C1', [], 60),
    segment(clamps[0]!, branch, 'Tronc C1 → dérivation', [], 60),
    segment(branch, clamps[1]!, 'Tronc dérivation → C2', [], 60),
    segment(clamps[1]!, C, 'Tronc C2 → C', [], 60),
  ];
  const branchSegment = segment(branch, B, 'Branche dérivation → B', [], 40);

  // Gaine spiralée sur le tronc, gaine annelée sur la branche.
  const spiral = sleeveFromCatalog(SLEEVE_CATALOG.find((s) => s.kind === 'spiralee' && s.innerDiameter === 16)!, newId('sl'), 'Spiralée tronc Ø16');
  spiral.segmentIds = trunk;
  project.sleeves[spiral.id] = spiral;
  for (const id of trunk) project.segments[id]!.sleeveId = spiral.id;

  const corrugated = sleeveFromCatalog(SLEEVE_CATALOG.find((s) => s.kind === 'annelee' && s.innerDiameter === 10)!, newId('sl'), 'Annelée branche Ø10');
  corrugated.segmentIds = [branchSegment];
  project.sleeves[corrugated.id] = corrugated;
  project.segments[branchSegment]!.sleeveId = corrugated.id;

  const seeds: WireSeed[] = [
    { name: 'ALIM+', section: 4, color: '#d0342c', network: 'Puissance', from: [A, '1'], to: [C, '1'], current: 32 },
    { name: 'ALIM-', section: 4, color: '#1c1c1c', network: 'Puissance', from: [A, '2'], to: [C, '2'], current: 32 },
    { name: 'MASSE', section: 2.5, color: '#7a4a21', network: 'Masse', from: [A, '3'], to: [C, '3'], current: 12 },
    { name: 'CMD-VENT', section: 1, color: '#2f6fd0', network: 'Commande', from: [A, '4'], to: [C, '4'], current: 6 },
    { name: 'CAN-H', section: 0.5, color: '#e8c22a', network: 'CAN', from: [A, '5'], to: [B, '1'] },
    { name: 'CAN-L', section: 0.5, color: '#2f9e51', network: 'CAN', from: [A, '6'], to: [B, '2'] },
    { name: 'CAPT-T', section: 0.5, color: '#8455b5', network: 'Mesure', from: [B, '3'], to: [C, '5'] },
    { name: 'CAPT-P', section: 0.5, color: '#9aa0aa', network: 'Mesure', from: [B, '4'], to: [C, '6'] },
    { name: 'ECLAIR', section: 1.5, color: '#e08028', network: 'Commande', from: [A, '7'], to: [C, '7'], current: 14 },
    { name: 'RETOUR', section: 1.5, color: '#eceff3', network: 'Commande', from: [A, '8'], to: [C, '8'], current: 14 },
  ];

  for (const seed of seeds) {
    const spec = findSpecBySection(seed.section);
    project.specs[spec.id] = { ...spec };
    const id = newId('wr');
    const terminal = suggestTerminal(spec.sectionMm2);
    project.wires[id] = {
      id,
      name: seed.name,
      specId: spec.id,
      sectionMm2: spec.sectionMm2,
      outerDiameter: spec.outerDiameter,
      color: seed.color,
      network: seed.network,
      ...(seed.current != null ? { currentA: seed.current } : {}),
      tenantG: { nodeId: seed.from[0], cavity: seed.from[1], terminalRef: terminal, sealRef: 'Joint MQS bleu', stripLength: 6, tailLength: 40, marking: seed.name },
      tenantD: { nodeId: seed.to[0], cavity: seed.to[1], terminalRef: terminal, sealRef: 'Joint MQS bleu', stripLength: 6, tailLength: 40, marking: seed.name },
      path: [],
      pathMode: 'auto',
    };
  }

  return project;
}
