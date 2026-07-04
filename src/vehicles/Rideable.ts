import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import type { Input } from '../core/Input';
import type { Player } from '../player/Player';
import type { Rover } from './Rover';
import type { Hovercraft } from './Hovercraft';
import type { Terrain } from '../world/Terrain';
import type { FloatingOrigin } from '../world/FloatingOrigin';

/** 可召回载具（自动驾驶目标为场景局部坐标） */
export type Recallable = Rover | Hovercraft;

export interface VehicleHud {
  title: string;
  lines: [string, string][];
}

/** 可乘载物统一接口 */
export interface Rideable {
  kind: string;
  /** 场景局部坐标（接近判定/上下车） */
  getPosition(out: THREE.Vector3): THREE.Vector3;
  enter(): void;
  /** 返回下车点（场景局部） */
  exit(): THREE.Vector3;
  /** 每物理步调用；ridden=false 时无输入但仍需维持悬挂/悬浮 */
  fixedUpdate(input: Input, h: number, ridden: boolean): void;
  update(dt: number): void;
  /** 驾驶时每帧驱动相机 */
  applyCamera(camera: THREE.PerspectiveCamera, mouseDX: number, mouseDY: number): void;
  hud(): VehicleHud;
}

const ENTER_RANGE = 4.5;

/** 载具管理：接近提示、E 键上下车、输入与相机路由 */
export class VehicleManager {
  private vehicles: Rideable[] = [];
  riding: Rideable | null = null;
  nearby: Rideable | null = null;
  /** 最后乘坐的载具（召回目标） */
  lastRidden: Rideable | null = null;
  private recalling: Recallable | null = null;
  private holdH = 0;
  private toast: HTMLElement;
  /** 召回远距传送用（main 注入） */
  terrain: Terrain | null = null;
  origin: FloatingOrigin | null = null;

  constructor(
    private engine: Engine,
    private player: Player,
  ) {
    this.toast = document.createElement('div');
    this.toast.style.cssText =
      'position:fixed;top:200px;left:50%;transform:translateX(-50%);color:#9fe8ff;' +
      'font:12px monospace;letter-spacing:2px;opacity:0;transition:opacity .4s;z-index:30;pointer-events:none';
    document.body.appendChild(this.toast);
  }

  private showToast(text: string): void {
    this.toast.textContent = text;
    this.toast.style.opacity = '1';
    setTimeout(() => (this.toast.style.opacity = '0'), 2600);
  }

  add(v: Rideable): void {
    this.vehicles.push(v);
  }

  /** H 长按召回：>400m 直接"自动驾驶抵达"（传送到玩家后方），近距自动驶来 */
  private startRecall(): void {
    const target = (this.lastRidden ?? this.vehicles[0]) as Recallable | null;
    if (!target || !this.terrain || !this.origin) return;
    const pp = this.player.localPosition();
    const vp = target.getPosition(TMP);
    const dist = vp.distanceTo(pp);
    if (dist > 400) {
      const w = this.player.worldPosition();
      const yaw = this.player.yaw;
      const bx = w.x + Math.sin(yaw) * 28; // 玩家背后
      const bz = w.z + Math.cos(yaw) * 28;
      const by = this.terrain.heightAt(bx, bz) + 2.5;
      target.body.setTranslation(
        { x: bx - this.origin.totalOffset.x, y: by, z: bz - this.origin.totalOffset.z },
        true,
      );
      target.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      target.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      this.showToast(`◈ ${target.kind === 'rover' ? '探测车' : '悬浮艇'}自动驾驶抵达`);
    } else {
      this.recalling = target;
      this.showToast(`◈ ${target.kind === 'rover' ? '探测车' : '悬浮艇'}正在驶来 (${Math.round(dist)}m)`);
    }
  }

  fixedUpdate(h: number): void {
    const locked = this.engine.cameraLock !== null;
    // 召回中：目标跟随玩家，抵达即停
    if (this.recalling) {
      const pp = this.player.localPosition();
      const vp = this.recalling.getPosition(TMP);
      if (vp.distanceTo(pp) < 9 || this.riding === this.recalling) {
        this.recalling.autopilotTarget = null;
        if (this.riding !== this.recalling) this.showToast('◈ 载具已抵达');
        this.recalling = null;
      } else {
        this.recalling.autopilotTarget = pp;
      }
    }
    for (const v of this.vehicles)
      v.fixedUpdate(this.engine.input, h, v === this.riding && !locked);
    if (this.riding) {
      // 玩家实体跟随载具（维持地形流式加载与 floating origin 的焦点）
      const p = this.riding.getPosition(TMP);
      this.player.teleportLocal(TMP2.set(p.x, p.y + 2, p.z));
    }
  }

  update(dt: number): void {
    const input = this.engine.input;
    for (const v of this.vehicles) v.update(dt);
    if (this.engine.cameraLock) return; // 照片模式接管相机与输入

    if (this.riding) {
      const m = input.consumeMouse();
      this.riding.applyCamera(this.engine.camera, m.dx, m.dy);
      if (input.consumePressed('KeyE')) {
        const exitPos = this.riding.exit();
        this.player.setRiding(false);
        this.player.teleportLocal(exitPos);
        this.riding = null;
        this.engine.bus.emit('vehicle:exited', {});
      }
      return;
    }

    // 接近检测
    this.nearby = null;
    const pp = this.player.localPosition();
    let best = ENTER_RANGE;
    for (const v of this.vehicles) {
      const d = v.getPosition(TMP).distanceTo(pp);
      if (d < best) {
        best = d;
        this.nearby = v;
      }
    }
    if (this.nearby && input.consumePressed('KeyE')) {
      this.riding = this.nearby;
      this.lastRidden = this.riding;
      this.nearby = null;
      this.riding.enter();
      this.player.setRiding(true);
      this.engine.bus.emit('vehicle:entered', { kind: this.riding.kind });
      return;
    }

    // H 长按 1s 召回
    if (input.isDown('KeyH')) {
      this.holdH += dt;
      if (this.holdH >= 1 && this.holdH < 999) {
        this.holdH = 999; // 触发一次，松开前不重复
        this.startRecall();
      }
    } else {
      this.holdH = 0;
    }
  }
}

const TMP = new THREE.Vector3();
const TMP2 = new THREE.Vector3();
