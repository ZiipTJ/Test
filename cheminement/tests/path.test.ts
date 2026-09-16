import { describe, expect, it } from 'vitest';
import { buildPath, polylineLength, resampleUniform, sampleAtStation, parallelFrames } from '../src/core/curve/path';
import { dot, length as vlen, type Vec3 } from '../src/core/math/vec';

describe('buildPath', () => {
  it('conserve la longueur d’un tracé rectiligne', () => {
    const path = buildPath([[0, 0, 0], [100, 0, 0]], { bendRadius: 20 });
    expect(path.length).toBeCloseTo(100, 6);
    expect(path.corners).toHaveLength(0);
    expect(path.minRadius).toBe(Infinity);
  });

  it('raccorde un angle droit par un arc tangent et raccourcit le tracé d’autant', () => {
    const R = 20;
    const path = buildPath([[0, 0, 0], [100, 0, 0], [100, 100, 0]], { bendRadius: R, tolerance: 0.01 });
    // Deux brins de 100 amputés de R, plus le quart de cercle.
    const expected = 2 * (100 - R) + (Math.PI / 2) * R;
    expect(path.length).toBeCloseTo(expected, 1);
    expect(path.corners).toHaveLength(1);
    expect(path.corners[0]!.radius).toBeCloseTo(R, 6);
    expect(path.corners[0]!.turnAngle).toBeCloseTo(Math.PI / 2, 6);
    expect(path.corners[0]!.clamped).toBe(false);
    // Le tracé raccordé est plus court que la polyligne à angle vif.
    expect(path.length).toBeLessThan(polylineLength([[0, 0, 0], [100, 0, 0], [100, 100, 0]]));
  });

  it('réduit le rayon quand les brins adjacents sont trop courts', () => {
    const path = buildPath([[0, 0, 0], [10, 0, 0], [10, 10, 0]], { bendRadius: 40, tolerance: 0.01 });
    const corner = path.corners[0]!;
    expect(corner.clamped).toBe(true);
    expect(corner.radius).toBeLessThan(40);
    expect(corner.radius).toBeGreaterThan(0);
  });

  it('respecte la flèche demandée sur l’arc', () => {
    const R = 50;
    const tolerance = 0.05;
    const path = buildPath([[0, 0, 0], [200, 0, 0], [200, 200, 0]], { bendRadius: R, tolerance });
    const exact = 2 * (200 - R) + (Math.PI / 2) * R;
    // La corde sous-estime l'arc, mais d'au plus la flèche cumulée.
    expect(exact - path.length).toBeGreaterThanOrEqual(0);
    expect(exact - path.length).toBeLessThan(0.5);
  });

  it('reste stable sur une entrée dégénérée', () => {
    const path = buildPath([[5, 5, 5]], { bendRadius: 10 });
    expect(path.points.length).toBeGreaterThanOrEqual(2);
    expect(path.length).toBe(0);
  });
});

describe('échantillonnage', () => {
  it('sampleAtStation retombe sur les extrémités', () => {
    const path = buildPath([[0, 0, 0], [100, 0, 0], [100, 50, 0]], { bendRadius: 10 });
    const start = sampleAtStation(path, 0);
    const end = sampleAtStation(path, path.length);
    expect(start.point[0]).toBeCloseTo(0, 6);
    expect(end.point[1]).toBeCloseTo(50, 6);
  });

  it('resampleUniform produit un pas régulier', () => {
    const path = buildPath([[0, 0, 0], [100, 0, 0]], { bendRadius: 10 });
    const { stations } = resampleUniform(path, 10);
    for (let i = 1; i < stations.length; i += 1) {
      expect(stations[i]! - stations[i - 1]!).toBeCloseTo(stations[1]! - stations[0]!, 6);
    }
  });
});

describe('parallelFrames', () => {
  it('produit des repères orthonormés et sans vrillage parasite', () => {
    const path = buildPath([[0, 0, 0], [200, 0, 0], [200, 200, 0], [200, 200, 200]], { bendRadius: 30 });
    const frames = parallelFrames(path.points, path.tangents);
    expect(frames).toHaveLength(path.points.length);
    for (const frame of frames) {
      expect(vlen(frame.u)).toBeCloseTo(1, 5);
      expect(vlen(frame.v)).toBeCloseTo(1, 5);
      expect(dot(frame.u, frame.t)).toBeCloseTo(0, 5);
      expect(dot(frame.u, frame.v)).toBeCloseTo(0, 5);
    }
    // Sur une portion droite, le repère ne doit pas tourner.
    const straight: Vec3[] = [[0, 0, 0], [10, 0, 0], [20, 0, 0], [30, 0, 0]];
    const tangents: Vec3[] = straight.map(() => [1, 0, 0] as Vec3);
    const flat = parallelFrames(straight, tangents);
    expect(dot(flat[0]!.u, flat[3]!.u)).toBeCloseTo(1, 6);
  });
});
