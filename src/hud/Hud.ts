import './hud.css';
import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import type { Player } from '../player/Player';
import type { DayNight } from '../sky/DayNight';
import type { Terrain } from '../world/Terrain';
import type { WeatherSystem } from '../weather/WeatherSystem';
import type { VehicleManager } from '../vehicles/Rideable';
import type { FloatingOrigin } from '../world/FloatingOrigin';

const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const TMP_EULER = new THREE.Euler();
const WARN_STATES: Record<string, string> = {
  DUST_STORM: '⚠ 沙尘暴 DUST STORM',
  THUNDERSTORM: '⚠ 雷暴 THUNDERSTORM',
  ACID_RAIN: '⚠ 酸雨 ACID RAIN',
};

/** 头盔 HUD（DOM 覆盖层）：罗盘 / 速度高度 / 燃料 / 天气警报 / 时间 / 载具面板 */
export class Hud {
  private el: HTMLElement;
  private tape: HTMLElement;
  private left: HTMLElement;
  private right: HTMLElement;
  private time: HTMLElement;
  private warning: HTMLElement;
  private prompt: HTMLElement;
  private updateTimer = 0;

  constructor(
    private engine: Engine,
    private player: Player,
    private dayNight: DayNight,
    private terrain: Terrain,
    private weather: WeatherSystem,
    private vehicles: VehicleManager,
    private origin: FloatingOrigin,
  ) {
    this.el = document.createElement('div');
    this.el.id = 'hud';
    this.el.innerHTML = `
      <div class="crosshair"></div>
      <div class="compass"><div class="compass-tape"></div></div>
      <div class="panel" id="hud-left"></div>
      <div class="panel" id="hud-right"></div>
      <div class="panel" id="hud-time"></div>
      <div id="hud-warning"></div>
      <div id="hud-prompt"><b>E</b><span></span></div>`;
    document.body.appendChild(this.el);
    this.tape = this.el.querySelector('.compass-tape')!;
    this.left = this.el.querySelector('#hud-left')!;
    this.right = this.el.querySelector('#hud-right')!;
    this.time = this.el.querySelector('#hud-time')!;
    this.warning = this.el.querySelector('#hud-warning')!;
    this.prompt = this.el.querySelector('#hud-prompt')!;

    // 罗盘刻度带（3 组循环以覆盖平移）
    let tape = '';
    for (let k = 0; k < 3; k++) for (const d of DIRS) tape += `<span>${d}</span>`;
    this.tape.innerHTML = tape;

    // 开场序列
    const intro = document.createElement('div');
    intro.id = 'intro';
    intro.innerHTML = `<div class="title">PLANET WALK</div><div class="sub">LANDING SITE — SECTOR 7</div>`;
    document.body.appendChild(intro);
    const dismiss = setInterval(() => {
      if (window.__game.ready) {
        intro.classList.add('done');
        setTimeout(() => intro.remove(), 2400);
        clearInterval(dismiss);
      }
    }, 300);
  }

  update(dt: number): void {
    // 罗盘每帧（平滑），面板 10Hz
    const yawDeg = ((-this.getYaw() * 180) / Math.PI + 360 * 4) % 360;
    const px = (yawDeg / 360) * (60 * 8);
    this.tape.style.transform = `translateX(${160 - 60 * 8 - px + 30}px)`;

    this.updateTimer -= dt;
    if (this.updateTimer > 0) return;
    this.updateTimer = 0.1;

    const riding = this.vehicles.riding;
    if (riding) {
      const hud = riding.hud();
      this.left.innerHTML =
        `<div class="row"><span class="label">${hud.title}</span></div>` +
        hud.lines
          .map(([k, v]) => `<div class="row"><span class="label">${k}</span><span>${v}</span></div>`)
          .join('');
    } else {
      const w = this.player.worldPosition();
      const ground = this.terrain.heightAt(w.x, w.z);
      const fuelPct = Math.round(this.player.jetpack.fuel * 100);
      this.left.innerHTML = `
        <div class="row"><span class="label">速度</span><span>${this.player.speed.toFixed(1)} m/s</span></div>
        <div class="row"><span class="label">海拔</span><span>${w.y.toFixed(0)} m</span></div>
        <div class="row"><span class="label">离地</span><span>${Math.max(0, w.y - ground).toFixed(1)} m</span></div>`;
      this.right.innerHTML = `
        <div class="row"><span class="label">喷气燃料</span><span>${fuelPct}%</span></div>
        <div class="fuel-bar ${fuelPct < 20 ? 'fuel-low' : ''}"><i style="width:${fuelPct}%"></i></div>`;
    }
    this.right.style.display = riding ? 'none' : 'block';

    this.time.textContent = this.dayNight.clockText();

    // 天气警报
    const warn =
      WARN_STATES[this.weather.core.transitioning ? (this.weather.core.target ?? '') : this.weather.core.current];
    this.warning.style.display = warn ? 'block' : 'none';
    if (warn) this.warning.textContent = warn;

    // 交互提示
    const nearby = this.vehicles.nearby;
    this.prompt.style.display = nearby && !riding ? 'block' : 'none';
    if (nearby) {
      this.prompt.querySelector('span')!.textContent =
        nearby.kind === 'rover' ? ' 登上探测车' : ' 登上悬浮飞行器';
    }
    void this.origin;
  }

  private getYaw(): number {
    if (this.vehicles.riding) {
      return TMP_EULER.setFromQuaternion(this.engine.camera.quaternion, 'YXZ').y;
    }
    return this.player.yaw;
  }
}
