/** 夜间低温模型（纯函数）：夜间露天积累，掩蔽/白天恢复。无死亡——只有结霜与减速。 */

export const COLD = {
  /** 露天夜晚积满所需秒数 */
  buildSeconds: 180,
  /** 掩蔽/白天恢复所需秒数 */
  recoverSeconds: 30,
  /** cold=1 时行走速度倍率 */
  slowMul: 0.6,
  /** HUD 警告阈值 */
  warnAt: 0.6,
} as const;

export interface ColdEnv {
  night: boolean;
  sheltered: boolean;
}

export function stepCold(cold: number, env: ColdEnv, dt: number): number {
  const delta =
    env.night && !env.sheltered ? dt / COLD.buildSeconds : -dt / COLD.recoverSeconds;
  return Math.max(0, Math.min(1, cold + delta));
}
