# 提案 v2：README 综合重构（对标 opencode / OmO 等开源 + consensus 评审）

> 状态：v2（三席 REPAIR×3 全部 findings 已合并修订——12 major + 14 minor → 11 主题逐字落文；
> 处置对照表见 consensus-round1-progress.md。moderator 认证：方向与九节结构三席一致成立，
> findings 均为文本级/事实级修正，REPAIR 后收敛）
> 提案人：主会话；触发：项目所有者指令——「项目是集成团队的 ai devops 流程，参照 opencode omo 这些开源项目，综合调整 README」
> 研究依据：11 个来源实际抓取原文（2026-11-04）：opencode、OmO（oh-my-openagent，前身 oh-my-opencode——多源交叉确证）、aider、goose、claude-code、spec-kit、OpenSpec、backstage、cookiecutter、agents.md 标准、GitHub 官方 README 文档；共识强度分级于评审后归档至本 change

## Why（现状差距——审视结论）

对照业界共识（首屏四问 6/6、badges 6/6、demo 4/6、渐进披露 7/7、CLI 全表 0/6 进 README、求助入口 6/6）与品类差异化模式（spec-kit 按需决策表与宿主标注、OpenSpec 对话 transcript 与 vs 对比、backstage 文档表含 ADR、agents.md 双入口分工、判定语义显式化），现行 README（118 行中文 9 节）存在六个真实差距：

1. **首屏叙事错位**：第 3 行一段塞三个深链接，首屏不答「是什么/给谁/为什么」——对标 6/6 首屏只有 tagline + badges。
2. **多类读者无分层**：评估决策者 / 首次上手工程师 / 框架维护者 / 审计与证据回读者 / 执行 agent 各自入口混在正文——品类实证：spec-kit 决策表、cookiecutter 双受众分节、backstage 并列清单、agents.md 标准「AGENTS.md 是 README for agents」并行双入口。
3. **快速开始分裂且与 cookbook 有历史偏离**：「基础设施初始化」与「受管交付六门」分居两处中间隔四大节；装应用只写 preview（RUNBOOK 实为两步安装）；命令无宿主标注。
4. **CLI 全表误置 + MCP 双维护**：9 条命令全文 = reference 内容（GitHub 官方分工 + 0/6 对标反例 + Diátaxis reference 分型）；MCP 表与 mcp-capabilities.yaml 双维护自违唯一事实源。
5. **求助/陷阱入口缺位**：RUNBOOK 陷阱表无 README 入口（goose Known Issues / aider FAQ / backstage FAQ 三实证同构）。
6. **无演示、无 badges**：CI 双 workflow 在盘但 badge 实测当前全红（见 D4 分步条件）；无 demo——OpenSpec 实证对话 transcript 是流程类工具最匹配形态。

已做对的（保持）：相对链接、退出码契约、诚实三态标注、「构建成功不等于运行资格」克制表述。

## What Changes（新结构，逐节设计——11 主题落文）

```markdown
# AI Coding Scaffold
> tagline（定语统一「脚手架」——仓库锚定自称，与 AGENTS/CLAUDE 定位句不矛盾）：
> 团队 AI coding 流程脚手架——把任意软件变更沿六道管理门（R→A→T→P→V→Kp）驱动到归档，
> 每道门强制独立证据链。
> 名词锚定（两句）：脚手架 = 五设施（规则入口+技能+hooks 控制平面+MCP 清单+验证工具）；
> 受管交付 = 六门流程应用，人只在审批点拍板。
badges 行（D4 分步条件）：当前不上 CI badge（两 workflow master 实测全红——转绿后才上，
URL 文件名形态已核实）；无 license badge（仓库无 LICENSE 文件——如实不加）；
无 Node/Comet 静态 badge（不可验证声明 + 随升级静默过期，席2#10 裁弃）。
```

### 1. 它是什么（四问压缩 ≤3 段）
- 定义段：两名词锚定句（上）+ 五设施一句话
- Why/compare 三段（措辞中性化）：vs 无流程（返工无证据链）/ vs 硬编码固定流程（基础层
  不规定工作流 ADR-0015；**衔接句：受管交付是可选的流程应用**）/ 自证段（**如实覆盖范围**：
  两轮试点验证的是 RUNBOOK/drive-journey 六门流程与证据链，非 convergence 目标架构——
  可读证据优先链接 STATUS-2026-11-01.md / acceptance-index.json，execution-ledger 次级引用
  并注明归档迁移后的链接维护策略）

### 2. 五入口（按你是谁，一行一入口——审计读者补入）
| 你是谁 | 从这里开始 |
| 引入评估的决策者 | 下方自证段 + 试点证据（可读证据先行；convergence 为第二跳，标注：目标架构，设计修订完成、实施以 tasks/DAG 为准） |
| 首次上手的工程师 | **下方快速开始（本页锚点）→ 之后 RUNBOOK**（受管交付 cookbook——消两条并行起步路径分叉） |
| 框架维护者 | AGENTS.md + CLAUDE.md（开发命令/构建告诫）+ docs/architecture/adr/ |
| 审计与证据回读者 | RUNBOOK 证据节 + tools/gate-bundle.mjs + foundation/（封存基线） |
| 执行 agent | AGENTS.md（agents.md 标准：README for agents——并行双入口） |

### 3. 快速开始（D1-D4 修正后命令流，命令+注释约 12 行；**AC-2 机械判据 = clone 到首个审批点可执行路径——实跑验证**）
```bash
git clone <本仓库> my-project && cd my-project   # 终端
bash tools/bootstrap.sh                          # 终端——hooks/skills/MCP 落地
# 编辑 AGENTS.md 与 openspec/project.md 的 TODO(team)   # 终端（编辑器）
bash scripts/check.sh                            # 终端——骨架完整确认
# 重启 Claude Code 会话——hooks 不重启不生效（功能前置，必须注释行）
comet application install <scaffold>/integrations/comet/application/package/application.json \
  --project "$PWD" --preview --json              # 项目根终端——第 1 步：记下 confirmationHash
comet application install ... --confirmation-hash <hash> --project "$PWD"  # 第 2 步：正式安装
mkdir -p openspec/changes/my-change              # 项目根终端——建目录（不要跑 comet state init——RUNBOOK 陷阱表）
export SDD_SESSION_ID="$(uuidgen)"               # 项目根终端——驱动器硬前置
bash tools/drive-journey.sh my-change            # 项目根终端——起 Run
# 审批点在驱动器所在终端输入 approved/同意/y/yes（/dev/tty，非 agent 对话）
```
前置行（**分列如实**，D4）：工具链 ≥18（bootstrap/check.sh）· 受管交付旅程 ≥22.16
（24 最佳——见 RUNBOOK 开始前表，node 退化陷阱在册）· Comet 0.5.1（PATH）。

### 4. 六门流程（ASCII 图 + 判定语义表为正式内容）
R→A→T→P→V→Kp→Archive 图示（每门一行职责）+ **Kt 终点行**（归档后经验经 Kt 双通道
写入团队知识库）+ 判定语义表（**正式内容非占位**——D3 裁决：每门 verdict
pass/repair/revise-requirements 一行 = workflow 契约级事实，不易腐）；
对话 transcript demo 仅在真实脱敏取证后追加（锚可定位旅程：minicraft r-series 或
delivery-foundation 验证 Run；claimToken 类凭据不得入文），**不发空 <details> 占位**。

### 5. 文档地图（渐进披露入口层 + 分工规则成文——D5 裁决）
分工规则（写死）：README = 按角色/任务「何时读」；FRAMEWORK.md = 按目录理解仓库 + 纯净线
规则；RUNBOOK = cookbook 操作序。README 分层图收敛为 scaffold-architecture.md 指针
（七层图实际所在 :30-42——不重复版本号，FRAMEWORK.md 的 v27 漂移教训在册）。

| 文档 | 何时读 |
RUNBOOK（cookbook + 陷阱表——求助/陷阱入口在此）/ scaffold-architecture（权威架构）/
convergence（目标架构，设计修订完成、实施以 tasks/DAG 为准）/ adr/（不可逆决策）/
skill-architecture（触发矩阵）/ mcp-capabilities.yaml（能力唯一事实源——一句话+链接，
D2 裁决：yaml 完整承载四条状态说明，零信息损失）/ FRAMEWORK.md（框架结构+纯净线）/
当前实施状态（tasks.md + HANDOFF——归档迁移维护说明同决策者行）/ **审计回读**（证据链
+ foundation/ 封存基线）/ docs/delivery/managed-delivery-quickstart.md（历史文献，
现行以 RUNBOOK 为准）

### 6. 技能与工具（索引化：一行 + 深链；at-risk 八项保全）
- 技能表 4 行保留（行末补 docs 深链）；触发矩阵链接
- 验证工具：doctor / test-gate / check.sh 三条 + 退出码一行 + **完整 9 条清单移
  docs/reference.md（新建，D1 裁 A 三条件：同 change 创建 + 登记文档地图 + README 保留
  退出码一行）**
- MCP：一句话 + mcp-capabilities.yaml 链接（D2：零信息损失已核实，README 不再复制状态表）
- Hooks：四条一句话保留 + hooks.yaml + adapter 扩展句（tools/adapters/<agent>.sh）保留
- 开发本仓库（原第 9 节落点）：npm test / check.sh + build-application.mjs 指针 +
  「构建成功不等于运行资格」告诫保留

### 7. 求助与治理（Need help 位）
陷阱与恢复 → RUNBOOK 陷阱表；反馈渠道一行（团队内部渠道如实写）；治理 → ADR +
AGENTS.md 指令层级。

## 同步纪律（新——席3#4 成文）
README 头部 HTML 注释维护规则：改 RUNBOOK 第 0-3 步命令、陷阱表、应用版本 → 同步本
README 快速开始/五入口/文档地图三节。登记入本 change tasks.md。三个快速开始面分工
声明（上 D5）。

## 非目标

- 不改 FRAMEWORK.md / AGENTS.md / RUNBOOK 正文（理由显式：三者入口职责成立且各有受众；
  README 侧措辞单方面避让其信号——FRAMEWORK「人类从这里开始」行与工程师入口指 RUNBOOK
  一致）。重叠处置仅动 README 侧。
- 不做多语言平级翻译（中文单主语言；业界模式是平级文件而非文内混排——推断非对标）
- 不删任何信息（分流而非删除；AC-3 附 at-risk 八项清单逐一保全：tasks.md 指针、
  gate-bundle 指针、state-init 陷阱指针、adapter 扩展句、build 命令+告诫、--with-llmwiki
  分支、SDD_SESSION_ID export、重启会话步骤）
- 不加 LICENSE 文件（仓库现状无——公开仓库使 LICENSE 另议优先级上升，单独小任务处理）
- 仓库实际公开（匿名 200 实测）——「内部仓库」措辞自 v2 起修正

## 验收（AC 编号，机器可解析 + 双轨 route 标注自举）

- **AC-1**（route: test）首屏机械边界：首个 `##` 前深链接 ≤1；tagline + 名词锚定两句 +
  badges 分步条件注记在场；tagline 定语与 AGENTS/CLAUDE 定位句不矛盾（grep 核对）
- **AC-2**（route: test）快速开始命令序列 = 从 clone 到首个审批点的**可执行路径**
  （合成项目实跑验证，非行数断言）；计行规则 = 命令+注释约 12 行；SDD_SESSION_ID/
  两步安装/重启会话/state-init 陷阱四要素在场
- **AC-3**（route: test）渐进披露：原九节内容全部有落点（映射表核对）+ at-risk 八项
  逐一在场；MCP 状态表不再复制（grep 无状态行）；docs/reference.md 存在且被文档地图
  登记（D1-A 三条件）
- **AC-4**（route: test）求助/陷阱入口在 README、内容在 docs；quickstart 历史文献标注
  在场；分层图为 scaffold-architecture.md 指针（grep 无重复七层图全文）
- **AC-5**（route: test）相对链接有效性脚本化（提取全部相对链接 test -e——check.sh 窄
  检查或一次性脚本）；诚实标注贯穿（无 license 无 badge、CI badge 缺席 + 转绿分步条件
  注记、llmwiki ENOENT 类现状如实）
- **AC-6**（route: inspection）五类读者各自路径从首屏到达入口且走查通过（人工走查，
  决策者/审计两条路径以可读证据文件存在性为准）

## v3 定位决策（项目所有者 2026-11-04 指令）

1. **README = 架构展示页（architecture showcase）**：主目的是宣传并讲清架构本身——六门
   受管交付、独立证据链、控制平面、知识收敛是主角；快速开始/文档地图降为支撑节（consensus
   全部事实修正保留）。
2. **中英双份**：`README.md`（英文，对外宣传主文）+ `README.zh.md`（中文）；顶部语言切换行
   （opencode/OmO/spec-kit 平级翻译范式）。
3. **去 AI 味**：英文按 Wikipedia AI-writing signs + blader humanizer 纪律（禁 leverage/
   seamless/robust/empower 类词、禁三段式填充、克制破折号、具体名词与真实数字替代形容词）；
   中文按 humanizer-zh 同源纪律（去夸大象征、宣传腔、-ing 肤浅分析、模糊归因、破折号滥用、
   否定式排比、连接词堆砌）。两份都过双语言自查后才提交。
4. AC-5 增补：AC-6 route 标注随 v2；本 v3 不改 AC 判据本体（定位与语言是实施约束，非新判据）。
5. **D5 反转（定位决策推导）**：v2 裁「分层图收敛为指针」基于工具型定位；架构展示页定位下
   分层图就是架构说明本体——README 承载七层图（英译），细节深链 scaffold-architecture.md；
   FRAMEWORK.md 保持框架结构/纯净线视角，两处不再重复版本号。
6. **配套件**：docs/reference.md（D1-A，CLI 完整清单）+ 本 change tasks.md + 双语言切换行。
