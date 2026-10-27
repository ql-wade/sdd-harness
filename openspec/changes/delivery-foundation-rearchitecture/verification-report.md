# P4_3 当前证据索引与分层交付报告（pre-VERIFY）

- 修订：`2026-10-26-comet-050-adoption-v1`；生成：P4_3 worker（2026-10-27）。
- 机器可读版：`verification-results.json`（schema 3）。一致性校验：`worker-reports/P4_3-comet-050/consistency-check-20261027.log`（exit 0）。
- **证明范围声明**：本报告只索引**构建级接纳证据**（34/39 计划节点在声明范围内的机制证据 + 独立复审）。它不是业务验收：`runtime_verified_scenarios=0`，130 项 required 检查（129 现域 + F10 另期）全部仍归 VERIFY 所有，本索引**未翻转任何检查状态**。
- 事实来源：`execution-state.json` node_status（34 节点证据指针）、`execution-ledger.jsonl`（662 事件，逐节点接纳事件齐全）、各 worker-reports 目录（根目录与 change 目录两处，见逐节点指针）。
- 上一修订（2026-10-26-command-first-v1，PLANNING_ONLY）的报告与 results 逐字保存在 `replans/2026-10-26-command-first/before/`。

## 总览

| 维度 | 数值 |
| --- | --- |
| 计划节点 | 39（identity 保留） |
| 已接纳（构建级） | **34**（与 execution-state `accepted_plan_nodes` 一致，脚本对账通过） |
| 待办 | P4_3（本节点）、P5_1、P5_3、VERIFY；P5_2 DEFERRED_NOT_EXERCISED（F10 另期，决策 A） |
| 场景/检查分母 | 104 场景 / 130 检查（129 现域 + 1 F10 NOT-EXERCISED）——全部归 VERIFY |
| 最新全仓信号 | npm test 1159/1159、`bash scripts/check.sh` exit 0（P4_8 接纳时点） |
| 缺口三档 | 可本地补验 8 项 / 需人工 6 项 / 需外部资源 6 项（见下） |

逐节点字段：状态 / 关键改动文件 / 核心 GREEN / 独立复审 / UNVERIFIED / 证据路径。证据路径相对仓库根；`*-comet-050`/`*-command-first` 无前缀者位于 `worker-reports/`（仓库根），带 `openspec/...` 前缀者位于 change 目录下。

---

## L0 文档门（4 节点）

### P0_1 架构收敛文档（ACCEPTED_CARRIED_COMET_050）
- 文件：`docs/architecture/comet-ai-devops-convergence.md`、ADR-0020、ADR-0021
- GREEN：plan_guard valid+handoff_ready；pinned openspec strict exit0；默认入口（bootstrap/hooks/package.json/check.sh/foundation）无六角色/端口/私有 RPC 前置；文档按 ADR-0021 修正（commit 252401a）
- 复审：文档门，独立评审链在 P0_4
- UNVERIFIED：runner compose.yaml 六角色仍在盘（I02 退休目标，保留未删）；九文件 pending diffs 核对后留置未接纳
- 证据：`execution-ledger.jsonl#P0_1_ACCEPTED_COMMAND_FIRST`、`replans/2026-10-26-command-first/`、`execution-state.json#node_status.P0_1`

### P0_2 规格/提案/设计（ACCEPTED_CARRIED_COMET_050）
- 文件：`proposal.md`、`design.md`、`specs/delivery-foundation/spec.md`
- GREEN：104 场景/130 检查身份保留；仅措辞修订 A19/U07/L09/N03；无场景强制 OS 容器/固定镜像/自建 RPC（全文仅 2 处否定性表述）；bindings==plan acceptance IDs
- UNVERIFIED：F10 正向 NOT-EXERCISED（用户决策 A，`f10-scope-amendment.json`）
- 证据：`execution-ledger.jsonl#P0_2_ACCEPTED_COMMAND_FIRST`、`spec-baseline.json`

### P0_3 用户入口文档（ACCEPTED_CARRIED_COMET_050）
- 文件：`README.md`、`AGENTS.md`、`docs/architecture/scaffold-architecture.md`、`docs/agent/skill-architecture.md`
- GREEN：陈旧扫描干净（无旧 sdd 阶段命令、无六角色部署暴露）；ADR-0021 与 ADR-0020 并列引用
- 证据：`execution-ledger.jsonl#P0_3_ACCEPTED_COMMAND_FIRST`

### P0_4 独立文档评审链（ACCEPTED_CARRIED_COMET_050）
- 文件：ADR-0021、`architecture-review/`
- GREEN：spec 链 r1 REQUEST_CHANGES→r2→final APPROVE；plan 链 r1 REQUEST_CHANGES→r2 APPROVE；r1 三项发现全部关闭
- 复审：APPROVE（`replans/2026-10-26-command-first/reviews/`）
- UNVERIFIED：范围=文档/计划交接；真实 A 门共识后由 P2_5 真实共识补齐；旧 15 张共识票未重绑、外部派发未消费
- 证据：`execution-ledger.jsonl#P0_4_ACCEPTED_COMMAND_FIRST`

## L1 工具链（2 节点）

### P1_1 官方 0.5.0 供应链重锁（ACCEPTED_COMET_050 @10-26 10:14）
- 文件：`toolchain-baseline.json`、`package-probes/`、`integrations/comet/upstream.lock.json`、`tools/comet/{source,prepare-source,build}.mjs` 及配套测试
- RED→GREEN：基线-锁漂移拒收（exit1）→ npm 0.5.0 registry 字节校验；源码包 aeb1a659（55731441B）gzip 校验（首次截断下载弃用）；构建指纹 29f2332b；套件 **20/20**（含 206s 集成契约复跑）；附件 I01 registry 采纳 RELOCKED 回填
- 复审：APPROVE，三项 follow-up 已在 r2/final 全部整改
- 证据：`worker-reports/P1_1-comet-050/`（5 文件）

### P1_4 供给重锁+官方编译器实探（ACCEPTED_COMET_050 @10-26 16:25）
- 文件：`mode-qualification.json`、`mode-probes/`、`test/delivery-cases/1_4.mjs`
- GREEN：patches=[0005] 重锁、重建指纹 de39629a；0005 源/dist 双验；**7/7 + 43/43 + 171/171 + 18/18**
- RED（真实）：官方编译器按声明拒跑（import escape）→ 迁移拒跑（无 executors）→ 诊断 stub 可编译；R1-R6 修复清单钉死；诚实无 application.json
- 复审：APPROVE；errata：RED 计数誊写（证据文件 13/11/2 为准）
- UNVERIFIED：B8——0.5.0 无 superpowers 排除开关（真实尝试留证；原生 workflow 免疫；B6 缓解已验）
- 证据：`worker-reports/P1_4-comet-050/`、`execution-ledger.jsonl#OPENSPEC_PIN_BUMPED_1_11_0_TO_1_15_0`

## L2 纯组件（4 节点）

### P2_1 契约/基线/测试契约（ACCEPTED_CARRIED_COMET_050）
- 文件：`contracts/delivery/`、`lib/delivery/{baseline,test-contract}.js`、`action-binding.schema.js`、`2_1.mjs`
- RED→GREEN：冻结计划锚点失效（计划改写移除旧 '2.1.a' 行格式）→ 锚点重钉到唯一现行步骤文本；**61/61**（评审员独立复跑）；修复范围仅两个锚点 hunk，digest oracle 未动
- 复审：APPROVE 无 P1/P2（`worker-reports/P2_1-command-first/independent-review-20261026.md`）
- 证据：`worker-reports/P2_1-command-first/`

### P2_2 证据准入+纯门（ACCEPTED_COMET_050 @10-26 09:57）
- 文件：`lib/delivery/{evidence,gate}.js`、`2_2.mjs`
- GREEN：**60/60/0** pinned 复跑；A05/A06/STALE*/A18/B03/同主体/受保护源 oracle 全部实质性；`gate.js` 纯 evaluate-only 确认；用户 tap-reporter 修复载荷性且被覆盖
- 复审：APPROVE（`worker-reports/P2_2-comet-050/independent-review-20261026.md`）
- 证据：`worker-reports/P2_2-comet-050/`

### P2_3 legacy CLI 兼容（ACCEPTED_COMET_050 @10-26 10:27）
- 文件：`bin/cli.js`、`lib/adapters/legacy-evidence.js`、`2_3.mjs`
- GREEN：零 diff 接纳；**31/31×2** pinned；退出码 0/1/2 + HISTORICAL_BOUNDARY 只读 + dispatches==0 逐行引用（20+ 处）；行覆盖 96.7%、全拒绝分支执行；活探针 help=0/badcmd=1/badpath=1/contradictory=2
- 复审：APPROVE
- UNVERIFIED：open_decision EVIDENCE_INPUT_MISSING_EXIT_CODE（措辞 1 vs 钉定 oracle 2，VERIFY 裁决，钉定值保留）
- 证据：`worker-reports/P2_3-comet-050/`

### P3_1 journey 验证器资格（ACCEPTED_COMET_050_CARRIED @10-26 09:14）
- 文件：`pilot-contract.md`、`tools/verify/delivery-journey.mjs`、`delivery-case-schema.json`、`3_1.mjs`、`comet-flow-acceptance.test.js`
- RED→GREEN：**46/47** 冻结基线漂移先于受保护源拒收 → 重冻结 record 3；**47/47**；控制器附件后升级 record 4（planBundle 0010b135，comet-050 replan）并复验 47/47
- 复审：APPROVE（4 项 P3 记录在案；`pilot-freeze-amendment-20261026.json`）
- UNVERIFIED：F01/F03/C07 冻结后 NOT-EXERCISED 证明未登记（正确中间态；VERIFY 分母登记）
- 证据：`worker-reports/P3_1-command-first/`、`execution-ledger.jsonl#CONTROLLER_ANNEX_STALE_REDS_CLOSED`

## L3 组合包（3 节点）

### P1_6 方法资产快照（ACCEPTED_COMET_050 @10-26 10:50）
- 文件：`.agents/skills/`、`method-profile-manifest.json`、`foundation/profiles/comet-managed.json`、`integrations/comet/application/{skills,manifest.json}`、绑定测试
- GREEN：11 技能/245 文件字节一致（diff -r×3 + 聚合摘要复算，零符号链接）；manifest content_sha256 机械绑定 upstream.lock 0.5.0/aeb1a659/patches[]；method-binding **9/9** + 1_6 **11/11** pinned 复跑；负例真实（missing/drift/retired-name 带行引）
- RED：clean-0.5.0 更新重装 superpowers（真实 8/4/4；报告数字勘误由评审员更正）
- 复审：APPROVE（2 项 minor：数字勘误；裁定经 ENFORCEMENT_PAIR_ROUTED 关闭）
- UNVERIFIED：profile ASSETS_PACKAGED 而非 QUALIFIED；runtime_accepted=false
- 证据：`worker-reports/P1_6-comet-050/`

### P1_2 分发+hooks 修复（ACCEPTED_COMET_050 @10-26 13:31）
- 文件：`foundation/`、`tools/foundation-export.mjs`、`tools/bootstrap.sh`、`tools/adapters/claude-code.sh`、`hooks.yaml`、分发/装配测试
- GREEN：kb-write-protection 覆盖规范落点 `.sdd/wiki/`——4 探针由评审员复现（canonical exit2/old exit2/non-wiki exit0/forcepush exit2）；编译产物 KB_PROTECT_PATHS + 完整 matcher（按 AGENTS 红线双侧验证）；组合资产入 exportDigest/封印基线 90ffe99f/release 视图；owned **76/76** 复跑、adapter-quoting **13/13**、全仓对 HEAD 零新增失败；7 份被删历史基线字节级复原；freeze-baseline 重封由附件事件关闭（19df85e0，foundation-distribution **61/61**）
- 复审：APPROVE（3 项非阻塞，其中 freeze 复跑待办已由附件关闭）
- UNVERIFIED：`hooks/pre-tool-gate.sh` 内建 fallback 默认值仍是旧子串（仅未编译宿主边缘）
- 证据：`worker-reports/P1_2-comet-050/`、`execution-ledger.jsonl#FOUNDATION_FREEZE_BASELINE_SEALED`

### P2_4 Comet 运行时组合（ACCEPTED_COMET_050_R3 @10-26 21:52）
- 文件：`integrations/comet/application/{composition.json,bindings.mjs,extensions/}`、`0005-comet-050-kt-closeout.patch`、`2_4.mjs`
- GREEN（R3）：B1 受管启动 initialState isolation=current（三方钉定，调用方状态拒收）；B2 epoch 限定 submissionId + 六门激活守卫（fail-closed）；B3 证据内容寻址稳定性；官方编译器双构建字节相等 **df916df6/ba88b84d**（评审员复跑）；3 次 /tmp 真实派发含 2 个诚实停跑负例；P1_5 探针重钉后 classic-integration **33/33**
- 历程：声明→被 P1_4 活探针拒→保守重开 R1-R6→修复→重编译→重接纳（账本两事件留痕）
- 复审：APPROVE（附件权限工件=账本 COMET_050_PLAN_ACTIVATED + wave-10 P1_4 派发记录）
- UNVERIFIED：raw-stdout 冻结留待将来（minor）
- 证据：`openspec/.../worker-reports/P2_4-comet-050/`、`openspec/.../worker-reports/P2_4-r3/`

## L4 宿主接线（4 节点）

### P1_3 适配器/MCP 注册接线（ACCEPTED_COMET_050 @10-26 15:13）
- 文件：`lib/adapters/{comet,harness,comet-executor}.js`、`host-probes/`、`mcp-capabilities.yaml`、`.mcp.json`、`tools/register-mcps.mjs`、绑定测试
- GREEN：comet.js 双名状态文件镜像上游（3 行为验证）；comet-executor 上 0.5.0 SDK 面；0002 端口退役；六门零回退（validator-only）；缺 application.json→零 CLI 调用；真实构建 CLI 探针含缺编译包拒派发；P1_2 修复后 mcp 注解重加；共存 13/13+53/53；**121/121 + 21/21 + 10/10** + 相邻 9/9、61/61、20/20（复跑）
- 复审：APPROVE（2 项 minor：provenance 注释于接纳时补；报告措辞）
- UNVERIFIED（声明并已路由关闭）：编译器实跑→P1_4/P2_4_R3；真实 Run 派发→P3_2；0005 写路径→P4_6
- 证据：`worker-reports/P1_3-comet-050/`

### P1_5 Classic 装配探针（ACCEPTED_COMET_050 @10-26 18:07）
- 文件：`test/classic-integration.test.js`、`classic-integration-probes/`、`1_5.mjs`
- GREEN：A/T AND 链 + P 唯一计划 + 批准锚（4 负变异体）+ 9 步映射 + 无 hook 场景真实 CLI 拒收（guard/state-write/transition/archive/forged/dispatch）全部落在**真实编译包**上；7 探针文件重注册 0.5.0；15 技能摘要字节匹配（程序化 0 失配）；**37/37 + 152/152**；全仓 1126/1126 绿
- 复审：APPROVE 零阻塞
- 证据：`worker-reports/P1_5-comet-050/`

### P3_2 首次真实 R→V（ACCEPTED_COMET_050 @10-26 20:16）
- 文件：`pilot-journey/`、`3_2.mjs`、`same-run-delivery.case.json`
- GREEN：真实 3-agent 共识（1 真 REJECT→修订→全票）；6 轮独立充分性评审（5 真 REJECT）；真实 TDD RED(4)→GREEN(11)；真评审 REJECT→修复；V 类型化读回含真实漂移拒收；Kp 正确双拒；4 份门收据束+漂移拒收原件+派发收据评审后冻结（活世界字节一致）；**13/13 + 25/25 + 21/21 + 10/10**；case.json schema 干净
- 复审：APPROVE（1 项 medium 证据冻结已整改；3 项措辞已修）
- UNVERIFIED：3 个真实上游阻断登记（isolation-null 死锁 / 跨 epoch submissionId / write-once×revise）；Run 诚实停于 verifyResult=pending，从未伪造完成；journey 验证器 NOT-EXERCISED（VERIFY 前登记分母）
- 证据：`openspec/.../worker-reports/P3_2-comet-050/`

### P3_3 恢复语义活体验证（ACCEPTED_COMET_050 @10-26 23:15）
- 文件：`pilot-recovery/`、`3_3.mjs`、`real-comet-recovery.case.json`
- GREEN：真实 CLI 五语义——SIGKILL 落在持久化窗口内续跑 exactly-once；幂等重放×4；1 字节漂移 WORKFLOW_CHANGED 双面；陈旧 token STALE_ACTION 零落地；第二写者 ACTION_ALREADY_CLAIMED；**11/11** + 相邻 3_2/3_4/3_1/2_4 绿；配方经真实 runner PASS；3_3+recipes 零 hash 钉定（主动反钉定断言）
- 复审：APPROVE
- UNVERIFIED：VERIFY-prep 登记项——run-recovery-chain 在钉定 node24 下 4 个旧链测试失败（同时影响 3_2 父跑）；journey 分母冻结；证据文件缺命令头（风格）
- 证据：`openspec/.../worker-reports/P3_3-comet-050/`

## L5 适配器/装配（3 节点）

### P2_5 架构评审适配器（ACCEPTED_COMET_050 @10-26 14:08）
- 文件：`lib/adapters/architecture-review.js`、`2_5.mjs`
- GREEN：buildGateReceiptBundle 纯格式层（+70 行尾部追加），判定语义源级零变更；全负例逐行引用；PAYLOAD_INPUT_REBOUND 真断言；**70/70×2 + 14/14 + 74/74**；陈旧 0.4.5 钉替换为 legacy-build 字节钉
- 复审：APPROVE（3 项 minor）
- 证据：`worker-reports/P2_5-comet-050/`

### P3_4 规格收尾适配器（ACCEPTED_COMET_050 @10-26 21:02）
- 文件：`lib/adapters/spec.js`、`3_4.mjs`
- GREEN：openspec 唯一归档写者（逐字上游 seam）；双名读回；AMBIGUOUS_ARCHIVE 调和；已归档零派发；Kp 转发不裁定——逐行引用并与 vendored 上游源对拍；九旧候选最后两项落定（0002 机制清除 grep 零残留）；**45/45 + 9/9**（含真实 SIGKILL 同 Run 无二次归档）+ 3_1 **25/25**
- 复审：APPROVE（4 项非阻塞观察）
- 证据：`worker-reports/P3_4-comet-050/`

### P4_5 可选 Ponytail hook 装配（ACCEPTED_COMET_050 @10-27 04:13）
- 文件：`hooks.yaml`、`hooks/`、`tools/adapters/claude-code.sh`、`delivery-hook-assembly.test.js`、`4_5.mjs`
- GREEN：设计上 Ponytail 不入 hooks.yaml（固定事件集 + plugin-source 门）；插件仅经宿主插件生命周期进入；plugin-source 门测试 +27 行（唯一代码改动，产物字节前后不变）；3 套件 **25/25** 复跑 + check.sh exit 0（**1157/1157**）；活配置指纹字节一致
- 复审：APPROVE（评审员以 tmpdir hooks.yaml 注入独立复现 plugin-source 拒收）
- UNVERIFIED：版本偏差 5.3.2 vs 5.2.0 诚实登记（仅 timeout 差异）
- 证据：`openspec/.../worker-reports/P4_5-comet-050/`

## L6 知识 / 平台基础设施 / 恢复（14 节点）

### 知识（6）

**I04 LLMWiki 供给登记**（@10-26 10:39）— `infra/delivery/llmwiki/*`、`tools/infra/llmwiki.mjs`；escape 全拒（含 policy-off 硬不变量）；worktree stdio 读回 CONSISTENT + 2 阴性对照 INCONSISTENT；**53/53** pinned；复审 APPROVE。UNVERIFIED 5 项诚实（宿主托管注册/canonical root/secrets/上游 clone 确认/活宿主索引一致性）。证据：`openspec/.../worker-reports/I04-comet-050/`

**I05 代码知识登记**（@11:13）— `infra/delivery/code-knowledge/*`；NOT_DEPLOYED 诚实登记（+125/-0）；4 个翻转门真实；**100/100**；复审 APPROVE。UNVERIFIED 8 项，qualify ready=false。证据：`openspec/.../worker-reports/I05-comet-050/`

**P4_4 实际 Kp→归档→Kt 闭环**（@10-27 04:09）— `lib/adapters/{llmwiki,outline,code-wiki}.js`、`lib/sdd-paths.js`、`knowledge-seed.js` 等；真实 LLMWiki stdio 活会话 + 四通道字节级摘要一致性评审员独立复验（MCP 读/磁盘 sha256/SQLite documents/chunks_fts MATCH）；kp_extension 活门裁决含负例（空收据 MISSING_OBSERVATION 拒收）；真实 comet 归档 openspec 1.15.0 exactly-once（评审员重读调用日志）；Kp 束归档后 sha256 稳定；**5/5 + 21/21**；复审 APPROVE（4 项 minor）。UNVERIFIED：**Kt Outline 401 authentication_required 逐字——UNVERIFIED-NEEDS-GRANT**。证据：`openspec/.../worker-reports/P4_4-comet-050/`

**P4_6 归档后同 Run Kt 恢复**（@03:09）— `0003-post-archive-closeout.patch`、`4_6.mjs`；四语义经 0005 五行真值表 + 真实 CLI 验证（post-archive Kt pending 发现/完成受阻、完成可组合、重复归档幂等 ARCHIVE_ALREADY_SEALED、unknown 保原始句柄）；**20/20 + 6/6**（评审员带真实 /tmp 场景子进程复跑）；0005 sha256 74e6c810 未变；复审 APPROVE（3 项 P3）。注：4_6.mjs 仍解析 openspec-1.11.0（下次触碰时等强迁移）。证据：`openspec/.../worker-reports/P4_6-comet-050/`

**P4_7 知识发布预授权**（@03:52）— `knowledge-authorization.js`、`authorization-journey/`、`knowledge-authz.mjs`、`infra/delivery/knowledge/`；四维面诚实登记（全 UNVERIFIED/STRUCTURAL_ONLY，零夸大）；SELF_AUTHORED / POLICY_MUTATION（全角色拒、零写、sha256 前后相等）/ SECRET_MATERIAL 红线；**13/13 + 15/15 + 13/13 + npm test 1155/1155 + check.sh exit 0**；复审 APPROVE。UNVERIFIED：Kp NOT_REQUIRED+BOUNDARY_REGISTERED；**Kt REQUIRED+NOT_PROVISIONED（5 条目各带阻断）**。证据：`openspec/.../worker-reports/P4_7-comet-050/`

**P4_8 撤权/隔离/告警/恢复**（@04:42）— `knowledge-revocation.js`、`revocation-journey/`；真实 stdio 删除活测（create→read→search1→delete→read not-found→search 无匹配→盘上消失）MEASURED；删除保护（* / ** / overview/log）活验证；恢复重建带行尾断言；G15 三段计时独立实测（LLMWiki 隔离 ~3ms，alert≠isolation 不变量）；**9/9 + 19/19 + npm test 1159/1159 + check.sh exit 0**；复审 REQUEST_CHANGES→APPROVED（修复后）。UNVERIFIED：**Outline 三次真实 401 逐字 UNVERIFIED-NEEDS-GRANT**。证据：`openspec/.../worker-reports/P4_8-comet-050/`

### 平台/基础设施（7）

**I01 registry 登记**（@10-26 10:02）— `infra/delivery/registry.json` 等；diff 范围与 worker 报告逐字节一致；**44/0 + 47/0** pinned 复跑；N1-N6 负例；采纳 PENDING_RELOCK→P1_1 后 RELOCKED 附件回填；复审 APPROVE。证据：`worker-reports/I01-comet-050/`

**I02 六角色退休**（@16:09）— `infra/delivery/runner/*`、`tools/infra/runner.mjs`；up/build-plan 资格前拒收（exit2，零 docker 调用）；9 入口 census oracle 零常驻角色引用；image.lock→退休记录；openspec 钉字节完好；7 份退休补丁删除、0005 未动；iso **75/75** 双节点 + registry **44/44**；全仓失败 39→10（iso 31→0）；docker 只读盘点：无六角色容器/卷，退休镜像按 ADR-0021 保留；复审 APPROVE（3 项文档/证据卫生）。UNVERIFIED：errata 报告数字 + 证据文件错标——归档前重生成。证据：`worker-reports/I02-comet-050/`

**I03 Outline 观察**（@12:15）— `infra/delivery/outline/*`；只读观察+登记（栈已运行，未改容器状态，owner keys 未动）；pins 5/5、仅回环、health 200/unauth 401/dex issuer 匹配；**44/44**；qualify exit2 诚实（10 类 UNVERIFIED）；复审 APPROVE（3 项表面性）。证据：`worker-reports/I03-comet-050/`

**I06 平台登记**（@10:55）— `infra/delivery/platform/*`；红线 CHECK_QUEUED/ARTIFACT_EXPIRED/REMOTE_ENFORCEMENT_CLAIM_FORBIDDEN + 6 notSuccessEvidence 逐行引用；**49/49×3** + consumers 20/17/6/6；复审 APPROVE（1 次瞬态红不可复现，VERIFY 时盯防）。UNVERIFIED：远端主张 UNVERIFIED(P4_1)/UNSELECTED(P4_2)。证据：`openspec/.../worker-reports/I06-comet-050/`

**I07 调度/告警登记**（@14:12）— `infra/delivery/monitor/*`；两个调度面诚实 UNREGISTERED（无 on.schedule/crontab 实证）；invocationContract 禁常驻控制器/调度器自有状态；8 个新 fail-closed 门带真实翻转测试；**22/22 + 61/61 + 7/7**；复审 APPROVE 零阻塞。UNVERIFIED：全部运维证据 UNVERIFIED（归 P4_8）。证据：`openspec/.../worker-reports/I07-comet-050/`

**P4_1 受保护 CI 硬门**（ACCEPTED_COMET_050_READBACK_ONLY @10-27 00:45）— `.github/workflows/delivery-gate.yml`、`tools/ci/verify-delivery.mjs`；UNPROTECTED_READ_BACK 三独立 gh-api 视图（protection 404 / rulesets [] / protected:false）评审员复现；**22/22 + 7/7 + 49/49 + 6/6**、全仓 1134/134；复审 APPROVE。UNVERIFIED：**平台缺口——delivery-gate workflow 不在平台（本地领先 717 commits，push 未授权），候选检查零平台证据，双向对比诚实不适用**；human_gated 三项（master 分支保护+required checks 注册 / push 授权 / repo secret SDD_DELIVERY_LAUNCH_AUTHORITY）；治理失误已记账（先 push 后平台验证；CI-parity 整改在途 `worker-reports/ci-parity-050/`）。证据：`openspec/.../worker-reports/P4_1-comet-050/`

**P4_2 同 digest 构建/发布/回滚**（@04:01）— `tools/ci/release.mjs`、`release-journey/`；本地全链（promote digest 锁+构建指纹对拍 / rollback 封印基线字节解析且仅限保留的前一批准 digest）；负例 TAG_DIGEST_DRIFT（零 tag 写）/ BUILD_DIGEST_DRIFT（零发布）/ READBACK_UNCONFIRMED（保留 correlationId，无二次发布）；真实仓库链 v1(60a75c53)→v2(HEAD)→未批准 BLOCKED→批准 VERIFIED→unknown UNCONFIRMED；真实漂移样例 0e0d8341 BLOCKED；**30/30 + 7/7 + 97/97**；复审 APPROVE（2 项 minor）。UNVERIFIED：git LOCAL_VERIFIED；npm/GitHub 发布 UNVERIFIED。证据：`worker-reports/P4_2-comet-050/`

### 恢复（1）

**I08 备份恢复演练**（@03:45）— `infra/delivery/recovery/*`、`infra/delivery/backup/`、`backup-restore.mjs`；真实工作区备份（6 文件/35647B，checkpoint hash 对照活宿主由评审员独立验证）→ /tmp 恢复 RELEASED → CLI 再解析同 Run 身份 → retention DENIED(R10) → 第二写者拒（真实进程 kill(0) 检查）；llmwiki 341 文件字节级一致恢复（diff -r + 聚合 sha256）；**18/18 + 13/13 + 4/4** + validate 0 违规 + 5 探针 VERIFIED；复审 APPROVE（2 项 P3 计数语义）。UNVERIFIED：2 项（outline docker 卷）+ 1 项诚实缺席（无本地 wiki DB）；open decisions BACKUP_V1_SHAPE_MAPPING + RETENTION_LIVE_SHAPE_INTAKE 待裁。证据：`openspec/.../worker-reports/I08-comet-050/`

---

## 缺口清单（当前 UNVERIFIED 且阻塞/影响 VERIFY）

### 第一档：可本地补验（8 项）

| # | 缺口 | 来源 | 归属 |
| --- | --- | --- | --- |
| G-T1-01 | run-recovery-chain 在钉定 node24 下 4 个旧链测试失败（同时影响 3_2 父跑）——须根因修复 | P3_3 登记 / 账本 verify_prep_registered | VERIFY-prep（原 owner 调和） |
| G-T1-02 | journey 分母登记：P3_1 F01/F03/C07 proof-registration-missing + P3_2/P3_3 配方 PASS 但验证器 NOT-EXERCISED | P3_1/P3_2/P3_3 | VERIFY |
| G-T1-03 | delivery-gate CI 最终绿需真实 R→V 六门收据链（`chain-gate.json` 绑 merge SHA，非忽略路径提交） | 账本 DELIVERY_GATE_CI_SEMANTICS_CLARIFIED | VERIFY |
| G-T1-04 | I02 errata 重生成：报告数字错误 + foundation-drift 归因证据文件错标 | I02 | I02（归档前） |
| G-T1-05 | `hooks/pre-tool-gate.sh` 内建 fallback 默认值仍旧子串（未编译宿主边缘） | P1_2 followup 路由 | hooks 文件 owner |
| G-T1-06 | 4_6.mjs 仍解析 openspec-1.11.0（两工具目录并存，下次触碰等强迁移） | P4_6 note | P4_6 |
| G-T1-07 | P3_3 证据文件缺字面命令头（风格） | P3_3 | P3_3 |
| G-T1-08 | CI-parity 整改在途（治理失误：push 先于平台验证）；正确次序=修 workflow→分支验证→平台绿→master push→开保护 | 账本 GOVERNANCE_MISS；`worker-reports/ci-parity-050/` | 控制器 + P4_1 人工门 |

### 第二档：需人工（决策/授权）（6 项）

| # | 缺口 | 来源 | 归属 |
| --- | --- | --- | --- |
| G-T2-01 | Outline 授权（Kt 发布路径三次真实 401；P4_7 五条目 NOT_PROVISIONED） | P4_4/P4_8/P4_7 | 用户（凭据授予，兼具外部性） |
| G-T2-02 | P4_1 人工门：master 分支保护+required checks 注册；push 授权（领先 717）；repo secret SDD_DELIVERY_LAUNCH_AUTHORITY | P4_1 human_gated | 用户 |
| G-T2-03 | 待裁决 open decisions：EVIDENCE_INPUT_MISSING_EXIT_CODE(P2_3)、DELIVERY_CASES_NODE_PIN(P1_5)、CONSUMER_CLOSEOUT_FORGED_RECORDS(P4_4 NB1)、LEDGER_CHANNELS_PERSISTENCE(P4_4 NB2)、BACKUP_V1_SHAPE_MAPPING+RETENTION_LIVE_SHAPE_INTAKE(I08)、I08_FILENAME_DEVIATION | execution-state.open_decisions | 用户/VERIFY |
| G-T2-04 | REMOTE_URL_DISCREPANCY（ql-wade vs rpamis，push/PR 目标）+ GH_AUTH_TOKEN TLS 拦截（x509 -26276） | open_decisions | 用户 |
| G-T2-05 | OV_OVERLAY_CANDIDATE overlay 重规划语料——单独裁决，本轮接纳外 | open_decisions | 用户 |
| G-T2-06 | P5_1 真实团队宿主能力/使用验证仍是待办计划节点（P4_3 不可代闭） | tasks.md P5_1 | 后继 worker + 真实团队 |

### 第三档：需外部资源（6 项）

| # | 缺口 | 来源 | 归属 |
| --- | --- | --- | --- |
| G-T3-01 | Outline API 凭据/授权（Kt 发布、docker 卷恢复面） | P4_4/P4_8/I08 | 外部服务授权 |
| G-T3-02 | 远端 CI 平台证据：workflow 不在平台、需 push 授权；gh CLI TLS 拦截阻断部分读回 | P4_1 / GH_AUTH_TOKEN | 外部平台 |
| G-T3-03 | I04 五项 UNVERIFIED：宿主托管注册、canonical root 未初始化、secrets 未解析、上游 clone 确认、活宿主索引一致性 | I04 | 外部宿主资源 |
| G-T3-04 | I05 八项未验（部署有意未执行，NOT_DEPLOYED 诚实） | I05 | 启用时外部 |
| G-T3-05 | I06/I07 远端运维证据 UNVERIFIED；P4_2 npm/GitHub 发布读回 UNVERIFIED | I06/I07/P4_2 | 外部平台 |
| G-T3-06 | F10 跨机器 Control API——决策 A NOT-EXERCISED；任何 API 启用前须单独正向认证 | f10-current-scope-decision.json | 另立变更 |

## VERIFY 就绪度评估

**判定：READY_WITH_GAPS（带缺口就绪）。**

- 索引完备性：34/34 已接纳节点全部具备 ≥1 条可解析证据指针与独立复审结论（脚本对账 exit 0，见 `worker-reports/P4_3-comet-050/consistency-check-20261027.log`）；分层划分（7 层）与节点集精确重合、无重叠。
- 全仓健康：最新接纳时点 npm test **1159/1159**、check.sh **exit 0**；仅存的第一档 G-T1-01（4 个旧链测试）已在账本登记为 VERIFY-prep 项，不属隐藏失败。
- 分母纪律：130 项 required 检查与 104 场景**全部留给 VERIFY**——本索引不翻转任何检查；`runtime_verified_scenarios=0` 如实。
- 阻塞路径：VERIFY 可即刻按层消费本索引；第一档 8 项可随 VERIFY-prep 就地补验；第二/三档 12 项只能由各自 holder 关闭，任何一项未闭都不能转 PASS——它们以 UNVERIFIED 原样移交给 VERIFY。
- 后继待办：P4_3（本节点）接纳、P5_1、P5_3，然后 VERIFY。

> 本报告由 P4_3 worker 生成供 VERIFY 系统消费；VERIFY 任务仍是 `verification-report.md`/`verification-results.json` 的最终 owner，须以真实同 Run 旅程重新推导终态验收，不得以本构建级索引替代。
