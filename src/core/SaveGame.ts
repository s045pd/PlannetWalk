/** 存档：序列化/反序列化为纯函数（可测），localStorage 读写为薄壳。v2 起承载玩法进度，兼容 v1 迁移。 */

export const SAVE_VERSION = 2;
export const SAVE_KEY = 'planet-walk-save-v1';

export interface VehicleSave {
  x: number;
  y: number;
  z: number;
  charge: number;
}

export interface SaveData {
  version: number;
  /** 玩家真实世界坐标 */
  playerWorld: { x: number; y: number; z: number };
  timeOfDay: number;
  weather: string;
  collectedLogs: string[];
  usedSpotKeys: string[];
  quality: 'low' | 'medium' | 'high';
  /** 信号主线进度（已完成的级数） */
  questStage: number;
  endingSeen: boolean;
  /** 已测绘的信标塔（POI cell key） */
  surveyedTowers: string[];
  /** 到访过的地形 chunk key（裁剪上限见 MAX_VISITED） */
  visitedChunks: string[];
  /** 个人信标（世界坐标） */
  beacons: { x: number; y: number; z: number }[];
  vehicles: { rover: VehicleSave | null; hover: VehicleSave | null };
  /** 光环试炼最佳成绩 ms（按 POI cell key） */
  raceBest: Record<string, number>;
}

export const MAX_VISITED = 6000;

const V2_DEFAULTS = {
  questStage: 0,
  endingSeen: false,
  surveyedTowers: [] as string[],
  visitedChunks: [] as string[],
  beacons: [] as { x: number; y: number; z: number }[],
  vehicles: { rover: null, hover: null } as SaveData['vehicles'],
  raceBest: {} as Record<string, number>,
};

export function serializeSave(data: SaveData): string {
  return JSON.stringify(data);
}

function isVehicleSave(v: unknown): v is VehicleSave | null {
  if (v === null) return true;
  const o = v as Partial<VehicleSave>;
  return (
    typeof o === 'object' &&
    typeof o.x === 'number' &&
    typeof o.y === 'number' &&
    typeof o.z === 'number' &&
    typeof o.charge === 'number'
  );
}

export function deserializeSave(raw: string): SaveData | null {
  try {
    const d = JSON.parse(raw) as Partial<SaveData>;
    if (typeof d.version !== 'number' || d.version < 1 || d.version > SAVE_VERSION) return null;
    // 核心字段（v1 起就有）
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
    // v1 → v2 迁移：新字段填默认；v2 自身缺字段同样容错回默认
    const out: SaveData = {
      version: SAVE_VERSION,
      playerWorld: d.playerWorld as SaveData['playerWorld'],
      timeOfDay: d.timeOfDay,
      weather: d.weather,
      collectedLogs: d.collectedLogs,
      usedSpotKeys: d.usedSpotKeys,
      quality: d.quality,
      questStage: typeof d.questStage === 'number' ? d.questStage : V2_DEFAULTS.questStage,
      endingSeen: typeof d.endingSeen === 'boolean' ? d.endingSeen : V2_DEFAULTS.endingSeen,
      surveyedTowers: Array.isArray(d.surveyedTowers)
        ? d.surveyedTowers
        : [...V2_DEFAULTS.surveyedTowers],
      visitedChunks: Array.isArray(d.visitedChunks)
        ? d.visitedChunks
        : [...V2_DEFAULTS.visitedChunks],
      beacons: Array.isArray(d.beacons) ? d.beacons : [...V2_DEFAULTS.beacons],
      vehicles:
        d.vehicles && isVehicleSave(d.vehicles.rover) && isVehicleSave(d.vehicles.hover)
          ? { rover: d.vehicles.rover, hover: d.vehicles.hover }
          : { ...V2_DEFAULTS.vehicles },
      raceBest:
        d.raceBest && typeof d.raceBest === 'object' && !Array.isArray(d.raceBest)
          ? (d.raceBest as Record<string, number>)
          : { ...V2_DEFAULTS.raceBest },
    };
    return out;
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
