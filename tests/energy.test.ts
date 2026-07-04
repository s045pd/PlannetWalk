import { describe, it, expect } from 'vitest';
import { stepEnergy, ENERGY } from '../src/vehicles/energy';

describe('stepEnergy', () => {
  it('油门耗电', () => {
    const c = stepEnergy(1, 1, -0.5, 1);
    expect(c).toBeCloseTo(1 - ENERGY.drainRate);
  });

  it('白天停车太阳能回充，随太阳高度缩放', () => {
    const noon = stepEnergy(0.5, 0, 0.9, 1);
    const morning = stepEnergy(0.5, 0, 0.2, 1);
    expect(noon).toBeGreaterThan(morning);
    expect(morning).toBeGreaterThan(0.5);
  });

  it('夜间不回充', () => {
    expect(stepEnergy(0.5, 0, -0.3, 10)).toBe(0.5);
  });

  it('边界钳制 [0,1]', () => {
    expect(stepEnergy(0.01, 1, -0.5, 60)).toBe(0);
    expect(stepEnergy(0.99, 0, 1, 600)).toBe(1);
  });

  it('边充边耗：净值为差', () => {
    const c = stepEnergy(0.5, 0.5, 0.9, 1);
    const expected = 0.5 - ENERGY.drainRate * 0.5 + ENERGY.solarRate * 0.9;
    expect(c).toBeCloseTo(Math.min(1, expected));
  });
});
