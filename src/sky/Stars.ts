import * as THREE from 'three';
import { mulberry32 } from '../world/noise';

const STAR_COUNT = 4000;

/** 星空点云 + 银河密集带，随太阳高度淡入淡出 */
export class Stars {
  readonly points: THREE.Points;
  private mat: THREE.PointsMaterial;

  constructor(scene: THREE.Scene, seed: number) {
    const rng = mulberry32(seed);
    const pos = new Float32Array(STAR_COUNT * 3);
    const col = new Float32Array(STAR_COUNT * 3);
    // 银河大圆带的法向
    const mwNormal = new THREE.Vector3(0.4, 0.75, 0.53).normalize();
    const v = new THREE.Vector3();

    let i = 0;
    let placed = 0;
    while (placed < STAR_COUNT && i < STAR_COUNT * 30) {
      i++;
      // 均匀球面采样
      const u = rng() * 2 - 1;
      const phi = rng() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      v.set(s * Math.cos(phi), u, s * Math.sin(phi));
      // 银河带附近密度 x3：远离带的候选按概率丢弃
      const band = 1 - Math.abs(v.dot(mwNormal));
      const density = 0.28 + 0.72 * Math.pow(band, 6);
      if (rng() > density) continue;

      const r = 8500;
      pos[placed * 3] = v.x * r;
      pos[placed * 3 + 1] = v.y * r;
      pos[placed * 3 + 2] = v.z * r;
      // 色温：白-蓝白-暖黄（乘 2.2 抵消夜间低曝光）
      const t = rng();
      const bright = (0.35 + rng() * 0.65) * 2.2;
      col[placed * 3] = bright * (t < 0.6 ? 1 : 0.85);
      col[placed * 3 + 1] = bright * 0.95;
      col[placed * 3 + 2] = bright * (t < 0.6 ? 0.9 : 1);
      placed++;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos.slice(0, placed * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col.slice(0, placed * 3), 3));
    this.mat = new THREE.PointsMaterial({
      size: 2.5,
      sizeAttenuation: false,
      vertexColors: true,
      transparent: true,
      opacity: 0,
      fog: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.renderOrder = -9;
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  /** 跟随相机并按太阳高度调整可见度 */
  update(cameraPos: THREE.Vector3, sunElevation: number): void {
    this.points.position.copy(cameraPos);
    // 太阳降到 -0.05 以下开始显现，-0.2 全亮
    const t = Math.min(1, Math.max(0, (-sunElevation - 0.05) / 0.15));
    this.mat.opacity = t * t * 0.9;
  }
}
