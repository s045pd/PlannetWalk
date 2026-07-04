import './hud.css';
import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import type { Player } from '../player/Player';
import type { DayNight } from '../sky/DayNight';
import type { Terrain } from '../world/Terrain';
import type { WeatherSystem } from '../weather/WeatherSystem';
import type { VehicleManager } from '../vehicles/Rideable';
import type { FloatingOrigin } from '../world/FloatingOrigin';
import type { LogPickups } from '../story/LogPickups';
import type { SignalQuest } from '../story/SignalQuest';
import type { Waypoints } from '../player/Waypoints';
import type { StormEffects } from '../weather/StormEffects';
import type { PoiManager } from '../world/PoiManager';
import { PoiKind } from '../world/poi';

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
  private logPanel: HTMLElement;
  private logBody: HTMLElement;
  private poiMarker: HTMLElement;
  private poiDist: HTMLElement;
  /** 天气玩法：沙尘暴中罗盘失灵（C2 接线） */
  compassScramble = 0;
  /** 信号主线（main 注入） */
  quest: SignalQuest | null = null;
  /** 个人信标（main 注入） */
  waypoints: Waypoints | null = null;
  /** 风暴避难（main 注入） */
  storm: StormEffects | null = null;
  private wpMarkers: HTMLElement[] = [];
  private updateTimer = 0;
  private typeText = '';
  private typeShown = 0;
  private logHold = 0;

  constructor(
    private engine: Engine,
    private player: Player,
    private dayNight: DayNight,
    private terrain: Terrain,
    private weather: WeatherSystem,
    private vehicles: VehicleManager,
    private origin: FloatingOrigin,
    private logs: LogPickups,
    private poi: PoiManager,
  ) {
    this.el = document.createElement('div');
    this.el.id = 'hud';
    this.el.innerHTML = `
      <div class="crosshair"></div>
      <div class="compass"><div class="compass-tape"></div><div class="poi-marker">◆</div></div>
      <div class="poi-dist"></div>
      <div class="panel" id="hud-left"></div>
      <div class="panel" id="hud-right"></div>
      <div class="panel" id="hud-time"></div>
      <div id="hud-warning"></div>
      <div id="hud-prompt"><b>E</b><span></span></div>
      <div id="hud-log"><div class="log-title"></div><div class="log-body"></div></div>`;
    document.body.appendChild(this.el);
    this.tape = this.el.querySelector('.compass-tape')!;
    this.left = this.el.querySelector('#hud-left')!;
    this.right = this.el.querySelector('#hud-right')!;
    this.time = this.el.querySelector('#hud-time')!;
    this.warning = this.el.querySelector('#hud-warning')!;
    this.prompt = this.el.querySelector('#hud-prompt')!;
    this.logPanel = this.el.querySelector('#hud-log')!;
    this.logBody = this.el.querySelector('#hud-log .log-body')!;
    this.poiMarker = this.el.querySelector('.poi-marker')!;
    this.poiDist = this.el.querySelector('.poi-dist')!;

    // 日志拾取 / 任务获取 → 打字机呈现
    engine.bus.on('log:collected', ({ title, body, already, count, total }) => {
      this.showTypewriter(
        title,
        `${already ? '已收录 · ' : ''}日志 ${String(count).padStart(2, '0')}/${total}`,
        body,
      );
    });
    engine.bus.on('quest:acquired', ({ title, body, stage, total }) => {
      this.showTypewriter(title, `信号 ${stage}/${total}`, body, 10);
    });

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

  private showTypewriter(title: string, tag: string, body: string, hold = 7): void {
    const titleEl = this.logPanel.querySelector('.log-title')!;
    titleEl.innerHTML = `${title}<span class="log-tag">${tag}</span>`;
    this.typeText = body;
    this.typeShown = 0;
    this.logHold = hold;
    this.logPanel.style.display = 'block';
    this.logPanel.classList.remove('done');
    this.logPanel.style.opacity = '1';
  }

  update(dt: number): void {
    // 沙尘暴罗盘失灵因子
    this.compassScramble = Math.max(0, Math.min(1, (this.weather.params.dustRate - 0.6) / 0.3));

    // 打字机推进
    if (this.typeText) {
      this.typeShown = Math.min(this.typeText.length, this.typeShown + dt * 28);
      this.logBody.textContent = this.typeText.slice(0, Math.floor(this.typeShown));
      if (this.typeShown >= this.typeText.length) {
        this.logPanel.classList.add('done');
        this.logHold -= dt;
        if (this.logHold <= 0) {
          this.logPanel.style.opacity = '0';
          if (this.logHold < -0.7) {
            this.logPanel.style.display = 'none';
            this.typeText = '';
          }
        }
      }
    }

    // 罗盘每帧（平滑），面板 10Hz；沙尘暴中乱跳
    const yaw = this.getYaw();
    const scramble =
      this.compassScramble > 0
        ? (Math.sin(performance.now() * 0.013) + Math.sin(performance.now() * 0.037)) *
          0.7 *
          this.compassScramble
        : 0;
    const yawDeg = ((-(yaw + scramble) * 180) / Math.PI + 360 * 4) % 360;
    const px = (yawDeg / 360) * (60 * 8);
    this.tape.style.transform = `translateX(${160 - 60 * 8 - px + 30}px)`;
    this.tape.style.opacity = this.compassScramble > 0.5 ? '0.4' : '1';

    // 个人信标：罗盘小三角（惰性创建 3 个标记元素）
    const wpos = this.player.worldPosition();
    if (this.waypoints) {
      while (this.wpMarkers.length < 3) {
        const m = document.createElement('div');
        m.className = 'wp-marker';
        m.textContent = '▲';
        this.el.querySelector('.compass')!.appendChild(m);
        this.wpMarkers.push(m);
      }
      this.wpMarkers.forEach((m, i) => {
        const b = this.waypoints!.beacons[i];
        if (!b || this.compassScramble >= 0.5) {
          m.style.display = 'none';
          return;
        }
        let delta = Math.atan2(b.x - wpos.x, b.z - wpos.z) - yaw;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        const deg = (delta * 180) / Math.PI;
        if (Math.abs(deg) < 110) {
          m.style.display = 'block';
          m.style.left = `${160 - deg * (60 / 45) - 4}px`;
        } else {
          m.style.display = 'none';
        }
      });
    }

    // POI 信标：罗盘上的菱形标记 + 距离
    const w = this.player.worldPosition();
    const near = this.poi.nearestFrom(w.x, w.z);
    if (near && this.compassScramble < 0.5) {
      let delta = near.bearing - yaw;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      const deltaDeg = (delta * 180) / Math.PI;
      if (Math.abs(deltaDeg) < 110) {
        this.poiMarker.style.display = 'block';
        this.poiMarker.style.left = `${160 - deltaDeg * (60 / 45) - 6}px`;
      } else {
        this.poiMarker.style.display = 'none';
      }
      const kindName =
        near.site.kind === PoiKind.WRECK ? '残骸' : near.site.kind === PoiKind.TOWER ? '信标塔' : '坠落点';
      this.poiDist.textContent = `◆ ${kindName} ${near.dist >= 1000 ? (near.dist / 1000).toFixed(2) + ' km' : Math.round(near.dist) + ' m'}`;
      this.poiDist.style.display = 'block';
    } else {
      this.poiMarker.style.display = 'none';
      this.poiDist.style.display = 'none';
    }

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
      let signalRow = '';
      if (this.quest && !this.quest.done) {
        const s = this.quest.strength;
        const bars = '▁▂▃▄▅▆▇█';
        const n = Math.round(s * 7);
        let meter = '';
        for (let i = 0; i <= n; i++) meter += bars[i];
        signalRow = `<div class="row"><span class="label">信号</span><span>${s < 0.02 ? '···' : meter} ${Math.round(s * 100)}%</span></div>`;
      }
      this.left.innerHTML = `
        <div class="row"><span class="label">速度</span><span>${this.player.speed.toFixed(1)} m/s</span></div>
        <div class="row"><span class="label">海拔</span><span>${w.y.toFixed(0)} m</span></div>
        <div class="row"><span class="label">离地</span><span>${Math.max(0, w.y - ground).toFixed(1)} m</span></div>${signalRow}`;
      this.right.innerHTML = `
        <div class="row"><span class="label">喷气燃料</span><span>${fuelPct}%</span></div>
        <div class="fuel-bar ${fuelPct < 20 ? 'fuel-low' : ''}"><i style="width:${fuelPct}%"></i></div>`;
    }
    this.right.style.display = riding ? 'none' : 'block';

    this.time.textContent = this.dayNight.clockText();

    // 天气警报：沙尘暴逼近倒计时 > 掩蔽状态 > 常规警报
    const core = this.weather.core;
    let warn =
      WARN_STATES[core.transitioning ? (core.target ?? '') : core.current];
    if (core.transitioning && core.target === 'DUST_STORM') {
      warn = `⚠ 沙尘暴逼近 ${Math.ceil(core.transitionRemaining)}s — 寻找掩蔽`;
    } else if (this.storm?.storming && this.storm.sheltered) {
      warn = '◈ 已掩蔽 — 等待风暴过去';
    }
    this.warning.style.display = warn ? 'block' : 'none';
    if (warn) this.warning.textContent = warn;

    // 交互提示：载具优先，其次数据板
    const nearby = this.vehicles.nearby;
    const pad = this.logs.nearbyPad;
    if (!riding && nearby) {
      this.prompt.style.display = 'block';
      this.prompt.querySelector('span')!.textContent =
        nearby.kind === 'rover' ? ' 登上探测车' : ' 登上悬浮飞行器';
    } else if (!riding && pad) {
      this.prompt.style.display = 'block';
      this.prompt.querySelector('span')!.textContent = ' 读取数据板';
    } else {
      this.prompt.style.display = 'none';
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
