import * as THREE from 'three';
import { createHeightfield, type Heightfield } from './heightfield';
import { createTerrainMaterial, buildChunkMesh } from './TerrainChunk';
import type { ChunkRequest, ChunkResult } from './terrain.worker';

export const CHUNK_SIZE = 128;
const LOD0_RES = 64;

interface ChunkRecord {
  mesh: THREE.Mesh | null;
  res: number;
  /** 期望分辨率（与 res 不同则需要生成/升降级） */
  pendingRes: number | null;
  /** 已派发给 worker 且未返回 */
  inFlight: boolean;
  /** LOD0 物理数据（供 Rapier trimesh），仅 res=64 时保留 */
  physics: { positions: Float32Array; indices: Uint32Array } | null;
}

interface WorkerSlot {
  worker: Worker;
  busy: boolean;
  currentKey: string | null;
}

/** 环形 LOD 区块地形管理器：worker 流式生成、按距离分级、floating origin 感知 */
export class Terrain {
  readonly group = new THREE.Group();
  readonly hf: Heightfield;
  private chunks = new Map<string, ChunkRecord>();
  private queue: { cx: number; cz: number; res: number }[] = [];
  private slots: WorkerSlot[] = [];
  private reqId = 0;
  private originOff = new THREE.Vector2(0, 0);
  private material: THREE.MeshStandardMaterial;
  private refreshTimer = 0;
  viewRadius = 6;
  private unloadRadius = 8;

  constructor(
    scene: THREE.Scene,
    readonly seed: number,
    private getWorldFocus: () => { x: number; z: number },
  ) {
    this.hf = createHeightfield(seed);
    this.material = createTerrainMaterial();
    scene.add(this.group);
    for (let i = 0; i < 2; i++) {
      const worker = new Worker(new URL('./terrain.worker.ts', import.meta.url), {
        type: 'module',
      });
      const slot: WorkerSlot = { worker, busy: false, currentKey: null };
      worker.onmessage = (e: MessageEvent<ChunkResult>) => {
        slot.busy = false;
        slot.currentKey = null;
        this.onChunkData(e.data);
        this.dispatch();
      };
      worker.onerror = (e) => {
        if (slot.currentKey) {
          const rec = this.chunks.get(slot.currentKey);
          if (rec) rec.inFlight = false;
        }
        slot.busy = false;
        slot.currentKey = null;
        console.error('[terrain.worker]', e.message);
        this.dispatch();
      };
      this.slots.push(slot);
    }
    this.refresh(); // 立即请求首屏区块，不依赖渲染循环启动
  }

  heightAt(x: number, z: number): number {
    return this.hf.height(x, z);
  }

  /** 供物理系统查询 LOD0 区块 trimesh 数据（chunk 局部坐标） */
  getPhysicsData(cx: number, cz: number): { positions: Float32Array; indices: Uint32Array } | null {
    return this.chunks.get(`${cx},${cz}`)?.physics ?? null;
  }

  /** 世界坐标 → 区块坐标 */
  static toChunk(v: number): number {
    return Math.floor(v / CHUNK_SIZE);
  }

  /** 首屏就绪判定：焦点周围 r 圈区块全部有 mesh */
  isReadyAround(r: number): boolean {
    const f = this.getWorldFocus();
    const pcx = Terrain.toChunk(f.x);
    const pcz = Terrain.toChunk(f.z);
    for (let j = -r; j <= r; j++)
      for (let i = -r; i <= r; i++)
        if (!this.chunks.get(`${pcx + i},${pcz + j}`)?.mesh) return false;
    return true;
  }

  update(dt: number): void {
    this.refreshTimer -= dt;
    if (this.refreshTimer <= 0) {
      this.refreshTimer = 0.25;
      this.refresh();
    }
  }

  /** floating origin 回移：重排所有区块 mesh 并更新材质偏移 */
  shiftOrigin(totalOffset: THREE.Vector3): void {
    this.originOff.set(totalOffset.x, totalOffset.z);
    const u = (this.material.userData as { uniforms: { uOriginOff: { value: THREE.Vector2 } } })
      .uniforms;
    u.uOriginOff.value.copy(this.originOff);
    for (const [key, rec] of this.chunks) {
      if (!rec.mesh) continue;
      const [cx, cz] = key.split(',').map(Number);
      this.placeMesh(rec.mesh, cx, cz);
    }
  }

  setWetness(w: number): void {
    const u = (this.material.userData as { uniforms: { uWetness: { value: number } } }).uniforms;
    u.uWetness.value = w;
  }

  private placeMesh(mesh: THREE.Mesh, cx: number, cz: number): void {
    mesh.position.set(cx * CHUNK_SIZE - this.originOff.x, 0, cz * CHUNK_SIZE - this.originOff.y);
    mesh.updateMatrix();
  }

  private resFor(dist: number): number {
    if (dist <= 1) return LOD0_RES;
    if (dist <= 3) return 32;
    return 16;
  }

  private refresh(): void {
    const f = this.getWorldFocus();
    const pcx = Terrain.toChunk(f.x);
    const pcz = Terrain.toChunk(f.z);
    const r = this.viewRadius;
    const wanted: { cx: number; cz: number; res: number; dist: number }[] = [];
    for (let j = -r; j <= r; j++) {
      for (let i = -r; i <= r; i++) {
        const dist = Math.max(Math.abs(i), Math.abs(j));
        wanted.push({ cx: pcx + i, cz: pcz + j, res: this.resFor(dist), dist });
      }
    }
    wanted.sort((a, b) => a.dist - b.dist);

    this.queue = [];
    for (const w of wanted) {
      const key = `${w.cx},${w.cz}`;
      let rec = this.chunks.get(key);
      if (!rec) {
        rec = { mesh: null, res: 0, pendingRes: w.res, inFlight: false, physics: null };
        this.chunks.set(key, rec);
      } else if (rec.res !== w.res) {
        rec.pendingRes = w.res;
      } else {
        rec.pendingRes = null; // 已是期望分辨率
      }
      if (rec.pendingRes !== null && !rec.inFlight) this.queue.push(w);
    }

    // 卸载远端区块
    for (const [key, rec] of this.chunks) {
      const [cx, cz] = key.split(',').map(Number);
      if (Math.max(Math.abs(cx - pcx), Math.abs(cz - pcz)) > this.unloadRadius) {
        if (rec.mesh) {
          this.group.remove(rec.mesh);
          rec.mesh.geometry.dispose();
        }
        this.chunks.delete(key);
      }
    }
    this.dispatch();
  }

  private dispatch(): void {
    for (const slot of this.slots) {
      if (slot.busy) continue;
      // 跳过过期/在途的队列项，直到找到有效任务
      let next: { cx: number; cz: number; res: number } | undefined;
      let rec: ChunkRecord | undefined;
      for (;;) {
        next = this.queue.shift();
        if (!next) return;
        const key = `${next.cx},${next.cz}`;
        rec = this.chunks.get(key);
        if (rec && !rec.inFlight && rec.pendingRes === next.res) break;
      }
      rec!.inFlight = true;
      slot.busy = true;
      slot.currentKey = `${next.cx},${next.cz}`;
      const req: ChunkRequest = {
        id: this.reqId++,
        cx: next.cx,
        cz: next.cz,
        size: CHUNK_SIZE,
        res: next.res,
        seed: this.seed,
      };
      slot.worker.postMessage(req);
    }
  }

  private onChunkData(data: ChunkResult): void {
    const key = `${data.cx},${data.cz}`;
    const rec = this.chunks.get(key);
    if (!rec) return; // 已卸载
    rec.inFlight = false;
    if (rec.pendingRes !== data.res) return; // 期望已变更，丢弃
    if (rec.mesh) {
      this.group.remove(rec.mesh);
      rec.mesh.geometry.dispose();
    }
    const mesh = buildChunkMesh(data, this.material);
    this.placeMesh(mesh, data.cx, data.cz);
    this.group.add(mesh);
    rec.mesh = mesh;
    rec.res = data.res;
    rec.pendingRes = null;
    rec.physics =
      data.res === LOD0_RES ? { positions: data.positions, indices: data.indices } : null;
  }
}
