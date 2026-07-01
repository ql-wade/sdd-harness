# MiniCraft 探针：第一人称体素沙盒 MVP

> Raw source：本地项目 steering doc + 体素引擎设计原则（互联网检索）

## 定位
浏览器第一人称体素沙盒——不是 2D 生存游戏（那是 Notch 的 MiniCraft），是 3D 第一人称方块世界。用作 SDD Harness 的探针：验证 harness 能否稳定产出高质量可交互的游戏。

## 技术约束
- TypeScript + Three.js + Vite + Vitest
- Chunk 系统：16×16×16 体素块
- Block types：grass / dirt / stone / wood（枚举）
- 分层架构：world(体素数据) / render(Three.js 网格) / input(键鼠) / player(位置/碰撞)

## 体素引擎设计原则（互联网检索）
- Chunk 是空间分块单元，标准 16³，字典 key 为 world coord index
- getBlock(pos) / setBlock(pos, val) 封装 chunk 边界，setBlock 后标记 chunk dirty 触发 mesh 重建
- DDA ray-casting 用于方块选择（准星指向 → 步进 → 找第一个实心体素 → 返回坐标 + 面法线）
- Greedy meshing 合并同材料相邻面，减少三角形数
- 地形生成：Perlin/Simplex 噪声 → 高度图 → biome 覆盖 → 填块

## verify 阶段实测产出（progress.md 2026-06-27）
- 47 个 vitest case 全 pass
- 覆盖矩阵：world 12 / render 9 / input 10 / player 12 / HUD 4
- 性能基准：rebuildChunkMeshes M1 < 5ms（performance.now 基准）
- AC-1..AC-8 浏览器手测通过
