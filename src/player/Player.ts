import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import type { Physics } from '../physics/Physics';
import { CharacterController, EYE_OFFSET } from '../physics/CharacterController';
import { GRAVITY } from '../physics/Physics';
import type { FloatingOrigin } from '../world/FloatingOrigin';

const WALK_SPEED = 3.5;
const RUN_SPEED = 8;
const AIR_CONTROL = 0.25;
const JUMP_SPEED = 4.5;

/** 第一人称玩家：移动/跳跃/视角/头部晃动。active=false 时冻结（等待地形碰撞就绪或乘载具）。 */
export class Player {
  cc: CharacterController;
  yaw = 0;
  pitch = 0;
  active = false;
  /** 乘坐载具时为 true：隐藏移动但保留实体位置 */
  riding = false;
  private vy = 0;
  private horizVel = new THREE.Vector2(0, 0);
  private prevPos = new THREE.Vector3();
  private currPos = new THREE.Vector3();
  private bobPhase = 0;
  private bobAmp = 0;
  private landDip = 0;
  speed = 0;

  constructor(
    private engine: Engine,
    physics: Physics,
    private origin: FloatingOrigin,
    spawnLocal: THREE.Vector3,
  ) {
    this.cc = new CharacterController(physics, {
      x: spawnLocal.x,
      y: spawnLocal.y,
      z: spawnLocal.z,
    });
    this.prevPos.copy(spawnLocal);
    this.currPos.copy(spawnLocal);
    origin.onShift((shift) => {
      this.prevPos.sub(shift);
      this.currPos.sub(shift);
    });
  }

  /** 场景局部坐标 */
  localPosition(): THREE.Vector3 {
    return this.currPos.clone();
  }

  /** 真实世界坐标 */
  worldPosition(out = new THREE.Vector3()): THREE.Vector3 {
    return this.origin.toWorld(this.currPos, out);
  }

  teleportLocal(p: THREE.Vector3): void {
    this.cc.setPosition({ x: p.x, y: p.y, z: p.z });
    this.prevPos.copy(p);
    this.currPos.copy(p);
    this.vy = 0;
  }

  fixedUpdate(h: number): void {
    if (!this.active || this.riding) return;
    const input = this.engine.input;
    const fwd = new THREE.Vector2(-Math.sin(this.yaw), -Math.cos(this.yaw));
    const right = new THREE.Vector2(-fwd.y, fwd.x);
    const wish = new THREE.Vector2(0, 0);
    if (input.isDown('KeyW')) wish.add(fwd);
    if (input.isDown('KeyS')) wish.sub(fwd);
    if (input.isDown('KeyD')) wish.add(right);
    if (input.isDown('KeyA')) wish.sub(right);
    if (wish.lengthSq() > 0) wish.normalize();
    const target = wish.multiplyScalar(input.isDown('ShiftLeft') ? RUN_SPEED : WALK_SPEED);

    // 地面即时响应，空中弱操控
    const blend = this.cc.grounded ? 1 : AIR_CONTROL * 10 * h;
    this.horizVel.lerp(target, Math.min(1, blend));

    this.vy -= GRAVITY * h;
    if (this.cc.grounded) {
      if (this.vy < -8) this.landDip = Math.min(0.18, -this.vy * 0.012);
      if (this.vy < 0) this.vy = -1.5; // 贴地
      if (input.isDown('Space')) this.vy = JUMP_SPEED;
    }

    const actual = this.cc.move({
      x: this.horizVel.x * h,
      y: this.vy * h,
      z: this.horizVel.y * h,
    });
    // 头顶碰撞时清零上升速度
    if (this.vy > 0 && actual.y < this.vy * h * 0.5) this.vy = 0;

    const p = this.cc.position();
    this.prevPos.copy(this.currPos);
    this.currPos.set(p.x, p.y, p.z);
    this.speed = Math.hypot(actual.x, actual.z) / h;
  }

  /** 上/下载具：乘载时禁用胶囊碰撞，实体位置由 VehicleManager 同步 */
  setRiding(r: boolean): void {
    this.riding = r;
    this.cc.collider.setEnabled(!r);
    if (!r) this.vy = 0;
  }

  update(dt: number, alpha: number): void {
    if (this.riding) return; // 鼠标交给载具相机
    const m = this.engine.input.consumeMouse();
    this.yaw -= m.dx * 0.0022;
    this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch - m.dy * 0.0022));

    // 头部晃动：行走/奔跑频率不同，落地下沉恢复
    const moving = this.cc.grounded && this.speed > 0.5;
    if (moving) {
      this.bobPhase += dt * (this.speed > 5 ? 11 : 7.5);
      this.bobAmp = Math.min(1, this.bobAmp + dt * 4);
    } else {
      this.bobAmp = Math.max(0, this.bobAmp - dt * 6);
    }
    this.landDip = Math.max(0, this.landDip - dt * 0.5);

    const cam = this.engine.camera;
    cam.position.lerpVectors(this.prevPos, this.currPos, alpha);
    cam.position.y +=
      EYE_OFFSET + this.bobAmp * 0.045 * Math.sin(this.bobPhase * 2) - this.landDip;
    cam.position.x += this.bobAmp * 0.03 * Math.sin(this.bobPhase);
    cam.rotation.set(this.pitch, this.yaw, this.bobAmp * 0.006 * Math.sin(this.bobPhase), 'YXZ');
  }
}
