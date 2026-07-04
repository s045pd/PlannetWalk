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
  questStage: 2,
  endingSeen: false,
  surveyedTowers: ['3,-1'],
  visitedChunks: ['0,0', '1,0'],
  beacons: [{ x: 10, y: 5, z: -20 }],
  vehicles: {
    rover: { x: 1, y: 2, z: 3, charge: 0.8 },
    hover: null,
  },
  raceBest: { '2,5': 48200 },
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

  it('版本过新返回 null', () => {
    const s = serializeSave({ ...sample, version: SAVE_VERSION + 1 });
    expect(deserializeSave(s)).toBeNull();
  });

  it('v1 存档迁移：核心字段保留，新字段填默认值', () => {
    const v1 = JSON.stringify({
      version: 1,
      playerWorld: { x: 5, y: 6, z: 7 },
      timeOfDay: 0.3,
      weather: 'CLEAR',
      collectedLogs: ['log-03'],
      usedSpotKeys: ['poi:1,1'],
      quality: 'high',
    });
    const d = deserializeSave(v1);
    expect(d).not.toBeNull();
    expect(d!.version).toBe(SAVE_VERSION);
    expect(d!.collectedLogs).toEqual(['log-03']);
    expect(d!.questStage).toBe(0);
    expect(d!.endingSeen).toBe(false);
    expect(d!.surveyedTowers).toEqual([]);
    expect(d!.visitedChunks).toEqual([]);
    expect(d!.beacons).toEqual([]);
    expect(d!.vehicles).toEqual({ rover: null, hover: null });
    expect(d!.raceBest).toEqual({});
  });

  it('缺字段返回 null', () => {
    expect(deserializeSave(JSON.stringify({ version: SAVE_VERSION }))).toBeNull();
  });
});
