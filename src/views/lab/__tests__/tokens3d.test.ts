import { describe, expect, it } from 'vitest';
import { labFov } from '../tokens3d';

describe('labFov', () => {
  it('zostawia bazowe FOV dla poziomej ramki', () => {
    expect(labFov(16 / 9)).toBe(42);
    expect(labFov(1.25)).toBe(42);
  });

  it('poszerza FOV w pionowej ramce, zachowując poziomy kadr', () => {
    const aspect = 0.7;
    const fov = labFov(aspect);
    const hHalf = (deg: number, a: number) => Math.atan(Math.tan((deg * Math.PI) / 360) * a);
    // Poziomy półkąt w pionie ≈ poziomy półkąt ramki projektowej (1.25)
    expect(hHalf(fov, aspect)).toBeCloseTo(hHalf(42, 1.25), 5);
    expect(fov).toBeGreaterThan(42);
  });

  it('ogranicza FOV do 80° i odrzuca błędne proporcje', () => {
    expect(labFov(0.1)).toBe(80);
    expect(labFov(0)).toBe(42);
    expect(labFov(Number.NaN)).toBe(42);
  });
});
