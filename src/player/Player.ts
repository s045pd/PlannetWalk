import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import type { Physics } from '../physics/Physics';
import { CharacterController, EYE_OFFSET } from '../physics/CharacterController';
import { GRAVITY } from '../physics/Physics';
import type { FloatingOrigin } from '../world/FloatingOrigin';
import { stepJetpack, JETPACK, type JetpackState } from './jetpack';
import type { ParticlePool } from '../fx/ParticlePool';

const FLAME_COLOR = new THREE.Color(1.0, 0.62, 0.28);
const FLAME_CORE = new THREE.Color(1.0, 0.9, 0.7);

const FLAME_TMP = new THREE.Vector3();
const FLAME_VEL = new THREE.Vector3();

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
  jetpack: JetpackState = { fuel: 1, sinceUsed: 99 };
  jetThrusting = false;
  /** 喷焰粒子池（main 注入） */
  flames: ParticlePool | null = null;
  /** 鼠标灵敏度倍率（设置菜单） */
  sensitivity = 1;
  private shockTimer = 0;

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
    // 近雷击：击退 + 燃料损失 + 短暂视角抖动
    engine.bus.on('player:shocked', ({ intensity }) => {
      if (this.riding) return;
      this.vy = Math.min(this.vy, -2);
      this.horizVel.set((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8);
      this.jetpack = {
        fuel: Math.max(0, this.jetpack.fuel - 0.2 * intensity),
        sinceUsed: 0,
      };
      this.shockTimer = 0.8;
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
    if (!this.active || this.riding || this.engine.cameraLock) return;
    const input = this.engine.input;
    const fwd = new THREE.Vector2(-Math.sin(this.yaw), -Math.cos(this.yaw));
    const right = new THREE.Vector2(-fwd.y, fwd.x);
    const wish = new THREE.Vector2(0, 0);
    if (input.isDown('KeyW')) wish.add(fwd);
    if (input.isDown('KeyS')) wish.sub(fwd);
    if (input.isDown('KeyD')) wish.add(right);
    if (input.isDown('KeyA')) wish.sub(right);
    // 手柄左摇杆（模拟量）
    wish.addScaledVector(fwd, -input.moveAxis.y);
    wish.addScaledVector(right, input.moveAxis.x);
    if (wish.lengthSq() > 1) wish.normalize();
    const target = wish.multiplyScalar(input.isDown('ShiftLeft') ? RUN_SPEED : WALK_SPEED);

    // 地面即时响应，空中弱操控
    const blend = this.cc.grounded ? 1 : AIR_CONTROL * 10 * h;
    this.horizVel.lerp(target, Math.min(1, blend));

    const prevVy = this.vy;
    const wasGrounded = this.cc.grounded;
    this.vy -= GRAVITY * h;

    // 喷气背包：空中按住 Space 持续喷射
    const wantJet = !this.cc.grounded && input.isDown('Space') && this.vy < 6;
    const jet = stepJetpack(this.jetpack, wantJet, h);
    this.jetpack = jet.state;
    this.jetThrusting = jet.thrust > 0 && wantJet;
    if (this.jetThrusting) {
      this.vy += JETPACK.accel * h;
      this.horizVel.lerp(target, Math.min(1, 0.4 * 10 * h)); // 喷射时增强空中操控
      // 喷焰：背包下方喷出
      if (this.flames) {
        for (let k = 0; k < 2; k++) {
          FLAME_TMP.set(
            this.currPos.x + (Math.random() - 0.5) * 0.3,
            this.currPos.y - 0.7,
            this.currPos.z + (Math.random() - 0.5) * 0.3,
          );
          FLAME_VEL.set(
            -this.horizVel.x * 0.4 + (Math.random() - 0.5) * 1.5,
            -6 - Math.random() * 3,
            -this.horizVel.y * 0.4 + (Math.random() - 0.5) * 1.5,
          );
          this.flames.spawn(FLAME_TMP, FLAME_VEL, {
            size: 0.12 + Math.random() * 0.1,
            life: 0.2 + Math.random() * 0.15,
            color: Math.random() < 0.35 ? FLAME_CORE : FLAME_COLOR,
          });
        }
      }
    }

    if (this.cc.grounded) {
      if (!wasGrounded && prevVy < -6) {
        this.landDip = Math.min(0.18, -prevVy * 0.012);
        this.engine.bus.emit('player:landed', { speed: -prevVy });
      }
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

  groundedNow(): boolean {
    return this.cc.grounded;
  }

  /** 上/下载具：乘载时禁用胶囊碰撞，实体位置由 VehicleManager 同步 */
  setRiding(r: boolean): void {
    this.riding = r;
    this.cc.collider.setEnabled(!r);
    if (!r) this.vy = 0;
  }

  update(dt: number, alpha: number): void {
    if (this.riding || this.engine.cameraLock) return; // 鼠标交给载具/照片模式相机
    const m = this.engine.input.consumeMouse();
    const sens = 0.0022 * this.sensitivity;
    this.yaw -= m.dx * sens;
    this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch - m.dy * sens));

    // 头部晃动：行走/奔跑频率不同，落地下沉恢复
    const moving = this.cc.grounded && this.speed > 0.5;
    if (moving) {
      this.bobPhase += dt * (this.speed > 5 ? 11 : 7.5);
      this.bobAmp = Math.min(1, this.bobAmp + dt * 4);
    } else {
      this.bobAmp = Math.max(0, this.bobAmp - dt * 6);
    }
    this.landDip = Math.max(0, this.landDip - dt * 0.5);

    // 雷击视角抖动
    this.shockTimer = Math.max(0, this.shockTimer - dt);
    const shake = this.shockTimer * 0.05;

    const cam = this.engine.camera;
    cam.position.lerpVectors(this.prevPos, this.currPos, alpha);
    cam.position.y +=
      EYE_OFFSET + this.bobAmp * 0.045 * Math.sin(this.bobPhase * 2) - this.landDip;
    cam.position.x += this.bobAmp * 0.03 * Math.sin(this.bobPhase);
    cam.rotation.set(
      this.pitch + (Math.random() - 0.5) * shake,
      this.yaw + (Math.random() - 0.5) * shake,
      this.bobAmp * 0.006 * Math.sin(this.bobPhase) + (Math.random() - 0.5) * shake,
      'YXZ',
    );
  }
}
