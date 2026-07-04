import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { questTargets, QUEST_TEXTS, QUEST_STAGES, type QuestTarget } from './quest';
import type { Engine } from '../core/Engine';
import type { Player } from '../player/Player';
import type { Heightfield } from '../world/heightfield';
import type { FloatingOrigin } from '../world/FloatingOrigin';
import type { AudioSystem } from '../audio/AudioSystem';

const ACQUIRE_RANGE = 18;
const BUILD_RANGE = 1600;

function box(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

/** 信号追踪主线：追随信号强度走完 5 级中继，终点为方舟九号发射台 */
export class SignalQuest {
  /** 已完成级数 0..5 */
  stage = 0;
  /** 当前信号强度 0..1（HUD 用） */
  strength = 0;
  private targets: QuestTarget[];
  private prop: THREE.Group | null = null;
  private propStage = -1;
  private blink: THREE.Mesh | null = null;
  private beepTimer = 0;
  private time = 0;
  private mat = new THREE.MeshStandardMaterial({ color: 0x4a4d50, roughness: 0.8, metalness: 0.3 });
  private blinkMat = new THREE.MeshBasicMaterial({ color: 0x57d8ff });

  constructor(
    private engine: Engine,
    seed: number,
    spawn: { x: number; z: number },
    private hf: Heightfield,
    private origin: FloatingOrigin,
    private player: Player,
    private audio: AudioSystem,
  ) {
    this.targets = questTargets(seed, spawn);
    origin.onShift(() => this.placeProp());
  }

  get done(): boolean {
    return this.stage >= QUEST_STAGES;
  }

  get currentTarget(): QuestTarget | null {
    return this.done ? null : this.targets[this.stage];
  }

  restore(stage: number): void {
    this.stage = Math.max(0, Math.min(QUEST_STAGES, Math.floor(stage)));
  }

  private buildProp(target: QuestTarget): void {
    this.disposeProp();
    const g = new THREE.Group();
    const geos: THREE.BufferGeometry[] = [];
    if (target.final) {
      // 方舟九号发射台：龙门架 + 半埋船体
      geos.push(box(2.2, 34, 2.2, -9, 17, 0));
      geos.push(box(2.2, 34, 2.2, 9, 17, 0));
      geos.push(box(22, 2.4, 2.4, 0, 33, 0));
      geos.push(box(26, 1.2, 10, 0, 0.6, 0)); // 基座平台
      const hull = new THREE.CylinderGeometry(3.4, 3.8, 26, 12);
      hull.rotateZ(1.25);
      hull.translate(4, 4.5, 9);
      geos.push(hull);
      geos.push(box(3, 5, 3, -6, 2.5, 8)); // 终端方亭
    } else {
      // 中继天线：基座 + 桅杆 + 三层横臂
      geos.push(box(3, 1.2, 3, 0, 0.6, 0));
      geos.push(box(0.5, 16, 0.5, 0, 8.6, 0));
      for (let i = 0; i < 3; i++) {
        geos.push(box(4 - i, 0.18, 0.18, 0, 11 + i * 2.4, 0));
      }
    }
    const merged = mergeGeometries(geos, false);
    geos.forEach((x) => x.dispose());
    const mesh = new THREE.Mesh(merged, this.mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
    // 闪烁信号灯
    this.blink = new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 8), this.blinkMat);
    this.blink.position.y = target.final ? 34.5 : 17;
    g.add(this.blink);
    this.engine.scene.add(g);
    this.prop = g;
    this.propStage = this.stage;
    this.placeProp();
  }

  private placeProp(): void {
    if (!this.prop) return;
    const t = this.targets[this.propStage];
    if (!t) return;
    this.prop.position.set(
      t.x - this.origin.totalOffset.x,
      this.hf.height(t.x, t.z),
      t.z - this.origin.totalOffset.z,
    );
  }

  private disposeProp(): void {
    if (!this.prop) return;
    this.engine.scene.remove(this.prop);
    this.prop.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    this.prop = null;
    this.propStage = -1;
  }

  update(dt: number): void {
    this.time += dt;
    const target = this.currentTarget;
    if (!target) {
      this.strength = 0;
      this.disposeProp();
      return;
    }

    const w = this.player.worldPosition();
    const d = Math.hypot(target.x - w.x, target.z - w.z);
    // 信号强度：距离衰减 + 电离层抖动
    const base = Math.max(0, Math.min(1, 1 - d / 2800));
    this.strength = Math.max(
      0,
      Math.min(1, base + Math.sin(this.time * 7.3) * 0.04 + Math.sin(this.time * 2.1) * 0.03),
    );

    // 信号滴答：越近越急促
    if (base > 0.02) {
      this.beepTimer -= dt;
      if (this.beepTimer <= 0) {
        this.beepTimer = 2.4 - base * 2.2;
        this.audio.beep(880 + base * 620, 0.05, 0.05 + base * 0.06);
      }
    }

    // 目标 prop 就近装配
    if (d < BUILD_RANGE && this.propStage !== this.stage) this.buildProp(target);
    if (d >= BUILD_RANGE + 300 && this.prop) this.disposeProp();
    if (this.blink) {
      const on = Math.sin(this.time * 5) > 0.2;
      this.blink.visible = on;
    }

    // 获取
    if (d < ACQUIRE_RANGE) {
      const text = QUEST_TEXTS[this.stage];
      this.stage++;
      this.engine.bus.emit('quest:acquired', {
        title: text.title,
        body: text.body,
        stage: this.stage,
        total: QUEST_STAGES,
      });
      this.audio.beep(1320, 0.4, 0.12);
      if (!this.done) this.disposeProp(); // 下一级就近再建
    }
  }
}
