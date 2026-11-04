# README 重构 consensus 评审进度（round 1，2026-11-04）

> 评审对象：openspec/changes/readme-restructure/proposal.md（v1 draft）。
> 三席并行，本文随裁决到达逐席落盘；全席到齐后 moderator 合并处置 → 修订提案 → 最终方案。

## 裁决进度

| 席 | 透镜 | VERDICT | findings |
|---|---|---|---|
| 1 | 定位与受众一致性 | REPAIR | 2 major + 6 minor |
| 2 | 信息架构与渐进披露 | 待返回 | 运行中 |
| 3 | 可实施性与维护性 | REPAIR | 5 major + 2 minor |

## 席3 findings（5 major + 2 minor）

1. **major** — 快速开始命令流三处实证相悖：(a) 丢 `export SDD_SESSION_ID="$(uuidgen)"`（drive-journey.sh:11 硬前置，缺失即 usage 退出——现行 README 有此步，压缩把它丢了 = 相对现状回归）；(b) 装应用只写 --preview——RUNBOOK L38-42 是两步安装（preview 记 confirmationHash → 带 --confirmation-hash 正式安装），只跑 preview = 未安装，drive-journey 必报未安装；(c) 丢 `mkdir -p openspec/changes/<change>` 与 proposal.md 步（跳过 → R 门拒）。**建议**：AC-2 增机械判据「快速开始命令序列 = clone 到首个审批点的可执行路径」；≤10 行装不下真实流程（仅必需命令已 9 条）——放宽至每命令一行+宿主注释约 12 行或回两 block 结构。
2. **major** — 宿主标注事实错误：「审批点在 agent 对话拍板」错——drive-journey.sh 从 /dev/tty 读 approved（人类模式），RUNBOOK L77/L85/陷阱表 L229 均指驱动器所在终端 stdin。**建议**：改「审批点在驱动器所在终端输入 approved/同意/y/yes」。
3. **major** — Node 版本四处不一致（package.json engines >=18 / AGENTS §3 >=18 / drive-journey 报错 >=20 / RUNBOOK ≥22.16 24 最佳）；单一前置行无法同时为真；静态 shield badge 最易腐。**建议**：badge/前置只写基础设施层事实 + 一句「六门交付前置见 RUNBOOK 开始前表」；或去版本类 badge。需显式裁决。
4. **major** — 同步纪律缺位：README 不在 AGENTS §1 所有权表，仓库无「改 RUNBOOK 同步 README」纪律，而新结构每节皆易腐（badges 版本号/demo 冻结版本/四入口路径/文档地图 60+ 文件/宿主标注）；漂移已有实证（FRAMEWORK.md 写 v27、git 已 v28）；仓库实际存在三个快速开始面（README/FRAMEWORK/RUNBOOK）。**建议**：README 头部加维护规则注释（改 RUNBOOK 0-3 步/陷阱表/应用版本 → 同步 README 三节）+ 列入 tasks.md；显式说明为何不动 AGENTS.md 或放宽该非目标；D5 裁向指针方向（README 分层图不重复版本号）。
5. **major** — D3 素材来源不可定位：new-sdd-verify 全仓 grep 仅命中 proposal 自身（该旅程在另一会话尚未产出可入库证据）；取证脱敏成本真实（绝对路径/UUID/confirmationHash/runId 需机器替换；claimToken 类凭据不得入文）。**建议**：判定语义表先行且作为正式内容（verdict 词汇 = workflow 契约级事实，不易腐）；transcript 仅在真实脱敏取证后追加并锚到可定位旅程（minicraft r-series 或 delivery-foundation 验证 Run）；**不发空 <details> 占位**（占位即承诺未来证据，违诚实标注文化）。
6. minor — AC 可测性：AC-1 需钉机械边界（首 ## 前深链 ≤1）；AC-5 落 check.sh 窄检查或一次性脚本；AC-6 纯 inspection——且本提案是 openspec change 的 proposal，AC 无 F-ID 无 route 标注，不符仓库自己声明的双轨 AC 标准。建议逐条补 route。
7. minor — 正面确认：check.sh 全链路零 README 内容断言（重写不碰检查器）；CLAUDE 软链检查无关；test/ 10 处 README 命中均在另一文件；CI 无 .md 断言；badge URL 可构造；文档地图目标全存在。遗漏三点：「重启 Claude Code 会话」步被静默丢弃（保留或说明）；D1 裁移 docs/reference.md 需新建文件（成本+1）；仓库可见性未核实（私有 badge 对未登录不渲染，合并后验证一次）。另：change 目录需补 tasks.md 再实施。

## 席1 findings（2 major + 6 minor）

1. **major** — 前置要求错误统一为 Node>=18（出处 CLAUDE.md 是工具链要求），但快速开始终点 drive-journey.sh 按 RUNBOOK:22 要求 **Node ≥22.16**（L26-30 有退化陷阱）——用 node18 跟随新快速开始会在旅程起点失败，违 AC-5 诚实标注。**建议**：前置/badge 分列「Node ≥22.16（受管交付旅程）/ 工具链 ≥18」。
2. **major** — 决策者首跳 comet-ai-devops-convergence.md 实测自述「尚未实现或验收」（设计态文档），且与「两轮试点实证」张力未调和（试点验证的是 RUNBOOK 流程非 convergence 目标架构）；「试点证据」无具体落点路径，AC-6 决策者路径不可走查。**建议**：决策者入口 = 自证段（如实覆盖范围）+ 具体 ledger 路径先行；convergence 降第二跳 + 设计态标注。
3. minor — 漏第五类读者：**审计/证据回读者**（FRAMEWORK.md 给 foundation/ 标注受众「审计回读」）。建议文档地图补一行或显式说明覆盖。
4. minor — 六门图止于 Kp→Archive 丢 **Kt**（三处一致语义 Kp→归档→Kt 双通道）。建议图补 Kt 终点行。
5. minor — 「vs 死流程」措辞口语微贬损（建议中性化「硬编码/固定流程」）；「不规定工作流」与六门 pitch 需衔接句（「基础层不规定工作流；受管交付是可选的流程应用」）。
6. minor — D5 边界未钉死（README=按角色/任务何时读；FRAMEWORK=按目录+纯净线规则）；convergence 括注「当前实施」overstated（改「目标架构，设计修订完成、实施以 tasks/DAG 为准」）。
7. minor — 研究依据称「分级存档于 consensus-round1.md」悬空（文件未落盘）。改「将于评审后归档至本 change」。
8. minor — 定位词三说并存（AI Coding Scaffold / 脚手架 / 交付基建）：「脚手架」是仓库锚定自称更准；AC 补「tagline 与 AGENTS/CLAUDE 定位句不矛盾」；四问段两句话锚定两核心名词（脚手架=五设施；受管交付=六门流程人只审批点拍板）。

事实核查通过：无 LICENSE（诚实不加 badge ✓）、CI 双 workflow + 远端属实、118 行 9 节属实、quickstart 历史文献标注成立、docs/reference.md 不存在（D1 选它即新建）、四入口克隆后仍成立、中文单主语言自洽。

## 席2 findings（5 major + 6 minor）

1. **major** — 「ledger 链接」悬空（盘上 37 个 ledger 匹配无指路；主候选是机器 JSONL 且在活跃 change 目录，归档迁移后链接失效）。建议：人类自证优先可读证据（docs/user/STATUS-2026-11-01.md 或 acceptance-index.json），ledger 次级 + 归档迁移维护说明；tasks.md 指针并入「当前实施状态」行。
2. **major** — CI badges 技术可行已核实（仓库公开匿名 200；badge URL 用文件名形态正确）但**实测两枚当前 default 分支全红**（SVG title 逐字 "failing"）——现在加 = 首屏两枚红 badge，负收益。delivery-gate 还依赖 secrets.SDD_DELIVERY_LAUNCH_AUTHORITY。建议：D4 硬前置 = 两 workflow master 转绿后才上。
3. **major** — 原第 9 节「开发（本仓库自身）」在新结构无落点（npm install/test、build-application + 「构建成功≠运行资格」告诫仅 check.sh 被吸收）。建议：加两句开发钩子或在 AC-3 登记落点 CLAUDE.md §3。
4. **major** — ≤10 行会挤掉「重启 Claude Code 会话」（hooks 不重启不生效，功能前置）与 state-init 陷阱指针；草图含两个非命令步骤。建议：明确计行规则（命令+注释约 12 行）或两 block；重启列为必须注释行。
5. **major** — D5 目标文档写错：FRAMEWORK.md（22 行）不含分层图——七层图逐字在 scaffold-architecture.md:30-42。D5-A 改述「README 分层图收敛为 scaffold-architecture.md 指针」，FRAMEWORK.md 保持框架结构/纯净线定位。
6. minor — tasks.md/HANDOFF 指针无落点（文档地图八项不含；convergence 也不链接它们）。并入发现 1。
7. minor — engineer 行与下方快速开始两条并行起步路径分叉。改「下方快速开始（本页锚点）→ 之后 RUNBOOK（受管交付）」。
8. minor — D1 裁 A 附三条件：同 change 新建 docs/reference.md、登记文档地图、README 保留退出码一行（本席倾向 A；裁 B 亦可接受）。
9. minor — D2 验证性正面结论：mcp-capabilities.yaml 完整承载四条状态说明全部信息，一句话+链接零损失。裁推荐案成立。
10. minor — 事实修正：仓库实际公开（非「内部」——D4 措辞改）；Node/Comet 静态 badge = 伪装成状态信号的不可验证声明 + shields 外部依赖 + 随升级静默过期——舍弃，保留前置行文本；公开且无 LICENSE 使 LICENSE 另议优先级上升。
11. minor — AC-3 附 at-risk 内容清单：tasks.md 指针、gate-bundle.mjs 指针、state-init 陷阱指针、adapter 扩展句、build 命令+告诫、--with-llmwiki 分支、SDD_SESSION_ID export、重启会话步骤。

## moderator 合并处置（12 major + 14 minor → 11 主题，全部落入提案 v2）

| # | 主题 | 来源 | 处置 |
|---|---|---|---|
| 1 | 前置/版本如实分列（去版本 badge） | 席1#1+席3#3+席2#10 | 前置行分列「工具链 ≥18 / 受管交付旅程 ≥22.16（24 最佳）见 RUNBOOK 开始前表」；舍弃 Node/Comet 静态 badge |
| 2 | 决策者入口重排（可读证据先行） | 席1#2+席2#1+席2#6 | 自证段如实覆盖范围（试点验证的是 RUNBOOK 流程非 convergence 目标架构）+ STATUS/acceptance-index 可读证据 + ledger 次级 + 归档迁移说明；convergence 降第二跳 + 设计态标注；tasks.md 指针入「当前实施状态」行 |
| 3 | 快速开始命令流实证修正 | 席3#1+席2#4 | 恢复 SDD_SESSION_ID + 两步安装 + mkdir/proposal 步 + 重启会话注释行 + state-init 陷阱指针；计行规则 = 命令+注释约 12 行（弃 ≤10 硬限）；AC-2 机械判据 = clone→首审批点可执行路径（实跑） |
| 4 | 宿主标注修正 | 席3#2 | 审批点在驱动器所在终端 stdin（approved/同意/y/yes） |
| 5 | CI badge 分步条件 | 席2#2 | 两 workflow master 转绿后才上 badge（badge URL 文件名形态已核实）；当前不上 |
| 6 | 同步纪律成文 | 席3#4 | README 头部维护规则注释（HTML 注释）+ tasks.md 登记；非目标「不改 AGENTS.md」保持 + 显式理由；三个快速开始面的分工声明（README=人类首屏 / FRAMEWORK=框架结构+纯净线 / RUNBOOK=cookbook） |
| 7 | D3 裁决 | 席3#5 | 判定语义表为正式内容（verdict=契约级事实）；transcript 仅真实脱敏取证后追加（锚可定位旅程）；不发空占位 |
| 8 | D1/D2/D5 裁决 | 席2#8/9/5+席1#6 | D1=A（新建 docs/reference.md 三条件）；D2=一句话+链接（零信息损失已核实）；D5=收敛为 scaffold-architecture.md 指针（分层图实际所在）+ 分工规则成文（README=按角色何时读 / FRAMEWORK=按目录+纯净线） |
| 9 | 五类读者 + Kt + 措辞 | 席1#3/4/5/8 | 文档地图补审计/证据回读行；六门图补 Kt 终点；compare 中性化 + 衔接句；tagline 定语统一「脚手架」+ 两名词锚定句 |
| 10 | engineer 路径消分叉 | 席2#7 | 「下方快速开始（本页锚点）→ 之后 RUNBOOK」 |
| 11 | AC 机械可测化 + 双轨自举 | 席3#6+席2#11 | AC-1 机械边界（首 ## 前深链 ≤1）；AC-5 链接检查脚本化；AC-6 声明 route=inspection；AC 逐条补 route 标注（仓库双轨自举）；AC-3 附 at-risk 清单（八项） |
