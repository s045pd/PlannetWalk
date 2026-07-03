import { describe, it, expect } from 'vitest';
import { stepJetpack, JETPACK } from '../src/player/jetpack';

describe('jetpack', () => {
  const full = { fuel: 1, sinceUsed: 99 };

  it('喷射消耗燃料且输出推力', () => {
    const r = stepJetpack(full, true, 1);
    expect(r.state.fuel).toBeCloseTo(1 - JETPACK.burnRate);
    expect(r.thrust).toBeGreaterThan(0);
  });

  it('燃料耗尽无推力', () => {
    const r = stepJetpack({ fuel: 0, sinceUsed: 0 }, true, 0.016);
    expect(r.thrust).toBe(0);
  });

  it('停用超过延迟后回充，且不超上限', () => {
    const r = stepJetpack({ fuel: 0.5, sinceUsed: JETPACK.rechargeDelay + 1 }, false, 1);
    expect(r.state.fuel).toBeCloseTo(Math.min(1, 0.5 + JETPACK.rechargeRate));
    expect(stepJetpack(full, false, 10).state.fuel).toBe(1);
  });

  it('延迟期内不回充', () => {
    const r = stepJetpack({ fuel: 0.5, sinceUsed: 0 }, false, 0.5);
    expect(r.state.fuel).toBe(0.5);
  });
});
