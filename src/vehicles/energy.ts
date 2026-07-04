/** 载具能量模型（纯函数）：油门耗电、白天太阳能回充、夜间不充 */

export const ENERGY = {
  /** 满油门每秒耗电（满电 ≈ 4 分钟持续驾驶；正午边开边充 ≈ 7 分钟） */
  drainRate: 1 / 240,
  /** 天顶太阳每秒回充（正午停车 ≈ 7 分钟回满）——刻意低于耗电，白天驾驶仍净耗 */
  solarRate: 1 / 420,
} as const;

/**
 * @param charge 当前电量 0..1
 * @param throttle 油门 0..1（召回自动驾驶同样计入）
 * @param sunElevation 太阳高度 -1..1（<=0 夜间）
 */
export function stepEnergy(
  charge: number,
  throttle: number,
  sunElevation: number,
  dt: number,
): number {
  let c = charge - ENERGY.drainRate * Math.max(0, Math.min(1, throttle)) * dt;
  if (sunElevation > 0) c += ENERGY.solarRate * Math.min(1, sunElevation) * dt;
  return Math.max(0, Math.min(1, c));
}
