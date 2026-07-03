import { describe, it, expect } from 'vitest';
import { WeatherCore } from '../src/weather/WeatherSystem';
import { WEATHER_STATES } from '../src/weather/weatherStates';

describe('WeatherCore', () => {
  it('初始为 CLEAR 且参数等于状态表', () => {
    const w = new WeatherCore(() => 0.5);
    expect(w.current).toBe('CLEAR');
    expect(w.params.fogDensity).toBe(WEATHER_STATES.CLEAR.fogDensity);
  });

  it('强制切换时参数在过渡期内插值', () => {
    const w = new WeatherCore(() => 0.5);
    w.forceTransition('DUST_STORM', 10);
    w.update(5);
    const a = WEATHER_STATES.CLEAR.fogDensity;
    const b = WEATHER_STATES.DUST_STORM.fogDensity;
    expect(w.params.fogDensity).toBeGreaterThan(Math.min(a, b));
    expect(w.params.fogDensity).toBeLessThan(Math.max(a, b));
    w.update(6);
    expect(w.params.fogDensity).toBeCloseTo(b);
    expect(w.current).toBe('DUST_STORM');
  });

  it('驻留结束后按转移矩阵选合法下一状态并进入过渡', () => {
    const w = new WeatherCore(() => 0.01);
    w.update(WEATHER_STATES.CLEAR.dwell[1] + 1);
    expect(w.transitioning).toBe(true);
    expect(Object.keys(WEATHER_STATES)).toContain(w.target!);
  });

  it('所有状态的转移目标都是合法状态', () => {
    for (const [name, st] of Object.entries(WEATHER_STATES)) {
      for (const target of Object.keys(st.transitions)) {
        expect(Object.keys(WEATHER_STATES), `${name} -> ${target}`).toContain(target);
      }
    }
  });
});
