import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import type { Player } from './Player';
import type { FloatingOrigin } from '../world/FloatingOrigin';

const MAX_BEACONS = 3;
const REMOVE_RANGE = 5;
const COLORS = [0x78ffa0, 0xffb36b, 0x57d8ff];

export interface Beacon {
  x: number;
  y: number;
  z: number;
}

/** 个人信标：B 放置（上限 3 个 FIFO），5m 内按 B 移除；世界光柱 + 罗盘/地图标记 */
export class Waypoints {
  beacons: Beacon[] = [];
  private meshes: THREE.Group[] = [];
  private toast: HTMLElement;
  private time = 0;

  constructor(
    private engine: Engine,
    private player: Player,
    private origin: FloatingOrigin,
  ) {
    this.toast = document.createElement('div');
    this.toast.style.cssText =
      'position:fixed;top:170px;left:50%;transform:translateX(-50%);color:#78ffa0;' +
      'font:12px monospace;letter-spacing:2px;opacity:0;transition:opacity .4s;z-index:30;pointer-events:none';
    document.body.appendChild(this.toast);
    origin.onShift(() => this.repositionAll());
  }

  restore(beacons: Beacon[]): void {
    this.beacons = beacons.slice(0, MAX_BEACONS);
    this.rebuildMeshes();
  }

  private showToast(text: string): void {
    this.toast.textContent = text;
    this.toast.style.opacity = '1';
    setTimeout(() => (this.toast.style.opacity = '0'), 2200);
  }

  private buildMesh(index: number): THREE.Group {
    const g = new THREE.Group();
    const color = COLORS[index % COLORS.length];
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.09, 1.6, 8),
      new THREE.MeshStandardMaterial({ color: 0x333638, roughness: 0.8 }),
    );
    pole.position.y = 0.8;
    const beam = new THREE.Mesh(
      new THREE.PlaneGeometry(0.7, 14),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.14,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    beam.position.y = 7.5;
    const beam2 = beam.clone();
    beam2.rotation.y = Math.PI / 2;
    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 8, 6),
      new THREE.MeshBasicMaterial({ color }),
    );
    lamp.position.y = 1.65;
    g.add(pole, beam, beam2, lamp);
    return g;
  }

  private rebuildMeshes(): void {
    for (const m of this.meshes) {
      this.engine.scene.remove(m);
      m.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
    }
    this.meshes = this.beacons.map((_, i) => this.buildMesh(i));
    for (const m of this.meshes) this.engine.scene.add(m);
    this.repositionAll();
  }

  private repositionAll(): void {
    this.beacons.forEach((b, i) => {
      this.meshes[i]?.position.set(
        b.x - this.origin.totalOffset.x,
        b.y,
        b.z - this.origin.totalOffset.z,
      );
    });
  }

  update(dt: number): void {
    this.time += dt;
    // 光柱轻微呼吸
    this.meshes.forEach((m, i) => {
      m.children[1].scale.x = m.children[2].scale.x = 1 + Math.sin(this.time * 2 + i) * 0.15;
    });

    if (this.engine.cameraLock || this.player.riding) return;
    if (!this.engine.input.consumePressed('KeyB')) return;

    const w = this.player.worldPosition();
    // 5m 内已有信标 → 移除
    const nearIdx = this.beacons.findIndex((b) => Math.hypot(b.x - w.x, b.z - w.z) < REMOVE_RANGE);
    if (nearIdx >= 0) {
      this.beacons.splice(nearIdx, 1);
      this.rebuildMeshes();
      this.showToast('▽ 信标已回收');
      return;
    }
    if (this.beacons.length >= MAX_BEACONS) this.beacons.shift(); // FIFO
    this.beacons.push({ x: w.x, y: w.y - 1.4, z: w.z });
    this.rebuildMeshes();
    this.showToast(`△ 信标已放置 (${this.beacons.length}/${MAX_BEACONS})`);
  }
}
