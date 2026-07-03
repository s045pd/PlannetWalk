import { createNoise2D, fbm2, ridged2, smoothstep, lerp } from './noise';
import { nearestCity } from './citySites';

/** 生物群系：尘漠 / 碎岩原 / 玻璃化熔壳 / 灰烬平原 */
export enum Biome {
  DUST = 0,
  ROCK = 1,
  GLASS = 2,
  ASH = 3,
}

export interface Heightfield {
  seed: number;
  height(x: number, z: number): number;
  biome(x: number, z: number): Biome;
  /** 四生物群系权重（用于地表材质 splat 混合） */
  biomeWeights(x: number, z: number, out: Float32Array, offset: number): void;
}

export function createHeightfield(seed: number): Heightfield {
  const n1 = createNoise2D(seed);
  const n2 = createNoise2D(seed + 1);
  const n3 = createNoise2D(seed + 2);

  function mountainMask(x: number, z: number): number {
    return Math.max(0, fbm2(n1, x * 0.00015 + 90, z * 0.00015 + 90, 3));
  }

  function rawHeight(x: number, z: number): number {
    const wx = x + 180 * n2(x * 0.0011, z * 0.0011);
    const wz = z + 180 * n2(x * 0.0011 + 50, z * 0.0011 + 50);
    const continent = 24 * fbm2(n1, wx * 0.0004, wz * 0.0004, 4);
    const mMask = mountainMask(x, z);
    const mountains = 220 * mMask * Math.pow(ridged2(n2, wx * 0.0016, wz * 0.0016, 5), 2);
    const detail = 2.5 * fbm2(n3, x * 0.02, z * 0.02, 3);
    return continent + mountains + detail;
  }

  function height(x: number, z: number): number {
    const h = rawHeight(x, z);
    const city = nearestCity(seed, x, z);
    if (!city) return h;
    const d = Math.hypot(x - city.x, z - city.z);
    if (d >= city.radius) return h;
    const plateau = rawHeight(city.x, city.z);
    const t = smoothstep(city.radius, city.radius * 0.6, d); // 中心 t=1
    return lerp(h, plateau, t);
  }

  /** 双通道低频噪声划分四象限；GLASS 只出现在平缓区（mMask 低） */
  function biomeChannels(x: number, z: number): { a: number; b: number } {
    return {
      a: fbm2(n3, x * 0.00025 + 300, z * 0.00025 + 300, 2),
      b: fbm2(n3, x * 0.00025 - 300, z * 0.00025 - 300, 2),
    };
  }

  function biome(x: number, z: number): Biome {
    const { a, b } = biomeChannels(x, z);
    if (a >= 0) return b >= 0 ? Biome.DUST : Biome.ROCK;
    if (b >= 0) return Biome.ASH;
    return mountainMask(x, z) < 0.25 ? Biome.GLASS : Biome.ROCK;
  }

  function biomeWeights(x: number, z: number, out: Float32Array, offset: number): void {
    const { a, b } = biomeChannels(x, z);
    // 平滑权重：远离 0 边界时趋向纯生物群系
    const wa = smoothstep(-0.15, 0.15, a);
    const wb = smoothstep(-0.15, 0.15, b);
    const glassOk = 1 - smoothstep(0.15, 0.35, mountainMask(x, z));
    const dust = wa * wb;
    const rock = wa * (1 - wb);
    const ash = (1 - wa) * wb;
    let glass = (1 - wa) * (1 - wb) * glassOk;
    const rockExtra = (1 - wa) * (1 - wb) * (1 - glassOk);
    const total = dust + rock + ash + glass + rockExtra;
    out[offset] = dust / total;
    out[offset + 1] = (rock + rockExtra) / total;
    out[offset + 2] = glass / total;
    out[offset + 3] = ash / total;
  }

  return { seed, height, biome, biomeWeights };
}
