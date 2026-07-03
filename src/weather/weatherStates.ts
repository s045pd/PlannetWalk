/** 天气状态参数表（纯数据）：所有数值参数在过渡期内线性插值 */

export type WeatherName =
  | 'CLEAR'
  | 'HAZE'
  | 'DUST_STORM'
  | 'ACID_RAIN'
  | 'THUNDERSTORM'
  | 'ASHFALL'
  | 'FOG';

export interface WeatherParams {
  /** 雾密度 → 映射到 Fog near/far */
  fogDensity: number;
  /** 雾/天穹染色 (RGB 0-1，乘性) */
  tint: [number, number, number];
  windSpeed: number;
  rainRate: number;
  dustRate: number;
  ashRate: number;
  exposureMul: number;
  ambientMul: number;
  /** 地表湿润度 */
  wetness: number;
}

export interface WeatherState extends WeatherParams {
  /** 驻留时长范围（秒） */
  dwell: [number, number];
  /** 马尔可夫转移权重 */
  transitions: Partial<Record<WeatherName, number>>;
}

export const WEATHER_STATES: Record<WeatherName, WeatherState> = {
  CLEAR: {
    fogDensity: 0.12,
    tint: [1, 1, 1],
    windSpeed: 2,
    rainRate: 0,
    dustRate: 0.05,
    ashRate: 0,
    exposureMul: 1,
    ambientMul: 1,
    wetness: 0,
    dwell: [90, 200],
    transitions: { HAZE: 4, ASHFALL: 2, FOG: 1.5, ACID_RAIN: 1.5, CLEAR: 2 },
  },
  HAZE: {
    fogDensity: 0.35,
    tint: [1, 0.92, 0.8],
    windSpeed: 6,
    rainRate: 0,
    dustRate: 0.4,
    ashRate: 0,
    exposureMul: 0.95,
    ambientMul: 0.9,
    wetness: 0,
    dwell: [60, 140],
    transitions: { CLEAR: 3, DUST_STORM: 3, ASHFALL: 1, FOG: 1 },
  },
  DUST_STORM: {
    fogDensity: 0.93,
    tint: [1, 0.62, 0.32],
    windSpeed: 18,
    rainRate: 0,
    dustRate: 1,
    ashRate: 0,
    exposureMul: 0.75,
    ambientMul: 0.65,
    wetness: 0,
    dwell: [50, 110],
    transitions: { HAZE: 4, CLEAR: 1 },
  },
  ACID_RAIN: {
    fogDensity: 0.5,
    tint: [0.72, 0.82, 0.78],
    windSpeed: 8,
    rainRate: 0.7,
    dustRate: 0,
    ashRate: 0,
    exposureMul: 0.8,
    ambientMul: 0.75,
    wetness: 1,
    dwell: [60, 140],
    transitions: { THUNDERSTORM: 3, CLEAR: 2, FOG: 1.5 },
  },
  THUNDERSTORM: {
    fogDensity: 0.65,
    tint: [0.55, 0.62, 0.66],
    windSpeed: 14,
    rainRate: 1,
    dustRate: 0,
    ashRate: 0,
    exposureMul: 0.65,
    ambientMul: 0.55,
    wetness: 1,
    dwell: [45, 100],
    transitions: { ACID_RAIN: 3, CLEAR: 1.5, FOG: 1 },
  },
  ASHFALL: {
    fogDensity: 0.45,
    tint: [0.85, 0.82, 0.8],
    windSpeed: 3,
    rainRate: 0,
    dustRate: 0,
    ashRate: 1,
    exposureMul: 0.85,
    ambientMul: 0.8,
    wetness: 0,
    dwell: [70, 160],
    transitions: { CLEAR: 3, HAZE: 1.5, FOG: 1 },
  },
  FOG: {
    fogDensity: 0.88,
    tint: [0.88, 0.9, 0.92],
    windSpeed: 1,
    rainRate: 0,
    dustRate: 0,
    ashRate: 0,
    exposureMul: 0.85,
    ambientMul: 0.85,
    wetness: 0.3,
    dwell: [50, 120],
    transitions: { CLEAR: 3, HAZE: 1.5, ACID_RAIN: 1 },
  },
};
