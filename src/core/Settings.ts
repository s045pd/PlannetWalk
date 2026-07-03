import * as THREE from 'three';
import type { Engine } from './Engine';
import type { DayNight } from '../sky/DayNight';
import type { Terrain } from '../world/Terrain';
import type { Particles } from '../weather/Particles';
import type { PostFX } from '../fx/PostFX';

export type QualityTier = 'low' | 'medium' | 'high';

interface TierConf {
  shadow: number;
  particleMul: number;
  viewRadius: number;
  maxDpr: number;
}

const TIERS: Record<QualityTier, TierConf> = {
  low: { shadow: 1024, particleMul: 0.4, viewRadius: 4, maxDpr: 1 },
  medium: { shadow: 2048, particleMul: 0.7, viewRadius: 6, maxDpr: 1.5 },
  high: { shadow: 2048, particleMul: 1, viewRadius: 6, maxDpr: 2 },
};
const ORDER: QualityTier[] = ['low', 'medium', 'high'];

/** 画质三档 + 启动自动降档（前 5 秒平均 fps） */
export class Settings {
  tier: QualityTier = 'high';
  private autoTimer = 5;
  private autoDone = false;
  private toast: HTMLElement;

  constructor(
    private engine: Engine,
    private dayNight: DayNight,
    private terrain: Terrain,
    private particles: Particles,
    private postfx: PostFX,
  ) {
    this.toast = document.createElement('div');
    this.toast.style.cssText =
      'position:fixed;top:110px;left:50%;transform:translateX(-50%);color:#9fe8ff;' +
      'font:13px monospace;letter-spacing:2px;opacity:0;transition:opacity .4s;z-index:30;pointer-events:none;';
    document.body.appendChild(this.toast);
    this.apply('high');
  }

  apply(tier: QualityTier): void {
    this.tier = tier;
    const c = TIERS[tier];
    const sun = this.dayNight.sun;
    sun.shadow.mapSize.set(c.shadow, c.shadow);
    sun.shadow.map?.dispose();
    sun.shadow.map = null as never;
    this.terrain.viewRadius = c.viewRadius;
    this.particles.rateMul = c.particleMul;
    this.engine.renderer.setPixelRatio(Math.min(window.devicePixelRatio, c.maxDpr));
    this.engine.renderer.setSize(window.innerWidth, window.innerHeight);
    this.postfx.setQuality(tier);
  }

  private showToast(text: string): void {
    this.toast.textContent = text;
    this.toast.style.opacity = '1';
    setTimeout(() => (this.toast.style.opacity = '0'), 1800);
  }

  update(dt: number): void {
    // G 键循环切档
    if (this.engine.input.consumePressed('KeyG')) {
      const next = ORDER[(ORDER.indexOf(this.tier) + 1) % ORDER.length];
      this.apply(next);
      this.showToast(`画质: ${next.toUpperCase()}`);
    }
    // 启动自动降档（页面可见时才统计）
    if (!this.autoDone && !document.hidden && window.__game.ready) {
      this.autoTimer -= dt;
      if (this.autoTimer <= 0) {
        this.autoDone = true;
        if (this.engine.fps < 30) {
          this.apply('low');
          this.showToast('画质: LOW (自动)');
        } else if (this.engine.fps < 50) {
          this.apply('medium');
          this.showToast('画质: MEDIUM (自动)');
        }
      }
    }
  }
}

/** 调试面板（反引号键切换）：天气/时间/传送/性能 */
export function createDebugPanel(engine: Engine): void {
  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;left:26px;top:60px;z-index:40;background:rgba(4,14,22,.85);' +
    'border:1px solid rgba(159,232,255,.3);border-radius:4px;padding:10px 12px;' +
    'font:12px monospace;color:#9fe8ff;display:none;min-width:220px';
  const weathers = ['CLEAR', 'HAZE', 'DUST_STORM', 'ACID_RAIN', 'THUNDERSTORM', 'ASHFALL', 'FOG'];
  el.innerHTML =
    `<div style="opacity:.6;margin-bottom:6px">DEBUG</div>` +
    `<div id="dbg-stats" style="margin-bottom:8px"></div>` +
    weathers
      .map(
        (w, i) =>
          `<button data-w="${w}" style="margin:2px;padding:2px 6px;background:#0a2433;color:#9fe8ff;border:1px solid #29596e;border-radius:2px;cursor:pointer">${i + 1}.${w}</button>`,
      )
      .join('') +
    `<div style="margin-top:8px">
      <button id="dbg-city" style="padding:2px 8px;background:#0a2433;color:#9fe8ff;border:1px solid #29596e;border-radius:2px;cursor:pointer">传送到城市</button>
      <label style="margin-left:8px">时间 <input id="dbg-time" type="range" min="0" max="1" step="0.01" style="width:80px;vertical-align:middle"></label>
    </div>`;
  document.body.appendChild(el);

  el.addEventListener('click', (e) => {
    const btn = e.target as HTMLElement;
    const w = btn.dataset?.w;
    if (w) window.__game.setWeather?.(w, 4);
    if (btn.id === 'dbg-city') window.__game.teleportToCity?.();
  });
  el.querySelector('#dbg-time')!.addEventListener('input', (e) => {
    window.__game.setTimeOfDay?.(parseFloat((e.target as HTMLInputElement).value));
  });

  const stats = el.querySelector('#dbg-stats')!;
  setInterval(() => {
    if (el.style.display === 'none') return;
    const info = engine.renderer.info;
    stats.textContent = `fps ${engine.fps.toFixed(0)} · calls ${info.render.calls} · tris ${(info.render.triangles / 1000).toFixed(0)}k`;
  }, 500);

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Backquote') el.style.display = el.style.display === 'none' ? 'block' : 'none';
  });

  // 数字键 1-7 直接切天气
  window.addEventListener('keydown', (e) => {
    const idx = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7'].indexOf(
      e.code,
    );
    if (idx >= 0) window.__game.setWeather?.(weathers[idx], 6);
  });
}
