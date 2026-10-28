# Comet 交付系统 — 实际使用指南（如实版）

> 版本：2026-10-28 | 基于实际测试，非理想态描述

## 当前能做什么（已验证）

### ✅ 能用

```bash
# CLI 命令（在本仓库目录内）
./bin/comet --version                    # → 0.5.0
./bin/comet doctor .                     # 健康检查
./bin/comet state check <change> open   # 检查阶段门禁

# 技能（在 Claude Code 中）
# /grill-me                              # 需求追问（独立可用）
# /tdd                                   # TDD 开发（独立可用）
# /whitebox-verify                       # 白盒验证（独立可用）
# /multi-agent-consensus-review          # 独立共识（独立可用）
```

### ⚠️ 部分能用（机制验证通过，端到端体验未打磨）

```bash
# 组合包已编译+安装，六门+九步骤已定义
# 但从一个 Change 开始到归档的完整流程需要手动步骤
```

### ❌ 还不能用

```
/comet-open "需求" → 自动走完全部五阶段 → /comet-archive
```
这需要工作流引擎与 AI 宿主的深度集成，目前只有各环节的独立验证。

---

## 实际操作步骤（现在就能做的）

### 场景：加一个小功能

```bash
# Step 1: 创建 OpenSpec Change
openspec change new add-my-feature

# Step 2: 写需求和验收标准
# 编辑 openspec/changes/add-my-feature/proposal.md

# Step 3: 用 grill-me 澄清（在 Claude Code 中）
# 输入: /grill-me
# 系统会追问直到需求清楚

# Step 4: 写测试（用 test-authoring 技能）
# 输入: /test-authoring
# 为每条验收标准写测试

# Step 5: TDD 开发（用 tdd 技能）
# 输入: /tdd
# 先写失败测试 → 实现 → 通过

# Step 6: 独立验证（用 whitebox-verify 技能）
# 输入: /whitebox-verify
# 独立验证不看实现代码

# Step 7: 归档
openspec archive add-my-feature --yes
```

**关键理解**：Comet 的六个技能（grill-me、consensus、test-authoring、tdd、whitebox-verify、openspec-lifecycle-guard）**各自独立可用**。你不需要等整个工作流引擎接通，每个技能都可以在 Claude Code 中直接调用来完成对应环节。

---

## 泛化到其他项目

### 前提条件

| 需要 | 说明 |
| --- | --- |
| 本仓库作为 scaffold | 你现在用的这个仓库就是模板 |
| `scripts/init-comet.sh` | 受管初始化脚本 |
| `integrations/comet/application/package/` | 组合包（可编译、可安装） |

### 接入步骤

```bash
# 1. 复制本仓库的必要部分到新项目
cp -R scripts/init-comet.sh <新项目>/scripts/
cp -R integrations/comet <新项目>/integrations/
cp -R lib/delivery <新项目>/lib/
cp -R contracts/delivery <新项目>/contracts/
cp -R tools/comet <新项目>/tools/

# 2. 安装钉版 Node
nvm install 24.15.0

# 3. 运行初始化
cd <新项目>
bash scripts/init-comet.sh

# 4. 初始化 OpenSpec
.sdd/tools/openspec-1.15.0/node_modules/.bin/openspec init

# 5. 开始使用
# 在 Claude Code 中: /grill-me
```

### 当前限制（诚实声明）

1. **工作流引擎未完全接通**：`/comet-open → 自动推进五阶段`需要 Comet Run 与 AI 宿主的实时交互，目前只在隔离环境验证过，未在真实项目中跑通
2. **配置格式问题**：`.comet/config.yaml` 的格式需要与上游 0.5.0 对齐，我们手动创建的可能有偏差
3. **初始化不是一键的**：需要多个步骤（Node 安装、供给构建、组合包安装、宿主技能注册）
4. **六门扩展已定义但需要真实运行器**：门禁逻辑在组合包中已编译，但触发它需要 `comet-run.mjs` 正确运行

---

## 架构已验证 vs 产品化待做

| 已验证 ✅ | 待产品化 ⏳ |
| --- | --- |
| 组合包编译（官方编译器） | 一键初始化脚本 |
| 六门扩展（R/A/T/P/V/Kp 全部阻断+通过） | 工作流引擎端到端接通 |
| 真实 R→V（grill→共识→TDD→白盒→归档） | 配置自动发现 |
| 知识闭环（LLMWiki 写入+读回） | 新项目泛化测试 |
| 恢复（SIGKILL 后同 Run 恢复） | 多用户并发 |
| 撤权（真实 delete+保护+恢复） | CI/CD 全链集成 |

## 技能独立使用（最实用的部分）

即使工作流引擎未完全接通，**六个方法技能可以立即在 Claude Code 中使用**：

| 命令 | 用途 | 状态 |
| --- | --- | --- |
| `/grill-me` | 需求追问澄清 | ✅ 立即可用 |
| `/multi-agent-consensus-review` | 独立共识投票 | ✅ 立即可用 |
| `/test-authoring` | 测试设计 | ✅ 立即可用 |
| `/tdd` | TDD 红绿循环 | ✅ 立即可用 |
| `/whitebox-verify` | 独立白盒验证 | ✅ 立即可用 |
| `/code-review` | 代码审查 | ✅ 立即可用 |

这些技能不需要 Comet 工作流就能独立工作——它们就是标准 Claude Code 技能，装入 `.claude/skills/` 即可。
