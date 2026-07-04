import { describe, it, expect } from 'vitest';
import { stepCold, COLD } from '../src/player/cold';

describe('stepCold', () => {
  it('夜间露天积累低温', () => {
    const c = stepCold(0, { night: true, sheltered: false }, 10);
    expect(c).toBeCloseTo(10 / COLD.buildSeconds);
  });

  it('掩蔽中恢复', () => {
    const c = stepCold(0.5, { night: true, sheltered: true }, 5);
    expect(c).toBeCloseTo(0.5 - 5 / COLD.recoverSeconds);
  });

  it('白天恢复（即使露天）', () => {
    const c = stepCold(0.5, { night: false, sheltered: false }, 5);
    expect(c).toBeLessThan(0.5);
  });

  it('边界钳制 [0,1]', () => {
    expect(stepCold(0.99, { night: true, sheltered: false }, 600)).toBe(1);
    expect(stepCold(0.01, { night: false, sheltered: true }, 600)).toBe(0);
  });
});
