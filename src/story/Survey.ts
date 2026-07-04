import type { Engine } from '../core/Engine';
import type { Player } from '../player/Player';
import type { PoiManager } from '../world/PoiManager';
import type { Scanner } from '../player/Scanner';
import type { Heightfield } from '../world/heightfield';
import { PoiKind } from '../world/poi';

const TOWER_TOP = 24; // 顶部平台高度阈值（H=26，平台 26.3）
const BOOST_DURATION = 1800; // 30 分钟扫描冷却减半
export const SURVEY_RADIUS = 2000;

/** 测绘塔：站上信标塔顶平台自动测绘——记录揭示圆（供全息地图）+ 扫描冷却减半 */
export class Survey {
  /** 已测绘塔（POI cell key "cx,cz"） */
  surveyed = new Set<string>();
  private boostLeft = 0;
  private checkTimer = 0;
  private toast: HTMLElement;

  constructor(
    private engine: Engine,
    private player: Player,
    private poi: PoiManager,
    private scanner: Scanner,
    private hf: Heightfield,
  ) {
    this.toast = document.createElement('div');
    this.toast.style.cssText =
      'position:fixed;top:140px;left:50%;transform:translateX(-50%);color:#8fffcf;' +
      'font:13px monospace;letter-spacing:2px;opacity:0;transition:opacity .5s;z-index:30;pointer-events:none;' +
      'text-shadow:0 0 8px rgba(110,255,190,.6)';
    document.body.appendChild(this.toast);
  }

  restore(keys: string[]): void {
    this.surveyed = new Set(keys);
  }

  /** 已测绘塔的揭示圆（世界坐标，供地图） */
  surveyCircles(): { x: number; z: number; r: number }[] {
    const out: { x: number; z: number; r: number }[] = [];
    for (const key of this.surveyed) {
      const [cx, cz] = key.split(',').map(Number);
      const site = this.poi.siteAtCell(cx, cz);
      if (site) out.push({ x: site.x, z: site.z, r: SURVEY_RADIUS });
    }
    return out;
  }

  update(dt: number): void {
    this.boostLeft = Math.max(0, this.boostLeft - dt);
    this.scanner.cooldownMul = this.boostLeft > 0 ? 0.5 : 1;

    this.checkTimer -= dt;
    if (this.checkTimer > 0) return;
    this.checkTimer = 1;

    const w = this.player.worldPosition();
    const near = this.poi.nearestFrom(w.x, w.z);
    if (!near || near.site.kind !== PoiKind.TOWER) return;
    const key = `${near.site.cellX},${near.site.cellZ}`;
    if (this.surveyed.has(key)) return;
    const groundY = this.hf.height(near.site.x, near.site.z);
    if (near.dist < 5 && w.y - groundY > TOWER_TOP) {
      this.surveyed.add(key);
      this.boostLeft = BOOST_DURATION;
      this.toast.textContent = '◈ 区域测绘完成 — 地图已更新 · 扫描冷却减半 30 分钟';
      this.toast.style.opacity = '1';
      setTimeout(() => (this.toast.style.opacity = '0'), 4000);
      this.engine.bus.emit('survey:completed', { key });
    }
  }
}
