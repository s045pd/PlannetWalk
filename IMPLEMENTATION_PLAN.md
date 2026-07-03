# 《星球漫步》实施进度

> 详细计划: `docs/superpowers/plans/2026-07-03-planet-walk.md`
> 设计文档: `docs/superpowers/specs/2026-07-03-planet-walk-design.md`

## Stage 1: 骨架与核心循环 (Task 1-2)
**Goal**: Vite+TS+three 脚手架、固定步长引擎循环、事件总线、输入
**Success Criteria**: 旋转方块渲染、fixedStep 单测绿、build 通过
**Tests**: tests/fixedStep.test.ts
**Status**: Not Started

## Stage 2: 地形与物理漫步 (Task 3-7)
**Goal**: 噪声高度场、环形 LOD 区块地形、worker 流式加载、floating origin、Rapier 角色控制器
**Success Criteria**: 第一人称在无边际地形行走/跳跃、不穿地、原点回移无跳变
**Tests**: noise/heightfield/floatingOrigin 单测
**Status**: Not Started

## Stage 3: 天穹光照与后处理 (Task 8-10)
**Goal**: 大气散射天穹、日夜循环、星空、行星环碎带、CSM 阴影、后处理
**Success Criteria**: 日出到夜晚色彩自然、碎片环可见、后处理 fps 掉幅 <15%
**Tests**: 目视验证（渲染代码不做脆弱断言）
**Status**: Not Started

## Stage 4: 天气系统 (Task 11-12)
**Goal**: 7 态天气状态机、GPU 粒子、闪电雷暴
**Success Criteria**: 天气单测绿、7 种天气可切换且过渡平滑
**Tests**: tests/weather.test.ts
**Status**: Not Started

## Stage 5: 废墟都市 (Task 13)
**Goal**: 程序化坍塌楼宇、城市装配、散布物
**Success Criteria**: 可步行进城、碰撞正常、fps ≥ 纯地形 80%
**Tests**: 目视验证 + 后续 e2e 截图
**Status**: Not Started

## Stage 6: 载具 (Task 14-17)
**Goal**: Rideable 接口、六轮探测车、悬浮飞行器、喷气背包
**Success Criteria**: pid/jetpack 单测绿、三载具可驾驶且手感稳定
**Tests**: tests/pid.test.ts, tests/jetpack.test.ts
**Status**: Not Started

## Stage 7: HUD、音频与收尾 (Task 18-21)
**Goal**: 头盔 HUD、程序化音频、画质三档、Playwright 冒烟、README
**Success Criteria**: 单测全绿、e2e 截图基线建立、build 通过
**Tests**: e2e/smoke.spec.ts
**Status**: Not Started
