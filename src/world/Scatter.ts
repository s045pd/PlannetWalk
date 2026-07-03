import * as THREE from 'three';
import { mulberry32 } from './noise';
import { nearestCity } from './citySites';
import type { Heightfield } from './heightfield';
import type { FloatingOrigin } from './FloatingOrigin';

const ROCK_COUNT = 600;
const RANGE = 700;
const REBUILD_DIST = 350;

/** 野外岩石散布：以玩家为中心按 100m 网格种子确定性布置，走远后重建 */
export class Scatter {
  private rocks: THREE.InstancedMesh;
  private lastCenter = new THREE.Vector2(Infinity, Infinity);

  constructor(
    scene: THREE.Scene,
    private seed: number,
    private hf: Heightfield,
    private origin: FloatingOrigin,
    private getWorldFocus: () => { x: number; z: number },
  ) {
    const geo = new THREE.IcosahedronGeometry(1, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0x635c54, roughness: 0.95 });
    this.rocks = new THREE.InstancedMesh(geo, mat, ROCK_COUNT);
    this.rocks.castShadow = true;
    this.rocks.receiveShadow = true;
    this.rocks.frustumCulled = false;
    scene.add(this.rocks);
    origin.onShift(() => this.rebuild());
  }

  update(): void {
    const f = this.getWorldFocus();
    if (Math.hypot(f.x - this.lastCenter.x, f.z - this.lastCenter.y) > REBUILD_DIST) {
      this.rebuild();
    }
  }

  private rebuild(): void {
    const f = this.getWorldFocus();
    this.lastCenter.set(f.x, f.z);
    const cellSize = 100;
    const cells = Math.floor(RANGE / cellSize);
    const ccx = Math.round(f.x / cellSize);
    const ccz = Math.round(f.z / cellSize);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const eul = new THREE.Euler();
    let idx = 0;

    for (let j = -cells; j <= cells && idx < ROCK_COUNT; j++) {
      for (let i = -cells; i <= cells && idx < ROCK_COUNT; i++) {
        const cx = ccx + i;
        const cz = ccz + j;
        const rng = mulberry32((this.seed ^ (cx * 2654435761) ^ (cz * 40503)) >>> 0);
        if (rng() > 0.32) continue; // 该网格无岩石
        const x = cx * cellSize + (rng() - 0.5) * cellSize;
        const z = cz * cellSize + (rng() - 0.5) * cellSize;
        const city = nearestCity(this.seed, x, z);
        if (city && Math.hypot(x - city.x, z - city.z) < city.radius + 50) continue;
        const y = this.hf.height(x, z);
        eul.set(rng() * 3.14, rng() * 3.14, rng() * 3.14);
        q.setFromEuler(eul);
        const s = 0.4 + rng() * rng() * 3.2;
        m4.compose(
          new THREE.Vector3(x - this.origin.totalOffset.x, y + s * 0.15, z - this.origin.totalOffset.z),
          q,
          new THREE.Vector3(s, s * (0.6 + rng() * 0.5), s),
        );
        this.rocks.setMatrixAt(idx++, m4);
      }
    }
    // 其余实例移出视野
    m4.makeTranslation(0, -9999, 0);
    for (let k = idx; k < ROCK_COUNT; k++) this.rocks.setMatrixAt(k, m4);
    this.rocks.instanceMatrix.needsUpdate = true;
  }
}
