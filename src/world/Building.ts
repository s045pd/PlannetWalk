import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** 材质基色（顶点色）：混凝土 / 深色核心 / 玻璃幕墙残片 / 锈蚀钢 */
const CONCRETE = new THREE.Color(0.5, 0.48, 0.45);
const CORE_DARK = new THREE.Color(0.16, 0.15, 0.15);
const GLASS = new THREE.Color(0.25, 0.34, 0.38);
const RUST = new THREE.Color(0.38, 0.24, 0.16);

/** 碰撞盒（楼宇局部坐标，原点在基座中心，随 rotY 整体旋转） */
export interface BoxDef {
  x: number;
  y: number;
  z: number;
  hx: number;
  hy: number;
  hz: number;
}

export interface BuildingResult {
  geometry: THREE.BufferGeometry;
  /** 包围半尺寸（发光窗口等用） */
  halfExtents: { x: number; y: number; z: number };
  /** 碰撞盒列表：非可进入楼宇为单一整盒，可进入楼宇为逐件盒 */
  colliders: BoxDef[];
  enterable: boolean;
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
 * ~25% 楼宇可进入：底层门洞 + 空腔大堂 + 可跳跃攀升的内部平台。
 * 原点位于基座中心，几何可能整体倾斜（半埋感）。
 */
export function buildRuinedTower(rng: () => number, footprint: number): BuildingResult {
  const floors = 6 + Math.floor(rng() * 34);
  const fullH = floors * 3.5;
  const keep = 0.3 + rng() * 0.6;
  const h = fullH * keep;
  const w = footprint * (0.75 + rng() * 0.5);
  const d = footprint * (0.75 + rng() * 0.5);
  const enterable = rng() < 0.25 && h > 10;
  const parts: THREE.BufferGeometry[] = [];
  const colliders: BoxDef[] = [];

  const add = (
    bw: number,
    bh: number,
    bd: number,
    x: number,
    y: number,
    z: number,
    color: THREE.Color,
    opts: { jitter?: number; collide?: boolean; rotY?: number } = {},
  ): void => {
    const g = coloredBox(bw, bh, bd, x, y, z, color, opts.jitter ?? 0, rng);
    if (opts.rotY) g.rotateY(opts.rotY);
    parts.push(g);
    if (enterable && (opts.collide ?? true) && !opts.rotY) {
      colliders.push({ x, y, z, hx: bw / 2, hy: bh / 2, hz: bd / 2 });
    }
  };

  const LOBBY = 6;
  if (enterable) {
    // 空腔大堂之上的核心筒
    add(w * 0.72, h * 0.96 - LOBBY, d * 0.72, 0, LOBBY + (h * 0.96 - LOBBY) / 2, 0, CORE_DARK);
    // 大堂顶板（也是内部平台）
    add(w * 0.68, 0.3, d * 0.68, 0, LOBBY, 0, CONCRETE);
    // 内部跳跃平台（低重力可逐级跳上）
    const steps = Math.min(4, Math.floor(LOBBY / 1.4));
    for (let s = 0; s < steps; s++) {
      const sy = 1.3 + s * 1.35;
      const ang = (s * Math.PI) / 2;
      const rr = Math.min(w, d) * 0.22;
      add(2.4, 0.22, 1.3, Math.cos(ang) * rr, sy, Math.sin(ang) * rr, CONCRETE, {
        jitter: 0.1,
      });
    }
  } else {
    // 整段核心筒
    add(w * 0.72, h * 0.96, d * 0.72, 0, h * 0.48, 0, CORE_DARK, { collide: false });
  }

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
    const horiz = side % 2 === 0;
    const len = horiz ? w : d;
    const stripLen = len / strips;
    for (let i = 0; i < strips; i++) {
      if (rng() < 0.14) continue; // 整条缺失 → 破洞
      const sh = Math.min(h * (0.55 + rng() * 0.5), h * 1.04);
      const off = -len / 2 + stripLen * (i + 0.5);
      const c = facade();
      // 可进入楼宇：+z 面中间条留 3m 门洞（墙条从门楣起）
      const isDoor = enterable && side === 0 && (i === 1 || i === 2);
      const y0 = isDoor ? 3 : 0;
      const clampH = sh - y0;
      if (clampH < 0.5) continue;
      if (horiz) {
        const z = side === 0 ? d / 2 : -d / 2;
        add(stripLen * 0.96, clampH, t, off, y0 + clampH / 2, z, c, { jitter: 0.12 });
      } else {
        const x = side === 1 ? w / 2 : -w / 2;
        add(t, clampH, stripLen * 0.96, x, y0 + clampH / 2, off, c, { jitter: 0.12 });
      }
    }
  }

  // 底部碎石堆（可进入楼宇避开 +z 门前扇区）
  const rubbleN = 4 + Math.floor(rng() * 5);
  for (let i = 0; i < rubbleN; i++) {
    const ang = rng() * Math.PI * 2;
    if (enterable && Math.abs(Math.sin(ang)) > 0.7 && Math.sin(ang) > 0) continue;
    const dist = (Math.max(w, d) / 2) * (0.7 + rng() * 0.7);
    const s = 1 + rng() * 3;
    add(
      s,
      s * (0.5 + rng() * 0.5),
      s,
      Math.cos(ang) * dist,
      s * 0.2,
      Math.sin(ang) * dist,
      CONCRETE,
      { jitter: 0.2, rotY: rng() * Math.PI, collide: false },
    );
  }

  const geometry = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());

  // 倾斜倒塌（仅不可进入的楼宇，避免内部空间歪斜）
  if (!enterable && rng() < 0.18) {
    const tilt = (2 + rng() * 6) * (Math.PI / 180);
    const axis = rng() < 0.5 ? 'x' : 'z';
    if (axis === 'x') geometry.rotateX(tilt);
    else geometry.rotateZ(tilt);
    geometry.translate(0, -h * Math.sin(tilt) * 0.4, 0);
  }

  if (!enterable) {
    colliders.push({ x: 0, y: h / 2, z: 0, hx: w / 2 + 0.4, hy: h / 2, hz: d / 2 + 0.4 });
  }

  return {
    geometry,
    halfExtents: { x: w / 2 + 0.4, y: h / 2, z: d / 2 + 0.4 },
    colliders,
    enterable,
  };
}
