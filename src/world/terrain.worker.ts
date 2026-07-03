/// <reference lib="webworker" />
import { createHeightfield, type Heightfield } from './heightfield';

export interface ChunkRequest {
  id: number;
  cx: number;
  cz: number;
  size: number;
  res: number;
  seed: number;
}

export interface ChunkResult {
  id: number;
  cx: number;
  cz: number;
  size: number;
  res: number;
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  glass: Float32Array;
  indices: Uint32Array;
}

const SKIRT_DROP = 8;

// 生物群系基色 (DUST/ROCK/GLASS/ASH)
const BIOME_COLORS = [
  [0.69, 0.54, 0.37],
  [0.44, 0.41, 0.38],
  [0.27, 0.38, 0.36],
  [0.25, 0.23, 0.22],
];
const ROCK = BIOME_COLORS[1];

let hf: Heightfield | null = null;

self.onmessage = (e: MessageEvent<ChunkRequest>) => {
  const { id, cx, cz, size, res, seed } = e.data;
  if (!hf || hf.seed !== seed) hf = createHeightfield(seed);

  const step = size / res;
  const n = res + 3; // 网格含外圈裙边环
  const ox = cx * size;
  const oz = cz * size;

  // 高度缓存：逻辑坐标 -1..res+1（供中心差分法线）
  const hgrid = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      hgrid[j * n + i] = hf.height(ox + (i - 1) * step, oz + (j - 1) * step);
    }
  }

  const positions = new Float32Array(n * n * 3);
  const normals = new Float32Array(n * n * 3);
  const colors = new Float32Array(n * n * 3);
  const glass = new Float32Array(n * n);
  const w4 = new Float32Array(4);

  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const li = i - 1;
      const lj = j - 1;
      const ci = Math.max(0, Math.min(res, li));
      const cj = Math.max(0, Math.min(res, lj));
      const isSkirt = li !== ci || lj !== cj;
      const idx = j * n + i;

      const h = hgrid[(cj + 1) * n + (ci + 1)];
      positions[idx * 3] = ci * step;
      positions[idx * 3 + 1] = isSkirt ? h - SKIRT_DROP : h;
      positions[idx * 3 + 2] = cj * step;

      // 中心差分法线（裙边复用边缘法线）
      const hl = hgrid[(cj + 1) * n + ci];
      const hr = hgrid[(cj + 1) * n + (ci + 2)];
      const hd = hgrid[cj * n + (ci + 1)];
      const hu = hgrid[(cj + 2) * n + (ci + 1)];
      let nx = -(hr - hl) / (2 * step);
      let ny = 1;
      let nz = -(hu - hd) / (2 * step);
      const inv = 1 / Math.hypot(nx, ny, nz);
      nx *= inv;
      ny *= inv;
      nz *= inv;
      normals[idx * 3] = nx;
      normals[idx * 3 + 1] = ny;
      normals[idx * 3 + 2] = nz;

      // 顶点色：生物群系混合 + 陡坡露岩
      hf.biomeWeights(ox + ci * step, oz + cj * step, w4, 0);
      let r = 0;
      let g = 0;
      let b = 0;
      for (let k = 0; k < 4; k++) {
        r += w4[k] * BIOME_COLORS[k][0];
        g += w4[k] * BIOME_COLORS[k][1];
        b += w4[k] * BIOME_COLORS[k][2];
      }
      const slope = Math.min(1, Math.max(0, (1 - ny - 0.15) * 2.2));
      r = r + (ROCK[0] - r) * slope;
      g = g + (ROCK[1] - g) * slope;
      b = b + (ROCK[2] - b) * slope;
      colors[idx * 3] = r;
      colors[idx * 3 + 1] = g;
      colors[idx * 3 + 2] = b;
      glass[idx] = w4[2] * (1 - slope);
    }
  }

  const indices = new Uint32Array((n - 1) * (n - 1) * 6);
  let k = 0;
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      indices[k++] = a;
      indices[k++] = c;
      indices[k++] = b;
      indices[k++] = b;
      indices[k++] = c;
      indices[k++] = d;
    }
  }

  const result: ChunkResult = { id, cx, cz, size, res, positions, normals, colors, glass, indices };
  (self as unknown as Worker).postMessage(result, [
    positions.buffer,
    normals.buffer,
    colors.buffer,
    glass.buffer,
    indices.buffer,
  ]);
};
