import { describe, it, expect } from 'vitest';
import { advanceFixed } from '../src/core/fixedStep';

describe('advanceFixed', () => {
  it('累积不足一步时不步进', () => {
    expect(advanceFixed(0, 0.008, 1 / 60)).toEqual({
      steps: 0,
      acc: 0.008,
      alpha: 0.008 / (1 / 60),
    });
  });

  it('累积超过一步时步进并保留余量', () => {
    const r = advanceFixed(0.01, 0.02, 1 / 60);
    expect(r.steps).toBe(1);
    expect(r.acc).toBeCloseTo(0.03 - 1 / 60);
  });

  it('单帧耗时过长时限制最大步数防螺旋', () => {
    expect(advanceFixed(0, 1.0, 1 / 60).steps).toBeLessThanOrEqual(5);
  });
});
