import { beforeEach, describe, expect, it } from 'vitest';
import { compute } from '../src/core/harness/compute';
import { insertIndexFor } from '../src/core/curve/edit';
import { gradeForSection } from '../src/core/harness/library';
import { emptyProject, type Project, type Wire } from '../src/core/harness/types';
import type { Vec3 } from '../src/core/math/vec';
import { useProject } from '../src/state/project';

function wire(name: string, section: number, points: Vec3[], patch: Partial<Wire> = {}): Wire {
  const grade = gradeForSection(section);
  return {
    id: name,
    name,
    sectionMm2: grade.sectionMm2,
    color: '#d0342c',
    outerDiameter: grade.outerDiameter,
    massPerMeter: grade.massPerMeter,
    resistancePerMeter: grade.resistancePerMeter,
    points,
    from: '',
    to: '',
    bendRadius: 30,
    slack: 0,
    tails: 0,
    ...patch,
  };
}

function project(...wires: Wire[]): Project {
  return { ...emptyProject(), wires };
}

describe('compute — un fil', () => {
  it('mesure la longueur du chemin tracé', () => {
    const result = compute(project(wire('F1', 0.75, [[0, 0, 0], [1000, 0, 0]])));
    const F1 = result.wires.get('F1')!;
    expect(F1.ready).toBe(true);
    expect(F1.pathLength).toBeCloseTo(1000, 6);
    expect(F1.length).toBeCloseTo(1000, 6);
  });

  it('ajoute le mou et les longueurs libres', () => {
    const result = compute(project(wire('F1', 0.75, [[0, 0, 0], [1000, 0, 0]], { slack: 0.05, tails: 60 })));
    // 1000 mm + 5 % de mou + 60 mm à chaque extrémité.
    expect(result.wires.get('F1')!.length).toBeCloseTo(1000 * 1.05 + 120, 6);
  });

  it('raccorde les coudes au rayon demandé', () => {
    const R = 40;
    const result = compute(project(wire('F1', 0.75, [[0, 0, 0], [500, 0, 0], [500, 500, 0]], { bendRadius: R })));
    const expected = 2 * (500 - R) + (Math.PI / 2) * R;
    expect(result.wires.get('F1')!.pathLength).toBeCloseTo(expected, 0);
  });

  it('déduit le poids et la résistance de la longueur', () => {
    const result = compute(project(wire('F1', 2.5, [[0, 0, 0], [2000, 0, 0]])));
    const grade = gradeForSection(2.5);
    expect(result.wires.get('F1')!.massGram).toBeCloseTo(2 * grade.massPerMeter, 6);
    expect(result.wires.get('F1')!.resistanceMilliOhm).toBeCloseTo(2 * grade.resistancePerMeter, 6);
  });

  it('laisse un fil non tracé sans longueur', () => {
    const result = compute(project(wire('F1', 0.75, []), wire('F2', 0.75, [[0, 0, 0]])));
    expect(result.wires.get('F1')!.ready).toBe(false);
    expect(result.wires.get('F2')!.ready).toBe(false);
    expect(result.totals.tracedCount).toBe(0);
    expect(result.totals.wireLength).toBe(0);
  });

  it('totalise ce qui est tracé', () => {
    const result = compute(project(
      wire('F1', 0.75, [[0, 0, 0], [1000, 0, 0]]),
      wire('F2', 0.75, [[0, 0, 0], [500, 0, 0]]),
      wire('F3', 0.75, []),
    ));
    expect(result.totals.wireCount).toBe(3);
    expect(result.totals.tracedCount).toBe(2);
    expect(result.totals.wireLength).toBeCloseTo(1500, 6);
  });
});

describe('compute — un toron', () => {
  function withToron(): Project {
    const wires = [
      wire('F1', 2.5, [[0, 0, 0], [800, 0, 0]], { toronId: 'T1' }),
      wire('F2', 2.5, [], { toronId: 'T1' }),
      wire('F3', 0.5, [], { toronId: 'T1' }),
    ];
    return {
      ...emptyProject(),
      wires,
      torons: [{
        id: 'T1',
        name: 'Toron 1',
        wireIds: ['F1', 'F2', 'F3'],
        points: [[0, 0, 0], [1000, 0, 0]],
        sleeve: 'spiralee',
        bendRadius: 30,
        color: '#9aa2ae',
      }],
    };
  }

  it('fait suivre à tous les fils le chemin du toron', () => {
    const result = compute(withToron());
    for (const id of ['F1', 'F2', 'F3']) {
      expect(result.wires.get(id)!.ready).toBe(true);
      expect(result.wires.get(id)!.pathLength).toBeCloseTo(1000, 6);
    }
    // Le chemin propre de F1 (800 mm) est ignoré tant qu'il est dans le toron.
    expect(result.wires.get('F1')!.pathLength).not.toBeCloseTo(800, 3);
  });

  it('range les fils dans la section et en déduit le diamètre', () => {
    const result = compute(withToron());
    const toron = result.torons.get('T1')!;
    expect(toron.diameter).toBeGreaterThan(3.1);
    expect(toron.diameter).toBeLessThan(3.1 * 3);
    expect(toron.offsets.size).toBe(3);
    // Deux fils ne peuvent pas occuper la même place.
    const a = toron.offsets.get('F1')!;
    const b = toron.offsets.get('F2')!;
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(a.r + b.r - 1e-3);
    expect(toron.sectionMm2).toBeCloseTo(5.5, 6);
  });

  it('cumule la masse linéique de ses fils', () => {
    const toron = compute(withToron()).torons.get('T1')!;
    expect(toron.massPerMeter).toBeCloseTo(2 * gradeForSection(2.5).massPerMeter + gradeForSection(0.5).massPerMeter, 6);
  });

  it('reste sain quand le toron n’est pas encore tracé', () => {
    const base = withToron();
    base.torons[0]!.points = [];
    const result = compute(base);
    expect(result.torons.get('T1')!.path).toBeNull();
    expect(result.wires.get('F1')!.ready).toBe(false);
  });
});

describe('réunir et séparer des fils', () => {
  beforeEach(() => {
    useProject.getState().resetProject('Test');
  });

  it('réunit des fils en reprenant le chemin du premier qui en a un', () => {
    const store = useProject.getState();
    const a = store.addWire();
    const b = store.addWire();
    store.updateWire(a, { points: [[0, 0, 0], [500, 0, 0]] });

    const toronId = useProject.getState().groupToron([a, b])!;
    const project = useProject.getState().project;
    const toron = project.torons.find((item) => item.id === toronId)!;

    expect(toron.wireIds).toEqual([a, b]);
    expect(toron.points).toEqual([[0, 0, 0], [500, 0, 0]]);
    expect(project.wires.every((wire) => wire.toronId === toronId)).toBe(true);
    // Le chemin du toron est une copie : modifier l'un ne touche pas l'autre.
    expect(toron.points).not.toBe(project.wires.find((wire) => wire.id === a)!.points);
  });

  it('refuse de réunir un seul fil', () => {
    const id = useProject.getState().addWire();
    expect(useProject.getState().groupToron([id])).toBeNull();
    expect(useProject.getState().project.torons).toHaveLength(0);
  });

  it('rend son chemin à chaque fil quand on les sépare', () => {
    const store = useProject.getState();
    const a = store.addWire();
    const b = store.addWire();
    store.updateWire(a, { points: [[0, 0, 0], [500, 0, 0]] });
    const toronId = useProject.getState().groupToron([a, b])!;

    useProject.getState().ungroupToron(toronId);
    const project = useProject.getState().project;
    expect(project.torons).toHaveLength(0);
    expect(project.wires.every((wire) => wire.toronId === undefined)).toBe(true);
    // B n'avait pas de chemin : il hérite de celui du toron.
    expect(project.wires.find((wire) => wire.id === b)!.points).toEqual([[0, 0, 0], [500, 0, 0]]);
  });

  it('retire un fil supprimé de son toron, et efface un toron vidé', () => {
    const store = useProject.getState();
    const a = store.addWire();
    const b = store.addWire();
    const toronId = useProject.getState().groupToron([a, b])!;

    useProject.getState().removeWire(a);
    expect(useProject.getState().project.torons.find((item) => item.id === toronId)!.wireIds).toEqual([b]);

    useProject.getState().removeWire(b);
    expect(useProject.getState().project.torons).toHaveLength(0);
  });

  it('aligne diamètre, masse et résistance quand on change la section', () => {
    const id = useProject.getState().addWire();
    useProject.getState().setSection(id, 6);
    const wire = useProject.getState().project.wires[0]!;
    const grade = gradeForSection(6);
    expect(wire.sectionMm2).toBe(6);
    expect(wire.outerDiameter).toBe(grade.outerDiameter);
    expect(wire.massPerMeter).toBe(grade.massPerMeter);
  });
});

describe('ajuster le tracé', () => {
  beforeEach(() => {
    useProject.getState().resetProject('Test');
  });

  it('insère un point sur le brin le plus proche', () => {
    const points: Vec3[] = [[0, 0, 0], [100, 0, 0], [100, 100, 0]];
    // Au milieu du premier brin.
    expect(insertIndexFor(points, [50, 3, 0])).toBe(1);
    // Au milieu du second.
    expect(insertIndexFor(points, [103, 50, 0])).toBe(2);
    // Près d'un sommet partagé : le rang reste valide.
    expect([1, 2]).toContain(insertIndexFor(points, [100, 0, 0]));
  });

  it('n’insère jamais avant le premier ni après le dernier point', () => {
    const points: Vec3[] = [[0, 0, 0], [100, 0, 0]];
    expect(insertIndexFor(points, [-500, 0, 0])).toBe(1);
    expect(insertIndexFor(points, [600, 0, 0])).toBe(1);
  });

  it('reste défini sur un tracé incomplet', () => {
    expect(insertIndexFor([], [0, 0, 0])).toBe(0);
    expect(insertIndexFor([[0, 0, 0]], [1, 1, 1])).toBe(1);
  });

  it('déplace, insère et retire un point', () => {
    const store = useProject.getState();
    const id = store.addWire();
    const target = { kind: 'fil' as const, id };
    store.updateWire(id, { points: [[0, 0, 0], [100, 0, 0]] });

    useProject.getState().movePoint(target, 1, [200, 0, 0]);
    expect(useProject.getState().project.wires[0]!.points[1]).toEqual([200, 0, 0]);

    useProject.getState().insertPoint(target, 1, [100, 50, 0]);
    expect(useProject.getState().project.wires[0]!.points).toEqual([[0, 0, 0], [100, 50, 0], [200, 0, 0]]);

    useProject.getState().removePoint(target, 1);
    expect(useProject.getState().project.wires[0]!.points).toEqual([[0, 0, 0], [200, 0, 0]]);
  });

  it('ignore un rang hors du tracé', () => {
    const store = useProject.getState();
    const id = store.addWire();
    const target = { kind: 'fil' as const, id };
    store.updateWire(id, { points: [[0, 0, 0], [100, 0, 0]] });

    useProject.getState().movePoint(target, 7, [9, 9, 9]);
    expect(useProject.getState().project.wires[0]!.points).toEqual([[0, 0, 0], [100, 0, 0]]);
  });
});
