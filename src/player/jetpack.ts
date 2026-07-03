/** 喷气背包燃料模型（纯函数） */

export const JETPACK = {
  /** 每秒燃料消耗 */
  burnRate: 0.35,
  /** 每秒回充 */
  rechargeRate: 0.12,
  /** 停用后开始回充的延迟（秒） */
  rechargeDelay: 2,
  /** 竖直加速度 m/s² */
  accel: 12,
} as const;

export interface JetpackState {
  fuel: number;
  sinceUsed: number;
}

export interface JetpackResult {
  state: JetpackState;
  /** 推力系数 0/1 */
  thrust: number;
}

export function stepJetpack(state: JetpackState, thrusting: boolean, dt: number): JetpackResult {
  if (thrusting && state.fuel > 0) {
    return {
      state: { fuel: Math.max(0, state.fuel - JETPACK.burnRate * dt), sinceUsed: 0 },
      thrust: 1,
    };
  }
  const sinceUsed = state.sinceUsed + dt;
  let fuel = state.fuel;
  if (sinceUsed >= JETPACK.rechargeDelay) {
    // 仅对超过延迟的时间段回充
    const rechargeTime = Math.min(dt, sinceUsed - JETPACK.rechargeDelay);
    fuel = Math.min(1, fuel + JETPACK.rechargeRate * rechargeTime);
  }
  return { state: { fuel, sinceUsed }, thrust: 0 };
}
