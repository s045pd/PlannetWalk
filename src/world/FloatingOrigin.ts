import * as THREE from 'three';
import { CHUNK_SIZE } from './Terrain';

/** 场景局部坐标偏离原点超过该值时触发回移 */
export const THRESHOLD = 2048;

/** 计算回移量（对齐 CHUNK_SIZE 的整数倍），阈值内返回 null */
export function computeShift(pos: { x: number; z: number }): { x: number; z: number } | null {
  if (Math.abs(pos.x) < THRESHOLD && Math.abs(pos.z) < THRESHOLD) return null;
  return {
    x: Math.floor(pos.x / CHUNK_SIZE) * CHUNK_SIZE,
    z: Math.floor(pos.z / CHUNK_SIZE) * CHUNK_SIZE,
  };
}

/**
 * Floating origin：真实世界坐标 = 场景局部坐标 + totalOffset。
 * 地形/城市/散布采样一律用真实坐标；渲染与物理都在局部坐标进行。
 */
export class FloatingOrigin {
  readonly totalOffset = new THREE.Vector3(0, 0, 0);
  private shiftHandlers: ((shift: THREE.Vector3, total: THREE.Vector3) => void)[] = [];

  toWorld(local: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(local).add(this.totalOffset);
  }

  toLocal(world: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(world).sub(this.totalOffset);
  }

  /** 注册回移处理器（物理刚体、区块重排等） */
  onShift(fn: (shift: THREE.Vector3, total: THREE.Vector3) => void): void {
    this.shiftHandlers.push(fn);
  }

  /** 每帧用焦点（玩家）局部坐标检查，必要时执行回移 */
  check(focusLocal: THREE.Vector3): boolean {
    const s = computeShift(focusLocal);
    if (!s) return false;
    const shift = new THREE.Vector3(s.x, 0, s.z);
    this.totalOffset.add(shift);
    for (const fn of this.shiftHandlers) fn(shift, this.totalOffset);
    return true;
  }
}
