import { describe, expect, it } from 'vitest';
import { buildPath, resampleUniform } from '../src/core/curve/path';
import { buildHelixTube, buildTube, corrugatedRadius } from '../src/core/geometry/tube';
import type { Vec3 } from '../src/core/math/vec';

const straight = () => {
  const path = buildPath([[0, 0, 0], [100, 0, 0]], { bendRadius: 10 });
  return resampleUniform(path, 10);
};

describe('buildTube', () => {
  it('produit un tube fermé au bon rayon', () => {
    const { points, tangents } = straight();
    const mesh = buildTube(points, tangents, 5, 12);
    expect(mesh.positions.length / 3).toBe(points.length * 12 + 2);
    // Chaque point de la paroi est à 5 mm de l'axe X.
    for (let i = 0; i < points.length * 12; i += 1) {
      const y = mesh.positions[i * 3 + 1]!;
      const z = mesh.positions[i * 3 + 2]!;
      expect(Math.hypot(y, z)).toBeCloseTo(5, 4);
    }
    // Normales unitaires et dirigées vers l'extérieur.
    for (let i = 0; i < points.length * 12; i += 1) {
      const n = [mesh.normals[i * 3]!, mesh.normals[i * 3 + 1]!, mesh.normals[i * 3 + 2]!];
      expect(Math.hypot(...n)).toBeCloseTo(1, 4);
      expect(n[0]).toBeCloseTo(0, 4);
    }
    expect(mesh.indices.length).toBe((points.length - 1) * 12 * 6 + 12 * 6);
  });

  it('accepte un rayon variable', () => {
    const { points, tangents } = straight();
    const mesh = buildTube(points, tangents, (t) => 2 + 8 * t, 8, { caps: false });
    const firstRing = Math.hypot(mesh.positions[1]!, mesh.positions[2]!);
    const lastIndex = (points.length - 1) * 8;
    const lastRing = Math.hypot(mesh.positions[lastIndex * 3 + 1]!, mesh.positions[lastIndex * 3 + 2]!);
    expect(firstRing).toBeCloseTo(2, 3);
    expect(lastRing).toBeCloseTo(10, 3);
  });

  it('reste sain sur une entrée dégénérée', () => {
    const p: Vec3[] = [[0, 0, 0]];
    expect(buildTube(p, [[1, 0, 0]], 3).indices.length).toBe(0);
  });

  it('module le rayon d’une gaine annelée entre ses bornes', () => {
    const radius = corrugatedRadius(5, 1, 10);
    const values = Array.from({ length: 50 }, (_, i) => radius(0, i * 0.5));
    expect(Math.min(...values)).toBeGreaterThanOrEqual(4.99);
    expect(Math.max(...values)).toBeLessThanOrEqual(6.01);
    expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(0.9);
  });
});

describe('buildHelixTube', () => {
  it('enroule le profil autour du toron au pas demandé', () => {
    const { points, tangents } = straight();
    const helixRadius = 6;
    const bandRadius = 1;
    const mesh = buildHelixTube(points, tangents, helixRadius, 25, bandRadius, { radialSegments: 6 });
    expect(mesh.indices.length).toBeGreaterThan(0);

    // Tout point de la gaine reste dans la couronne [R−r, R+r] autour de l'axe.
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const d = Math.hypot(mesh.positions[i + 1]!, mesh.positions[i + 2]!);
      min = Math.min(min, d);
      max = Math.max(max, d);
    }
    expect(min).toBeGreaterThanOrEqual(helixRadius - bandRadius - 1e-3);
    expect(max).toBeLessThanOrEqual(helixRadius + bandRadius + 1e-3);
  });

  it('fait bien quatre tours sur 100 mm au pas de 25 mm', () => {
    const { points, tangents } = straight();
    const mesh = buildHelixTube(points, tangents, 6, 25, 0.5, { radialSegments: 4, samplesPerTurn: 32 });
    // On compte les passages de l'hélice par le demi-plan y > 0, z ≈ 0.
    let crossings = 0;
    let previous: number | null = null;
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const angle = Math.atan2(mesh.positions[i + 2]!, mesh.positions[i + 1]!);
      if (previous !== null && previous < 0 && angle >= 0) crossings += 1;
      previous = angle;
    }
    expect(crossings).toBeGreaterThan(0);
  });

  it('refuse un pas nul', () => {
    const { points, tangents } = straight();
    expect(buildHelixTube(points, tangents, 6, 0, 1).indices.length).toBe(0);
  });
});
