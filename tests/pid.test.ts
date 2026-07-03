import { describe, it, expect } from 'vitest';
import { createPid } from '../src/vehicles/pid';

describe('pid', () => {
  it('对一阶系统收敛到目标', () => {
    const pid = createPid({ kp: 8, ki: 2, kd: 4, iMax: 5 });
    let pos = 0;
    let vel = 0;
    for (let i = 0; i < 600; i++) {
      const f = pid.update(10 - pos, 1 / 60);
      vel += (f - vel * 0.5) * (1 / 60);
      pos += vel * (1 / 60);
    }
    expect(pos).toBeCloseTo(10, 0);
  });

  it('积分限幅防 windup', () => {
    const pid = createPid({ kp: 0, ki: 1, kd: 0, iMax: 2 });
    for (let i = 0; i < 1000; i++) pid.update(100, 1 / 60);
    expect(Math.abs(pid.update(100, 1 / 60))).toBeLessThanOrEqual(2);
  });

  it('reset 清零积分', () => {
    const pid = createPid({ kp: 0, ki: 1, kd: 0, iMax: 2 });
    pid.update(100, 1);
    pid.reset();
    expect(pid.update(0, 1 / 60)).toBe(0);
  });
});
