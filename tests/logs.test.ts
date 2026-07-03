import { describe, it, expect } from 'vitest';
import { LOGS, pickLogForSite, addCollected } from '../src/story/logs';

describe('logs', () => {
  it('日志库至少 16 条且 id 唯一', () => {
    expect(LOGS.length).toBeGreaterThanOrEqual(16);
    expect(new Set(LOGS.map((l) => l.id)).size).toBe(LOGS.length);
  });

  it('pickLogForSite 同种子确定性且索引在界内', () => {
    for (let i = 0; i < 50; i++) {
      const a = pickLogForSite(1234, i * 7, -i * 3, i % 3);
      const b = pickLogForSite(1234, i * 7, -i * 3, i % 3);
      expect(a).toBe(b);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(LOGS.length);
    }
  });

  it('同一站点不同槽位倾向给出不同日志', () => {
    const a = pickLogForSite(1234, 5, 5, 0);
    const b = pickLogForSite(1234, 5, 5, 1);
    expect(a).not.toBe(b);
  });

  it('addCollected 去重且不可变', () => {
    const s0 = new Set<string>();
    const s1 = addCollected(s0, 'log-01');
    const s2 = addCollected(s1, 'log-01');
    expect(s0.size).toBe(0);
    expect(s1.has('log-01')).toBe(true);
    expect(s2.size).toBe(1);
  });
});
