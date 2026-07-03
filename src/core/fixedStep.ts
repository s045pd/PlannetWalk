export interface FixedStepResult {
  steps: number;
  acc: number;
  alpha: number;
}

export const MAX_STEPS = 5;

/** 固定步长累加器：返回本帧应执行的物理步数、剩余累积量与插值系数 */
export function advanceFixed(acc: number, dt: number, h: number): FixedStepResult {
  let a = acc + dt;
  let steps = 0;
  while (a >= h && steps < MAX_STEPS) {
    a -= h;
    steps++;
  }
  if (steps === MAX_STEPS) a = 0; // 丢弃积压，避免死亡螺旋
  return { steps, acc: a, alpha: a / h };
}
