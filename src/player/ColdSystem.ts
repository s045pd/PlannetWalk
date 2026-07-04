import { stepCold, COLD } from './cold';
import type { Engine } from '../core/Engine';
import type { Player } from './Player';
import type { DayNight } from '../sky/DayNight';
import type { StormEffects } from '../weather/StormEffects';

/** 夜间低温：露天结霜减速，掩蔽（车内/屋下）或白天恢复 */
export class ColdSystem {
  cold = 0;
  private frost: HTMLElement;
  private warn: HTMLElement;

  constructor(
    engine: Engine,
    private player: Player,
    private dayNight: DayNight,
    private storm: StormEffects,
  ) {
    void engine;
    this.frost = document.createElement('div');
    this.frost.style.cssText =
      'position:fixed;inset:0;pointer-events:none;z-index:12;opacity:0;transition:opacity 1.2s;' +
      'background:radial-gradient(ellipse 68% 58% at 50% 48%, transparent 48%, rgba(210,235,255,.18) 72%, rgba(235,248,255,.5) 100%);';
    document.body.appendChild(this.frost);
    this.warn = document.createElement('div');
    this.warn.style.cssText =
      'position:fixed;top:104px;left:50%;transform:translateX(-50%);padding:4px 16px;' +
      'border:1px solid rgba(140,200,255,.7);color:#bfe3ff;background:rgba(6,18,34,.45);' +
      'font:12px monospace;letter-spacing:3px;display:none;z-index:30;pointer-events:none;' +
      'animation:hud-blink 1.2s steps(2) infinite;';
    this.warn.textContent = '❄ 体温过低 — 寻找掩蔽或等待日出';
    document.body.appendChild(this.warn);
  }

  update(dt: number): void {
    const night = this.dayNight.sunElevation < -0.03;
    this.cold = stepCold(this.cold, { night, sheltered: this.storm.sheltered }, dt);
    this.player.speedMul = 1 - (1 - COLD.slowMul) * this.cold;
    this.frost.style.opacity = String(this.cold * 0.9);
    this.warn.style.display = this.cold > COLD.warnAt ? 'block' : 'none';
  }
}
