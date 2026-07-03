import { describe, it, expect } from 'vitest';
import { createHeightfield, Biome } from '../src/world/heightfield';
import { citySiteAt } from '../src/world/citySites';

const hf = createHeightfield(1234);

describe('heightfield', () => {
  it('确定性', () => {
    const hf2 = createHeightfield(1234);
    expect(hf.height(100.5, -200.25)).toBe(hf2.height(100.5, -200.25));
  });

  it('连续性：相邻 1m 采样高差有限', () => {
    for (let i = 0; i < 200; i++) {
      const x = i * 37.7;
      const z = i * 91.3;
      expect(Math.abs(hf.height(x, z) - hf.height(x + 1, z))).toBeLessThan(8);
    }
  });

  it('生物群系返回合法枚举', () => {
    const valid = Object.values(Biome).filter((v) => typeof v === 'number');
    for (let i = 0; i < 100; i++) {
      expect(valid).toContain(hf.biome(i * 503.1, i * 977.7));
    }
  });

  it('城市中心区域被压平（台地）', () => {
    let site: { x: number; z: number; radius: number } | null = null;
    for (let cx = -20; cx < 20 && !site; cx++)
      for (let cz = -20; cz < 20 && !site; cz++) site = citySiteAt(1234, cx, cz);
    expect(site).not.toBeNull();
    const c = hf.height(site!.x, site!.z);
    for (const [dx, dz] of [
      [30, 0],
      [0, 30],
      [-30, -30],
      [50, 20],
    ]) {
      expect(Math.abs(hf.height(site!.x + dx, site!.z + dz) - c)).toBeLessThan(2);
    }
  });
});
