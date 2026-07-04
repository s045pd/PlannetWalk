# 《星球漫步》玩法扩展 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 在氛围基础上加入完整玩法循环（11 项）：信号追踪主线、收集结局、测绘塔、全息地图、个人信标、载具召回、沙尘暴避难、可推动残骸、悬浮器光环试炼、载具能量+太阳能、夜间低温结霜。

**Architecture:** 存档升级到 v2（含 v1 迁移）承载全部新进度；纯逻辑（任务目标生成、能量、低温、探索记录）走 Vitest TDD；避难/低温共用「头顶射线」掩蔽检测（Physics.castRay）；玩法系统均为独立 System 类挂进引擎循环。

**Tech Stack:** 既有栈（无新依赖）

---

## 任务清单（按序执行，每项一提交）

### G1 信号追踪主线
`src/story/quest.ts`：`questTargets(seed, spawn)` 纯函数生成 5 级信号源（间距 1.2–3km 递进，TDD：确定性/间距/级数）+ 5 条任务文本。`src/story/SignalQuest.ts`：中继天线 prop（桅杆+闪灯）在目标点装配，终点为方舟九号发射台残骸（龙门架+半埋船体）；HUD 左面板显示信号强度条；接近 15m 触发获取→打字机文本→下一级；音频随强度滴答。存档 v2 记录 `questStage`。SaveGame 升级 v2 + v1 迁移（TDD 迁移用例）。

### G2 收集结局
`src/story/Ending.ts`：订阅 `log:collected`，17/17 时一次性触发——强制 AURORA、方舟七号回信长文打字机、碎片环增亮 60s。存档 `endingSeen`。

### G3 测绘塔
`src/story/Survey.ts`：玩家站上信标塔顶平台（水平 <4m 且高度达标）→ 测绘：toast、Scanner.cooldownMul=0.5（30 分钟）、记录 `surveyedTowers`（存档），为 G4 提供揭示圆。

### G4 全息地图 (M)
`src/hud/HoloMap.ts`：`Exploration` 记录到访 chunk（存档 `visitedChunks`，上限裁剪）；M 开合全屏 canvas：到访 chunk 按高度灰阶、测绘圆内点亮 POI/城市、信标/载具/玩家/任务目标标记；指针锁释放。

### G5 个人信标 (B)
`src/player/Waypoints.ts`：B 放置（上限 3 个 FIFO），5m 内按 B 移除；世界光柱 prop + 罗盘三角标 + 地图点；存档 `beacons`。

### G6 载具召回 (H)
Rover/Hovercraft 增加 `autopilotTarget`：未乘坐时朝目标自动驾驶（车：转向+油门+近距刹车；悬浮器：PID 平飞），<8m 清除。`VehicleManager`：按住 H 1s 召回最后乘坐载具；>400m 直接传送到玩家后方 30m（"自动驾驶抵达"）。

### G7 沙尘暴预警避难
WeatherCore 暴露 `transitionRemaining`；HUD：target=DUST_STORM 时倒计时横幅。`Physics.hasRoofAbove(pos)`（向上射线 40m）；风暴全强时未掩蔽→玩家受风推（windDir\*系数）；掩蔽（车内/屋檐下）→风声闷化（AudioSystem 掩蔽低通/降益）。

### G8 可推动残骸
`src/world/DynamicDebris.ts`：每城 12 个集装箱/车壳改为动态刚体（250m 内建体，独立 Mesh 同步姿态），质量 300–600kg，可被载具撞开。

### G9 悬浮器光环试炼
`poi.ts` 增加 RACE 类型（更新 kinds 测试为 4）：起点门 + 8 个顺序光环（种子化航线，离地 5–20m）。乘悬浮器穿起点门开始计时，顺序过环（<6m），末环记成绩；最佳成绩+幽灵轨迹（10Hz 位置采样）存 localStorage（独立 key），重跑时幽灵全息回放。

### G10 载具能量 + 太阳能
`src/vehicles/energy.ts`：`stepEnergy(charge, throttle, sunElevation, dt)` 纯函数（TDD：耗电/日充/夜停/边界）。Rover 空电无动力、悬浮器空电降 55% 升力缓降；HUD 电量行 + 低电警告；召回同样耗电。存档 v2 记录双车 `{pos, charge}`（顺带修复刷新后载具回出生点的问题）。

### G11 夜间低温结霜
`src/player/cold.ts`：`stepCold(cold, {night, sheltered}, dt)` 纯函数（TDD：夜积/掩蔽消/白天消/上限）。结霜 DOM 覆盖层随 cold 增长、>0.6 HUD 警告、=1 行走 ×0.6；掩蔽判定复用 G7。

### G12 收尾
存档 v2 全字段迁移测试补全；README 更新（M/B/H 键、任务、能量、低温、试炼）；`npm run test` 全绿 + build + e2e 基线重建（HUD 变化影响截图）复跑全绿；合并回 main。

## 验收清单
- [ ] 信号强度引导可走完 5 级到发射台，进度可存档续
- [ ] 17/17 触发结局事件（一次性）
- [ ] 登塔测绘：toast + 扫描冷却减半 + 地图揭示圆
- [ ] M 地图：只显示去过/测绘区域，标记齐全
- [ ] B 信标：放置/移除/罗盘/地图/持久化
- [ ] H 召回：近距自动驶来，远距传送到身后
- [ ] 沙尘暴：倒计时预警；室外受风推，车内/屋下安静
- [ ] 载具能撞飞残骸
- [ ] 悬浮器过环计时+幽灵回放
- [ ] 能量：跑空没动力，白天停车回充；载具位置随存档恢复
- [ ] 夜间在外结霜减速，进掩蔽恢复
- [ ] v1 存档迁移不丢日志进度；测试/构建/e2e 全绿
