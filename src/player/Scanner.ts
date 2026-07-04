import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import type { Player } from '../player/Player';
import type { PoiManager } from '../world/PoiManager';
import type { LogPickups } from '../story/LogPickups';
import type { FloatingOrigin } from '../world/FloatingOrigin';
import type { Heightfield } from '../world/heightfield';

const RANGE = 400;
const COOLDOWN = 6;
const MARK_LIFE = 4.5;

interface Marker {
  mesh: THREE.Mesh;
  born: number;
  baseY: number;
}

/** 扫描仪：Tab 触发地面扩散脉冲，高亮范围内 POI 与未拾取数据板 */
export class Scanner {
  private ring: THREE.Mesh;
  private ringT = -1;
  private cooldown = 0;
  /** 测绘加成：冷却倍率（Survey 驱动） */
  cooldownMul = 1;
  private markers: Marker[] = [];
  private markerGeo = new THREE.OctahedronGeometry(1.3, 0);
  private poiMat = new THREE.MeshBasicMaterial({
    color: 0xffb36b,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  private logMat = new THREE.MeshBasicMaterial({
    color: 0x57d8ff,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  private time = 0;

  constructor(
    private engine: Engine,
    private player: Player,
    private poi: PoiManager,
    private logs: LogPickups,
    private origin: FloatingOrigin,
    private hf: Heightfield,
  ) {
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.96, 1, 64),
      new THREE.MeshBasicMaterial({
        color: 0x6fe0d8,
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.visible = false;
    engine.scene.add(this.ring);
  }

  private trigger(): void {
    this.cooldown = COOLDOWN * this.cooldownMul;
    this.ringT = 0;
    const local = this.player.localPosition();
    this.ring.position.set(local.x, local.y - 1, local.z);
    this.ring.visible = true;

    const w = this.player.worldPosition();
    // POI 标记
    for (const site of this.poi.allWithin(w.x, w.z, RANGE)) {
      const gy = this.hf.height(site.x, site.z);
      this.addMarker(site.x, gy + 14, site.z, this.poiMat);
    }
    // 未拾取数据板标记
    for (const spot of this.logs.spotsWithin(w.x, w.z, RANGE)) {
      const gy = this.hf.height(spot.x, spot.z);
      this.addMarker(spot.x, gy + 4, spot.z, this.logMat);
    }
  }

  private addMarker(wx: number, wy: number, wz: number, mat: THREE.MeshBasicMaterial): void {
    const m = new THREE.Mesh(this.markerGeo, mat.clone());
    m.position.set(wx - this.origin.totalOffset.x, wy, wz - this.origin.totalOffset.z);
    m.scale.setScalar(1);
    this.engine.scene.add(m);
    this.markers.push({ mesh: m, born: this.time, baseY: wy });
  }

  update(dt: number): void {
    this.time += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (
      this.cooldown === 0 &&
      !this.engine.cameraLock &&
      this.engine.input.consumePressed('Tab')
    ) {
      this.trigger();
    }

    // 扩散环动画
    if (this.ringT >= 0) {
      this.ringT += dt;
      const k = this.ringT / 1.6;
      if (k >= 1) {
        this.ringT = -1;
        this.ring.visible = false;
      } else {
        const r = k * RANGE;
        this.ring.scale.setScalar(Math.max(0.001, r));
        (this.ring.material as THREE.MeshBasicMaterial).opacity = 0.6 * (1 - k);
      }
    }

    // 标记浮动/旋转/淡出
    for (let i = this.markers.length - 1; i >= 0; i--) {
      const mk = this.markers[i];
      const age = this.time - mk.born;
      if (age > MARK_LIFE) {
        this.engine.scene.remove(mk.mesh);
        (mk.mesh.material as THREE.Material).dispose();
        this.markers.splice(i, 1);
        continue;
      }
      mk.mesh.rotation.y += dt * 2;
      mk.mesh.position.y = mk.baseY + Math.sin(this.time * 2 + mk.born) * 0.6;
      (mk.mesh.material as THREE.MeshBasicMaterial).opacity =
        Math.min(1, age * 4) * (1 - Math.max(0, (age - MARK_LIFE + 1) / 1));
    }
  }
}
