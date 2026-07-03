# 《星球漫步》氛围深化扩展 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 在已完成的主体（地形/天穹/天气/物理/载具/HUD/音频）之上，按既定顺序加入 15 项氛围深化内容：叙事碎片、POI 信标、夜间城市微光、照片模式、载具粒子、SSAO、地形细节法线、存档、天气玩法影响、可进入建筑、手柄、扫描仪、设置菜单、极光、头盔存在感。

**Architecture:** 全部在现有模块架构内扩展：新增 `src/story/`（叙事）、`src/world/poi.ts + PoiManager.ts`（兴趣点）、`src/fx/ParticlePool.ts`（通用粒子池）、`src/player/PhotoMode.ts`、`src/core/SaveGame.ts`。纯逻辑（日志分配、POI 选址、存档序列化）走 Vitest TDD；渲染项走 preview 目视 + 最终重建 e2e 截图基线。

**Tech Stack:** 既有栈 + `n8ao`（SSAO）+ Gamepad API + localStorage

**Spec 背景:** 世界观锚点——天上的碎片环是被轨道武器摧毁的卫星「晨昏」(Twilight)，叙事日志围绕它展开，与 DebrisRing 视觉互相印证。

---

## Stage A：第一梯队（叙事与体验核心）

### Task A1: 叙事碎片系统
**Files:** Create `src/story/logs.ts`（16 条日志纯数据 + `pickLogForSite(seed,cx,cz)` 确定性分配）、`src/story/LogPickups.ts`（发光数据板放置/拾取/事件）；Modify `src/hud/Hud.ts`（打字机日志面板 + 收集进度）、`src/core/EventBus.ts`（`log:collected`）；Test `tests/logs.test.ts`
- 数据板：城市内每城 2 块（种子确定性挑楼旁位置）+ 每个 POI 1 块；小型发光方板 + 浮动呼吸动画，3m 内 HUD 提示 [E]，拾取后打字机显示标题+正文，重复 id 显示「已收录」。
- 测试：`pickLogForSite` 同种子确定、索引在界内；收集状态 reducer（新增/去重/计数）。

### Task A2: POI 系统 + 罗盘信标
**Files:** Create `src/world/poi.ts`（`poiSiteAt(seed,cx,cz)`：1024m 网格 ~22% 概率，避开城市半径+200m；类型 WRECK/TOWER/CRATER）、`src/world/PoiManager.ts`（视距内装配/回收/碰撞，同 Ruins 模式）；Modify `src/world/heightfield.ts`（CRATER 凹陷+环缘、WRECK/TOWER 小台地混合——worker 自动生效）、`src/hud/Hud.ts`（罗盘 POI 菱形标记+距离）；Test `tests/poi.test.ts`
- WRECK：半埋倾斜船体（盒体组合）+ 散落残骸；TOWER：格架塔 + 螺旋台阶盒（autostep 可走）+ 塔顶信标闪灯；CRATER：地形凹坑 + 斜插的巨型环碎片（发光棱边）。
- 测试：选址确定性、与城市间距、陨坑高度函数连续性（不破坏现有 heightfield 测试）。

### Task A3: 夜间城市微光
**Files:** Modify `src/world/Ruins.ts`（每城 ~15 个发光窗口 quad InstancedMesh，自定义 shader：按 instance 哈希闪烁 + `uNight` 因子控制显隐）、`src/main.ts`（每帧传入 nightFactor）
- 目视验收：夜间城市里零星窗口忽明忽暗，白天不可见；bloom 拾取光晕。

### Task A4: 照片模式
**Files:** Create `src/player/PhotoMode.ts`；Modify `src/core/Engine.ts`（`cameraLock` 标志 + `timeScale`）、`src/player/Player.ts`/`src/vehicles/Rideable.ts`（cameraLock 时跳过输入与相机）、`src/hud/Hud.ts`（隐藏）
- P 切换：自由相机（WASD+QE 升降、滚轮 FOV、Z/C 滚转、Shift 加速），世界慢动作 timeScale 0.15，HUD 隐藏；再按 P 恢复。

## Stage B：视觉还债

### Task B1: 通用粒子池 + 车轮扬尘/喷气喷焰/悬浮气垫尘
**Files:** Create `src/fx/ParticlePool.ts`（instanced quad 环形缓冲，CPU spawn/GPU 动画，尘（alpha）与焰（additive）两材质）；Modify `Rover.ts`（轮后扬尘）、`Player.ts`（喷射焰锥+尘）、`Hovercraft.ts`（低空气垫尘环）
### Task B2: SSAO (n8ao)
**Files:** Modify `src/fx/PostFX.ts`（`N8AOPostPass` 插入 RenderPass 后；画质档开关：low 关 / medium 半res / high 全res）；`package.json` + `n8ao`
### Task B3: 地形三平面细节法线
**Files:** Modify `src/world/TerrainChunk.ts`（fragment 注入：pwNoise 双尺度梯度扰动 normal，随距离淡出防闪烁）

## Stage C：系统深度

### Task C1: 存档系统
**Files:** Create `src/core/SaveGame.ts`（`serialize/deserialize` 纯函数 + localStorage 读写，v1 版本守卫）；Modify `src/main.ts`（10s 自动存 + hidden 时存；启动有档则按档定位/时间/天气/日志）；Test `tests/saveGame.test.ts`（round-trip、坏档回退 null、版本不符回退）
### Task C2: 天气影响玩法
**Files:** Modify `src/hud/Hud.ts`（沙尘暴 dustRate>0.7 时罗盘乱跳、POI 标记消失）、`src/weather/Lightning.ts`（雷暴中玩家离地>15m 或喷射时，落雷偏向玩家：立即雷声+闪白+`player:shocked`）、`src/player/Player.ts`（受击随机冲量+燃料损失 20%）、`EventBus`（`player:shocked`）
### Task C3: 可进入建筑
**Files:** Modify `src/world/Building.ts`（~25% 楼宇：底层留门洞、核心筒内螺旋楼梯板、顶部天台开口；返回 `colliders[]` 复合盒列表替代单盒）、`src/world/Ruins.ts`（复合碰撞体装配）
### Task C4: 手柄支持
**Files:** Modify `src/core/Input.ts`（Gamepad 轮询：左摇杆→WASD 模拟、右摇杆→视角增量、A=Space、X=KeyE、B=KeyR、LB=KeyL、RT=Shift、Start=KeyP；`consumeMouse` 合并右摇杆）、`src/core/Engine.ts`（每帧先 poll）
### Task C5: 扫描仪脉冲
**Files:** Create `src/player/Scanner.ts`（Tab 触发：世界扩散环 shader mesh + 400m 内 POI/未收集日志显示漂浮菱形标记 4s，冷却 6s）；Modify `Hud.ts`（冷却提示）

## Stage D：小项与收尾

### Task D1: 设置菜单
**Files:** Create `src/hud/SettingsMenu.ts`（Esc 开合，释放指针锁：主音量/鼠标灵敏度/FOV/画质/键位表；localStorage `pw-settings` 持久化并启动时应用）；Modify `AudioSystem.ts`（master 音量 setter）、`Player.ts`（灵敏度系数）
### Task D2: 极光天气
**Files:** Modify `src/weather/weatherStates.ts`（第 8 态 AURORA，自 CLEAR/FOG 低权重可达）、Create `src/sky/Aurora.ts`（竖直帘幕带 shader：噪声滚动 alpha，绿-青-紫，夜间因子×极光因子显隐）；测试自动覆盖（转移合法性用例遍历全表）
### Task D3: 头盔存在感强化
**Files:** Modify `src/hud/hud.css`（面罩斜向反光条纹、边缘刮痕纹理、随呼吸周期的轻微雾化脉动动画）
### Task D4: 收尾
- README 更新（新按键：P/Tab/Esc/1-7/G/反引号、手柄映射、新系统说明）
- `npm run test` 全绿；`npm run build` 通过；e2e 重建截图基线（视觉已变：`--update-snapshots`）并跑绿
- IMPLEMENTATION_PLAN.md 状态更新、合并回 main

## 验收清单
- [ ] 16 条日志可拾取、打字机呈现、进度持久化（含存档）
- [ ] 三类 POI 生成正确、罗盘信标指向最近 POI、塔可登顶、陨坑地形成立
- [ ] 夜城有微光、白天无痕迹
- [ ] 照片模式：自由机位/慢动作/无 HUD
- [ ] 车轮扬尘、喷焰、气垫尘可见
- [ ] SSAO 在城市街景有接触阴影、low 档关闭
- [ ] 近景地面有细节法线、远处无闪烁
- [ ] 刷新页面回到上次位置与进度
- [ ] 沙尘暴罗盘失灵；雷暴中高空/喷射会被近雷击中
- [ ] 部分楼宇可走入并登顶
- [ ] 手柄可完整游玩
- [ ] Tab 扫描高亮 POI/日志
- [ ] 设置菜单生效且持久化
- [ ] 极光在夜间出现（调试键可切）
- [ ] 单测全绿 + e2e 新基线全绿
