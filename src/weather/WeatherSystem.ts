import * as THREE from 'three';
import {
  WEATHER_STATES,
  type WeatherName,
  type WeatherParams,
} from './weatherStates';
import type { Engine } from '../core/Engine';
import type { DayNight } from '../sky/DayNight';
import type { Sky } from '../sky/Sky';
import type { Terrain } from '../world/Terrain';
import { lerp } from '../world/noise';

const TRANSITION_MIN = 10;
const TRANSITION_MAX = 30;
const BASE_TINT = new THREE.Color(1, 0.96, 0.92);

function copyParams(name: WeatherName): WeatherParams {
  const s = WEATHER_STATES[name];
  return {
    fogDensity: s.fogDensity,
    tint: [...s.tint],
    windSpeed: s.windSpeed,
    rainRate: s.rainRate,
    dustRate: s.dustRate,
    ashRate: s.ashRate,
    exposureMul: s.exposureMul,
    ambientMul: s.ambientMul,
    wetness: s.wetness,
  };
}

/** 天气状态机核心（纯逻辑，不依赖 three，可单测） */
export class WeatherCore {
  current: WeatherName = 'CLEAR';
  target: WeatherName | null = null;
  transitioning = false;
  readonly params: WeatherParams = copyParams('CLEAR');
  private from: WeatherParams = copyParams('CLEAR');
  private dwellLeft: number;
  private transitionT = 0;
  private transitionDur = 1;

  constructor(private rng: () => number = Math.random) {
    const [a, b] = WEATHER_STATES.CLEAR.dwell;
    this.dwellLeft = a + this.rng() * (b - a);
  }

  forceTransition(target: WeatherName, duration?: number): void {
    this.from = { ...this.params, tint: [...this.params.tint] };
    this.target = target;
    this.transitioning = true;
    this.transitionT = 0;
    this.transitionDur =
      duration ?? TRANSITION_MIN + this.rng() * (TRANSITION_MAX - TRANSITION_MIN);
  }

  update(dt: number): void {
    if (this.transitioning && this.target) {
      this.transitionT += dt;
      const t = Math.min(1, this.transitionT / this.transitionDur);
      const to = WEATHER_STATES[this.target];
      this.params.fogDensity = lerp(this.from.fogDensity, to.fogDensity, t);
      this.params.windSpeed = lerp(this.from.windSpeed, to.windSpeed, t);
      this.params.rainRate = lerp(this.from.rainRate, to.rainRate, t);
      this.params.dustRate = lerp(this.from.dustRate, to.dustRate, t);
      this.params.ashRate = lerp(this.from.ashRate, to.ashRate, t);
      this.params.exposureMul = lerp(this.from.exposureMul, to.exposureMul, t);
      this.params.ambientMul = lerp(this.from.ambientMul, to.ambientMul, t);
      this.params.wetness = lerp(this.from.wetness, to.wetness, t);
      for (let i = 0; i < 3; i++) this.params.tint[i] = lerp(this.from.tint[i], to.tint[i], t);
      if (t >= 1) {
        this.current = this.target;
        this.target = null;
        this.transitioning = false;
        const [a, b] = WEATHER_STATES[this.current].dwell;
        this.dwellLeft = a + this.rng() * (b - a);
      }
      return;
    }

    this.dwellLeft -= dt;
    if (this.dwellLeft <= 0) this.forceTransition(this.pickNext());
  }

  private pickNext(): WeatherName {
    const trans = WEATHER_STATES[this.current].transitions;
    const entries = Object.entries(trans) as [WeatherName, number][];
    const total = entries.reduce((s, [, w]) => s + w, 0);
    let r = this.rng() * total;
    for (const [name, w] of entries) {
      r -= w;
      if (r <= 0) return name;
    }
    return entries[entries.length - 1][0];
  }
}

/** 天气系统：把状态机参数应用到雾/光照/天穹/地表/粒子 */
export class WeatherSystem {
  readonly core: WeatherCore;
  private tintColor = new THREE.Color();
  /** 风向（缓慢旋转） */
  windDir = new THREE.Vector2(1, 0);
  private windAngle = 0;

  constructor(
    private engine: Engine,
    private dayNight: DayNight,
    private sky: Sky,
    private terrain: Terrain,
    rng: () => number = Math.random,
  ) {
    this.core = new WeatherCore(rng);
  }

  get params(): WeatherParams {
    return this.core.params;
  }

  setWeather(name: WeatherName, duration = 5): void {
    this.core.forceTransition(name, duration);
    this.engine.bus.emit('weather:changed', { state: name });
  }

  update(dt: number): void {
    const wasTransitioning = this.core.transitioning;
    this.core.update(dt);
    if (wasTransitioning && !this.core.transitioning) {
      this.engine.bus.emit('weather:changed', { state: this.core.current });
    }

    const p = this.core.params;
    // 雾：密度映射到 near/far
    const fog = this.engine.scene.fog as THREE.Fog;
    fog.near = lerp(250, 8, p.fogDensity);
    fog.far = lerp(2200, 70, p.fogDensity);
    // 天气染色叠加到雾色与天穹（乘上行星大气基础暖调）
    this.tintColor.setRGB(p.tint[0], p.tint[1], p.tint[2]).multiply(BASE_TINT);
    fog.color.multiply(this.tintColor);
    this.sky.setTint(this.tintColor);
    // 光照/曝光倍率交给 DayNight
    this.dayNight.exposureMul = p.exposureMul;
    this.dayNight.ambientMul = p.ambientMul;
    // 地表湿润
    this.terrain.setWetness(p.wetness);
    // 风向缓慢游移
    this.windAngle += dt * 0.02;
    this.windDir.set(Math.cos(this.windAngle), Math.sin(this.windAngle));
  }
}
