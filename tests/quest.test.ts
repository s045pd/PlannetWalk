import { describe, it, expect } from 'vitest';
import { questTargets, QUEST_STAGES, QUEST_TEXTS } from '../src/story/quest';

const spawn = { x: -460, z: 3527 };

describe('questTargets', () => {
  it('同种子确定性', () => {
    const a = questTargets(1234, spawn);
    const b = questTargets(1234, spawn);
    expect(a).toEqual(b);
  });

  it('共 5 级且每级有配套文本', () => {
    const t = questTargets(1234, spawn);
    expect(t.length).toBe(QUEST_STAGES);
    expect(QUEST_TEXTS.length).toBe(QUEST_STAGES);
  });

  it('级间距递进且在合理范围 (0.8km–4km)', () => {
    const t = questTargets(1234, spawn);
    let prev = spawn;
    for (const p of t) {
      const d = Math.hypot(p.x - prev.x, p.z - prev.z);
      expect(d).toBeGreaterThan(800);
      expect(d).toBeLessThan(4000);
      prev = p;
    }
  });

  it('不同种子路线不同', () => {
    const a = questTargets(1, spawn);
    const b = questTargets(2, spawn);
    expect(a[0]).not.toEqual(b[0]);
  });
});
