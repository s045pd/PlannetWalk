import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** 材质基色（顶点色）：混凝土 / 深色核心 / 玻璃幕墙残片 / 锈蚀钢 */
const CONCRETE = new THREE.Color(0.5, 0.48, 0.45);
const CORE_DARK = new THREE.Color(0.16, 0.15, 0.15);
const GLASS = new THREE.Color(0.25, 0.34, 0.38);
const RUST = new THREE.Color(0.38, 0.24, 0.16);

export interface BuildingResult {
  geometry: THREE.BufferGeometry;
  /** 碰撞半尺寸（局部，原点在基座中心） */
  halfExtents: { x: number; y: number; z: number };
}

function coloredBox(
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  color: THREE.Color,
  jitter = 0,
  rng?: () => number,
): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  const count = g.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const v = jitter && rng ? 1 - jitter + rng() * jitter * 2 : 1;
    colors[i * 3] = color.r * v;
    colors[i * 3 + 1] = color.g * v;
    colors[i * 3 + 2] = color.b * v;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

/**
 * 程序化坍塌高楼：核心筒 + 四面参差墙条 + 底部碎石堆。
 * 原点位于基座中心，几何可能整体倾斜（半埋感）。
 */
export function buildRuinedTower(rng: () => number, footprint: number): BuildingResult {
  const floors = 6 + Math.floor(rng() * 34);
  const fullH = floors * 3.5;
  const keep = 0.3 + rng() * 0.6;
  const h = fullH * keep;
  const w = footprint * (0.75 + rng() * 0.5);
  const d = footprint * (0.75 + rng() * 0.5);
  const parts: THREE.BufferGeometry[] = [];

  // 核心筒（深色，露出处即"内部"）
  parts.push(coloredBox(w * 0.72, h * 0.96, d * 0.72, 0, h * 0.48, 0, CORE_DARK));

  // 四面墙条：参差高度 + 随机缺失（形成破洞与锯齿天际线）
  const facade = (): THREE.Color => {
    const r = rng();
    if (r < 0.45) return CONCRETE;
    if (r < 0.8) return GLASS;
    return RUST;
  };
  const strips = 4;
  const t = 0.35; // 墙厚
  for (let side = 0; side < 4; side++) {
    const horiz = side % 2 === 0; // 沿 x 方向的墙
    const len = horiz ? w : d;
    const stripLen = len / strips;
    for (let i = 0; i < strips; i++) {
      if (rng() < 0.14) continue; // 整条缺失 → 破洞
      const sh = h * (0.55 + rng() * 0.5);
      const clampH = Math.min(sh, h * 1.04);
      const off = -len / 2 + stripLen * (i + 0.5);
      const c = facade();
      if (horiz) {
        const z = side === 0 ? d / 2 : -d / 2;
        parts.push(coloredBox(stripLen * 0.96, clampH, t, off, clampH / 2, z, c, 0.12, rng));
      } else {
        const x = side === 1 ? w / 2 : -w / 2;
        parts.push(coloredBox(t, clampH, stripLen * 0.96, x, clampH / 2, off, c, 0.12, rng));
      }
    }
  }

  // 底部碎石堆
  const rubbleN = 4 + Math.floor(rng() * 5);
  for (let i = 0; i < rubbleN; i++) {
    const ang = rng() * Math.PI * 2;
    const dist = (Math.max(w, d) / 2) * (0.7 + rng() * 0.7);
    const s = 1 + rng() * 3;
    const g = coloredBox(
      s,
      s * (0.5 + rng() * 0.5),
      s,
      Math.cos(ang) * dist,
      s * 0.2,
      Math.sin(ang) * dist,
      CONCRETE,
      0.2,
      rng,
    );
    g.rotateY(rng() * Math.PI);
    parts.push(g);
  }

  const geometry = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());

  // 倾斜倒塌（~18% 概率，2-8°，向下沉一点）
  if (rng() < 0.18) {
    const tilt = (2 + rng() * 6) * (Math.PI / 180);
    const axis = rng() < 0.5 ? 'x' : 'z';
    if (axis === 'x') geometry.rotateX(tilt);
    else geometry.rotateZ(tilt);
    geometry.translate(0, -h * Math.sin(tilt) * 0.4, 0);
  }

  return {
    geometry,
    halfExtents: { x: w / 2 + 0.4, y: h / 2, z: d / 2 + 0.4 },
  };
}
