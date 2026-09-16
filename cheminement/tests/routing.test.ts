import { describe, expect, it } from 'vitest';
import { computeHarness } from '../src/core/harness/routing';
import { buildCutList, buildBom } from '../src/core/harness/bom';
import { runChecks, summarizeChecks } from '../src/core/harness/checks';
import { flattenHarness } from '../src/core/harness/flatten';
import { node, segment, tenant, tHarness, wire } from './fixtures';
import { emptyProject } from '../src/core/harness/types';

describe('computeHarness — cheminement', () => {
  it('route chaque fil par le plus court chemin et charge les segments', () => {
    const project = tHarness();
    const result = computeHarness(project);

    expect(result.routes.get('w1')!.nodes).toEqual(['A', 'B', 'C']);
    expect(result.routes.get('w2')!.nodes).toEqual(['A', 'B', 'D']);

    // Le tronc AB porte les trois fils, les branches un et deux.
    expect(result.loads.get('AB')!.wireIds.sort()).toEqual(['w1', 'w2', 'w3']);
    expect(result.loads.get('BC')!.wireIds).toEqual(['w1']);
    expect(result.loads.get('BD')!.wireIds.sort()).toEqual(['w2', 'w3']);
  });

  it('calcule la longueur de coupe avec le mou et les tenants', () => {
    const project = tHarness();
    project.segments['AB']!.slack = 0.1;
    project.wires['w1']!.tenantG.tailLength = 50;
    project.wires['w1']!.tenantD.tailLength = 30;

    const result = computeHarness(project);
    const route = result.routes.get('w1')!;
    // AB = 300 (+10 %), BC = 300, plus 80 mm de tenants.
    expect(route.routedLength).toBeCloseTo(300 * 1.1 + 300, 6);
    expect(route.tailLength).toBe(80);
    expect(route.totalLength).toBeCloseTo(300 * 1.1 + 300 + 80, 6);
  });

  it('respecte un cheminement imposé plus long que le plus court chemin', () => {
    const project = tHarness();
    // Détour par le bas : plus long que A→B→C, le mode auto doit l'ignorer.
    node(project, 'E', 'Passage bas', [300, -400, 0]);
    segment(project, 'AE', 'A', 'E');
    segment(project, 'EC', 'E', 'C');

    const auto = computeHarness(project);
    expect(auto.routes.get('w1')!.nodes).toEqual(['A', 'B', 'C']);

    project.wires['w1']!.pathMode = 'manuel';
    project.wires['w1']!.path = ['A', 'E', 'C'];
    const forced = computeHarness(project);
    expect(forced.routes.get('w1')!.segments).toEqual(['AE', 'EC']);
    expect(forced.routes.get('w1')!.totalLength).toBeGreaterThan(auto.routes.get('w1')!.totalLength);
  });

  it('signale un fil dont les tenants ne sont pas reliés', () => {
    const project = tHarness();
    node(project, 'Z', 'Connecteur isolé', [0, 0, 500], { kind: 'connecteur' });
    wire(project, 'w9', '9A', 0.5, tenant('A', '9'), tenant('Z', '1'));
    const result = computeHarness(project);
    expect(result.routes.get('w9')!.status).toBe('non-route');
    expect(result.totals.routedWireCount).toBe(3);
  });

  it('signale un tenant non affecté', () => {
    const project = tHarness();
    project.wires['w1']!.tenantD.nodeId = null;
    expect(computeHarness(project).routes.get('w1')!.status).toBe('tenant-incomplet');
  });

  it('honore une longueur imposée sur un segment', () => {
    const project = tHarness();
    project.segments['BC']!.overrideLength = 1000;
    const result = computeHarness(project);
    expect(result.geometry.get('BC')!.geometricLength).toBeCloseTo(300, 6);
    expect(result.routes.get('w1')!.routedLength).toBeCloseTo(300 + 1000, 6);
  });

  it('corrige la longueur selon la position du fil dans le toron', () => {
    const project = emptyProject();
    node(project, 'A', 'A', [0, 0, 0], { kind: 'connecteur' });
    node(project, 'B', 'B', [500, 0, 0], { kind: 'passage' });
    node(project, 'C', 'C', [500, 500, 0], { kind: 'connecteur' });
    segment(project, 'AB', 'A', 'B', { bendRadius: 40 });
    segment(project, 'BC', 'B', 'C', { bendRadius: 40 });
    for (let i = 0; i < 6; i += 1) {
      wire(project, `w${i}`, `W${i}`, 2.5, tenant('A', String(i + 1)), tenant('C', String(i + 1)));
    }
    const neutral = computeHarness(project);
    project.settings.correctLengthByPosition = true;
    const corrected = computeHarness(project);

    const deltas = [...corrected.routes.values()].map(
      (r) => r.totalLength - neutral.routes.get(r.wireId)!.totalLength,
    );
    // Le coude est en B, traversé de façon continue par la chaîne AB+BC.
    expect(deltas.some((d) => Math.abs(d) > 0.5)).toBe(true);
    // Les fils extérieurs au coude rallongent, les intérieurs raccourcissent.
    expect(Math.max(...deltas)).toBeGreaterThan(0);
    expect(Math.min(...deltas)).toBeLessThan(0);
    // L'écart reste borné par le rayon du toron vu sous l'angle du coude.
    const bundleRadius = corrected.loads.get('AB')!.bundleDiameter / 2;
    for (const d of deltas) expect(Math.abs(d)).toBeLessThanOrEqual(bundleRadius * (Math.PI / 2) + 1e-6);
  });
});

describe('continuité au travers des nœuds de passage', () => {
  it('raccorde le coude porté par un nœud de passage et le partage entre les deux segments', () => {
    const project = emptyProject();
    node(project, 'A', 'A', [0, 0, 0], { kind: 'connecteur' });
    node(project, 'P', 'P', [400, 0, 0], { kind: 'passage' });
    node(project, 'C', 'C', [400, 400, 0], { kind: 'connecteur' });
    const R = 50;
    segment(project, 'AP', 'A', 'P', { bendRadius: R });
    segment(project, 'PC', 'P', 'C', { bendRadius: R });
    wire(project, 'w', 'W', 1.5, tenant('A', '1'), tenant('C', '1'));

    const result = computeHarness(project, 0.005);
    const lAP = result.geometry.get('AP')!.geometricLength;
    const lPC = result.geometry.get('PC')!.geometricLength;
    const expected = 2 * (400 - R) + (Math.PI / 2) * R;
    expect(lAP + lPC).toBeCloseTo(expected, 1);
    // L'arc est partagé équitablement de part et d'autre du nœud.
    expect(lAP).toBeCloseTo(lPC, 1);

    // Chaque tronçon est bien orienté de son nœud a vers son nœud b.
    const ap = result.geometry.get('AP')!.path;
    expect(ap.points[0]![0]).toBeCloseTo(0, 6);
    const pc = result.geometry.get('PC')!.path;
    const lastPC = pc.points[pc.points.length - 1]!;
    expect(lastPC[1]).toBeCloseTo(400, 6);
    // Continuité : la fin de AP coïncide avec le début de PC.
    const endAP = ap.points[ap.points.length - 1]!;
    expect(Math.hypot(endAP[0] - pc.points[0]![0], endAP[1] - pc.points[0]![1])).toBeLessThan(1e-6);
  });

  it('ne raccorde pas au travers d\u2019une dérivation', () => {
    const project = tHarness();
    const result = computeHarness(project);
    // B est une dérivation : chaque branche part en ligne droite, sans arc.
    expect(result.geometry.get('AB')!.path.corners).toHaveLength(0);
    expect(result.geometry.get('BD')!.geometricLength).toBeCloseTo(400, 6);
  });
});

describe('contrôles', () => {
  it('ne relève rien de bloquant sur un faisceau sain', () => {
    const project = tHarness();
    const items = runChecks(project, computeHarness(project));
    expect(summarizeChecks(items).erreur).toBe(0);
  });

  it('détecte une cavité affectée deux fois', () => {
    const project = tHarness();
    project.wires['w3']!.tenantG.cavity = '2';
    const items = runChecks(project, computeHarness(project));
    expect(items.some((i) => i.code === 'CAVITE-OCCUPEE')).toBe(true);
  });

  it('accepte plusieurs fils sur une épissure', () => {
    const project = tHarness();
    project.nodes['A']!.kind = 'epissure';
    project.wires['w3']!.tenantG.cavity = '2';
    const items = runChecks(project, computeHarness(project));
    expect(items.some((i) => i.code === 'CAVITE-OCCUPEE')).toBe(false);
  });

  it('détecte une gaine trop petite pour le toron', () => {
    const project = tHarness();
    project.sleeves['sl1']!.innerDiameter = 3;
    const items = runChecks(project, computeHarness(project));
    expect(items.some((i) => i.code === 'GAINE-PETITE')).toBe(true);
  });

  it('détecte un rayon de coude insuffisant', () => {
    const project = tHarness();
    // Un point de passage impose un crochet serré dans la branche B→D.
    project.segments['BD']!.vias = [[380, 200, 0]];
    project.segments['BD']!.bendRadius = 2;
    const items = runChecks(project, computeHarness(project));
    expect(items.some((i) => i.code === 'COUDE-RAYON' || i.code === 'COUDE-VIF')).toBe(true);
  });

  it('détecte une section insuffisante pour le courant déclaré', () => {
    const project = tHarness();
    project.wires['w1']!.currentA = 40;
    const items = runChecks(project, computeHarness(project));
    expect(items.some((i) => i.code === 'FIL-COURANT' && i.severity === 'erreur')).toBe(true);
  });
});

describe('livrables', () => {
  it('produit une liste de coupe avec les deux tenants', () => {
    const project = tHarness();
    project.wires['w1']!.tenantG.terminalRef = 'MQS 0,75-1,0';
    const rows = buildCutList(project, computeHarness(project));
    const row = rows.find((r) => r.repere === '1A')!;
    expect(row.tenantG.connecteur).toContain('Connecteur A');
    expect(row.tenantG.cavite).toBe('1');
    expect(row.tenantG.contact).toBe('MQS 0,75-1,0');
    expect(row.tenantD.connecteur).toContain('Connecteur C');
    expect(row.longueur).toBeCloseTo(600, 3);
    expect(row.cheminement).toBe('Connecteur A → Dérivation B → Connecteur C');
  });

  it('cumule la nomenclature par référence', () => {
    const project = tHarness();
    const bom = buildBom(project, computeHarness(project));
    const sleeve = bom.find((l) => l.famille === 'Gaine')!;
    expect(sleeve.quantite).toBeCloseTo(0.3, 6); // 300 mm de spiralée sur AB
    expect(bom.filter((l) => l.famille === 'Fil').length).toBeGreaterThan(0);
  });
});

describe('mise à plat', () => {
  it('conserve la longueur des segments de l’arbre', () => {
    const project = tHarness();
    const computation = computeHarness(project);
    const layout = flattenHarness(project, computation);
    const positions = new Map(layout.nodes.map((n) => [n.id, n]));
    for (const edge of layout.edges) {
      if (!edge.inTree) continue;
      const a = positions.get(edge.a)!;
      const b = positions.get(edge.b)!;
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeCloseTo(edge.length, 3);
    }
  });

  it('marque les arêtes de boucle, non dépliables', () => {
    const project = tHarness();
    segment(project, 'AC', 'A', 'C');
    const layout = flattenHarness(project, computeHarness(project));
    expect(layout.edges.filter((e) => !e.inTree)).toHaveLength(1);
  });
});
