import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { Engine } from '../core/Engine';
import type { Physics } from '../physics/Physics';
import type { Input } from '../core/Input';
import type { Rideable, VehicleHud } from './Rideable';
import type { ParticlePool } from '../fx/ParticlePool';

const DUST_COLOR = new THREE.Color(0.62, 0.5, 0.36);

const WHEEL_R = 0.45;
const REST = 0.55;
/** 车轮悬挂连接点（底盘局部坐标，6 轮） */
const WHEELS: [number, number, number][] = [
  [1.7, -0.2, 1.05],
  [1.7, -0.2, -1.05],
  [0, -0.2, 1.1],
  [0, -0.2, -1.1],
  [-1.7, -0.2, 1.05],
  [-1.7, -0.2, -1.05],
];

/** 六轮探测车：raycast vehicle 独立悬挂，前轮转向、中后轮驱动 */
export class Rover implements Rideable {
  readonly kind = 'rover';
  readonly body: RAPIER.RigidBody;
  private vc: RAPIER.DynamicRayCastVehicleController;
  private chassis = new THREE.Group();
  private wheels: THREE.Mesh[] = [];
  private headlights: THREE.SpotLight[] = [];
  private lightsOn = false;
  private lookYaw = 0;
  private lookPitch = 0;
  private steer = 0;
  speedKmh = 0;
  /** 车轮扬尘粒子池（main 注入） */
  dust: ParticlePool | null = null;
  private dustTimer = 0;

  constructor(
    engine: Engine,
    physics: Physics,
    spawnLocal: THREE.Vector3,
  ) {
    const w = physics.world;
    this.body = w.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(spawnLocal.x, spawnLocal.y, spawnLocal.z)
        .setAngularDamping(1.2)
        .setLinearDamping(0.15),
    );
    w.createCollider(
      RAPIER.ColliderDesc.cuboid(2.1, 0.5, 1.15).setDensity(180).setTranslation(0, 0.25, 0),
      this.body,
    );
    this.vc = w.createVehicleController(this.body);
    WHEELS.forEach((p, i) => {
      this.vc.addWheel(
        new RAPIER.Vector3(p[0], p[1], p[2]),
        new RAPIER.Vector3(0, -1, 0),
        new RAPIER.Vector3(0, 0, 1),
        REST,
        WHEEL_R,
      );
      this.vc.setWheelSuspensionStiffness(i, 32);
      this.vc.setWheelSuspensionCompression(i, 2.2);
      this.vc.setWheelSuspensionRelaxation(i, 2.6);
      this.vc.setWheelMaxSuspensionTravel(i, 0.5);
      this.vc.setWheelFrictionSlip(i, 2.4);
      this.vc.setWheelSideFrictionStiffness(i, 0.9);
    });

    this.buildVisual(engine.scene);
  }

  private buildVisual(scene: THREE.Scene): void {
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xb0977a, roughness: 0.6, metalness: 0.35 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x2c2e30, roughness: 0.85 });
    const hull = new THREE.Mesh(new THREE.BoxGeometry(4.0, 0.9, 2.2), bodyMat);
    hull.position.y = 0.45;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.75, 1.9), darkMat);
    cabin.position.set(0.85, 1.2, 0);
    const mast = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.1, 0.12), darkMat);
    mast.position.set(-1.6, 1.5, 0.7);
    hull.castShadow = cabin.castShadow = true;
    hull.receiveShadow = true;
    this.chassis.add(hull, cabin, mast);

    const wheelGeo = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.34, 18);
    wheelGeo.rotateX(Math.PI / 2);
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(wheelGeo, darkMat);
      m.castShadow = true;
      this.chassis.add(m);
      this.wheels.push(m);
    }

    // 前大灯
    for (const z of [0.7, -0.7]) {
      const spot = new THREE.SpotLight(0xfff2d9, 0, 60, 0.5, 0.4, 1.2);
      spot.position.set(2.05, 0.6, z);
      spot.target.position.set(12, -0.5, z);
      this.chassis.add(spot, spot.target);
      this.headlights.push(spot);
    }
    scene.add(this.chassis);
  }

  getPosition(out: THREE.Vector3): THREE.Vector3 {
    const t = this.body.translation();
    return out.set(t.x, t.y, t.z);
  }

  enter(): void {
    this.lookYaw = 0;
    this.lookPitch = 0;
  }

  exit(): THREE.Vector3 {
    const t = this.body.translation();
    const q = this.body.rotation();
    const side = new THREE.Vector3(0, 0.6, 2.6).applyQuaternion(
      new THREE.Quaternion(q.x, q.y, q.z, q.w),
    );
    return new THREE.Vector3(t.x + side.x, t.y + side.y + 0.6, t.z + side.z);
  }

  fixedUpdate(input: Input, h: number, ridden: boolean): void {
    const fwd = ridden ? (input.isDown('KeyW') ? 1 : input.isDown('KeyS') ? -0.6 : 0) : 0;
    const targetSteer = ridden ? (input.isDown('KeyA') ? 1 : input.isDown('KeyD') ? -1 : 0) : 0;
    const brake = ridden ? (input.isDown('Space') ? 18 : 0) : 4; // 停车常刹

    const vel = this.body.linvel();
    const speed = Math.hypot(vel.x, vel.y, vel.z);
    this.speedKmh = speed * 3.6;
    // 速度越快转向越钝
    const maxSteer = 0.55 / (1 + speed * 0.12);
    this.steer += (targetSteer * maxSteer - this.steer) * Math.min(1, h * 10);

    const force = fwd * 2600 * (input.isDown('ShiftLeft') ? 1.6 : 1);
    for (let i = 0; i < 6; i++) {
      if (i >= 2) this.vc.setWheelEngineForce(i, force / 4);
      if (i < 2) this.vc.setWheelSteering(i, this.steer);
      this.vc.setWheelBrake(i, brake);
    }
    this.vc.updateVehicle(h);
    if (!ridden) return;

    // R 翻车复位
    if (input.consumePressed('KeyR')) {
      const t = this.body.translation();
      this.body.setTranslation({ x: t.x, y: t.y + 1.5, z: t.z }, true);
      this.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
    if (input.consumePressed('KeyL')) {
      this.lightsOn = !this.lightsOn;
      for (const l of this.headlights) l.intensity = this.lightsOn ? 90 : 0;
    }
  }

  update(dt: number): void {
    const t = this.body.translation();
    const q = this.body.rotation();
    this.chassis.position.set(t.x, t.y, t.z);
    this.chassis.quaternion.set(q.x, q.y, q.z, q.w);

    // 车轮扬尘：接地且有速度时从后轮扬起
    if (this.dust) {
      const vel = this.body.linvel();
      const speed = Math.hypot(vel.x, vel.z);
      this.dustTimer -= dt;
      if (speed > 3 && this.dustTimer <= 0) {
        this.dustTimer = 0.05;
        for (const wi of [4, 5]) {
          if (!this.vc.wheelIsInContact(wi)) continue;
          const wp = this.wheels[wi].getWorldPosition(TMP_V);
          TMP_V2.set(
            -vel.x * 0.25 + (Math.random() - 0.5) * 1.2,
            1.2 + Math.random() * 1.4,
            -vel.z * 0.25 + (Math.random() - 0.5) * 1.2,
          );
          this.dust.spawn(TMP_V.setY(wp.y - 0.3), TMP_V2, {
            size: 0.35 + Math.random() * 0.3 + speed * 0.02,
            life: 0.9 + Math.random() * 0.7,
            color: DUST_COLOR,
          });
        }
      }
    }

    // 车轮视觉：悬挂长度 + 滚动 + 转向
    for (let i = 0; i < 6; i++) {
      const conn = WHEELS[i];
      const rest = this.vc.wheelSuspensionRestLength(i) ?? REST;
      const len = this.vc.wheelSuspensionLength(i) ?? rest;
      const wm = this.wheels[i];
      wm.position.set(conn[0], conn[1] - len, conn[2]);
      const rot = this.vc.wheelRotation(i) ?? 0;
      const st = this.vc.wheelSteering(i) ?? 0;
      wm.rotation.set(0, st, -rot, 'YXZ');
    }
  }

  applyCamera(camera: THREE.PerspectiveCamera, dx: number, dy: number): void {
    this.lookYaw = THREE.MathUtils.clamp(this.lookYaw - dx * 0.002, -2.4, 2.4);
    this.lookPitch = THREE.MathUtils.clamp(this.lookPitch - dy * 0.002, -0.9, 0.9);
    const seat = new THREE.Vector3(0.85, 1.75, 0);
    camera.position.copy(this.chassis.localToWorld(seat.clone()));
    // 底盘前向为 +X，相机默认朝 -Z，故加 -90° 偏航基准
    camera.quaternion
      .copy(this.chassis.quaternion)
      .multiply(
        TMP_Q.setFromEuler(new THREE.Euler(this.lookPitch, this.lookYaw - Math.PI / 2, 0, 'YXZ')),
      );
  }

  hud(): VehicleHud {
    return {
      title: 'ROVER — 六轮探测车',
      lines: [
        ['速度', `${this.speedKmh.toFixed(0)} km/h`],
        ['大灯 [L]', this.lightsOn ? 'ON' : 'OFF'],
        ['复位 [R] · 刹车 [Space]', ''],
      ],
    };
  }
}

const TMP_Q = new THREE.Quaternion();
const TMP_V = new THREE.Vector3();
const TMP_V2 = new THREE.Vector3();
