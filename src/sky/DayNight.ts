import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import type { Sky } from './Sky';
import { scatterColor } from './atmosphere';
import { smoothstep, lerp } from '../world/noise';

/** 游戏内一天 = 现实 20 分钟 */
const DAY_LENGTH = 1200;
const ORBIT_TILT = (35 * Math.PI) / 180;

const NIGHT_FOG = new THREE.Color(0.012, 0.018, 0.032);
const SUN_NOON = new THREE.Color(1, 0.95, 0.88);
const SUN_LOW = new THREE.Color(1, 0.55, 0.32);
const AZIMUTHS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** 太阳/残月轨道 → 方向光/环境光/曝光/雾色 */
export class DayNight {
  /** [0,1)，0 = 午夜，0.5 = 正午 */
  timeOfDay = 0.35;
  timeScale = 1;
  readonly sunDir = new THREE.Vector3();
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly fogColor = new THREE.Color();
  private moon: THREE.Mesh;
  /** 天气系统可修改的倍率 */
  exposureMul = 1;
  ambientMul = 1;
  sunElevation = 0;
  private fogTimer = 0;

  constructor(
    private engine: Engine,
    private sky: Sky,
  ) {
    this.sun = new THREE.DirectionalLight(0xffffff, 2.4);
    this.hemi = new THREE.HemisphereLight(0xcbd8ee, 0x51443a, 0.8);
    engine.scene.add(this.sun, this.sun.target, this.hemi);

    this.moon = new THREE.Mesh(
      new THREE.CircleGeometry(220, 32),
      new THREE.MeshBasicMaterial({
        color: 0x9aa4b8,
        transparent: true,
        opacity: 0.85,
        fog: false,
        depthWrite: false,
      }),
    );
    this.moon.renderOrder = -9;
    engine.scene.add(this.moon);

    if (!engine.scene.fog) engine.scene.fog = new THREE.Fog(0x8a7a66, 200, 900);
  }

  update(dt: number): void {
    // 调试快进：[ 后退 ] 前进
    if (this.engine.input.isDown('BracketRight')) this.timeOfDay += dt * 0.03;
    if (this.engine.input.isDown('BracketLeft')) this.timeOfDay -= dt * 0.03;
    this.timeOfDay = ((this.timeOfDay + (dt * this.timeScale) / DAY_LENGTH) % 1 + 1) % 1;

    const a = (this.timeOfDay - 0.25) * Math.PI * 2;
    this.sunDir
      .set(Math.cos(a), Math.sin(a) * Math.cos(ORBIT_TILT), Math.sin(ORBIT_TILT) * 0.45)
      .normalize();
    const el = this.sunDir.y;
    this.sunElevation = el;

    this.sky.setSunDir(this.sunDir);

    const camPos = this.engine.camera.position;
    this.sky.update(camPos);

    // 方向光（位置相对相机，方向由 target 决定）
    const dayness = smoothstep(-0.05, 0.15, el);
    this.sun.color.copy(SUN_LOW).lerp(SUN_NOON, smoothstep(0, 0.35, el));
    this.sun.intensity = 1.9 * dayness;
    this.sun.position.copy(camPos).addScaledVector(this.sunDir, 600);
    this.sun.target.position.copy(camPos);

    // 环境光
    this.hemi.intensity = (0.1 + 0.55 * smoothstep(-0.1, 0.3, el)) * this.ambientMul;

    // 曝光
    this.engine.renderer.toneMappingExposure =
      lerp(0.35, 0.9, smoothstep(-0.15, 0.12, el)) * this.exposureMul;

    // 雾色 = 大气散射的地平线平均色（与天空严格一致），叠加夜色底
    this.fogTimer -= dt;
    if (this.fogTimer <= 0) {
      this.fogTimer = 0.25;
      const s: [number, number, number] = [this.sunDir.x, this.sunDir.y, this.sunDir.z];
      const acc = [0, 0, 0];
      for (const [dx, dz] of AZIMUTHS) {
        const c = scatterColor([dx, 0.015, dz], s);
        acc[0] += c[0];
        acc[1] += c[1];
        acc[2] += c[2];
      }
      this.fogColor.setRGB(
        NIGHT_FOG.r + acc[0] / 4,
        NIGHT_FOG.g + acc[1] / 4,
        NIGHT_FOG.b + acc[2] / 4,
      );
      // 环境天光色 = 天顶散射色
      const zen = scatterColor([0, 1, 0], s);
      this.hemi.color.setRGB(
        Math.max(0.05, zen[0]),
        Math.max(0.06, zen[1]),
        Math.max(0.09, zen[2]),
      );
    }
    const fog = this.engine.scene.fog as THREE.Fog;
    fog.color.copy(this.fogColor);

    // 残月：太阳反向轨道，面向相机
    this.moon.position.copy(camPos).addScaledVector(this.sunDir, -8200);
    this.moon.lookAt(camPos);
    (this.moon.material as THREE.MeshBasicMaterial).opacity =
      0.85 * smoothstep(0.0, 0.2, -el + 0.3);
  }

  /** HUD 时间 HH:MM */
  clockText(): string {
    const t = this.timeOfDay * 24;
    const hh = Math.floor(t);
    const mm = Math.floor((t - hh) * 60);
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }
}
