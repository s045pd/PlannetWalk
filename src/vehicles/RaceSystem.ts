import * as THREE from 'three';
import { poiSiteAt, PoiKind, raceCourse, RACE_RINGS, type PoiSite, type RaceRing } from '../world/poi';
import { POI_CELL } from '../world/poi';
import type { Engine } from '../core/Engine';
import type { Hovercraft } from './Hovercraft';
import type { VehicleManager } from './Rideable';
import type { Heightfield } from '../world/heightfield';
import type { FloatingOrigin } from '../world/FloatingOrigin';

const GATE_RANGE = 10;
const RING_RANGE = 7;
const ABORT_DIST = 220;
const GHOST_DT = 0.1;

interface GhostData {
  dt: number;
  pts: number[]; // 世界坐标扁平 [x,y,z,...]
}

/** 悬浮器光环试炼：穿起点门计时、顺序过环、最佳成绩 + 幽灵回放 */
export class RaceSystem {
  /** 最佳成绩 ms（按 POI cell key），随存档持久化 */
  best: Record<string, number> = {};
  private site: PoiSite | null = null;
  private rings: RaceRing[] = [];
  private ringMeshes: THREE.Mesh[] = [];
  private group = new THREE.Group();
  private running = false;
  private t = 0;
  private next = 0;
  private samples: number[] = [];
  private sampleTimer = 0;
  private ghost: GhostData | null = null;
  private ghostMesh: THREE.Mesh;
  private timerEl: HTMLElement;
  private checkTimer = 0;

  constructor(
    engine: Engine,
    private hovercraft: Hovercraft,
    private vehicles: VehicleManager,
    private hf: Heightfield,
    private origin: FloatingOrigin,
  ) {
    engine.scene.add(this.group);
    this.ghostMesh = new THREE.Mesh(
      new THREE.BoxGeometry(3.9, 1.2, 2.6),
      new THREE.MeshBasicMaterial({
        color: 0x57d8ff,
        transparent: true,
        opacity: 0.3,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.ghostMesh.visible = false;
    engine.scene.add(this.ghostMesh);
    this.timerEl = document.createElement('div');
    this.timerEl.style.cssText =
      'position:fixed;top:100px;left:50%;transform:translateX(-50%);color:#57d8ff;' +
      'font:16px monospace;letter-spacing:3px;display:none;z-index:30;pointer-events:none;' +
      'text-shadow:0 0 8px rgba(87,216,255,.6)';
    document.body.appendChild(this.timerEl);
    origin.onShift(() => this.placeRings());
  }

  restore(best: Record<string, number>): void {
    this.best = { ...best };
  }

  private siteKey(): string {
    return this.site ? `${this.site.cellX},${this.site.cellZ}` : '';
  }

  /** 就近装配航线光环 */
  private ensureCourse(): void {
    const f = this.hovercraft.getPosition(TMP_V);
    const w = { x: f.x + this.origin.totalOffset.x, z: f.z + this.origin.totalOffset.z };
    const ccx = Math.floor(w.x / POI_CELL);
    const ccz = Math.floor(w.z / POI_CELL);
    let found: PoiSite | null = null;
    let bestD = 1500;
    for (let j = -2; j <= 2; j++) {
      for (let i = -2; i <= 2; i++) {
        const p = poiSiteAt(this.engineSeed, ccx + i, ccz + j);
        if (!p || p.kind !== PoiKind.RACE) continue;
        const d = Math.hypot(w.x - p.x, w.z - p.z);
        if (d < bestD) {
          bestD = d;
          found = p;
        }
      }
    }
    if (found === this.site || (found && this.site && found.cellX === this.site.cellX && found.cellZ === this.site.cellZ)) return;
    // 切换站点：清旧建新
    this.disposeRings();
    this.site = found;
    if (!found) return;
    this.rings = raceCourse(this.engineSeed, found, (x, z) => this.hf.height(x, z));
    const geo = new THREE.TorusGeometry(5, 0.3, 10, 32);
    this.rings.forEach((_, i) => {
      const mat = new THREE.MeshBasicMaterial({
        color: 0x2a6f8a,
        transparent: true,
        opacity: 0.75,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const m = new THREE.Mesh(geo, mat);
      // 朝向下一环方向
      const from = i === 0 ? { x: found!.x, z: found!.z } : this.rings[i - 1];
      m.rotation.y = Math.atan2(this.rings[i].x - from.x, this.rings[i].z - from.z);
      this.ringMeshes.push(m);
      this.group.add(m);
    });
    this.placeRings();
    this.ghost = this.loadGhost();
  }

  private placeRings(): void {
    this.rings.forEach((r, i) => {
      this.ringMeshes[i]?.position.set(
        r.x - this.origin.totalOffset.x,
        r.y,
        r.z - this.origin.totalOffset.z,
      );
    });
  }

  private disposeRings(): void {
    for (const m of this.ringMeshes) {
      this.group.remove(m);
      (m.material as THREE.Material).dispose();
    }
    this.ringMeshes = [];
    this.rings = [];
  }

  private ghostKey(): string {
    return `pw-ghost-${this.siteKey()}`;
  }

  private loadGhost(): GhostData | null {
    try {
      const raw = localStorage.getItem(this.ghostKey());
      if (!raw) return null;
      const g = JSON.parse(raw) as GhostData;
      return Array.isArray(g.pts) && g.pts.length >= 6 ? g : null;
    } catch {
      return null;
    }
  }

  private start(): void {
    this.running = true;
    this.t = 0;
    this.next = 0;
    this.samples = [];
    this.sampleTimer = 0;
    this.timerEl.style.display = 'block';
    this.ghostMesh.visible = !!this.ghost;
  }

  private stop(finished: boolean): void {
    this.running = false;
    this.timerEl.style.display = 'none';
    this.ghostMesh.visible = false;
    this.ringMeshes.forEach((m) => (m.material as THREE.MeshBasicMaterial).color.setHex(0x2a6f8a));
    if (!finished) return;
    const ms = Math.round(this.t * 1000);
    const key = this.siteKey();
    const prev = this.best[key];
    if (prev === undefined || ms < prev) {
      this.best = { ...this.best, [key]: ms };
      try {
        localStorage.setItem(
          this.ghostKey(),
          JSON.stringify({ dt: GHOST_DT, pts: this.samples } satisfies GhostData),
        );
      } catch {
        /* 存储满则跳过幽灵 */
      }
      this.ghost = this.loadGhost();
      this.toast(`◆ 试炼完成 ${(ms / 1000).toFixed(2)}s — 新纪录！`);
    } else {
      this.toast(`◆ 试炼完成 ${(ms / 1000).toFixed(2)}s（纪录 ${(prev / 1000).toFixed(2)}s）`);
    }
  }

  private toast(text: string): void {
    this.timerEl.style.display = 'block';
    this.timerEl.textContent = text;
    setTimeout(() => {
      if (!this.running) this.timerEl.style.display = 'none';
    }, 4000);
  }

  update(dt: number): void {
    this.checkTimer -= dt;
    if (this.checkTimer <= 0) {
      this.checkTimer = 1;
      this.ensureCourse();
    }
    if (!this.site) return;

    const riding = this.vehicles.riding === (this.hovercraft as unknown);
    const hp = this.hovercraft.getPosition(TMP_V);
    const hw = { x: hp.x + this.origin.totalOffset.x, y: hp.y, z: hp.z + this.origin.totalOffset.z };

    if (!this.running) {
      // 乘悬浮器穿过起点门 → 开始
      if (riding && Math.hypot(hw.x - this.site.x, hw.z - this.site.z) < GATE_RANGE) this.start();
      return;
    }

    // 运行中
    this.t += dt;
    if (!riding) {
      this.toast('◇ 试炼中止 — 离开了悬浮器');
      this.stop(false);
      return;
    }
    const ring = this.rings[this.next];
    const distToRing = Math.hypot(hw.x - ring.x, hw.y - ring.y, hw.z - ring.z);
    if (distToRing > ABORT_DIST) {
      this.toast('◇ 试炼中止 — 偏离航线');
      this.stop(false);
      return;
    }
    if (distToRing < RING_RANGE) {
      (this.ringMeshes[this.next].material as THREE.MeshBasicMaterial).color.setHex(0x35e08a);
      this.next++;
      if (this.next >= RACE_RINGS) {
        this.stop(true);
        return;
      }
    }
    // 当前目标环脉动
    const cur = this.ringMeshes[this.next];
    if (cur) {
      const s = 1 + Math.sin(this.t * 6) * 0.06;
      cur.scale.setScalar(s);
      (cur.material as THREE.MeshBasicMaterial).color.setHex(0x57d8ff);
    }

    // 幽灵回放
    if (this.ghost && this.ghostMesh.visible) {
      const idx = Math.min(this.ghost.pts.length / 3 - 2, this.t / this.ghost.dt);
      const i0 = Math.floor(idx);
      const k = idx - i0;
      const p = this.ghost.pts;
      this.ghostMesh.position.set(
        (p[i0 * 3] * (1 - k) + p[(i0 + 1) * 3] * k) - this.origin.totalOffset.x,
        p[i0 * 3 + 1] * (1 - k) + p[(i0 + 1) * 3 + 1] * k,
        (p[i0 * 3 + 2] * (1 - k) + p[(i0 + 1) * 3 + 2] * k) - this.origin.totalOffset.z,
      );
    }

    // 采样自身轨迹（世界坐标）
    this.sampleTimer -= dt;
    if (this.sampleTimer <= 0) {
      this.sampleTimer = GHOST_DT;
      if (this.samples.length < 3 * 10 * 180) this.samples.push(hw.x, hw.y, hw.z); // 上限 3 分钟
    }

    this.timerEl.textContent = `环 ${this.next}/${RACE_RINGS} · ${this.t.toFixed(1)}s`;
  }

  /** main 注入种子 */
  engineSeed = 0;
}

const TMP_V = new THREE.Vector3();
