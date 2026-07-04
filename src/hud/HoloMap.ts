import { CHUNK_SIZE } from '../world/Terrain';
import { MAX_VISITED } from '../core/SaveGame';
import { citySiteAt, CITY_CELL } from '../world/citySites';
import { PoiKind } from '../world/poi';
import type { Engine } from '../core/Engine';
import type { Player } from '../player/Player';
import type { Heightfield } from '../world/heightfield';
import type { PoiManager } from '../world/PoiManager';
import type { Survey } from '../story/Survey';
import type { SignalQuest } from '../story/SignalQuest';

const VIEW_METERS = 6000;

interface MapPoint {
  x: number;
  z: number;
}

/** 全息地图 (M)：只显示到访过的区域与测绘圆，探索即填图 */
export class HoloMap {
  /** 到访 chunk keys（插入序，超限裁最老） */
  visited = new Set<string>();
  open = false;
  /** G5 信标提供者（可选注入） */
  beaconsProvider: (() => MapPoint[]) | null = null;
  /** G10 载具位置提供者 */
  vehiclesProvider: (() => { x: number; z: number; kind: string }[]) | null = null;
  private el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private trackTimer = 0;
  private redrawTimer = 0;
  private heightCache = new Map<string, number>();

  constructor(
    private engine: Engine,
    private player: Player,
    private hf: Heightfield,
    private poi: PoiManager,
    private survey: Survey,
    private quest: SignalQuest,
  ) {
    this.el = document.createElement('div');
    this.el.style.cssText =
      'position:fixed;inset:0;display:none;z-index:45;background:rgba(2,8,13,.88);backdrop-filter:blur(3px)';
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText =
      'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);border:1px solid rgba(159,232,255,.3)';
    const hint = document.createElement('div');
    hint.style.cssText =
      'position:absolute;bottom:26px;left:50%;transform:translateX(-50%);color:rgba(159,232,255,.6);font:11px monospace;letter-spacing:2px';
    hint.textContent = '全息地图 — 只显示到访与测绘区域 · M 关闭';
    this.el.appendChild(this.canvas);
    this.el.appendChild(hint);
    document.body.appendChild(this.el);
    // 地图打开时按 Esc 只关地图（拦截设置菜单）
    window.addEventListener(
      'keydown',
      (e) => {
        if (this.open && e.code === 'Escape') {
          e.stopImmediatePropagation();
          this.toggle();
        }
      },
      { capture: true },
    );
  }

  restore(keys: string[]): void {
    this.visited = new Set(keys.slice(-MAX_VISITED));
  }

  private toggle(): void {
    this.open = !this.open;
    this.el.style.display = this.open ? 'block' : 'none';
    if (this.open) {
      document.exitPointerLock();
      this.draw();
    }
  }

  update(dt: number): void {
    // 探索记录
    this.trackTimer -= dt;
    if (this.trackTimer <= 0) {
      this.trackTimer = 0.5;
      const w = this.player.worldPosition();
      const key = `${Math.floor(w.x / CHUNK_SIZE)},${Math.floor(w.z / CHUNK_SIZE)}`;
      if (!this.visited.has(key)) {
        this.visited.add(key);
        if (this.visited.size > MAX_VISITED) {
          const first = this.visited.values().next().value as string;
          this.visited.delete(first);
        }
      }
    }

    if (this.engine.input.consumePressed('KeyM') && !this.engine.cameraLock) this.toggle();
    if (this.open) {
      this.redrawTimer -= dt;
      if (this.redrawTimer <= 0) {
        this.redrawTimer = 0.5;
        this.draw();
      }
    }
  }

  private chunkHeight(key: string, cx: number, cz: number): number {
    let h = this.heightCache.get(key);
    if (h === undefined) {
      h = this.hf.height((cx + 0.5) * CHUNK_SIZE, (cz + 0.5) * CHUNK_SIZE);
      this.heightCache.set(key, h);
    }
    return h;
  }

  private draw(): void {
    const size = Math.min(window.innerWidth, window.innerHeight) - 90;
    this.canvas.width = size;
    this.canvas.height = size;
    const ctx = this.canvas.getContext('2d')!;
    const w = this.player.worldPosition();
    const scale = size / VIEW_METERS;
    const toPx = (x: number, z: number): [number, number] => [
      size / 2 + (x - w.x) * scale,
      size / 2 + (z - w.z) * scale,
    ];

    ctx.clearRect(0, 0, size, size);

    // 测绘圆（底层微光）
    for (const c of this.survey.surveyCircles()) {
      const [px, pz] = toPx(c.x, c.z);
      ctx.beginPath();
      ctx.arc(px, pz, c.r * scale, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(80, 160, 190, 0.10)';
      ctx.fill();
    }

    // 到访 chunk：高度灰阶
    const cell = Math.max(1.5, CHUNK_SIZE * scale);
    for (const key of this.visited) {
      const [cx, cz] = key.split(',').map(Number);
      const [px, pz] = toPx(cx * CHUNK_SIZE, cz * CHUNK_SIZE);
      if (px < -cell || pz < -cell || px > size || pz > size) continue;
      const h = this.chunkHeight(key, cx, cz);
      const b = Math.round(50 + Math.max(0, Math.min(1, (h + 30) / 240)) * 130);
      ctx.fillStyle = `rgba(${b},${b},${Math.round(b * 0.92)},0.85)`;
      ctx.fillRect(px, pz, cell + 0.5, cell + 0.5);
    }

    // 公里网格
    ctx.strokeStyle = 'rgba(159,232,255,0.08)';
    ctx.lineWidth = 1;
    const kmStep = 1000 * scale;
    const ox = ((-w.x % 1000) + 1000) % 1000;
    const oz = ((-w.z % 1000) + 1000) % 1000;
    for (let x = ox * scale; x < size; x += kmStep) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, size);
      ctx.stroke();
    }
    for (let z = oz * scale; z < size; z += kmStep) {
      ctx.beginPath();
      ctx.moveTo(0, z);
      ctx.lineTo(size, z);
      ctx.stroke();
    }

    const inSurvey = (x: number, z: number): boolean =>
      this.survey.surveyCircles().some((c) => Math.hypot(x - c.x, z - c.z) <= c.r);
    const nearVisited = (x: number, z: number): boolean =>
      this.visited.has(`${Math.floor(x / CHUNK_SIZE)},${Math.floor(z / CHUNK_SIZE)}`);

    // 城市（矩形标记）
    const ccx = Math.floor(w.x / CITY_CELL);
    const ccz = Math.floor(w.z / CITY_CELL);
    ctx.font = '10px monospace';
    for (let j = -2; j <= 2; j++) {
      for (let i = -2; i <= 2; i++) {
        const city = citySiteAt(this.poi.seed, ccx + i, ccz + j);
        if (!city || (!inSurvey(city.x, city.z) && !nearVisited(city.x, city.z))) continue;
        const [px, pz] = toPx(city.x, city.z);
        ctx.strokeStyle = 'rgba(200,220,235,0.8)';
        ctx.strokeRect(px - 5, pz - 5, 10, 10);
        ctx.fillStyle = 'rgba(200,220,235,0.6)';
        ctx.fillText('遗迹', px + 8, pz + 3);
      }
    }

    // POI（菱形）
    for (const site of this.poi.allWithin(w.x, w.z, VIEW_METERS * 0.75)) {
      if (!inSurvey(site.x, site.z) && !nearVisited(site.x, site.z)) continue;
      const [px, pz] = toPx(site.x, site.z);
      const surveyedTower =
        site.kind === PoiKind.TOWER && this.survey.surveyed.has(`${site.cellX},${site.cellZ}`);
      ctx.fillStyle = surveyedTower ? 'rgba(140,255,205,0.95)' : 'rgba(255,179,107,0.9)';
      ctx.beginPath();
      ctx.moveTo(px, pz - 5);
      ctx.lineTo(px + 4, pz);
      ctx.lineTo(px, pz + 5);
      ctx.lineTo(px - 4, pz);
      ctx.closePath();
      ctx.fill();
    }

    // 信标（G5）
    if (this.beaconsProvider) {
      ctx.fillStyle = 'rgba(120,255,160,0.95)';
      for (const b of this.beaconsProvider()) {
        const [px, pz] = toPx(b.x, b.z);
        ctx.beginPath();
        ctx.moveTo(px, pz - 6);
        ctx.lineTo(px + 5, pz + 4);
        ctx.lineTo(px - 5, pz + 4);
        ctx.closePath();
        ctx.fill();
      }
    }

    // 载具（G10）
    if (this.vehiclesProvider) {
      for (const v of this.vehiclesProvider()) {
        const [px, pz] = toPx(v.x, v.z);
        ctx.fillStyle = 'rgba(159,232,255,0.9)';
        ctx.fillRect(px - 3, pz - 3, 6, 6);
        ctx.fillText(v.kind === 'rover' ? '车' : '艇', px + 6, pz + 3);
      }
    }

    // 信号任务目标（脉动圆环）
    const target = this.quest.currentTarget;
    if (target) {
      const [px, pz] = toPx(target.x, target.z);
      const cl = Math.max(6, Math.min(size - 6, px));
      const cz2 = Math.max(6, Math.min(size - 6, pz));
      const pulse = 4 + Math.sin(performance.now() * 0.004) * 2;
      ctx.strokeStyle = 'rgba(87,216,255,0.95)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cl, cz2, pulse + 3, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 玩家箭头（朝向 yaw）
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.rotate(-this.player.yaw + Math.PI);
    ctx.fillStyle = '#9fe8ff';
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(5, 6);
    ctx.lineTo(-5, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // 比例尺
    ctx.strokeStyle = 'rgba(159,232,255,0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(18, size - 18);
    ctx.lineTo(18 + 1000 * scale, size - 18);
    ctx.stroke();
    ctx.fillStyle = 'rgba(159,232,255,0.7)';
    ctx.fillText('1 km', 18, size - 24);
  }
}
