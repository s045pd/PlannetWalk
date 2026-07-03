import { describe, it, expect } from 'vitest';
import { poiSiteAt, nearestPoi, POI_CELL, PoiKind, craterDepth } from '../src/world/poi';
import { nearestCity } from '../src/world/citySites';

const SEED = 1234;

describe('poi', () => {
  it('选址同种子确定性', () => {
    for (let i = -10; i < 10; i++) {
      const a = poiSiteAt(SEED, i, -i * 2);
      const b = poiSiteAt(SEED, i, -i * 2);
      expect(a).toEqual(b);
    }
  });

  it('存在三种类型且都能被找到', () => {
    const kinds = new Set<PoiKind>();
    for (let cx = -40; cx <= 40; cx++)
      for (let cz = -40; cz <= 40; cz++) {
        const p = poiSiteAt(SEED, cx, cz);
        if (p) kinds.add(p.kind);
      }
    expect(kinds.size).toBe(3);
  });

  it('POI 与城市保持距离', () => {
    for (let cx = -30; cx <= 30; cx++)
      for (let cz = -30; cz <= 30; cz++) {
        const p = poiSiteAt(SEED, cx, cz);
        if (!p) continue;
        const city = nearestCity(SEED, p.x, p.z);
        if (city) {
          expect(Math.hypot(p.x - city.x, p.z - city.z)).toBeGreaterThan(city.radius + 150);
        }
      }
  });

  it('nearestPoi 返回搜索范围内最近站点', () => {
    let any = null;
    for (let cx = -10; cx <= 10 && !any; cx++)
      for (let cz = -10; cz <= 10 && !any; cz++) any = poiSiteAt(SEED, cx, cz);
    expect(any).not.toBeNull();
    const found = nearestPoi(SEED, any!.x + 50, any!.z + 50, 2);
    expect(found).not.toBeNull();
    expect(found!.x).toBe(any!.x);
  });

  it('陨坑深度函数连续且中心最深、坑缘外为零', () => {
    const r = 80;
    const center = craterDepth(0, r);
    expect(center).toBeLessThan(0);
    expect(craterDepth(r * 1.4, r)).toBe(0);
    // 单调采样无跳变
    let prev = center;
    for (let d = 0; d <= r * 1.4; d += 2) {
      const v = craterDepth(d, r);
      expect(Math.abs(v - prev)).toBeLessThan(6);
      prev = v;
    }
  });

  it('POI cell 尺寸小于城市 cell（密度更高）', () => {
    expect(POI_CELL).toBeLessThan(2048);
  });
});
