# AI DevOps 角色与流程架构

> 状态：权威（参考视图）。本文是 scaffold 的**纵向视图**——把横向五层（约定/协作/技能/控制/验证，见 [scaffold-architecture.md](scaffold-architecture.md)）映射到软件交付生命周期。
> 原则（继承 ADR-0015）：**映射而非编排**。scaffold 提供每个环节的能力、门禁与人机边界；不规定阶段顺序，不造状态机。团队按变更风险裁剪环节。

## 0. 人机分工三原则

| 类型 | 归属 | 例 |
|------|------|----|
| **不可逆 / 外部副作用 / 红线** | **人**（必审点） | 删库、生产发布、架构不可逆决策、写飞书对齐内容 |
| **机械可验证** | **门禁自动化**（agent 不得绕过） | 测试全绿、证据 sha256 绑定、probe 契约、check.sh |
| **判断性** | **agent 起草 + 人审** | PRD、设计、review 结论、知识提炼 |

## 1. 环节 × 能力 × 门禁 × 人决策点

| # | 环节 | agent 能力（已有=✅ / 规划=⏳） | 门禁与证据 | 人决策点 |
|---|------|------------------------------|-----------|---------|
| 1 | **需求澄清**（Intake） | ✅ grill-me 质询（一次一问消除歧义）＋⏳ 知识层 recall（v3：vault/teamwiki/飞书抽取） | findings 落盘（事实来源+未决问题+owner） | 范围与非目标拍板 |
| 2 | **产品定义**（PRD/AC） | ✅ grill-me（AC 可测性质询）＋产品文档模板（task-template 族） | AC 给定/当/则可测；non-goals 必填 | 优先级与取舍 |
| 3 | **架构设计**（Design/ADR） | ✅ **consensus 三方评审**（不可逆决策全票门）＋openspec proposal 工件 | ADR 落盘；跨模块须 openspec change | **不可逆决策批准** |
| 4 | **变更提案**（Change） | ✅ openspec `changes/<id>/`（proposal/specs/design/tasks） | 高风险先提案后实施（AGENTS §7） | 批准进入实施 |
| 5 | **任务分解**（Planning） | ✅ claude-parallel-tdd-planner（context pack/DAG/RED-GREEN ledger） | CONFIRM_ALIGNMENT 前禁改产品代码 | 计划确认 |
| 6 | **实现**（Code/TDD） | ✅ whitebox-verify（Slice 模式）＋hooks 控制平面（越界拦截/danger deny） | ✅ generation-gate（用例编写完整性：前后清单比对）；✅ test-gate（sha256 证据绑定） | — |
| 7 | **评审**（Review） | ✅ consensus 三方（架构/spec 对照）＋行级 review（ocr 类工具， degraded 按项目） | verdict + ✅ evidence-audit（声明与磁盘/命令输出一致） | **拒绝/放行**；2 拡触发返工 |
| 8 | **测试与验证**（Verify） | ✅ whitebox-verify（Journey：终态业务 oracle，No GREEN without closure）＋probe（UI/运行时证据） | ✅ probe 证据契约（debug 泄漏/布局/状态迁移）；✅ deliverable-audit | — |
| 9 | **集成**（CI） | ✅ check.sh 总门（规则/技能/回归/YAML）＋GitHub Actions | 全绿；⏳ teamai ci extract-mr（MR 知识回流） | — |
| 10 | **发布**（CD） | release 三模式（manual/auto/skip）——模式由项目自定 | 回滚路径 + 最新 verify 证据仍绑定（workflow-audit） | **发布批准**（manual 模式） |
| 11 | **归档与沉淀**（Archive） | ✅ openspec archive＋⏳ spec→wiki promotion（v3 单向晋升）＋⏳ teamwiki 摩擦沉淀 | 归档完成；晋升带 provenance | — |
| 12 | **知识对齐**（横切） | ⏳ lark-cli 服务层桥（飞书↔repo，评审产物才外推）＋⏳ deepwiki 集中消费 | 路由矩阵（v3 D3）；DR5 纪律 | 对齐内容批准 |

## 2. 角色视图（同一映射，按人组织）

| 角色 | 驱动环节 | 核心能力组合 | 主要产出 |
|------|---------|-------------|---------|
| **产品** | 1→2 | grill-me + 知识 recall | PRD、AC、non-goals |
| **架构** | 3→4 | consensus 评审 + openspec + ADR | 设计、ADR、变更提案 |
| **研发** | 5→6 | planner + TDD + hooks 边界 | DAG 计划、代码+测试+证据 |
| **测试** | 7→8 | whitebox Journey + probe + 三 audit | 验证报告、终态证据 |
| **平台/DevOps** | 9→10 + scaffold 维护 | check.sh/CI + release + bootstrap | 绿流水线、可回滚发布、scaffold 升级 |
| **知识 curator**（可轮值） | 11→12 | archive + promotion + lark 桥 | 团队知识库、飞书对齐页 |

角色是**能力组合的视角**，不是组织岗位强制——一人可兼多角色，一个环节可多人介入。

## 3. 风险分级裁剪（环节按需组合）

| 变更风险 | 必经环节 | 可跳过 |
|---------|---------|--------|
| 单文件低风险 | 6（TDD）+9（CI） | 1-5、7-8、11 |
| 标准多文件 | 1、4-9 | 2-3 视情况 |
| 跨模块/高风险 | **全环节**（3 必须 consensus 全票） | 无 |
| 不可逆（数据/定位/安全） | 全环节 + ADR + 人工双重审 | 无 |

裁剪由执行 agent 按触发矩阵（[skill-architecture.md](../agent/skill-architecture.md)）判断，**门禁不可裁剪**——跳过环节=不产生对应工件，不等于伪造通过。

## 4. 效果杠杆（为什么这样组合）

1. **澄清前置**（1-2）：grill-me 消歧的成本是返工成本的 1/10——问题在 findings 里暴露，不在 review 里爆炸。
2. **计划显式化**（5）：DAG + RED/GREEN ledger 让并行实现不漂移；CONFIRM_ALIGNMENT 是第二道人闸。
3. **证据链闭环**（6-8-10）：test-gate sha256 → probe 契约 → evidence-audit → workflow-audit——每个"通过"都可机械复核，agent 无法口头宣称完成。这是 AI DevOps 与传统 DevOps 的本质差异：**信任来自证据不来自汇报**。
4. **评审对抗性**（3/7）：consensus 全票 + 行级 review 双层——多数票和平均分不能放行，分歧必须被证据关闭。
5. **知识回流**（11-12）：每次变更的长期结论晋升 wiki、摩擦经验自动沉淀、飞书双向对齐——交付过程同时是团队资产的积累过程。
6. **门禁即护栏**（横切）：hooks 在 agent 运行时拦（fail-closed），check 在提交时拦（全绿才过），CI 在合并时拦（第三层）——三层拦截互为冗余。

## 5. 与现有架构的关系

- 本文不新增工具：所有 ✅ 项已在仓库，⏳ 项挂靠 [knowledge-layer-plan.md](knowledge-layer-plan.md)（K1-K5）与 [teamai-integration-plan.md](teamai-integration-plan.md)（P0-P3）。
- 触发矩阵（skill-architecture.md）是本文环节视图在"任务粒度"的投影；两文档以触发矩阵为操作入口、本文为全景索引。
- 新增环节能力时：先过本表对应环节的门禁定义，再进触发矩阵——防能力漂移。
