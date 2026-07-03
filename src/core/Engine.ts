import * as THREE from 'three';
import { advanceFixed } from './fixedStep';
import { EventBus } from './EventBus';
import { Input } from './Input';

export const FIXED_H = 1 / 60;

export interface System {
  /** 固定 60Hz 调用（物理/逻辑） */
  fixedUpdate?(h: number): void;
  /** 每渲染帧调用，alpha 为插值系数 */
  update?(dt: number, alpha: number): void;
}

export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly bus = new EventBus();
  readonly input: Input;
  readonly clock = new THREE.Clock();

  /** 覆盖默认渲染（后处理接管时设置） */
  renderOverride: ((dt: number) => void) | null = null;
  /** 相机被特殊模式接管（如照片模式）：玩家/载具跳过输入与相机写入 */
  cameraLock: 'photo' | null = null;
  /** 世界时间缩放（照片模式慢动作） */
  timeScale = 1;
  /** 用户设置的基准 FOV（照片模式退出时恢复） */
  baseFov = 70;

  private systems: System[] = [];
  private acc = 0;
  fps = 60;
  private fpsAcc = 0;
  private fpsFrames = 0;
  private running = false;
  private hiddenTimer: ReturnType<typeof setInterval> | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.camera = new THREE.PerspectiveCamera(
      70,
      window.innerWidth / window.innerHeight,
      0.1,
      20000,
    );
    this.input = new Input(canvas);

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  add(system: System): void {
    this.systems.push(system);
  }

  start(): void {
    this.running = true;
    this.renderer.setAnimationLoop(() => this.frame());
    // 标签页隐藏时 rAF 停摆：降级用定时器驱动，保持物理与流式加载运转
    document.addEventListener('visibilitychange', () => this.syncHiddenTicker());
    this.syncHiddenTicker();
  }

  private syncHiddenTicker(): void {
    if (document.hidden && this.running && !this.hiddenTimer) {
      this.hiddenTimer = setInterval(() => this.frame(), 100);
    } else if (!document.hidden && this.hiddenTimer) {
      clearInterval(this.hiddenTimer);
      this.hiddenTimer = null;
    }
  }

  private frame(): void {
    this.input.pollGamepad();
    const rawDt = Math.min(this.clock.getDelta(), 0.1);
    const dt = rawDt * this.timeScale;
    const { steps, acc, alpha } = advanceFixed(this.acc, dt, FIXED_H);
    this.acc = acc;
    for (let i = 0; i < steps; i++) {
      for (const s of this.systems) s.fixedUpdate?.(FIXED_H);
    }
    for (const s of this.systems) s.update?.(dt, alpha);

    if (this.renderOverride) this.renderOverride(dt);
    else this.renderer.render(this.scene, this.camera);

    this.fpsAcc += dt;
    this.fpsFrames++;
    if (this.fpsAcc >= 0.5) {
      this.fps = this.fpsFrames / this.fpsAcc;
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
    this.input.endFrame();
  }
}
