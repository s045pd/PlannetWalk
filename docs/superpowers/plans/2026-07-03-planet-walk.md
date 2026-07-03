# 《星球漫步》(Planet Walk) 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 纯前端拟真级星球漫步游戏——第一人称在被毁灭世界的行星地表漫游，含程序地形、大气天穹、动态天气、真实物理与三种载具。

**Architecture:** Vite + TypeScript + Three.js (WebGL2) 直接驱动渲染循环（固定 60Hz 物理步长 + 渲染插值），Rapier3D WASM 负责碰撞与载具物理，各系统经事件总线解耦。地形/废墟全程序化生成（种子确定性），HUD 为 DOM 覆盖层。

**Tech Stack:** three, @dimforge/rapier3d-compat, postprocessing (pmndrs), vite, typescript, vitest, @playwright/test

**Spec:** `docs/superpowers/specs/2026-07-03-planet-walk-design.md`

---

## 文件结构总览

```
index.html / package.json / tsconfig.json / vite.config.ts / .gitignore
src/
├── main.ts                     # 装配所有系统并启动
├── core/
│   ├── Engine.ts               # rAF 循环、固定步长累加器、系统调度
│   ├── fixedStep.ts            # 纯函数：累加器步进计算（可测）
│   ├── EventBus.ts             # 类型化事件总线
│   ├── Input.ts                # 键鼠状态 + PointerLock
│   └── Settings.ts             # 画质三档参数表
├── world/
│   ├── noise.ts                # 可种子化 simplex 噪声（纯函数）
│   ├── heightfield.ts          # 高度场 + 生物群系 + 城市台地混合（纯函数）
│   ├── citySites.ts            # 城市选址哈希网格（纯函数）
│   ├── terrain.worker.ts       # Worker：区块几何生成
│   ├── TerrainChunk.ts         # 单区块 Mesh + splat 材质
│   ├── Terrain.ts              # 环形 LOD 区块管理器、流式加载
│   ├── FloatingOrigin.ts       # 原点回移（核心计算为纯函数）
│   ├── Building.ts             # 程序化坍塌楼宇几何
│   ├── Ruins.ts                # 废墟城市装配（街区/楼宇/碰撞）
│   └── Scatter.ts              # InstancedMesh 散布物（残骸/岩石）
├── sky/
│   ├── atmosphere.ts           # Rayleigh+Mie 单次散射 shader 源码
│   ├── Sky.ts                  # 天穹 mesh + uniform 驱动
│   ├── DayNight.ts             # 太阳/残月轨道 → 光照/曝光
│   ├── Stars.ts                # 星空 Points + 随日光淡出
│   └── DebrisRing.ts           # 行星环碎带
├── weather/
│   ├── weatherStates.ts        # 7 状态参数表 + 马尔可夫转移矩阵（纯数据）
│   ├── WeatherSystem.ts        # 状态机 + 插值（纯逻辑核心可测）
│   ├── Particles.ts            # GPU 粒子（雨/尘/灰烬，相机包围盒回绕）
│   └── Lightning.ts            # 闪电光脉冲 + 延迟雷声调度
├── physics/
│   ├── Physics.ts              # Rapier init、固定步进、地形 trimesh 碰撞管理
│   └── CharacterController.ts  # 胶囊运动学角色控制器封装
├── player/
│   ├── Player.ts               # 第一人称：移动/跳跃/头部晃动/相机
│   └── jetpack.ts              # 喷气背包燃料逻辑（纯函数）
├── vehicles/
│   ├── Rideable.ts             # 接口 + VehicleManager（E 进入/退出、输入路由）
│   ├── pid.ts                  # PID 控制器（纯函数）
│   ├── Rover.ts                # 六轮 raycast vehicle
│   └── Hovercraft.ts           # PID 悬浮飞行器
├── fx/PostFX.ts                # postprocessing 合成器（bloom/SSAO/vignette/ACES）
├── hud/Hud.ts + hud/hud.css    # DOM HUD
└── audio/AudioSystem.ts        # WebAudio 全程序化音效
tests/                          # Vitest（纯逻辑模块）
e2e/smoke.spec.ts               # Playwright 视觉冒烟
```

**测试原则**（遵循 web 测试规则）：纯逻辑（噪声/高度场/天气机/PID/燃料/原点回移/固定步长）用 Vitest TDD；渲染代码以 dev server 目视验证 + 最终 Playwright 视觉冒烟为主信号，不写脆弱的渲染内部断言。

---

## Stage 1：骨架与核心循环

### Task 1: 项目脚手架

**Files:** Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.ts`, `.gitignore`

- [ ] **Step 1: 写配置文件**

`package.json`（版本装最新即可，`npm i` 时确定）:

```json
{
  "name": "planet-walk",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:e2e": "playwright test"
  }
}
```

```bash
npm i three @dimforge/rapier3d-compat postprocessing
npm i -D typescript vite vitest @types/three @playwright/test
```

`tsconfig.json`: `strict: true`, `target: ES2022`, `module: ESNext`, `moduleResolution: bundler`, `types: ["vite/client"]`。
`vite.config.ts`: 默认配置 + `build.target: 'es2022'`。
`index.html`: 全屏 `<canvas id="app">`，`margin:0; overflow:hidden`, 深色背景。
`.gitignore`: `node_modules/ dist/ test-results/ playwright-report/`。

- [ ] **Step 2: 最小渲染验证**

`src/main.ts`: 创建 `WebGLRenderer({canvas, antialias:true})`、`PerspectiveCamera(70, ar, 0.1, 20000)`、场景内放一个旋转 Box + HemisphereLight，rAF 循环渲染。

Run: `npm run dev` → 浏览器看到旋转方块。Run: `npm run build` → 通过。

- [ ] **Step 3: Commit** `chore: 项目脚手架 (vite+ts+three+rapier)`

### Task 2: 固定步长引擎循环 + 事件总线 + 输入

**Files:** Create: `src/core/fixedStep.ts`, `src/core/Engine.ts`, `src/core/EventBus.ts`, `src/core/Input.ts`; Test: `tests/fixedStep.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/fixedStep.test.ts
import { describe, it, expect } from 'vitest';
import { advanceFixed } from '../src/core/fixedStep';

describe('advanceFixed', () => {
  it('累积不足一步时不步进', () => {
    expect(advanceFixed(0, 0.008, 1 / 60)).toEqual({ steps: 0, acc: 0.008, alpha: 0.008 / (1 / 60) });
  });
  it('累积超过一步时步进并保留余量', () => {
    const r = advanceFixed(0.01, 0.02, 1 / 60);
    expect(r.steps).toBe(1);
    expect(r.acc).toBeCloseTo(0.03 - 1 / 60);
  });
  it('单帧耗时过长时限制最大步数防螺旋', () => {
    expect(advanceFixed(0, 1.0, 1 / 60).steps).toBeLessThanOrEqual(5);
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — `npm run test`，Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```ts
// src/core/fixedStep.ts
export interface FixedStepResult { steps: number; acc: number; alpha: number }
export const MAX_STEPS = 5;
export function advanceFixed(acc: number, dt: number, h: number): FixedStepResult {
  let a = acc + dt;
  let steps = 0;
  while (a >= h && steps < MAX_STEPS) { a -= h; steps++; }
  if (steps === MAX_STEPS) a = 0; // 丢弃积压，避免死亡螺旋
  return { steps, acc: a, alpha: a / h };
}
```

`Engine.ts`: 持有 `renderer/scene/camera`，注册 `System { fixedUpdate?(h), update?(dt, alpha) }` 列表；rAF 中 `advanceFixed` 决定调用几次 `fixedUpdate(1/60)`，然后调 `update(dt, alpha)` 与渲染。`dt` 用 `clock.getDelta()` 且 clamp 到 0.1s。
`EventBus.ts`: `on/off/emit`，事件表接口 `Events { 'weather:changed': {state}; 'vehicle:entered': {kind}; 'vehicle:exited': {}; 'origin:shifted': {offset} }`。
`Input.ts`: `keys: Set<string>`（`code` 值）、`mouseDX/DY` 每帧取走清零、点击 canvas 请求 PointerLock、`isDown(code)`、`consumePressed(code)`（边沿触发）。

- [ ] **Step 4: 跑测试通过** — `npm run test` Expected: PASS；main.ts 改用 Engine 驱动旋转方块验证。

- [ ] **Step 5: Commit** `feat: 固定步长引擎循环/事件总线/输入管理`

---

## Stage 2：地形与物理漫步

### Task 3: 可种子化噪声（TDD）

**Files:** Create: `src/world/noise.ts`; Test: `tests/noise.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/noise.test.ts
import { describe, it, expect } from 'vitest';
import { createNoise2D, fbm2, ridged2 } from '../src/world/noise';

describe('noise', () => {
  it('同种子确定性', () => {
    const a = createNoise2D(42), b = createNoise2D(42);
    expect(a(1.5, 2.5)).toBe(b(1.5, 2.5));
  });
  it('不同种子结果不同', () => {
    expect(createNoise2D(1)(3.3, 4.4)).not.toBe(createNoise2D(2)(3.3, 4.4));
  });
  it('值域在 [-1,1]', () => {
    const n = createNoise2D(7);
    for (let i = 0; i < 500; i++) {
      const v = n(i * 0.173, i * 0.317);
      expect(v).toBeGreaterThanOrEqual(-1); expect(v).toBeLessThanOrEqual(1);
    }
  });
  it('fbm/ridged 值域合理', () => {
    const n = createNoise2D(7);
    for (let i = 0; i < 200; i++) {
      expect(Math.abs(fbm2(n, i * 0.11, i * 0.07, 5))).toBeLessThanOrEqual(1);
      const r = ridged2(n, i * 0.11, i * 0.07, 4);
      expect(r).toBeGreaterThanOrEqual(0); expect(r).toBeLessThanOrEqual(1);
    }
  });
});
```

- [ ] **Step 2: 跑测试失败** — Expected: FAIL

- [ ] **Step 3: 实现** — 标准 2D simplex：mulberry32(seed) 洗牌 256 permutation 表；`fbm2(noise,x,y,octaves,lac=2,gain=0.5)` 归一化幅值和；`ridged2 = 1-|noise|` 逐倍频叠加归一化。

- [ ] **Step 4: 跑测试通过** — Expected: PASS
- [ ] **Step 5: Commit** `feat: 可种子化 simplex 噪声与 fbm/ridged`

### Task 4: 高度场 + 生物群系 + 城市台地（TDD）

**Files:** Create: `src/world/heightfield.ts`, `src/world/citySites.ts`; Test: `tests/heightfield.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/heightfield.test.ts
import { describe, it, expect } from 'vitest';
import { createHeightfield, Biome } from '../src/world/heightfield';
import { citySiteAt, CITY_CELL } from '../src/world/citySites';

const hf = createHeightfield(1234);

describe('heightfield', () => {
  it('确定性', () => {
    const hf2 = createHeightfield(1234);
    expect(hf.height(100.5, -200.25)).toBe(hf2.height(100.5, -200.25));
  });
  it('连续性：相邻 1m 采样高差有限', () => {
    for (let i = 0; i < 200; i++) {
      const x = i * 37.7, z = i * 91.3;
      expect(Math.abs(hf.height(x, z) - hf.height(x + 1, z))).toBeLessThan(8);
    }
  });
  it('生物群系返回合法枚举', () => {
    for (let i = 0; i < 100; i++) {
      const b = hf.biome(i * 503.1, i * 977.7);
      expect(Object.values(Biome)).toContain(b);
    }
  });
  it('城市中心区域被压平（台地）', () => {
    // 扫描找到一个城市
    let site = null;
    for (let cx = -20; cx < 20 && !site; cx++)
      for (let cz = -20; cz < 20 && !site; cz++)
        site = citySiteAt(1234, cx, cz);
    expect(site).not.toBeNull();
    const c = hf.height(site!.x, site!.z);
    for (const [dx, dz] of [[30, 0], [0, 30], [-30, -30], [50, 20]])
      expect(Math.abs(hf.height(site!.x + dx, site!.z + dz) - c)).toBeLessThan(2);
  });
});
```

- [ ] **Step 2: 跑测试失败** — Expected: FAIL

- [ ] **Step 3: 实现**

`citySites.ts`: `CITY_CELL = 2048`；`citySiteAt(seed, cellX, cellZ)`：cell 坐标哈希出 PRNG → 35% 概率有城市，返回 `{x, z, radius(250..500), rot}`（cell 内随机偏移，保持离 cell 边 ≥ radius），否则 null。`nearestCity(seed, x, z)`：查 3×3 邻域 cell 取最近。

`heightfield.ts`:

```ts
export enum Biome { DUST = 0, ROCK = 1, GLASS = 2, ASH = 3 }
export function createHeightfield(seed: number) {
  const n1 = createNoise2D(seed), n2 = createNoise2D(seed + 1), n3 = createNoise2D(seed + 2);
  function rawHeight(x: number, z: number): number {
    const wx = x + 180 * n2(x * 0.0011, z * 0.0011);      // domain warp
    const wz = z + 180 * n2(x * 0.0011 + 50, z * 0.0011 + 50);
    const continent = 24 * fbm2(n1, wx * 0.0004, wz * 0.0004, 4);
    const mMask = Math.max(0, fbm2(n1, x * 0.00015 + 90, z * 0.00015 + 90, 3));
    const mountains = 220 * mMask * Math.pow(ridged2(n2, wx * 0.0016, wz * 0.0016, 5), 2);
    const detail = 2.5 * fbm2(n3, x * 0.02, z * 0.02, 3);
    return continent + mountains + detail;
  }
  function height(x, z) { // 城市台地混合
    const city = nearestCity(seed, x, z);
    const h = rawHeight(x, z);
    if (!city) return h;
    const d = Math.hypot(x - city.x, z - city.z);
    if (d >= city.radius) return h;
    const plateau = rawHeight(city.x, city.z);
    const t = smoothstep(city.radius, city.radius * 0.6, d); // 中心 t=1
    return h * (1 - t) + plateau * t;
  }
  function biome(x, z): Biome { /* n3 低频 0.00025 双通道划分四象限，GLASS 需 mMask 低 */ }
  return { height, biome, seed };
}
```

- [ ] **Step 4: 跑测试通过** — Expected: PASS（连续性阈值不过就调低 detail 频率/幅度）
- [ ] **Step 5: Commit** `feat: 高度场+生物群系+城市台地混合`

### Task 5: 区块地形 + Worker 流式加载 + 环形 LOD

**Files:** Create: `src/world/terrain.worker.ts`, `src/world/TerrainChunk.ts`, `src/world/Terrain.ts`; Modify: `src/main.ts`

- [ ] **Step 1: Worker 几何生成**

`terrain.worker.ts`: 收 `{cx, cz, size, res, seed}`；用 `createHeightfield(seed)` 采样 `(res+1)²` 顶点网格（含裙边：边缘外扩一圈下拉 8m 遮 LOD 接缝），产出 `positions/normals/uvs/indices` + 每顶点 `biomeWeights`(vec4)，`postMessage` 用 Transferable。法线用中心差分采样高度场（不是面法线），保证跨块一致。

- [ ] **Step 2: 区块与管理器**

`TerrainChunk.ts`: 由 worker 数据构建 `BufferGeometry` + 共享 `ShaderMaterial`（自定义 splat：四层程序纹理——沙/岩/灰烬/熔渣按 `biomeWeights` 与坡度混合；接收全局雾 uniform）。
`Terrain.ts`: 环形 LOD——CHUNK=128m；每帧算玩家所在 chunk 坐标；需求集合 = 半径 6 内所有 chunk，res 按 Chebyshev 距离：≤1→64, ≤3→32, 其余→16。差量加载：进队列（每帧最多派 2 个给 worker 池 [2 workers]），移除超出半径 8 的。API: `getHeightAt(x,z)`（直接调 heightfield 纯函数）、`chunksReadyAround(x,z,r)`。

- [ ] **Step 3: 接入 main 验证** — main.ts 放自由飞行相机（临时 WASD+鼠标），`npm run dev` 目视：地形连绵、山脊/盆地/城市台地可见、无接缝洞、移动时新块无卡顿加载。

- [ ] **Step 4: Commit** `feat: 环形LOD区块地形+worker流式加载+splat材质`

### Task 6: Floating Origin（TDD）

**Files:** Create: `src/world/FloatingOrigin.ts`; Test: `tests/floatingOrigin.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/floatingOrigin.test.ts
import { describe, it, expect } from 'vitest';
import { computeShift, THRESHOLD } from '../src/world/FloatingOrigin';

describe('computeShift', () => {
  it('阈值内不回移', () => {
    expect(computeShift({ x: 100, z: -200 })).toBeNull();
  });
  it('超阈值时返回对齐 CHUNK 的回移量，使新位置落回阈值内', () => {
    const s = computeShift({ x: THRESHOLD + 300, z: 0 })!;
    expect(s.x % 128).toBe(0);
    expect(Math.abs(THRESHOLD + 300 - s.x)).toBeLessThan(THRESHOLD);
  });
});
```

- [ ] **Step 2: 跑测试失败** — Expected: FAIL
- [ ] **Step 3: 实现** — `THRESHOLD = 2048`；超出则 `shift = floor(pos/CHUNK)*CHUNK`（分轴）。`FloatingOrigin` 类持有 `totalOffset`（世界真坐标 = 局部 + totalOffset，地形/城市/散布采样一律用真坐标），`apply(engine)`: 平移场景根节点下所有动态对象与 Rapier 刚体 `setTranslation`，emit `origin:shifted`。
- [ ] **Step 4: 跑测试通过** — PASS
- [ ] **Step 5: Commit** `feat: floating origin 原点回移`

### Task 7: Rapier 物理 + 第一人称角色控制器

**Files:** Create: `src/physics/Physics.ts`, `src/physics/CharacterController.ts`, `src/player/Player.ts`; Modify: `src/main.ts`

- [ ] **Step 1: Physics 封装** — `await RAPIER.init()`；`World(gravity = {x:0, y:-6.86, z:0})`（0.7g）；`fixedUpdate` 调 `world.step()`；地形碰撞：订阅 Terrain 的 LOD0 块就绪事件，为玩家周围 3×3 块由 worker 顶点数据建 trimesh collider（fixed body），块卸载/降级时移除。
- [ ] **Step 2: 角色控制器** — Rapier `KinematicCharacterController`（offset 0.1，autostep 0.5m，最大爬坡 50°，snap-to-ground 0.5m）+ 胶囊 collider(h=1.1, r=0.4)。`CharacterController.move(desired, dt)` 返回实际位移与 `grounded`。
- [ ] **Step 3: Player** — PointerLock 视角（pitch clamp ±89°）；WASD 地面速度 3.5m/s、Shift 8m/s，空中操控系数 0.25；跳跃初速 4.5m/s；重力手动积分入 desired；头部晃动：`bobPhase += speed*dt`，相机局部 y 偏移 `0.05*sin(2*bobPhase)`，落地轻微下沉恢复。出生点：世界原点最近的城市边缘（`nearestCity` 查询），朝向城市。
- [ ] **Step 4: 目视验证** — dev server：能在地形上行走/奔跑/跳跃、上斜坡、不穿地、走远后原点回移无跳变（console 打印 shift 事件）。
- [ ] **Step 5: Commit** `feat: rapier物理+第一人称角色控制器+头部晃动`

---

## Stage 3：天穹光照与后处理

### Task 8: 大气散射天穹 + 日夜循环

**Files:** Create: `src/sky/atmosphere.ts`, `src/sky/Sky.ts`, `src/sky/DayNight.ts`; Modify: `src/main.ts`

- [ ] **Step 1: 散射 shader** — 半径 9000 反面 icosphere。片元：视线方向与太阳方向做单次散射数值积分（视线 12 步采样大气密度 `exp(-h/H)`，Rayleigh β=(5.8,13.5,33.1)e-6 略调橙化、Mie β=21e-6 g=0.76），太阳圆盘由 Mie 前向峰 + `smoothstep` 圆盘叠加；行星地平线以下渐暗。uniforms: `sunDir, turbidity, tint`（天气可染色）。
- [ ] **Step 2: DayNight** — 游戏内 1 天 = 现实 20 分钟（可配）；`timeOfDay ∈ [0,1)` 驱动：太阳方向（倾角 35° 轨道）、`DirectionalLight` 颜色/强度（正午白 1.2 → 日落橙 0.4 → 夜 0）、环境光（HemisphereLight 从天穹采样色）、`renderer.toneMappingExposure`（夜间 0.35）。残月：反向轨道的发光圆盘 sprite。调试键 `[`/`]` 快进时间。
- [ ] **Step 3: 目视验证** — 完整看一次日出→正午→日落→夜：地平线色彩渐变自然、太阳圆盘清晰、夜晚近黑。
- [ ] **Step 4: Commit** `feat: 大气散射天穹+日夜循环光照`

### Task 9: 星空 + 行星环碎带 + 级联阴影

**Files:** Create: `src/sky/Stars.ts`, `src/sky/DebrisRing.ts`; Modify: `src/sky/DayNight.ts`

- [ ] **Step 1: Stars** — 4000 颗 `Points` 均匀球面分布（种子化），大小/色温随机，材质 opacity = `smoothstep(0.05, -0.15, sunElevation)`；银河：沿一条大圆带提高密度 3 倍。
- [ ] **Step 2: DebrisRing** — 倾斜 25° 的巨大环带平面（内径 5500 外径 7500，`RingGeometry` + 程序噪声 alpha 条纹 shader，双面）横跨天空；近段叠 60 个 Instanced 不规则岩块缓慢漂移。白天 alpha 0.15 隐约可见，夜间 0.5。
- [ ] **Step 3: 阴影** — DirectionalLight 开 CSM（three 内置 CSM 或手动 2 级联：0-60m 高精度 2048 / 60-300m 1024），仅 LOD0/1 地形块与建筑投射。太阳落山后关阴影省性能。
- [ ] **Step 4: 目视验证** — 夜晚星空+银河+清晰碎片环（末日印记成立）；白天物体阴影随太阳移动。
- [ ] **Step 5: Commit** `feat: 星空/行星环碎带/级联阴影`

### Task 10: 后处理管线

**Files:** Create: `src/fx/PostFX.ts`; Modify: `src/main.ts`

- [ ] **Step 1: 实现** — pmndrs `postprocessing`：`EffectComposer` + `RenderPass` + `EffectPass(SMAAEffect, SSAOEffect(半分辨率), BloomEffect(luminanceThreshold 1.0, intensity 0.6), VignetteEffect(0.35), NoiseEffect(0.02 镜头颗粒), ToneMappingEffect(ACES))`。暴露 `setQuality(tier)` 开关 SSAO/Bloom。
- [ ] **Step 2: 目视验证** — 日落时地形层次感、太阳 bloom 光晕、暗角与颗粒质感；fps 掉幅 < 15%。
- [ ] **Step 3: Commit** `feat: 后处理管线 (SMAA/SSAO/bloom/vignette/ACES)`

---

## Stage 4：天气系统

### Task 11: 天气状态机（TDD）

**Files:** Create: `src/weather/weatherStates.ts`, `src/weather/WeatherSystem.ts`; Test: `tests/weather.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/weather.test.ts
import { describe, it, expect } from 'vitest';
import { WeatherCore } from '../src/weather/WeatherSystem';
import { WEATHER_STATES } from '../src/weather/weatherStates';

describe('WeatherCore', () => {
  it('初始为 CLEAR 且参数等于状态表', () => {
    const w = new WeatherCore(() => 0.5);
    expect(w.current).toBe('CLEAR');
    expect(w.params.fogDensity).toBe(WEATHER_STATES.CLEAR.fogDensity);
  });
  it('强制切换时参数在过渡期内插值', () => {
    const w = new WeatherCore(() => 0.5);
    w.forceTransition('DUST_STORM', 10);
    w.update(5);
    const a = WEATHER_STATES.CLEAR.fogDensity, b = WEATHER_STATES.DUST_STORM.fogDensity;
    expect(w.params.fogDensity).toBeGreaterThan(Math.min(a, b));
    expect(w.params.fogDensity).toBeLessThan(Math.max(a, b));
    w.update(6);
    expect(w.params.fogDensity).toBeCloseTo(b);
    expect(w.current).toBe('DUST_STORM');
  });
  it('驻留结束后按转移矩阵选合法下一状态', () => {
    const w = new WeatherCore(() => 0.01); // 固定 rng
    w.update(WEATHER_STATES.CLEAR.dwell[1] + 1);
    expect(w.transitioning).toBe(true);
    expect(Object.keys(WEATHER_STATES)).toContain(w.target!);
  });
});
```

- [ ] **Step 2: 跑测试失败** — Expected: FAIL
- [ ] **Step 3: 实现** — `weatherStates.ts`: 每状态 `{fogDensity, fogColor, windSpeed, rainRate, dustRate, ashRate, lightTint, exposureMul, ambientMul, dwell:[min,max], transitions:{state:weight}}`，7 状态：CLEAR/HAZE/DUST_STORM/ACID_RAIN/THUNDERSTORM/ASHFALL/FOG。`WeatherCore(rng)`：纯逻辑（不碰 three）——驻留倒计时→按权重采样下一状态→`transitionT` 走 [0,1] 线性插值所有数值参数（颜色 lerp RGB）。`WeatherSystem` 包装：把 `params` 应用到雾/光照/天穹 tint/粒子发射率，emit `weather:changed`。
- [ ] **Step 4: 跑测试通过** — PASS
- [ ] **Step 5: Commit** `feat: 天气状态机7态+马尔可夫演化 (TDD)`

### Task 12: GPU 天气粒子 + 闪电

**Files:** Create: `src/weather/Particles.ts`, `src/weather/Lightning.ts`; Modify: `src/main.ts`

- [ ] **Step 1: 粒子** — 三套 `InstancedBufferGeometry`（雨 8000 竖长 quad / 尘 3000 软 sprite / 灰烬 2000 慢速飘落片）；顶点 shader：`pos = mod(seedPos + vel*time + wind*time, BOX) - BOX/2 + cameraPos`（40m 包围盒回绕），灰烬加 `sin` 摆动；发射率由天气参数控制 instance 可见数。雨天叠加：地形材质 uniform `wetness` 提高镜面。
- [ ] **Step 2: 闪电** — THUNDERSTORM 期间 3~12s 随机：天穹 `flash` uniform 脉冲 0.15s + 方向光强度尖峰；随机距离 0.5~5km → `distance/340` 秒后播雷声。
- [ ] **Step 3: 目视验证** — 调试键 1-7 切换天气：沙尘暴遮天+橙褐天光、酸雨+湿地面、雷暴闪电+延迟雷声、灰烬静谧飘落、雾能见度压缩；过渡平滑无跳变。
- [ ] **Step 4: Commit** `feat: GPU天气粒子+闪电雷暴`

---

## Stage 5：废墟都市

### Task 13: 程序化坍塌楼宇 + 城市装配

**Files:** Create: `src/world/Building.ts`, `src/world/Ruins.ts`, `src/world/Scatter.ts`

- [ ] **Step 1: Building** — `buildRuinedTower(rng, plot)`: 底面 12~24m、层高 3.5m、6~40 层；破坏操作（按 rng 组合）：①顶部斜切（保留 30%~90% 高度，切面不规则）②整体倾斜 2~8°（半埋入地）③侧面缺角（移除角柱体积）④楼底碎石堆（噪声扰动锥体）。几何全为 Box/扰动锥合并（`BufferGeometryUtils.mergeGeometries`），顶点色区分混凝土/锈钢/玻璃残片三材质区。
- [ ] **Step 2: Ruins** — 对进入视距（半径 2 个 CITY_CELL）的城市站点装配：城市种子 PRNG → 60m 网格街道，地块楼宇概率 `0.8 * (1 - d/radius)`，沿街留残迹空地；每城合并为 ≤6 个 Mesh；每楼一个 Rapier cuboid collider（倾斜楼用旋转 cuboid），玩家 300m 内才建碰撞体。离开视距整城释放。
- [ ] **Step 3: Scatter** — 城市内：集装箱/倾倒灯柱/废弃车壳（盒体组合）Instanced 每城 ~200 个；野外：岩石 Instanced 每 chunk ~30 个（坡度过滤）。种子确定性。
- [ ] **Step 4: 目视验证** — 从出生点步行进城：断裂天际线剪影、可走进楼间街道、碰撞正常、远处城市渐入；fps 不低于纯地形时的 80%。
- [ ] **Step 5: Commit** `feat: 程序化坍塌楼宇+废墟城市+散布物`

---

## Stage 6：载具

### Task 14: Rideable 接口 + PID（TDD）

**Files:** Create: `src/vehicles/Rideable.ts`, `src/vehicles/pid.ts`; Test: `tests/pid.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/pid.test.ts
import { describe, it, expect } from 'vitest';
import { createPid } from '../src/vehicles/pid';

describe('pid', () => {
  it('对一阶系统收敛到目标', () => {
    const pid = createPid({ kp: 8, ki: 2, kd: 4, iMax: 5 });
    let pos = 0, vel = 0;
    for (let i = 0; i < 600; i++) {
      const f = pid.update(10 - pos, 1 / 60);
      vel += (f - vel * 0.5) * (1 / 60); pos += vel * (1 / 60);
    }
    expect(pos).toBeCloseTo(10, 0);
  });
  it('积分限幅防 windup', () => {
    const pid = createPid({ kp: 0, ki: 1, kd: 0, iMax: 2 });
    for (let i = 0; i < 1000; i++) pid.update(100, 1 / 60);
    expect(Math.abs(pid.update(100, 1 / 60))).toBeLessThanOrEqual(2);
  });
  it('reset 清零积分', () => {
    const pid = createPid({ kp: 0, ki: 1, kd: 0, iMax: 2 });
    pid.update(100, 1); pid.reset();
    expect(pid.update(0, 1 / 60)).toBe(0);
  });
});
```

- [ ] **Step 2: 跑测试失败** — FAIL
- [ ] **Step 3: 实现 pid.ts + Rideable** — PID 常规实现（d 项用误差差分）。`Rideable` 接口：`kind; object3D; enter(); exit(): {exitPos}; fixedUpdate(input, h); getCameraRig(): Object3D; hudData(): VehicleHud`。`VehicleManager`：注册载具，玩家 3m 内 HUD 提示 [E]，`consumePressed('KeyE')` 进入（隐藏玩家胶囊、输入路由到载具、相机挂 rig）/退出（在 exitPos 恢复角色）。
- [ ] **Step 4: 跑测试通过** — PASS
- [ ] **Step 5: Commit** `feat: PID控制器(TDD)+Rideable载具接口`

### Task 15: 六轮探测车

**Files:** Create: `src/vehicles/Rover.ts`

- [ ] **Step 1: 实现** — Rapier `DynamicRayCastVehicleController`：底盘 cuboid 刚体(质量 800)，6 轮（悬挂行程 0.45m、刚度 28、阻尼 4.5、轮半径 0.4）；前 2 轮转向（速度越快转角越小）、后 4 轮驱动（W/S 扭矩、Space 刹车）；R 键翻车复位（回正+抬升 1m）。车体：盒体组合外壳（舱体/轮舱/天线），轮子圆柱随悬挂长度与转速旋转。前灯 2 个 SpotLight（L 键，夜间自动提示）。车轮打滑/速度>4m/s 时轮后扬尘粒子。相机：驾驶位第一人称 + 鼠标限角环视。
- [ ] **Step 2: 目视验证** — 出生点旁上车：过起伏地形悬挂压缩可见、爬坡打滑、高速转向侧倾、翻车可复位、夜间开灯照亮地形。
- [ ] **Step 3: Commit** `feat: 六轮探测车 (raycast vehicle悬挂)`

### Task 16: 悬浮飞行器

**Files:** Create: `src/vehicles/Hovercraft.ts`

- [ ] **Step 1: 实现** — 动力学刚体（质量 500，线阻尼 0.6 角阻尼 2）；四角向下 ray 采样离地高，各角 PID（目标 3m）输出向上力（限幅防弹飞）；整体额外高度上限：离地 > 12m 时衰减升力。W/S 前后推力、A/D 偏航扭矩、鼠标不控制（环视）、Shift 加速；速度产生俯仰/横滚视觉倾斜（`lerp` 姿态）。尾部 2 个推进器发光锥 + 底部气垫尘环粒子。
- [ ] **Step 2: 目视验证** — 悬浮平稳不振荡、越过丘陵自动跟地、限高生效、贴地飞越废墟城市流畅。
- [ ] **Step 3: Commit** `feat: PID悬浮飞行器`

### Task 17: 喷气背包（TDD 燃料逻辑）

**Files:** Create: `src/player/jetpack.ts`; Modify: `src/player/Player.ts`; Test: `tests/jetpack.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/jetpack.test.ts
import { describe, it, expect } from 'vitest';
import { stepJetpack, JETPACK } from '../src/player/jetpack';

describe('jetpack', () => {
  const full = { fuel: 1, sinceUsed: 99 };
  it('喷射消耗燃料且输出推力', () => {
    const r = stepJetpack(full, true, 1);
    expect(r.state.fuel).toBeCloseTo(1 - JETPACK.burnRate);
    expect(r.thrust).toBeGreaterThan(0);
  });
  it('燃料耗尽无推力', () => {
    const r = stepJetpack({ fuel: 0, sinceUsed: 0 }, true, 0.016);
    expect(r.thrust).toBe(0);
  });
  it('停用超过延迟后回充，且不超上限', () => {
    const r = stepJetpack({ fuel: 0.5, sinceUsed: JETPACK.rechargeDelay + 1 }, false, 1);
    expect(r.state.fuel).toBeCloseTo(Math.min(1, 0.5 + JETPACK.rechargeRate));
    expect(stepJetpack(full, false, 10).state.fuel).toBe(1);
  });
  it('延迟期内不回充', () => {
    const r = stepJetpack({ fuel: 0.5, sinceUsed: 0 }, false, 0.5);
    expect(r.state.fuel).toBe(0.5);
  });
});
```

- [ ] **Step 2: 跑测试失败** — FAIL
- [ ] **Step 3: 实现** — `JETPACK = {burnRate: 0.35/s, rechargeRate: 0.12/s, rechargeDelay: 2s, accel: 12}`；纯函数返回 `{state, thrust}`。Player 集成：空中按住 Space → 竖直 accel*thrust + 水平方向 40% 助推；喷焰粒子锥 + 引擎白噪声；燃料低于 20% HUD 警示。
- [ ] **Step 4: 跑测试通过** — PASS；目视：低重力下喷射滑翔跨越街区。
- [ ] **Step 5: Commit** `feat: 喷气背包 (TDD燃料系统)`

---

## Stage 7：HUD、音频与收尾

### Task 18: 头盔 HUD

**Files:** Create: `src/hud/Hud.ts`, `src/hud/hud.css`; Modify: `index.html`, `src/main.ts`

- [ ] **Step 1: 实现** — DOM 覆盖层（`pointer-events:none`，等宽字体、青色 #9fe8ff、细线框、轻微 `text-shadow` 辉光；四角弧形头盔暗角 CSS）：中央准星、顶部罗盘刻度带（按 yaw 平移的重复刻度）、左下速度 m/s + 海拔（离地高）、右下喷气燃料条、顶部天气警报横幅（沙尘暴/雷暴时闪烁）、右上星球时间 HH:MM。载具模式：探测车显速度/倾角，悬浮器显离地高/推力。数据每帧从事件总线与系统查询更新。开场序列：黑屏 2s 渐亮 + "LANDING SITE — SECTOR 7" 字幕淡出。
- [ ] **Step 2: 目视验证** — 步行/三种载具 HUD 正确切换，罗盘随转向平移，天气警报触发。
- [ ] **Step 3: Commit** `feat: 头盔HUD+开场序列`

### Task 19: 程序化音频

**Files:** Create: `src/audio/AudioSystem.ts`

- [ ] **Step 1: 实现** — WebAudio 全程序生成（零音频资源）：①风：循环白噪声 buffer → lowpass(400~1200Hz 随风速) + gain(风速&天气)；②脚步：着地时触发短噪声 burst，DUST/ASH 群系 lowpass 600Hz 闷响、ROCK/GLASS 2500Hz 脆响，步频随速度；③头盔呼吸：4s 周期极低音量 filtered noise，奔跑时加快；④引擎：锯齿振荡器 80~220Hz 随油门 + lowpass；⑤雷声：2s 衰减包络棕噪声 burst；⑥雨：持续高频噪声层 gain 随 rainRate。主输出总线 → 头盔 lowpass 3500Hz（微妙的头盔滤波感）。首次用户点击后 `resume()` AudioContext。
- [ ] **Step 2: 目视(听)验证** — 风随天气增强、不同地表脚步声不同、雷暴闪电后雷声、引擎随油门。
- [ ] **Step 3: Commit** `feat: 全程序化音频系统`

### Task 20: 画质分级 + 调试面板

**Files:** Create: `src/core/Settings.ts`; Modify: `src/fx/PostFX.ts`, `src/world/Terrain.ts`, `src/weather/Particles.ts`

- [ ] **Step 1: 实现** — 三档参数表：LOW（阴影 1024/无 SSAO/粒子 ×0.4/视距 4 chunks/像素比 min(dpr,1)）、MEDIUM（2048/SSAO 关/×0.7/6/min(dpr,1.5)）、HIGH（2048×2 级联/SSAO 开/×1.0/6/min(dpr,2)）。启动时按 `navigator.hardwareConcurrency` 与首 5s 平均 fps 自动降档；G 键循环切换，HUD 短暂显示当前档位。调试面板（反引号键）：天气切换、时间快进、fps/drawcall 显示、传送到最近城市。暴露 `window.__game = {ready, setWeather, setTimeOfDay, getFps, teleportToCity}` 供 e2e 使用。
- [ ] **Step 2: 验证** — 三档切换生效且 fps 变化可见。
- [ ] **Step 3: Commit** `feat: 画质三档+自动降档+调试面板`

### Task 21: Playwright 视觉冒烟 + README

**Files:** Create: `e2e/smoke.spec.ts`, `playwright.config.ts`, `README.md`

- [ ] **Step 1: 写 e2e**

```ts
// e2e/smoke.spec.ts（要点）
test('游戏加载无控制台错误', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__game?.ready, { timeout: 30000 });
  expect(errors).toEqual([]);
});
// 关键状态截图：白天/夜晚/沙尘暴/雷暴/城市废墟(teleportToCity)
// 每个: page.evaluate 设置状态 → waitForTimeout(1500) → expect(page).toHaveScreenshot(name, {maxDiffPixelRatio: 0.05})
// fps 采样: getFps() > 20（CI 宽松阈值）
```

`playwright.config.ts`: `webServer: {command: 'npm run dev', port: 5173}`，仅 chromium，viewport 1280×720。

- [ ] **Step 2: 跑通** — `npx playwright install chromium && npm run test:e2e`，首跑生成基线截图，复跑全绿；`npm run test` 全绿；`npm run build` 通过。
- [ ] **Step 3: README** — 操作说明（WASD/Shift/Space/E/R/L/G/数字键/反引号）、技术架构一览、npm 脚本。
- [ ] **Step 4: Commit** `test: playwright视觉冒烟 + docs: README`

---

## 验收清单（对照 spec）

- [ ] 无边际程序地形 + 4 生物群系 + floating origin（spec §2）
- [ ] 大气散射日夜循环 + 星空银河 + 行星环碎带 + CSM + 后处理（spec §3）
- [ ] 7 种天气平滑过渡 + GPU 粒子 + 闪电雷声（spec §4）
- [ ] 0.7g 重力、角色控制器、三载具物理（spec §5、§7）
- [ ] 程序化坍塌楼宇城市 + 散布残骸 + 可进入碰撞（spec §6）
- [ ] 第一人称沉浸细节 + 头盔 HUD + 程序化音频（spec §8）
- [ ] 画质三档 + 60fps 目标 + Vitest/Playwright 测试（spec §9、§10）
