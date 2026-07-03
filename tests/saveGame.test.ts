import { describe, it, expect } from 'vitest';
import { serializeSave, deserializeSave, SAVE_VERSION, type SaveData } from '../src/core/SaveGame';

const sample: SaveData = {
  version: SAVE_VERSION,
  playerWorld: { x: 100.5, y: 20.25, z: -300 },
  timeOfDay: 0.42,
  weather: 'HAZE',
  collectedLogs: ['log-01', 'log-06'],
  usedSpotKeys: ['city:0,1:0'],
  quality: 'medium',
};

describe('SaveGame', () => {
  it('序列化/反序列化 round-trip', () => {
    const s = serializeSave(sample);
    expect(typeof s).toBe('string');
    const back = deserializeSave(s);
    expect(back).toEqual(sample);
  });

  it('坏 JSON 返回 null', () => {
    expect(deserializeSave('not-json{{')).toBeNull();
  });

  it('版本不符返回 null', () => {
    const s = serializeSave({ ...sample, version: SAVE_VERSION + 1 });
    expect(deserializeSave(s)).toBeNull();
  });

  it('缺字段返回 null', () => {
    expect(deserializeSave(JSON.stringify({ version: SAVE_VERSION }))).toBeNull();
  });
});
