import { describe, expect, it } from 'vitest';
import { estimateBundleDiameter, fillRatio, packCircles } from '../src/core/harness/bundle';

function noOverlap(radii: number[], tolerance = 1e-3): boolean {
  const { circles } = packCircles(radii);
  for (let i = 0; i < circles.length; i += 1) {
    for (let j = i + 1; j < circles.length; j += 1) {
      const a = circles[i]!;
      const b = circles[j]!;
      if (Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r - tolerance) return false;
    }
  }
  return true;
}

describe('packCircles', () => {
  it('traite les cas triviaux', () => {
    expect(packCircles([]).radius).toBe(0);
    const one = packCircles([2.5]);
    expect(one.radius).toBe(2.5);
    expect(one.circles[0]).toMatchObject({ x: 0, y: 0, r: 2.5 });
  });

  it('range deux fils côte à côte', () => {
    const { circles, radius } = packCircles([1, 1]);
    expect(Math.hypot(circles[0]!.x - circles[1]!.x, circles[0]!.y - circles[1]!.y)).toBeCloseTo(2, 2);
    expect(radius).toBeCloseTo(2, 2);
  });

  it('approche l’empilement hexagonal pour 7 fils identiques', () => {
    // Un fil central, six autour : le cercle circonscrit vaut exactement 3r.
    const { radius } = packCircles(Array.from({ length: 7 }, () => 1));
    expect(radius).toBeGreaterThan(2.8);
    expect(radius).toBeLessThan(3.35);
  });

  it('ne laisse aucun recouvrement, y compris en diamètres mélangés', () => {
    expect(noOverlap([1, 1, 1, 1, 1])).toBe(true);
    expect(noOverlap([0.7, 0.95, 1.55, 1.55, 0.7, 2.25, 0.8, 0.8, 1.2])).toBe(true);
    expect(noOverlap(Array.from({ length: 40 }, (_, i) => 0.5 + (i % 5) * 0.3))).toBe(true);
  });

  it('reste déterministe (mise en cache incluse)', () => {
    const a = packCircles([1, 2, 3]);
    const b = packCircles([1, 2, 3]);
    expect(b.circles.map((c) => [c.x, c.y])).toEqual(a.circles.map((c) => [c.x, c.y]));
  });

  it('conserve l’ordre des rayons fournis', () => {
    const { circles } = packCircles([3, 1, 2]);
    expect(circles.map((c) => c.r)).toEqual([3, 1, 2]);
    expect(circles.map((c) => c.index)).toEqual([0, 1, 2]);
  });

  it('range mieux que la formule empirique sans s’en écarter absurdement', () => {
    const diameters = Array.from({ length: 12 }, () => 2);
    const packed = packCircles(diameters.map((d) => d / 2)).radius * 2;
    const estimated = estimateBundleDiameter(diameters, 1.15);
    expect(packed).toBeGreaterThan(estimated * 0.6);
    expect(packed).toBeLessThan(estimated * 1.4);
  });
});

describe('fillRatio', () => {
  it('rapporte la somme des sections à la section utile', () => {
    // Quatre fils Ø5 dans une gaine Ø10 : 4·25/100 = 1 (gaine pleine à ras bord).
    expect(fillRatio([5, 5, 5, 5], 10)).toBeCloseTo(1, 6);
    expect(fillRatio([2, 2], 10)).toBeCloseTo(0.08, 6);
    expect(fillRatio([2], 0)).toBe(0);
  });
});
