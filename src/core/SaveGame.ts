/** 存档：序列化/反序列化为纯函数（可测），localStorage 读写为薄壳 */

export const SAVE_VERSION = 1;
export const SAVE_KEY = 'planet-walk-save-v1';

export interface SaveData {
  version: number;
  /** 玩家真实世界坐标 */
  playerWorld: { x: number; y: number; z: number };
  timeOfDay: number;
  weather: string;
  collectedLogs: string[];
  usedSpotKeys: string[];
  quality: 'low' | 'medium' | 'high';
}

export function serializeSave(data: SaveData): string {
  return JSON.stringify(data);
}

export function deserializeSave(raw: string): SaveData | null {
  try {
    const d = JSON.parse(raw) as Partial<SaveData>;
    if (d.version !== SAVE_VERSION) return null;
    if (
      !d.playerWorld ||
      typeof d.playerWorld.x !== 'number' ||
      typeof d.playerWorld.y !== 'number' ||
      typeof d.playerWorld.z !== 'number' ||
      typeof d.timeOfDay !== 'number' ||
      typeof d.weather !== 'string' ||
      !Array.isArray(d.collectedLogs) ||
      !Array.isArray(d.usedSpotKeys) ||
      (d.quality !== 'low' && d.quality !== 'medium' && d.quality !== 'high')
    ) {
      return null;
    }
    return d as SaveData;
  } catch {
    return null;
  }
}

export function loadSave(): SaveData | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? deserializeSave(raw) : null;
  } catch {
    return null;
  }
}

export function writeSave(data: SaveData): void {
  try {
    localStorage.setItem(SAVE_KEY, serializeSave(data));
  } catch {
    // 存储满/隐私模式：静默失败，不影响游戏
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* noop */
  }
}
