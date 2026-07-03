import { describe, it, expect } from 'vitest';
import { computeShift, THRESHOLD } from '../src/world/FloatingOrigin';

describe('computeShift', () => {
  it('阈值内不回移', () => {
    expect(computeShift({ x: 100, z: -200 })).toBeNull();
  });

  it('超阈值时返回对齐 CHUNK 的回移量，使新位置落回阈值内', () => {
    const s = computeShift({ x: THRESHOLD + 300, z: 0 })!;
    expect(s.x % 128).toBe(0);
    expect(Math.abs(THRESHOLD + 300 - s.x)).toBeLessThan(THRESHOLD);
  });

  it('负方向同样回移', () => {
    const s = computeShift({ x: 0, z: -(THRESHOLD + 500) })!;
    expect(Math.abs(s.z % 128)).toBe(0);
    expect(Math.abs(-(THRESHOLD + 500) - s.z)).toBeLessThan(THRESHOLD);
  });
});
