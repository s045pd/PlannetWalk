import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import type { Input } from '../core/Input';
import type { Player } from '../player/Player';

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

  constructor(
    private engine: Engine,
    private player: Player,
  ) {}

  add(v: Rideable): void {
    this.vehicles.push(v);
  }

  fixedUpdate(h: number): void {
    const locked = this.engine.cameraLock !== null;
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
      this.nearby = null;
      this.riding.enter();
      this.player.setRiding(true);
      this.engine.bus.emit('vehicle:entered', { kind: this.riding.kind });
    }
  }
}

const TMP = new THREE.Vector3();
const TMP2 = new THREE.Vector3();
