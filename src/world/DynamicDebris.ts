import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { citySiteAt, CITY_CELL } from './citySites';
import { mulberry32 } from './noise';
import type { Heightfield } from './heightfield';
import type { FloatingOrigin } from './FloatingOrigin';
import type { Physics } from '../physics/Physics';

const PER_CITY = 12;
const BODY_RANGE = 250;

interface DebrisRec {
  /** 世界坐标姿态（无刚体时的静止位姿） */
  x: number;
  y: number;
  z: number;
  quat: THREE.Quaternion;
  mesh: THREE.Mesh;
  body: RAPIER.RigidBody | null;
  half: { x: number; y: number; z: number };
  mass: number;
}

function coloredBox(
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  c: THREE.Color,
): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  const n = g.getAttribute('position').count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

const CONTAINER_COLORS = [
  new THREE.Color(0.45, 0.28, 0.18),
  new THREE.Color(0.25, 0.35, 0.3),
  new THREE.Color(0.4, 0.36, 0.22),
];
const CAR_BODY = new THREE.Color(0.35, 0.36, 0.38);
const CAR_TOP = new THREE.Color(0.22, 0.24, 0.26);

/** 可推动残骸：城市街道上的动态刚体集装箱/车壳，载具可撞飞 */
export class DynamicDebris {
  private cities = new Map<string, DebrisRec[]>();
  private mat: THREE.MeshStandardMaterial;
  private checkTimer = 0;

  constructor(
    private scene: THREE.Scene,
    private seed: number,
    private hf: Heightfield,
    private origin: FloatingOrigin,
    private physics: Physics,
    private getWorldFocus: () => { x: number; z: number },
  ) {
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.25 });
    origin.onShift(() => this.repositionAll());
  }

  private buildCity(key: string, cellX: number, cellZ: number): void {
    const site = citySiteAt(this.seed, cellX, cellZ);
    if (!site) {
      this.cities.set(key, []);
      return;
    }
    const rng = mulberry32((this.seed ^ (cellX * 31337) ^ (cellZ * 271) ^ 0xdeb) >>> 0);
    const recs: DebrisRec[] = [];
    for (let i = 0; i < PER_CITY; i++) {
      // 街口附近：网格交叉点 + 抖动
      const cells = Math.max(1, Math.floor((site.radius * 0.7) / 60));
      const gi = Math.floor(rng() * cells * 2) - cells;
      const gj = Math.floor(rng() * cells * 2) - cells;
      const lx = gi * 60 + 30 + (rng() - 0.5) * 18;
      const lz = gj * 60 + 30 + (rng() - 0.5) * 18;
      const cos = Math.cos(site.rot);
      const sin = Math.sin(site.rot);
      const x = site.x + lx * cos - lz * sin;
      const z = site.z + lx * sin + lz * cos;

      const isCar = rng() < 0.45;
      let geo: THREE.BufferGeometry;
      let half: DebrisRec['half'];
      let mass: number;
      if (isCar) {
        geo = mergeGeometries(
          [
            coloredBox(4.2, 1.0, 1.9, 0, 0.5, 0, CAR_BODY),
            coloredBox(2.2, 0.7, 1.7, -0.2, 1.35, 0, CAR_TOP),
          ],
          false,
        );
        half = { x: 2.1, y: 0.85, z: 0.95 };
        mass = 320;
      } else {
        const c = CONTAINER_COLORS[Math.floor(rng() * CONTAINER_COLORS.length)];
        geo = coloredBox(6, 2.5, 2.5, 0, 1.25, 0, c);
        half = { x: 3, y: 1.25, z: 1.25 };
        mass = 520;
      }
      const mesh = new THREE.Mesh(geo, this.mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const quat = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        rng() * Math.PI * 2,
      );
      const rec: DebrisRec = { x, y: this.hf.height(x, z), z, quat, mesh, body: null, half, mass };
      this.placeMesh(rec);
      this.scene.add(mesh);
      recs.push(rec);
    }
    this.cities.set(key, recs);
  }

  private placeMesh(rec: DebrisRec): void {
    rec.mesh.position.set(
      rec.x - this.origin.totalOffset.x,
      rec.y,
      rec.z - this.origin.totalOffset.z,
    );
    rec.mesh.quaternion.copy(rec.quat);
  }

  private repositionAll(): void {
    for (const recs of this.cities.values()) {
      for (const rec of recs) if (!rec.body) this.placeMesh(rec);
    }
  }

  private disposeCity(key: string, recs: DebrisRec[]): void {
    for (const rec of recs) {
      if (rec.body) this.physics.world.removeRigidBody(rec.body);
      this.scene.remove(rec.mesh);
      rec.mesh.geometry.dispose();
    }
    this.cities.delete(key);
  }

  update(dt: number): void {
    this.checkTimer -= dt;
    if (this.checkTimer > 0) {
      this.syncMeshes();
      return;
    }
    this.checkTimer = 1;

    const f = this.getWorldFocus();
    const ccx = Math.floor(f.x / CITY_CELL);
    const ccz = Math.floor(f.z / CITY_CELL);
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const key = `${ccx + i},${ccz + j}`;
        if (!this.cities.has(key)) this.buildCity(key, ccx + i, ccz + j);
      }
    }
    for (const [key, recs] of this.cities) {
      const [cx, cz] = key.split(',').map(Number);
      if (Math.abs(cx - ccx) > 2 || Math.abs(cz - ccz) > 2) this.disposeCity(key, recs);
    }

    // 就近激活/回收刚体
    for (const recs of this.cities.values()) {
      for (const rec of recs) {
        const dist = Math.hypot(rec.x - f.x, rec.z - f.z);
        if (dist < BODY_RANGE && !rec.body) {
          const body = this.physics.world.createRigidBody(
            RAPIER.RigidBodyDesc.dynamic()
              .setTranslation(
                rec.x - this.origin.totalOffset.x,
                rec.y + rec.half.y + 0.05,
                rec.z - this.origin.totalOffset.z,
              )
              .setRotation(rec.quat)
              .setLinearDamping(0.4)
              .setAngularDamping(0.8),
          );
          this.physics.world
            .createCollider(RAPIER.ColliderDesc.cuboid(rec.half.x, rec.half.y, rec.half.z), body)
            .setMass(rec.mass);
          rec.body = body;
        } else if (dist >= BODY_RANGE + 60 && rec.body) {
          // 记住最终位姿后休眠为静态 mesh
          const t = rec.body.translation();
          const q = rec.body.rotation();
          rec.x = t.x + this.origin.totalOffset.x;
          rec.y = t.y - rec.half.y;
          rec.z = t.z + this.origin.totalOffset.z;
          rec.quat.set(q.x, q.y, q.z, q.w);
          this.physics.world.removeRigidBody(rec.body);
          rec.body = null;
          this.placeMesh(rec);
        }
      }
    }
    this.syncMeshes();
  }

  /** 刚体位姿 → mesh（注意 mesh 原点在底部，刚体原点在中心） */
  private syncMeshes(): void {
    for (const recs of this.cities.values()) {
      for (const rec of recs) {
        if (!rec.body) continue;
        const t = rec.body.translation();
        const q = rec.body.rotation();
        rec.mesh.quaternion.set(q.x, q.y, q.z, q.w);
        // 中心 → 底部偏移（随姿态旋转）
        TMP_V.set(0, -rec.half.y, 0).applyQuaternion(rec.mesh.quaternion);
        rec.mesh.position.set(t.x + TMP_V.x, t.y + TMP_V.y, t.z + TMP_V.z);
      }
    }
  }
}

const TMP_V = new THREE.Vector3();
