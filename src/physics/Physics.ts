import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { Terrain, CHUNK_SIZE } from '../world/Terrain';
import type { FloatingOrigin } from '../world/FloatingOrigin';

/** 行星重力：0.7g */
export const GRAVITY = 6.86;

/**
 * Rapier 封装：固定 60Hz 步进；为玩家周围 3x3 LOD0 区块维护 trimesh 碰撞体；
 * floating origin 回移时平移所有刚体。
 */
export class Physics {
  readonly world: RAPIER.World;
  private terrainBodies = new Map<string, RAPIER.RigidBody>();
  private syncCounter = 0;

  private constructor(
    private terrain: Terrain,
    private origin: FloatingOrigin,
    private getWorldFocus: () => { x: number; z: number },
  ) {
    this.world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
    origin.onShift((shift) => this.shiftBodies(shift));
  }

  static async create(
    terrain: Terrain,
    origin: FloatingOrigin,
    getWorldFocus: () => { x: number; z: number },
  ): Promise<Physics> {
    await RAPIER.init();
    return new Physics(terrain, origin, getWorldFocus);
  }

  fixedUpdate(): void {
    if (this.syncCounter-- <= 0) {
      this.syncCounter = 15; // 每 0.25s 同步一次地形碰撞体
      this.syncTerrainColliders();
    }
    this.world.step();
  }

  /** 玩家所在区块的碰撞体是否就绪（出生安全判定） */
  hasColliderUnder(worldX: number, worldZ: number): boolean {
    return this.terrainBodies.has(`${Terrain.toChunk(worldX)},${Terrain.toChunk(worldZ)}`);
  }

  /** 头顶是否有遮蔽（建筑/残骸屋檐）：向上射线，排除指定刚体（通常是玩家自身） */
  hasRoofAbove(pos: { x: number; y: number; z: number }, exclude?: RAPIER.RigidBody): boolean {
    const ray = new RAPIER.Ray({ x: pos.x, y: pos.y + 0.2, z: pos.z }, { x: 0, y: 1, z: 0 });
    const hit = this.world.castRay(ray, 40, true, undefined, undefined, undefined, exclude);
    return hit !== null;
  }

  private syncTerrainColliders(): void {
    const f = this.getWorldFocus();
    const pcx = Terrain.toChunk(f.x);
    const pcz = Terrain.toChunk(f.z);
    const wanted = new Set<string>();
    for (let j = -1; j <= 1; j++)
      for (let i = -1; i <= 1; i++) wanted.add(`${pcx + i},${pcz + j}`);

    for (const [key, body] of this.terrainBodies) {
      if (!wanted.has(key)) {
        this.world.removeRigidBody(body);
        this.terrainBodies.delete(key);
      }
    }
    for (const key of wanted) {
      if (this.terrainBodies.has(key)) continue;
      const [cx, cz] = key.split(',').map(Number);
      const data = this.terrain.getPhysicsData(cx, cz);
      if (!data) continue;
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(
          cx * CHUNK_SIZE - this.origin.totalOffset.x,
          0,
          cz * CHUNK_SIZE - this.origin.totalOffset.z,
        ),
      );
      this.world.createCollider(RAPIER.ColliderDesc.trimesh(data.positions, data.indices), body);
      this.terrainBodies.set(key, body);
    }
  }

  private shiftBodies(shift: THREE.Vector3): void {
    this.world.bodies.forEach((body) => {
      const t = body.translation();
      const p = { x: t.x - shift.x, y: t.y, z: t.z - shift.z };
      body.setTranslation(p, true);
      if (body.isKinematic()) body.setNextKinematicTranslation(p);
    });
  }
}
