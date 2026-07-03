import * as THREE from 'three';
import { LOGS, pickLogForSite, addCollected } from './logs';
import { citySiteAt, CITY_CELL } from '../world/citySites';
import { mulberry32 } from '../world/noise';
import type { Heightfield } from '../world/heightfield';
import type { FloatingOrigin } from '../world/FloatingOrigin';
import type { Engine } from '../core/Engine';
import type { Player } from '../player/Player';

const BUILD_RANGE = 900;
const PICKUP_RANGE = 3.2;

export interface LogSpot {
  key: string;
  x: number; // 世界坐标
  z: number;
  logIndex: number;
}

interface PadRec {
  spot: LogSpot;
  group: THREE.Group;
  baseY: number;
  beamMat: THREE.MeshBasicMaterial;
}

/** 叙事数据板：城市/POI 站点确定性放置，接近拾取，打字机呈现由 HUD 订阅事件完成 */
export class LogPickups {
  collected = new Set<string>();
  nearbyPad: LogSpot | null = null;
  private spots = new Map<string, LogSpot>();
  private pads = new Map<string, PadRec>();
  /** 已拾取的点位 key，防止确定性生成把它复活 */
  usedSpotKeys = new Set<string>();
  private padGeo: THREE.BoxGeometry;
  private padMat: THREE.MeshStandardMaterial;
  private beamGeo: THREE.PlaneGeometry;
  private beamMat: THREE.MeshBasicMaterial;
  private checkTimer = 0;
  private time = 0;

  constructor(
    private engine: Engine,
    private seed: number,
    private hf: Heightfield,
    private origin: FloatingOrigin,
    private player: Player,
  ) {
    this.padGeo = new THREE.BoxGeometry(0.38, 0.06, 0.26);
    this.padMat = new THREE.MeshStandardMaterial({
      color: 0x1a2b33,
      emissive: new THREE.Color(0x35c7ff),
      emissiveIntensity: 1.6,
      roughness: 0.4,
    });
    this.beamGeo = new THREE.PlaneGeometry(0.5, 5);
    this.beamMat = new THREE.MeshBasicMaterial({
      color: 0x57d8ff,
      transparent: true,
      opacity: 0.16,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    origin.onShift(() => this.repositionAll());
  }

  /** 供 POI 等外部系统注册数据板点位（世界坐标） */
  addSpot(key: string, x: number, z: number, logIndex: number): void {
    if (!this.spots.has(key) && !this.usedSpotKeys.has(key))
      this.spots.set(key, { key, x, z, logIndex });
  }

  /** 城市站点内生成 2 块数据板点位 */
  private ensureCitySpots(f: { x: number; z: number }): void {
    const ccx = Math.floor(f.x / CITY_CELL);
    const ccz = Math.floor(f.z / CITY_CELL);
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const site = citySiteAt(this.seed, ccx + i, ccz + j);
        if (!site) continue;
        const rng = mulberry32(
          (this.seed ^ (site.cellX * 92821) ^ (site.cellZ * 68917) ^ 0x109) >>> 0,
        );
        for (let slot = 0; slot < 2; slot++) {
          const key = `city:${site.cellX},${site.cellZ}:${slot}`;
          if (this.spots.has(key) || this.usedSpotKeys.has(key)) continue;
          // 街口位置：网格交叉点 + 半格偏移，避开楼宇地块中心
          const cells = Math.max(1, Math.floor((site.radius * 0.6) / 60));
          const gi = Math.floor(rng() * cells * 2) - cells;
          const gj = Math.floor(rng() * cells * 2) - cells;
          const lx = gi * 60 + 30;
          const lz = gj * 60 + 30;
          const cos = Math.cos(site.rot);
          const sin = Math.sin(site.rot);
          this.spots.set(key, {
            key,
            x: site.x + lx * cos - lz * sin,
            z: site.z + lx * sin + lz * cos,
            logIndex: pickLogForSite(this.seed, site.cellX, site.cellZ, slot),
          });
        }
      }
    }
  }

  private buildPad(spot: LogSpot): void {
    const group = new THREE.Group();
    const pad = new THREE.Mesh(this.padGeo, this.padMat);
    pad.rotation.y = Math.random() * Math.PI;
    const beamMat = this.beamMat.clone(); // 每板独立：近距离淡出
    const beam = new THREE.Mesh(this.beamGeo, beamMat);
    beam.position.y = 2.5;
    const beam2 = beam.clone();
    beam2.rotation.y = Math.PI / 2;
    group.add(pad, beam, beam2);
    const baseY = this.hf.height(spot.x, spot.z) + 0.45;
    group.position.set(
      spot.x - this.origin.totalOffset.x,
      baseY,
      spot.z - this.origin.totalOffset.z,
    );
    this.engine.scene.add(group);
    this.pads.set(spot.key, { spot, group, baseY, beamMat });
  }

  private repositionAll(): void {
    for (const rec of this.pads.values()) {
      rec.group.position.set(
        rec.spot.x - this.origin.totalOffset.x,
        rec.baseY,
        rec.spot.z - this.origin.totalOffset.z,
      );
    }
  }

  update(dt: number): void {
    this.time += dt;
    const w = this.player.worldPosition();

    this.checkTimer -= dt;
    if (this.checkTimer <= 0) {
      this.checkTimer = 1;
      this.ensureCitySpots({ x: w.x, z: w.z });
      // 视距内建板 / 视距外回收
      for (const spot of this.spots.values()) {
        const d = Math.hypot(spot.x - w.x, spot.z - w.z);
        if (d < BUILD_RANGE && !this.pads.has(spot.key)) this.buildPad(spot);
      }
      for (const [key, rec] of this.pads) {
        if (Math.hypot(rec.spot.x - w.x, rec.spot.z - w.z) > BUILD_RANGE + 200) {
          this.engine.scene.remove(rec.group);
          this.pads.delete(key);
        }
      }
    }

    // 浮动呼吸 + 接近检测 + 光柱近距离淡出
    this.nearbyPad = null;
    for (const rec of this.pads.values()) {
      rec.group.position.y = rec.baseY + Math.sin(this.time * 1.6 + rec.baseY) * 0.08;
      rec.group.rotation.y += dt * 0.4;
      const d = Math.hypot(rec.spot.x - w.x, rec.spot.z - w.z);
      rec.beamMat.opacity = 0.16 * Math.min(1, Math.max(0, (d - 4) / 12));
      if (d < PICKUP_RANGE) this.nearbyPad = rec.spot;
    }

    if (this.nearbyPad && !this.player.riding && this.engine.input.consumePressed('KeyE')) {
      this.collect(this.nearbyPad);
    }
  }

  private collect(spot: LogSpot): void {
    const log = LOGS[spot.logIndex];
    const already = this.collected.has(log.id);
    this.collected = addCollected(this.collected, log.id);
    this.usedSpotKeys.add(spot.key);
    const rec = this.pads.get(spot.key);
    if (rec) {
      this.engine.scene.remove(rec.group);
      this.pads.delete(spot.key);
    }
    this.spots.delete(spot.key);
    this.engine.bus.emit('log:collected', {
      id: log.id,
      title: log.title,
      body: log.body,
      already,
      total: LOGS.length,
      count: this.collected.size,
    });
  }
}
