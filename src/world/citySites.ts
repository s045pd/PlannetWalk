import { mulberry32 } from './noise';

/** 城市选址哈希网格：每 CITY_CELL 米一个 cell，按种子确定性判定是否有城市 */
export const CITY_CELL = 2048;

export interface CitySite {
  x: number;
  z: number;
  radius: number;
  rot: number;
  cellX: number;
  cellZ: number;
}

function hashCell(seed: number, cx: number, cz: number): number {
  let h = seed ^ (cx * 374761393) ^ (cz * 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

export function citySiteAt(seed: number, cellX: number, cellZ: number): CitySite | null {
  const rng = mulberry32(hashCell(seed, cellX, cellZ));
  if (rng() > 0.35) return null;
  const radius = 250 + rng() * 250;
  const margin = radius + 100;
  const range = CITY_CELL - margin * 2;
  if (range <= 0) return null;
  return {
    x: cellX * CITY_CELL + margin + rng() * range,
    z: cellZ * CITY_CELL + margin + rng() * range,
    radius,
    rot: rng() * Math.PI * 2,
    cellX,
    cellZ,
  };
}

/** 查询 (x,z) 附近 3x3 cell 内最近的城市站点 */
export function nearestCity(seed: number, x: number, z: number): CitySite | null {
  const cx = Math.floor(x / CITY_CELL);
  const cz = Math.floor(z / CITY_CELL);
  let best: CitySite | null = null;
  let bestD = Infinity;
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      const site = citySiteAt(seed, cx + i, cz + j);
      if (!site) continue;
      const d = Math.hypot(x - site.x, z - site.z);
      if (d < bestD) {
        bestD = d;
        best = site;
      }
    }
  }
  return best;
}
