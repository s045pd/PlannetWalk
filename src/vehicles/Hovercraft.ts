import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { Engine } from '../core/Engine';
import type { Physics } from '../physics/Physics';
import type { Input } from '../core/Input';
import type { Terrain } from '../world/Terrain';
import type { FloatingOrigin } from '../world/FloatingOrigin';
import { createPid, type Pid } from './pid';
import type { Rideable, VehicleHud } from './Rideable';
import type { ParticlePool } from '../fx/ParticlePool';

const PAD_DUST = new THREE.Color(0.6, 0.5, 0.38);

const HOVER_TARGET = 3;
const MAX_ALT = 12;
/** 四角悬浮点（局部） */
const CORNERS: [number, number][] = [
  [1.6, 1.1],
  [1.6, -1.1],
  [-1.6, 1.1],
  [-1.6, -1.1],
];

/** 悬浮飞行器：四角 PID 悬浮 + 姿态自稳 + 限高 */
export class Hovercraft implements Rideable {
  readonly kind = 'hovercraft';
  readonly body: RAPIER.RigidBody;
  private hull = new THREE.Group();
  private pids: Pid[];
  private glows: THREE.Mesh[] = [];
  private lookYaw = 0;
  private lookPitch = 0;
  altitude = 0;
  thrustLevel = 0;
  /** 气垫尘环粒子池（main 注入） */
  dust: ParticlePool | null = null;
  private dustTimer = 0;

  constructor(
    engine: Engine,
    physics: Physics,
    private terrain: Terrain,
    private origin: FloatingOrigin,
    spawnLocal: THREE.Vector3,
  ) {
    const w = physics.world;
    this.body = w.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(spawnLocal.x, spawnLocal.y, spawnLocal.z)
        .setLinearDamping(0.7)
        .setAngularDamping(3),
    );
    w.createCollider(
      RAPIER.ColliderDesc.cuboid(2.0, 0.4, 1.4).setDensity(110),
      this.body,
    );
    this.pids = CORNERS.map(() => createPid({ kp: 14, ki: 2.5, kd: 7, iMax: 8 }));
    this.buildVisual(engine.scene);
  }

  private buildVisual(scene: THREE.Scene): void {
    const hullMat = new THREE.MeshStandardMaterial({ color: 0x6d7b85, roughness: 0.45, metalness: 0.6 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x22262a, roughness: 0.8 });
    const glowMat = new THREE.MeshBasicMaterial({ color: 0x7fd4ff });
    const deck = new THREE.Mesh(new THREE.BoxGeometry(3.9, 0.5, 2.6), hullMat);
    deck.castShadow = true;
    const nose = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.35, 1.6), hullMat);
    nose.position.set(2.3, 0.05, 0);
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.7, 1.2), dark);
    seat.position.set(-0.5, 0.55, 0);
    this.hull.add(deck, nose, seat);
    // 四角推进器 + 底部辉光
    for (const [x, z] of CORNERS) {
      const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 0.5, 12), dark);
      pod.position.set(x, -0.3, z);
      const glow = new THREE.Mesh(new THREE.CircleGeometry(0.32, 12), glowMat);
      glow.rotation.x = -Math.PI / 2;
      glow.position.set(x, -0.58, z);
      this.hull.add(pod, glow);
      this.glows.push(glow);
    }
    scene.add(this.hull);
  }

  getPosition(out: THREE.Vector3): THREE.Vector3 {
    const t = this.body.translation();
    return out.set(t.x, t.y, t.z);
  }

  enter(): void {
    this.lookYaw = 0;
    this.lookPitch = 0;
    this.pids.forEach((p) => p.reset());
  }

  exit(): THREE.Vector3 {
    const t = this.body.translation();
    const q = this.body.rotation();
    const side = new THREE.Vector3(0, 0.5, 2.8).applyQuaternion(
      new THREE.Quaternion(q.x, q.y, q.z, q.w),
    );
    return new THREE.Vector3(t.x + side.x, t.y + side.y + 0.5, t.z + side.z);
  }

  fixedUpdate(input: Input, h: number, ridden: boolean): void {
    const t = this.body.translation();
    const q = new THREE.Quaternion();
    const rq = this.body.rotation();
    q.set(rq.x, rq.y, rq.z, rq.w);
    const mass = this.body.mass();

    // 地面高度（真实世界坐标采样）
    const groundY = this.terrain.heightAt(
      t.x + this.origin.totalOffset.x,
      t.z + this.origin.totalOffset.z,
    );
    this.altitude = t.y - groundY;
    const altFactor = this.altitude > MAX_ALT ? 0.2 : 1; // 限高：升力衰减

    // 四角 PID 悬浮
    for (let i = 0; i < 4; i++) {
      const [cx, cz] = CORNERS[i];
      const corner = new THREE.Vector3(cx, 0, cz).applyQuaternion(q);
      const px = t.x + corner.x;
      const pz = t.z + corner.z;
      const py = t.y + corner.y;
      const g = this.terrain.heightAt(
        px + this.origin.totalOffset.x,
        pz + this.origin.totalOffset.z,
      );
      const err = HOVER_TARGET - (py - g);
      const f = Math.max(0, this.pids[i].update(err, h)) * (mass / 4) * 0.9 * altFactor;
      this.body.applyImpulseAtPoint(
        { x: 0, y: f * h, z: 0 },
        { x: px, y: py, z: pz },
        true,
      );
    }

    // 姿态自稳：把机体 up 拉向世界 up
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const corr = new THREE.Vector3().crossVectors(up, new THREE.Vector3(0, 1, 0));
    const av = this.body.angvel();
    this.body.applyTorqueImpulse(
      {
        x: (corr.x * 18 - av.x * 6) * mass * h * 0.1,
        y: -av.y * 2 * mass * h * 0.1,
        z: (corr.z * 18 - av.z * 6) * mass * h * 0.1,
      },
      true,
    );

    // 推进（未乘坐时仅悬浮）
    const boost = ridden && input.isDown('ShiftLeft') ? 1.8 : 1;
    const fwdIn = ridden ? (input.isDown('KeyW') ? 1 : input.isDown('KeyS') ? -0.6 : 0) : 0;
    const yawIn = ridden ? (input.isDown('KeyA') ? 1 : input.isDown('KeyD') ? -1 : 0) : 0;
    this.thrustLevel = Math.abs(fwdIn) * boost;
    const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    fwd.y = 0;
    fwd.normalize();
    const force = fwdIn * 5200 * boost;
    this.body.applyImpulse(
      { x: fwd.x * force * h, y: 0, z: fwd.z * force * h },
      true,
    );
    this.body.applyTorqueImpulse({ x: 0, y: yawIn * 900 * h * mass * 0.01, z: 0 }, true);
  }

  update(dt: number): void {
    const t = this.body.translation();
    const q = this.body.rotation();
    this.hull.position.set(t.x, t.y, t.z);
    this.hull.quaternion.set(q.x, q.y, q.z, q.w);
    // 推进辉光脉动
    const s = 0.8 + this.thrustLevel * 0.5 + Math.sin(performance.now() * 0.02) * 0.08;
    for (const g of this.glows) g.scale.setScalar(s);

    // 低空气垫尘环
    if (this.dust && this.altitude < 4.5) {
      this.dustTimer -= dt;
      const vel = this.body.linvel();
      const speed = Math.hypot(vel.x, vel.z);
      const interval = 0.12 / (1 + speed * 0.15);
      if (this.dustTimer <= 0) {
        this.dustTimer = interval;
        const ang = Math.random() * Math.PI * 2;
        TMP_V.set(t.x + Math.cos(ang) * 2.2, t.y - this.altitude + 0.4, t.z + Math.sin(ang) * 2.2);
        TMP_V2.set(Math.cos(ang) * 3.2, 0.8, Math.sin(ang) * 3.2);
        this.dust.spawn(TMP_V, TMP_V2, {
          size: 0.5 + Math.random() * 0.4,
          life: 0.7 + Math.random() * 0.4,
          color: PAD_DUST,
        });
      }
    }
  }

  applyCamera(camera: THREE.PerspectiveCamera, dx: number, dy: number): void {
    this.lookYaw = THREE.MathUtils.clamp(this.lookYaw - dx * 0.002, -2.4, 2.4);
    this.lookPitch = THREE.MathUtils.clamp(this.lookPitch - dy * 0.002, -0.9, 0.9);
    camera.position.copy(this.hull.localToWorld(new THREE.Vector3(-0.5, 1.45, 0)));
    // 机体前向为 +X，相机默认朝 -Z，故加 -90° 偏航基准
    camera.quaternion
      .copy(this.hull.quaternion)
      .multiply(
        TMP_Q.setFromEuler(new THREE.Euler(this.lookPitch, this.lookYaw - Math.PI / 2, 0, 'YXZ')),
      );
  }

  hud(): VehicleHud {
    return {
      title: 'SKIFF — 悬浮飞行器',
      lines: [
        ['离地', `${this.altitude.toFixed(1)} m`],
        ['推力', `${(this.thrustLevel * 100).toFixed(0)}%`],
        ['限高', `${MAX_ALT} m`],
      ],
    };
  }
}

const TMP_Q = new THREE.Quaternion();
const TMP_V = new THREE.Vector3();
const TMP_V2 = new THREE.Vector3();
