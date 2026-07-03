import { mulberry32, smoothstep } from './noise';
import { nearestCity } from './citySites';

/** POI 选址网格（比城市 cell 密） */
export const POI_CELL = 1024;

export enum PoiKind {
  WRECK = 0,
  TOWER = 1,
  CRATER = 2,
}

export interface PoiSite {
  kind: PoiKind;
  x: number;
  z: number;
  /** 影响半径：CRATER 用作坑半径，其余用作台地半径 */
  radius: number;
  rot: number;
  cellX: number;
  cellZ: number;
}

function hashCell(seed: number, cx: number, cz: number): number {
  let h = (seed ^ 0x9e3779b9) ^ (cx * 374761393) ^ (cz * 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

/** cell 级缓存：height() 每顶点都会查询，确定性结果直接记住 */
const siteCache = new Map<string, PoiSite | null>();

export function poiSiteAt(seed: number, cellX: number, cellZ: number): PoiSite | null {
  const key = `${seed}:${cellX}:${cellZ}`;
  const hit = siteCache.get(key);
  if (hit !== undefined) return hit;
  const site = computeSite(seed, cellX, cellZ);
  siteCache.set(key, site);
  return site;
}

function computeSite(seed: number, cellX: number, cellZ: number): PoiSite | null {
  const rng = mulberry32(hashCell(seed, cellX, cellZ));
  if (rng() > 0.22) return null;
  const kindRoll = rng();
  const kind = kindRoll < 0.4 ? PoiKind.WRECK : kindRoll < 0.72 ? PoiKind.TOWER : PoiKind.CRATER;
  const radius = kind === PoiKind.CRATER ? 55 + rng() * 45 : 40 + rng() * 20;
  const margin = radius + 60;
  const range = POI_CELL - margin * 2;
  if (range <= 0) return null;
  const x = cellX * POI_CELL + margin + rng() * range;
  const z = cellZ * POI_CELL + margin + rng() * range;
  // 避开城市（含缓冲）
  const city = nearestCity(seed, x, z);
  if (city && Math.hypot(x - city.x, z - city.z) < city.radius + 150 + radius) return null;
  return { kind, x, z, radius, rot: rng() * Math.PI * 2, cellX, cellZ };
}

/** 搜索 (x,z) 周围 (2r+1)² cell 内最近 POI */
export function nearestPoi(seed: number, x: number, z: number, r = 2): PoiSite | null {
  const cx = Math.floor(x / POI_CELL);
  const cz = Math.floor(z / POI_CELL);
  let best: PoiSite | null = null;
  let bestD = Infinity;
  for (let j = -r; j <= r; j++) {
    for (let i = -r; i <= r; i++) {
      const p = poiSiteAt(seed, cx + i, cz + j);
      if (!p) continue;
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
  }
  return best;
}

/**
 * 陨坑高度修正：中心下凹、坑缘微隆起、1.4R 外归零（连续）。
 * @param dist 距坑心距离  @param radius 坑半径
 */
export function craterDepth(dist: number, radius: number): number {
  if (dist >= radius * 1.4) return 0;
  const depth = radius * 0.28;
  const bowl = -depth * (1 - smoothstep(0, radius, dist));
  const rim = depth * 0.22 * smoothstep(radius * 0.55, radius, dist) * (1 - smoothstep(radius, radius * 1.4, dist));
  return bowl + rim;
}
