import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { poiSiteAt, POI_CELL, PoiKind, type PoiSite } from './poi';
import { pickLogForSite } from '../story/logs';
import { mulberry32 } from './noise';
import type { Heightfield } from './heightfield';
import type { FloatingOrigin } from '../world/FloatingOrigin';
import type { Physics } from '../physics/Physics';
import type { LogPickups } from '../story/LogPickups';

const VIEW_CELLS = 2; // 5x5 POI cells ≈ ±2.5km
const COLLIDER_RANGE = 220;

interface PoiRec {
  site: PoiSite;
  group: THREE.Group;
  beacon: THREE.Mesh | null;
  colliderDefs: { x: number; y: number; z: number; hx: number; hy: number; hz: number; rotY: number }[];
  bodies: RAPIER.RigidBody[];
  baseY: number;
}

const CONCRETE = new THREE.Color(0.45, 0.43, 0.4);
const HULL = new THREE.Color(0.35, 0.33, 0.3);
const RUST = new THREE.Color(0.4, 0.25, 0.16);
const SHARD = new THREE.Color(0.5, 0.55, 0.58);

function coloredBox(
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  color: THREE.Color,
): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  const count = g.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

/** POI 装配器：坠毁船 / 信标塔（可拾级登顶）/ 环碎片陨坑 */
export class PoiManager {
  readonly group = new THREE.Group();
  private pois = new Map<string, PoiRec>();
  private mat: THREE.MeshStandardMaterial;
  private beaconMat: THREE.MeshBasicMaterial;
  private checkTimer = 0;
  private time = 0;

  constructor(
    scene: THREE.Scene,
    private seed: number,
    private hf: Heightfield,
    private origin: FloatingOrigin,
    private physics: Physics,
    private logPickups: LogPickups,
    private getWorldFocus: () => { x: number; z: number },
  ) {
    scene.add(this.group);
    this.mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.85,
      metalness: 0.2,
    });
    this.beaconMat = new THREE.MeshBasicMaterial({ color: 0xff5a3c });
    origin.onShift(() => this.repositionAll());
  }

  /** 供 HUD 罗盘信标查询：最近 POI（世界坐标） */
  nearestFrom(x: number, z: number): { site: PoiSite; dist: number; bearing: number } | null {
    let best: PoiSite | null = null;
    let bestD = Infinity;
    const ccx = Math.floor(x / POI_CELL);
    const ccz = Math.floor(z / POI_CELL);
    for (let j = -3; j <= 3; j++) {
      for (let i = -3; i <= 3; i++) {
        const p = poiSiteAt(this.seed, ccx + i, ccz + j);
        if (!p) continue;
        const d = Math.hypot(x - p.x, z - p.z);
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
    }
    if (!best) return null;
    return { site: best, dist: bestD, bearing: Math.atan2(best.x - x, best.z - z) };
  }

  update(dt: number): void {
    this.time += dt;
    // 信标呼吸闪烁
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 3);
    this.beaconMat.color.setRGB(1 * (0.4 + 0.6 * pulse), 0.35 * pulse, 0.24 * pulse);

    this.checkTimer -= dt;
    if (this.checkTimer > 0) return;
    this.checkTimer = 1;

    const f = this.getWorldFocus();
    const ccx = Math.floor(f.x / POI_CELL);
    const ccz = Math.floor(f.z / POI_CELL);
    for (let j = -VIEW_CELLS; j <= VIEW_CELLS; j++) {
      for (let i = -VIEW_CELLS; i <= VIEW_CELLS; i++) {
        const site = poiSiteAt(this.seed, ccx + i, ccz + j);
        if (!site) continue;
        const key = `${site.cellX},${site.cellZ}`;
        if (!this.pois.has(key)) this.buildPoi(key, site);
      }
    }
    for (const [key, rec] of this.pois) {
      if (
        Math.abs(rec.site.cellX - ccx) > VIEW_CELLS + 1 ||
        Math.abs(rec.site.cellZ - ccz) > VIEW_CELLS + 1
      ) {
        this.disposePoi(key, rec);
      }
    }
    this.syncColliders(f);
  }

  private buildPoi(key: string, site: PoiSite): void {
    const rng = mulberry32((this.seed ^ (site.cellX * 48271) ^ (site.cellZ * 16807) ^ 0x7f1) >>> 0);
    const baseY = this.hf.height(site.x, site.z);
    const geos: THREE.BufferGeometry[] = [];
    const colliderDefs: PoiRec['colliderDefs'] = [];
    let beacon: THREE.Mesh | null = null;
    const group = new THREE.Group();

    if (site.kind === PoiKind.WRECK) {
      // 半埋倾斜船体：主舱段 + 断裂尾段 + 散落残骸
      const hull = coloredBox(22, 5.5, 6.5, 0, 1.6, 0, HULL);
      hull.rotateZ(0.16 + rng() * 0.1);
      geos.push(hull);
      const tail = coloredBox(8, 4.5, 5.5, 16 + rng() * 4, 0.8, 3 + rng() * 3, RUST);
      tail.rotateY(rng() * 0.8);
      geos.push(tail);
      const fin = coloredBox(0.5, 6, 3.5, -8, 4, 0, RUST);
      fin.rotateZ(0.3);
      geos.push(fin);
      for (let i = 0; i < 8; i++) {
        const s = 0.6 + rng() * 1.8;
        const g = coloredBox(
          s,
          s * 0.6,
          s,
          (rng() - 0.5) * 46,
          s * 0.2,
          (rng() - 0.5) * 40,
          rng() < 0.5 ? HULL : RUST,
        );
        g.rotateY(rng() * Math.PI);
        geos.push(g);
      }
      colliderDefs.push({ x: 0, y: 3, z: 0, hx: 12, hy: 3, hz: 3.5, rotY: 0 });
      colliderDefs.push({ x: 17, y: 2, z: 4, hx: 4.5, hy: 2.2, hz: 3, rotY: 0.4 });
      this.logPickups.addSpot(
        `poi:${key}`,
        site.x + 8,
        site.z - 7,
        pickLogForSite(this.seed, site.cellX, site.cellZ, 2),
      );
    } else if (site.kind === PoiKind.TOWER) {
      // 信标塔：格架 + 螺旋台阶（autostep 可走）+ 顶部平台
      const H = 26;
      for (const [lx, lz] of [
        [-2.2, -2.2],
        [2.2, -2.2],
        [-2.2, 2.2],
        [2.2, 2.2],
      ]) {
        geos.push(coloredBox(0.45, H, 0.45, lx * 0.8, H / 2, lz * 0.8, CONCRETE));
      }
      geos.push(coloredBox(1.2, H, 1.2, 0, H / 2, 0, HULL)); // 中央桅杆
      colliderDefs.push({ x: 0, y: H / 2, z: 0, hx: 0.7, hy: H / 2, hz: 0.7, rotY: 0 });
      // 螺旋台阶到 ~15m（autostep 可走），其上两级跳台留给喷气背包
      const steps = 32;
      for (let s = 0; s < steps; s++) {
        const ang = s * 0.55;
        const r = 3.1;
        const sx = Math.cos(ang) * r;
        const sz = Math.sin(ang) * r;
        const sy = 0.6 + s * 0.44;
        geos.push(coloredBox(2.0, 0.18, 1.1, sx, sy, sz, CONCRETE));
        colliderDefs.push({ x: sx, y: sy, z: sz, hx: 1.0, hy: 0.09, hz: 0.55, rotY: -ang });
      }
      const midY = 0.6 + steps * 0.44 + 0.2; // ~14.9m 中层平台
      geos.push(coloredBox(4.5, 0.25, 4.5, 0, midY, 0, HULL));
      colliderDefs.push({ x: 0, y: midY, z: 0, hx: 2.25, hy: 0.13, hz: 2.25, rotY: 0 });
      const jumpY = midY + 5; // 跳台
      geos.push(coloredBox(2.6, 0.25, 2.6, 2.4, jumpY, 0, CONCRETE));
      colliderDefs.push({ x: 2.4, y: jumpY, z: 0, hx: 1.3, hy: 0.13, hz: 1.3, rotY: 0 });
      const py = H + 0.3; // 顶部平台
      geos.push(coloredBox(6, 0.3, 6, 0, py, 0, HULL));
      colliderDefs.push({ x: 0, y: py, z: 0, hx: 3, hy: 0.15, hz: 3, rotY: 0 });
      // 信标灯（顶端）
      beacon = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), this.beaconMat);
      beacon.position.y = py + 3;
      group.add(beacon);
      geos.push(coloredBox(0.3, 6, 0.3, 0, py + 1.5, 0, RUST));
      this.logPickups.addSpot(
        `poi:${key}`,
        site.x + 6,
        site.z + 6,
        pickLogForSite(this.seed, site.cellX, site.cellZ, 2),
      );
    } else {
      // 陨坑：斜插的巨型环碎片（发光棱缘由 bloom 拾取）
      const shardGeo = new THREE.IcosahedronGeometry(1, 0);
      shardGeo.scale(5, 20, 6);
      const count = shardGeo.getAttribute('position').count;
      const colors = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        colors[i * 3] = SHARD.r;
        colors[i * 3 + 1] = SHARD.g;
        colors[i * 3 + 2] = SHARD.b;
      }
      shardGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      shardGeo.rotateZ(0.5 + rng() * 0.3);
      shardGeo.rotateY(rng() * Math.PI);
      shardGeo.translate(0, 6, 0);
      geos.push(shardGeo);
      colliderDefs.push({ x: 0, y: 7, z: 0, hx: 4.5, hy: 12, hz: 5, rotY: rng() });
      // 碎片余烬微光
      const glow = new THREE.Mesh(
        new THREE.CircleGeometry(7, 20),
        new THREE.MeshBasicMaterial({
          color: 0x6fe0d8,
          transparent: true,
          opacity: 0.12,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      glow.rotation.x = -Math.PI / 2;
      glow.position.y = 0.3;
      group.add(glow);
      this.logPickups.addSpot(
        `poi:${key}`,
        site.x + site.radius * 0.5,
        site.z,
        pickLogForSite(this.seed, site.cellX, site.cellZ, 2),
      );
    }

    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    merged.rotateY(site.rot);
    const mesh = new THREE.Mesh(merged, this.mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);

    const rec: PoiRec = { site, group, beacon, colliderDefs, bodies: [], baseY };
    this.pois.set(key, rec);
    this.placePoi(rec);
    this.group.add(group);
  }

  private placePoi(rec: PoiRec): void {
    rec.group.position.set(
      rec.site.x - this.origin.totalOffset.x,
      rec.baseY,
      rec.site.z - this.origin.totalOffset.z,
    );
  }

  private repositionAll(): void {
    for (const rec of this.pois.values()) this.placePoi(rec);
  }

  private disposePoi(key: string, rec: PoiRec): void {
    for (const b of rec.bodies) this.physics.world.removeRigidBody(b);
    this.group.remove(rec.group);
    rec.group.traverse((o) => {
      if (o instanceof THREE.Mesh && o.geometry !== undefined) o.geometry.dispose();
    });
    this.pois.delete(key);
  }

  /** 玩家附近的 POI 才建碰撞体（台阶盒较多，控制数量） */
  private syncColliders(f: { x: number; z: number }): void {
    const cos = (r: PoiRec): number => Math.cos(r.site.rot);
    const sin = (r: PoiRec): number => Math.sin(r.site.rot);
    for (const rec of this.pois.values()) {
      const dist = Math.hypot(rec.site.x - f.x, rec.site.z - f.z);
      if (dist < COLLIDER_RANGE && rec.bodies.length === 0) {
        for (const c of rec.colliderDefs) {
          // 站点整体旋转 site.rot 作用于局部偏移
          const wx = rec.site.x + c.x * cos(rec) - c.z * sin(rec);
          const wz = rec.site.z + c.x * sin(rec) + c.z * cos(rec);
          const body = this.physics.world.createRigidBody(
            RAPIER.RigidBodyDesc.fixed()
              .setTranslation(
                wx - this.origin.totalOffset.x,
                rec.baseY + c.y,
                wz - this.origin.totalOffset.z,
              )
              .setRotation(
                new THREE.Quaternion().setFromAxisAngle(
                  new THREE.Vector3(0, 1, 0),
                  c.rotY + rec.site.rot,
                ),
              ),
          );
          this.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(c.hx, c.hy, c.hz), body);
          rec.bodies.push(body);
        }
      } else if (dist >= COLLIDER_RANGE + 80 && rec.bodies.length > 0) {
        for (const b of rec.bodies) this.physics.world.removeRigidBody(b);
        rec.bodies = [];
      }
    }
  }
}
