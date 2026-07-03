import { describe, it, expect } from 'vitest';
import { createNoise2D, fbm2, ridged2 } from '../src/world/noise';

describe('noise', () => {
  it('同种子确定性', () => {
    const a = createNoise2D(42);
    const b = createNoise2D(42);
    expect(a(1.5, 2.5)).toBe(b(1.5, 2.5));
  });

  it('不同种子结果不同', () => {
    expect(createNoise2D(1)(3.3, 4.4)).not.toBe(createNoise2D(2)(3.3, 4.4));
  });

  it('值域在 [-1,1]', () => {
    const n = createNoise2D(7);
    for (let i = 0; i < 500; i++) {
      const v = n(i * 0.173, i * 0.317);
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('fbm/ridged 值域合理', () => {
    const n = createNoise2D(7);
    for (let i = 0; i < 200; i++) {
      expect(Math.abs(fbm2(n, i * 0.11, i * 0.07, 5))).toBeLessThanOrEqual(1);
      const r = ridged2(n, i * 0.11, i * 0.07, 4);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(1);
    }
  });
});
