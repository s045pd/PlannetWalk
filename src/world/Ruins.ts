import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { citySiteAt, CITY_CELL, type CitySite } from './citySites';
import { buildRuinedTower } from './Building';
import { mulberry32 } from './noise';
import type { Heightfield } from './heightfield';
import type { FloatingOrigin } from './FloatingOrigin';
import type { Physics } from '../physics/Physics';

const STREET = 60;
const COLLIDER_RANGE = 300;

interface BuildingRec {
  x: number; // 世界坐标
  z: number;
  y: number;
  rotY: number;
  half: { x: number; y: number; z: number };
  body: RAPIER.RigidBody | null;
}

interface CityRec {
  mesh: THREE.Mesh;
  props: THREE.InstancedMesh[];
  buildings: BuildingRec[];
  site: CitySite;
}

function hashKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

/** 废墟城市：按站点装配坍塌楼宇群 + 街道散布物 + 就近碰撞体 */
export class Ruins {
  readonly group = new THREE.Group();
  private cities = new Map<string, CityRec>();
  private mat: THREE.MeshStandardMaterial;
  private propGeos: { geo: THREE.BufferGeometry; color: THREE.Color }[];
  private checkTimer = 0;

  constructor(
    scene: THREE.Scene,
    private seed: number,
    private hf: Heightfield,
    private origin: FloatingOrigin,
    private physics: Physics,
    private getWorldFocus: () => { x: number; z: number },
  ) {
    scene.add(this.group);
    this.mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.92,
      metalness: 0.05,
    });
    // 散布物模板：集装箱 / 废弃车壳 / 倒塌灯柱
    const container = new THREE.BoxGeometry(6, 2.5, 2.5);
    container.translate(0, 1.25, 0);
    const carBody = new THREE.BoxGeometry(4.2, 1, 1.9);
    carBody.translate(0, 0.55, 0);
    const carTop = new THREE.BoxGeometry(2.2, 0.7, 1.7);
    carTop.translate(-0.2, 1.35, 0);
    const car = mergeGeometries([carBody, carTop], false);
    const post = new THREE.BoxGeometry(0.25, 9, 0.25);
    post.rotateZ(Math.PI / 2 - 0.15); // 倒塌的灯柱
    post.translate(0, 0.6, 0);
    this.propGeos = [
      { geo: container, color: new THREE.Color(0.45, 0.3, 0.2) },
      { geo: car, color: new THREE.Color(0.32, 0.33, 0.35) },
      { geo: post, color: new THREE.Color(0.35, 0.36, 0.38) },
    ];
    origin.onShift(() => this.repositionAll());
  }

  update(dt: number): void {
    this.checkTimer -= dt;
    if (this.checkTimer > 0) return;
    this.checkTimer = 1;

    const f = this.getWorldFocus();
    const ccx = Math.floor(f.x / CITY_CELL);
    const ccz = Math.floor(f.z / CITY_CELL);
    // 周围 5x5 cell 内的城市建立，之外销毁
    for (let j = -2; j <= 2; j++) {
      for (let i = -2; i <= 2; i++) {
        const site = citySiteAt(this.seed, ccx + i, ccz + j);
        if (!site) continue;
        const key = hashKey(site.cellX, site.cellZ);
        if (!this.cities.has(key)) this.buildCity(key, site);
      }
    }
    for (const [key, city] of this.cities) {
      if (
        Math.abs(city.site.cellX - ccx) > 2 ||
        Math.abs(city.site.cellZ - ccz) > 2
      ) {
        this.disposeCity(key, city);
      }
    }
    this.syncColliders(f);
  }

  private buildCity(key: string, site: CitySite): void {
    const rng = mulberry32((this.seed ^ (site.cellX * 73856093) ^ (site.cellZ * 19349663)) >>> 0);
    const baseY = this.hf.height(site.x, site.z);
    const geos: THREE.BufferGeometry[] = [];
    const buildings: BuildingRec[] = [];
    const propSpots: { x: number; z: number; rot: number }[] = [];

    const cells = Math.floor(site.radius / STREET);
    for (let gj = -cells; gj <= cells; gj++) {
      for (let gi = -cells; gi <= cells; gi++) {
        const px = gi * STREET;
        const pz = gj * STREET;
        const d = Math.hypot(px, pz);
        if (d > site.radius * 0.95) continue;
        const prob = 0.8 * (1 - d / site.radius);
        if (rng() > prob) {
          // 空地块：可能放散布物
          if (rng() < 0.5) propSpots.push({ x: site.x + px, z: site.z + pz, rot: rng() * 6.28 });
          continue;
        }
        const jx = (rng() - 0.5) * 14;
        const jz = (rng() - 0.5) * 14;
        const bx = site.x + px + jx;
        const bz = site.z + pz + jz;
        const by = this.hf.height(bx, bz);
        const { geometry, halfExtents } = buildRuinedTower(rng, 14 + rng() * 10);
        const rotY = site.rot + (rng() - 0.5) * 0.12;
        geometry.rotateY(rotY);
        geometry.translate(bx - site.x, by - baseY, bz - site.z);
        geos.push(geometry);
        buildings.push({ x: bx, z: bz, y: by, rotY, half: halfExtents, body: null });
        // 楼旁街道散布物
        if (rng() < 0.6)
          propSpots.push({
            x: bx + (rng() - 0.5) * 40,
            z: bz + (rng() - 0.5) * 40,
            rot: rng() * 6.28,
          });
      }
    }
    if (geos.length === 0) return;

    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    const mesh = new THREE.Mesh(merged, this.mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;

    // 街道散布物 InstancedMesh
    const props: THREE.InstancedMesh[] = [];
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (const tpl of this.propGeos) {
      const spots = propSpots.filter(() => rng() < 0.4);
      if (spots.length === 0) continue;
      const im = new THREE.InstancedMesh(
        tpl.geo,
        new THREE.MeshStandardMaterial({ color: tpl.color, roughness: 0.9 }),
        spots.length,
      );
      spots.forEach((s, idx) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.rot);
        const sy = this.hf.height(s.x, s.z);
        m4.compose(
          new THREE.Vector3(s.x - site.x, sy - baseY, s.z - site.z),
          q,
          new THREE.Vector3(1, 1, 1).multiplyScalar(0.8 + rng() * 0.5),
        );
        im.setMatrixAt(idx, m4);
      });
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = true;
      im.receiveShadow = true;
      im.matrixAutoUpdate = false;
      props.push(im);
      mesh.add(im);
    }

    const rec: CityRec = { mesh, props, buildings, site };
    this.cities.set(key, rec);
    this.placeCity(rec);
    this.group.add(mesh);
  }

  private placeCity(rec: CityRec): void {
    const baseY = this.hf.height(rec.site.x, rec.site.z);
    rec.mesh.position.set(
      rec.site.x - this.origin.totalOffset.x,
      baseY,
      rec.site.z - this.origin.totalOffset.z,
    );
    rec.mesh.updateMatrix();
    rec.mesh.updateMatrixWorld(true);
  }

  private repositionAll(): void {
    for (const rec of this.cities.values()) this.placeCity(rec);
  }

  private disposeCity(key: string, rec: CityRec): void {
    for (const b of rec.buildings) {
      if (b.body) {
        this.physics.world.removeRigidBody(b.body);
        b.body = null;
      }
    }
    this.group.remove(rec.mesh);
    rec.mesh.geometry.dispose();
    for (const p of rec.props) (p.material as THREE.Material).dispose();
    this.cities.delete(key);
  }

  /** 仅玩家 300m 内的楼宇建碰撞体 */
  private syncColliders(f: { x: number; z: number }): void {
    for (const rec of this.cities.values()) {
      for (const b of rec.buildings) {
        const dist = Math.hypot(b.x - f.x, b.z - f.z);
        if (dist < COLLIDER_RANGE && !b.body) {
          const body = this.physics.world.createRigidBody(
            RAPIER.RigidBodyDesc.fixed()
              .setTranslation(
                b.x - this.origin.totalOffset.x,
                b.y + b.half.y,
                b.z - this.origin.totalOffset.z,
              )
              .setRotation(
                new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.rotY),
              ),
          );
          this.physics.world.createCollider(
            RAPIER.ColliderDesc.cuboid(b.half.x, b.half.y, b.half.z),
            body,
          );
          b.body = body;
        } else if (dist >= COLLIDER_RANGE + 60 && b.body) {
          this.physics.world.removeRigidBody(b.body);
          b.body = null;
        }
      }
    }
  }
}
