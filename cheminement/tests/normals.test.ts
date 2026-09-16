import { describe, expect, it } from 'vitest';
import { generateNormals } from '../src/core/geometry/normals';

/** Cube à sommets partagés, comme dans un 3MF : 8 sommets, 12 triangles. */
function sharedCube(size = 10) {
  const h = size / 2;
  const positions = new Float32Array([
    -h, -h, -h, h, -h, -h, h, h, -h, -h, h, -h,
    -h, -h, h, h, -h, h, h, h, h, -h, h, h,
  ]);
  const indices = new Uint32Array([
    0, 3, 2, 0, 2, 1, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4,
    1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7,
  ]);
  return { positions, indices };
}

/** Cylindre à 32 facettes, axe Z, sans chapeaux. */
function tube(radius = 5, height = 20, sides = 32) {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i < sides; i += 1) {
    const angle = (i / sides) * Math.PI * 2;
    positions.push(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
    positions.push(Math.cos(angle) * radius, Math.sin(angle) * radius, height);
  }
  for (let i = 0; i < sides; i += 1) {
    const a = i * 2;
    const b = ((i + 1) % sides) * 2;
    indices.push(a, b, a + 1, b, b + 1, a + 1);
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

describe('generateNormals', () => {
  it('dédouble les sommets d’un cube : 3 familles par coin', () => {
    const { positions, indices } = sharedCube();
    const result = generateNormals(positions, indices, 35);
    expect(result.positions.length / 3).toBe(24);
    expect(result.indices.length).toBe(indices.length);
    // Chaque normale est unitaire et alignée sur un axe.
    for (let i = 0; i < result.normals.length; i += 3) {
      const n = [result.normals[i]!, result.normals[i + 1]!, result.normals[i + 2]!];
      expect(Math.hypot(...n)).toBeCloseTo(1, 5);
      expect(n.filter((c) => Math.abs(c) > 0.99)).toHaveLength(1);
    }
  });

  it('lisse un cylindre sans le facetter', () => {
    const { positions, indices } = tube();
    const result = generateNormals(positions, indices, 35);
    // Aucun dédoublement : les facettes voisines restent dans la même famille.
    expect(result.positions.length / 3).toBe(64);
    // La normale est radiale, donc perpendiculaire à l'axe du tube.
    for (let i = 0; i < result.normals.length; i += 3) {
      expect(result.normals[i + 2]!).toBeCloseTo(0, 5);
      const p = [result.positions[i]!, result.positions[i + 1]!];
      const n = [result.normals[i]!, result.normals[i + 1]!];
      const radial = (p[0]! * n[0]! + p[1]! * n[1]!) / Math.hypot(p[0]!, p[1]!);
      expect(radial).toBeCloseTo(1, 2);
    }
  });

  it('ignore les triangles dégénérés sans planter', () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0]);
    const indices = new Uint32Array([0, 1, 2]);
    expect(() => generateNormals(positions, indices)).not.toThrow();
  });
});
