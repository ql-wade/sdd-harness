# Implementation Plan — Comet原生命令、技能与硬门禁收敛

**Goal:** 沿原39节点/30父任务/69工作包完成现有Agent宿主中的Comet命令→技能→制品→硬门→知识/平台闭环；本次仅修订计划，不启动实施。
**Architecture:** docs/architecture/comet-ai-devops-convergence.md 与 ADR-0021 为当前权威；design.md/architecture.md记录同一决定，旧六角色常驻前置退休。
**Tech Stack:** Comet 0.5.0组合应用基线（精确锁待P1_1重验）、隔离钉版OpenSpec 1.11.0、现有Claude/Codex宿主、Matt方法/test-authoring/Whitebox、既有MCP/CI；Docker仅必要依赖。

## Global Constraints

- Comet Classic is the sole business workflow owner; TeamAI distributes only
- Use native Comet commands and existing host skills/tools; no resident six-role services or replacement Agent RPC/control plane
- Matt methods and test-authoring/independent Whitebox remain separate; product planner P is plan-only
- Preserve all39 node IDs,30 parent IDs,69 workpackage IDs,104 scenario IDs and130 check IDs; F10 alone remains deferred
- One canonical tasks/DAG/state/ledger; no worker or hook owns a second lifecycle
- R/A/T independently gated; requirement/design changes invalidate all downstream and restored bytes never revive retired approvals
- Native host enforced read/tool/path scopes and real independent execution evidence are required; do not claim malicious same-OS-user isolation from local signatures
- Docker only for necessary knowledge infrastructure or justified temporary jobs; no mandatory Runner image rebuild before R-to-V
- Kp blocks archive; Kt blocks overall completed; preserve same Run/operation recovery and genuine source permissions/audience/grants
- R10 retains unresolved workspaces; G15 normal discovery3min plus isolation2min and separate failure/alert timing remain
- No production/ACL/publication/credential actions implied by this planning-only revision
- Planning validates structure only; no old fixture/container/image PASS qualifies the command-first delivery

原身份、依赖修订、旧文本和证据均保存于replans/2026-10-26-command-first与replans/2026-10-26-comet-050-adoption；本期129required/103场景，F10另期。以下时间盒仅是单次检查点，不是功能工期。

并行执行（本修订启用）：宿主并发子代理派发已实测；worker用独立worktree隔离；同波任务文件所有权无重叠（DAG强制）；串行仅P3_2/P4_2/P4_8/P5_1/VERIFY（活试点/目标环境/外部撤权/真实宿主/终验）。P0_1–P0_4、P2_1接纳原样保留；P3_1工作完成待提交；P1_1重开做0.5.0资格重验；P2_1的P1_1依赖边按版本无关契约移除（见amendment）。旧通过只保留原证明范围，不能替代新流程；实际owner按受领Agent指定。只有具体缺失能力或外部操作需要人处理，不为已经确认的方向重开泛化访谈。

## Schema2 执行任务投影

### Task P0_1: 架构与保留/退休/返工裁决

**Files:** docs/architecture/comet-ai-devops-convergence.md, docs/architecture/adr/0020-comet-command-knowledge-convergence.md, docs/architecture/adr/0021-comet-command-first-no-resident-role-services.md
**Interfaces:** Comet.Run.managedDelivery.v1: same RunState/lock/transaction, no second currentPhase; SDD.Gate.v1: pure evaluate(inputs,receipts,policy), no dispatch; Knowledge.Closeout.v1: Kp before archive, Kt before overall completion; Runner.Dispatch.v1: trusted launcher binds run/gate/input/policy/attempt/epoch, worker cannot write control state
**Dependencies:** none
**Owns:** docs/architecture/comet-ai-devops-convergence.md, docs/architecture/adr/0020-comet-command-knowledge-convergence.md, docs/architecture/adr/0021-comet-command-first-no-resident-role-services.md
**Parallel safe:** true
**Acceptance IDs:** A01, N01

原工作包身份：该节点原无子工作包；不新增身份。当前修订：2026-10-26-comet-050-adoption-v1；command-first接纳原样保留。

- [x] **Step 1 [5 min]: Record** 检查架构/默认入口/安装器仍要求六角色、端口或私有协议时提出冲突，不删除数据。
- [x] **Step 2 [5 min]: Implement** 按ADR-0021固定原命令、宿主执行、最小Docker和知识/权限边界；盘点旧部署与实际消费者；仅文档，不改运行配置/代码。
- [x] **Step 3 [5 min]: Review** 逐条核当前用户决定、所有场景映射与原始来源；独立审查不得复用旧摘要票。
- [x] **Step 4 [5 min]: Verify** 运行同一plan_guard、OpenSpec strict与交接一致性校验；计划绿色不签业务通过。
- [x] **Step 5 [5 min]: Commit** 只记录该任务文档/实际检查/未验项，保留原用户改动与旧冻结包。

### Task P0_2: 原规范与验收映射修订

**Files:** openspec/changes/delivery-foundation-rearchitecture/proposal.md, openspec/changes/delivery-foundation-rearchitecture/design.md, openspec/changes/delivery-foundation-rearchitecture/specs/delivery-foundation/spec.md
**Interfaces:** Comet.Run.managedDelivery.v1: same RunState/lock/transaction, no second currentPhase; SDD.Gate.v1: pure evaluate(inputs,receipts,policy), no dispatch; Knowledge.Closeout.v1: Kp before archive, Kt before overall completion; Runner.Dispatch.v1: trusted launcher binds run/gate/input/policy/attempt/epoch, worker cannot write control state
**Dependencies:** P0_1
**Owns:** openspec/changes/delivery-foundation-rearchitecture/proposal.md, openspec/changes/delivery-foundation-rearchitecture/design.md, openspec/changes/delivery-foundation-rearchitecture/specs/delivery-foundation/spec.md
**Parallel safe:** true
**Acceptance IDs:** A01

原工作包身份：该节点原无子工作包；不新增身份。当前修订：2026-10-26-comet-050-adoption-v1；command-first接纳原样保留。

- [x] **Step 1 [5 min]: Record** 找出旧场景/检查还强制OS容器、固定镜像或自建RPC的地方；不删功能性权限/恢复场景。
- [x] **Step 2 [5 min]: Implement** 保留104场景/130检查身份，修订受管身份和部署证明；保持F10处置与全部功能oracle；仅文档，不改运行配置/代码。
- [x] **Step 3 [5 min]: Review** 逐条核当前用户决定、所有场景映射与原始来源；独立审查不得复用旧摘要票。
- [x] **Step 4 [5 min]: Verify** 运行同一plan_guard、OpenSpec strict与交接一致性校验；计划绿色不签业务通过。
- [x] **Step 5 [5 min]: Commit** 只记录该任务文档/实际检查/未验项，保留原用户改动与旧冻结包。

### Task P0_3: 文档、安装说明和能力状态对齐

**Files:** README.md, AGENTS.md, docs/architecture/scaffold-architecture.md, docs/agent/skill-architecture.md
**Interfaces:** Comet.Run.managedDelivery.v1: same RunState/lock/transaction, no second currentPhase; SDD.Gate.v1: pure evaluate(inputs,receipts,policy), no dispatch; Knowledge.Closeout.v1: Kp before archive, Kt before overall completion; Runner.Dispatch.v1: trusted launcher binds run/gate/input/policy/attempt/epoch, worker cannot write control state
**Dependencies:** P0_2
**Owns:** README.md, AGENTS.md, docs/architecture/scaffold-architecture.md, docs/agent/skill-architecture.md
**Parallel safe:** true
**Acceptance IDs:** B10

原工作包身份：该节点原无子工作包；不新增身份。当前修订：2026-10-26-comet-050-adoption-v1；command-first接纳原样保留。

- [x] **Step 1 [5 min]: Record** 全新会话/默认安装不能重新发现旧sdd命令或六角色必需部署；保留用户原有条目。
- [x] **Step 2 [5 min]: Implement** 更新README/AGENTS/技能矩阵等当前入口，只暴露原生Comet阶段；区分计划态和运行态；仅文档，不改运行配置/代码。
- [x] **Step 3 [5 min]: Review** 逐条核当前用户决定、所有场景映射与原始来源；独立审查不得复用旧摘要票。
- [x] **Step 4 [5 min]: Verify** 运行同一plan_guard、OpenSpec strict与交接一致性校验；计划绿色不签业务通过。
- [x] **Step 5 [5 min]: Commit** 只记录该任务文档/实际检查/未验项，保留原用户改动与旧冻结包。

### Task P0_4: 收敛架构独立技术审查

**Files:** docs/architecture/adr/0021-comet-command-first-no-resident-role-services.md, openspec/changes/delivery-foundation-rearchitecture/architecture-review
**Interfaces:** Comet.Run.managedDelivery.v1: same RunState/lock/transaction, no second currentPhase; SDD.Gate.v1: pure evaluate(inputs,receipts,policy), no dispatch; Knowledge.Closeout.v1: Kp before archive, Kt before overall completion; Runner.Dispatch.v1: trusted launcher binds run/gate/input/policy/attempt/epoch, worker cannot write control state
**Dependencies:** P0_3
**Owns:** docs/architecture/adr/0021-comet-command-first-no-resident-role-services.md, openspec/changes/delivery-foundation-rearchitecture/architecture-review
**Parallel safe:** true
**Acceptance IDs:** E03, E04

原工作包身份：0.4.a, 0.4.b。当前修订：2026-10-26-comet-050-adoption-v1；command-first接纳原样保留。

- [x] **Step 1 [5 min]: Record** 旧15份共识票不能改绑到本修订；有必要外发时取得新包/目的地授权，缺票不伪造。
- [x] **Step 2 [5 min]: Implement** 按新摘要独立审查计划和关键边界，保留原A门要求与用户已确认取舍；仅文档，不改运行配置/代码。
- [x] **Step 3 [5 min]: Review** 逐条核当前用户决定、所有场景映射与原始来源；独立审查不得复用旧摘要票。
- [x] **Step 4 [5 min]: Verify** 运行同一plan_guard、OpenSpec strict与交接一致性校验；计划绿色不签业务通过。
- [x] **Step 5 [5 min]: Commit** 只记录该任务文档/实际检查/未验项，保留原用户改动与旧冻结包。

### Task P1_1: 原生Comet与工具/方法版本基线

**Files:** openspec/changes/delivery-foundation-rearchitecture/toolchain-baseline.json, openspec/changes/delivery-foundation-rearchitecture/package-probes, integrations/comet/upstream.lock.json, test/delivery-cases/1_1.mjs, tools/comet/source.js, tools/comet/prepare-source.mjs, tools/comet/build.mjs, test/comet-source-preparation.test.js, test/comet-build.test.js
**Interfaces:** Comet.Run.managedDelivery.v1: same RunState/lock/transaction, no second currentPhase; SDD.Gate.v1: pure evaluate(inputs,receipts,policy), no dispatch; Knowledge.Closeout.v1: Kp before archive, Kt before overall completion; Runner.Dispatch.v1: trusted launcher binds run/gate/input/policy/attempt/epoch, worker cannot write control state; Comet.SourcePreparation.v1: prepareCometSource({projectRoot,lock,archivePath}) returns canonical pristine source and verified provenance; Comet.DistributionBuild.v1: buildCometDistribution({projectRoot,lock,archivePath}) returns buildRoot, entrypoint, sourceCommit, fingerprint with exact toolchain precondition
**Dependencies:** P0_4
**Owns:** openspec/changes/delivery-foundation-rearchitecture/toolchain-baseline.json, openspec/changes/delivery-foundation-rearchitecture/package-probes, integrations/comet/upstream.lock.json, test/delivery-cases/1_1.mjs, tools/comet/source.js, tools/comet/prepare-source.mjs, tools/comet/build.mjs, test/comet-source-preparation.test.js, test/comet-build.test.js
**Parallel safe:** true
**Acceptance IDs:** F01, F03

原工作包身份：1.1.a, 1.1.b, 1.1.c。当前修订：2026-10-26-comet-050-adoption-v1；重开0.5.0资格重验（0.4.5事实保全为历史证据）。

- [x] **Step 1 [5 min]: Test** 版本或方法内容漂移必须拒绝；不以完整私有SDK重建作为命令入口前置；先观察真实RED，记录当前Run/版本/原始输出，不以缺环境当行为RED。
- [x] **Step 2 [5 min]: Implement** 复用已验证0.4.5源码/发行/安全补丁事实，只认证本次实际调用的命令与方法版本；复用现有模块和原生接口，最小GREEN。
- [x] **Step 3 [5 min]: Verify** 保持原功能oracle，覆盖正向/拒绝/重复/失效/中断；执行现有公开seam的相关回归与实际读回，缺环境明确UNVERIFIED。
- [x] **Step 4 [5 min]: Review** 独立Spec/质量审查；测试作者不签Whitebox；声明fixture/真实宿主/资源各自证明范围。
- [x] **Step 5 [5 min]: Verify** 按execution-contract中本任务checks执行，记录新修订及当前候选；全量跨边界旅程归VERIFY，不以局部绿关闭父义务。
- [x] **Step 6 [5 min]: Commit** 只交所属文件、原始RED/GREEN、版本与未验证项，移交唯一控制器集成；不得写业务phase或另起DAG。

### Task P2_1: 当前基线与AC到测试的纯数据契约

**Files:** contracts/delivery, lib/delivery/baseline.js, lib/delivery/test-contract.js, test/delivery-baseline.test.js, test/delivery-test-contract.test.js, test/delivery-cases/2_1.mjs, contracts/delivery/action-binding.schema.js, package.json, package-lock.json
**Interfaces:** Comet.Run.managedDelivery.v1: same RunState/lock/transaction, no second currentPhase; SDD.Gate.v1: pure evaluate(inputs,receipts,policy), no dispatch; Knowledge.Closeout.v1: Kp before archive, Kt before overall completion; Runner.Dispatch.v1: trusted launcher binds run/gate/input/policy/attempt/epoch, worker cannot write control state
**Dependencies:** none
**Owns:** contracts/delivery, lib/delivery/baseline.js, lib/delivery/test-contract.js, test/delivery-baseline.test.js, test/delivery-test-contract.test.js, test/delivery-cases/2_1.mjs, contracts/delivery/action-binding.schema.js, package.json, package-lock.json
**Parallel safe:** true
**Acceptance IDs:** A01, A02, A03, A04, A07, A08

原工作包身份：2.1.a, 2.1.b, 2.1.c。当前修订：2026-10-26-comet-050-adoption-v1；command-first接纳原样保留。

- [x] **Step 1 [5 min]: Test** 零执行/全skip/环境故障冒充RED、缺文件类别或旧候选摘要都拒绝；先观察真实RED，记录当前Run/版本/原始输出，不以缺环境当行为RED。
- [x] **Step 2 [5 min]: Implement** 复用基线/测试分母/版本契约，补宿主执行证据字段的最小需要；不建新控制层；复用现有模块和原生接口，最小GREEN。
- [x] **Step 3 [5 min]: Verify** 保持原功能oracle，覆盖正向/拒绝/重复/失效/中断；执行现有公开seam的相关回归与实际读回，缺环境明确UNVERIFIED。
- [x] **Step 4 [5 min]: Review** 独立Spec/质量审查；测试作者不签Whitebox；声明fixture/真实宿主/资源各自证明范围。
- [x] **Step 5 [5 min]: Verify** 按execution-contract中本任务checks执行，记录新修订及当前候选；全量跨边界旅程归VERIFY，不以局部绿关闭父义务。
- [x] **Step 6 [5 min]: Commit** 只交所属文件、原始RED/GREEN、版本与未验证项，移交唯一控制器集成；不得写业务phase或另起DAG。

### Task P3_1: 试点与验收器资格化

**Files:** openspec/changes/delivery-foundation-rearchitecture/pilot-contract.md, tools/verify/delivery-journey.mjs, tools/verify/delivery-case-schema.json, test/delivery-cases/3_1.mjs, test/comet-flow-acceptance.test.js
**Interfaces:** Comet.Run.managedDelivery.v1: same RunState/lock/transaction, no second currentPhase; SDD.Gate.v1: pure evaluate(inputs,receipts,policy), no dispatch; Knowledge.Closeout.v1: Kp before archive, Kt before overall completion; Runner.Dispatch.v1: trusted launcher binds run/gate/input/policy/attempt/epoch, worker cannot write control state
**Dependencies:** P0_4, P2_1
**Owns:** openspec/changes/delivery-foundation-rearchitecture/pilot-contract.md, tools/verify/delivery-journey.mjs, tools/verify/delivery-case-schema.json, test/delivery-cases/3_1.mjs, test/comet-flow-acceptance.test.js
**Parallel safe:** true
**Acceptance IDs:** A01, A15, N05

原工作包身份：3.1.a, 3.1.b。当前修订：2026-10-26-comet-050-adoption-v1；工作完成+独立复审APPROVE，提交按用户指示暂持。

- [x] **Step 1 [5 min]: Test** target不存在/无实际执行/弱oracle/缺真实UI或资源均不能PASS；先观察真实RED，记录当前Run/版本/原始输出，不以缺环境当行为RED。
- [x] **Step 2 [5 min]: Implement** 登记一个已有试点/owner/目标及AC/TestPack，先证明验收器会拒绝假绿；复用现有模块和原生接口，最小GREEN。
- [x] **Step 3 [5 min]: Verify** 保持原功能oracle，覆盖正向/拒绝/重复/失效/中断；执行现有公开seam的相关回归与实际读回，缺环境明确UNVERIFIED。
- [x] **Step 4 [5 min]: Review** 独立Spec/质量审查；测试作者不签Whitebox；声明fixture/真实宿主/资源各自证明范围。
- [x] **Step 5 [5 min]: Verify** 按execution-contract中本任务checks执行，记录新修订及当前候选；全量跨边界旅程归VERIFY，不以局部绿关闭父义务。
- [x] **Step 6 [5 min]: Commit** 只交所属文件、原始RED/GREEN、版本与未验证项，移交唯一控制器集成；不得写业务phase或另起DAG。

### Task P1_6: Matt方法与阶段调用绑定

**Files:** .agents/skills, docs/agent/skill-architecture.md, openspec/changes/delivery-foundation-rearchitecture/method-profile-manifest.json, test/delivery-cases/1_6.mjs, foundation/profiles/comet-managed.json, test/comet-method-binding.test.js, scripts/check.sh, integrations/comet/application/skills, integrations/comet/application/manifest.json
**Interfaces:** Comet.Run.managedDelivery.v1: same RunState/lock/transaction, no second currentPhase; SDD.Gate.v1: pure evaluate(inputs,receipts,policy), no dispatch; Knowledge.Closeout.v1: Kp before archive, Kt before overall completion; Runner.Dispatch.v1: trusted launcher binds run/gate/input/policy/attempt/epoch, worker cannot write control state
**Dependencies:** P1_1
**Owns:** .agents/skills, docs/agent/skill-architecture.md, openspec/changes/delivery-foundation-rearchitecture/method-profile-manifest.json, test/delivery-cases/1_6.mjs, foundation/profiles/comet-managed.json, test/comet-method-binding.test.js, scripts/check.sh, integrations/comet/application/skills, integrations/comet/application/manifest.json
**Parallel safe:** true
**Acceptance IDs:** M01, M02, B01, B09, N01, N02, N04

原工作包身份：1.6.a, 1.6.b, 1.6.c。当前修订：2026-10-26-comet-050-adoption-v1；未执行。

- [x] **Step 1 [5 min]: Test** 停用的Superpowers/Trinity和嵌套planner不得再生；读取技能名不等于正确执行；先观察真实RED，记录当前Run/版本/原始输出，不以缺环境当行为RED。
- [x] **Step 2 [5 min]: Implement** 原样版本化grill/consensus/test-authoring/tdd/review/Whitebox，原Comet调用真实方法；复用现有模块和原生接口，最小GREEN。
- [x] **Step 3 [5 min]: Verify** 保持原功能oracle，覆盖正向/拒绝/重复/失效/中断；执行现有公开seam的相关回归与实际读回，缺环境明确UNVERIFIED。
- [x] **Step 4 [5 min]: Review** 独立Spec/质量审查；测试作者不签Whitebox；声明fixture/真实宿主/资源各自证明范围。
- [x] **Step 5 [5 min]: Verify** 按execution-contract中本任务checks执行，记录新修订及当前候选；全量跨边界旅程归VERIFY，不以局部绿关闭父义务。
- [x] **Step 6 [5 min]: Commit** 只交所属文件、原始RED/GREEN、版本与未验证项，移交唯一控制器集成；不得写业务phase或另起DAG。

### Task P1_2: 原生命令分发与旧入口防再生

**Files:** foundation, tools/foundation-export.mjs, tools/bootstrap.sh, tools/adapters/claude-code.sh, test/foundation-distribution.test.js, hooks.yaml, test/delivery-cases/1_2.mjs, test/legacy-workflow-routing.test.js
**Interfaces:** Comet.Run.managedDelivery.v1: same RunState/lock/transaction, no second currentPhase; SDD.Gate.v1: pure evaluate(inputs,receipts,policy), no dispatch; Knowledge.Closeout.v1: Kp before archive, Kt before overall completion; Runner.Dispatch.v1: trusted launcher binds run/gate/input/policy/attempt/epoch, worker cannot write control state
**Dependencies:** P1_6
**Owns:** foundation, tools/foundation-export.mjs, tools/bootstrap.sh, tools/adapters/claude-code.sh, test/foundation-distribution.test.js, hooks.yaml, test/delivery-cases/1_2.mjs, test/legacy-workflow-routing.test.js
**Parallel safe:** true
**Acceptance IDs:** F02, F04, B09, N01, N02, N11

原工作包身份：1.2.a, 1.2.b, 1.2.c。当前修订：2026-10-26-comet-050-adoption-v1；未执行。

- [x] **Step 1 [5 min]: Test** 原sdd命令/迁移副本及六角色自动启动入口不得重新注册；只有安装文件不算技能实际运行；先观察真实RED，记录当前Run/版本/原始输出，不以缺环境当行为RED。
- [x] **Step 2 [5 min]: Implement** 沿现有Foundation/TeamAI只分发；冷安装/升级/卸载保留用户配置并退出旧命令/部署模板；复用现有模块和原生接口，最小GREEN。
- [x] **Step 3 [5 min]: Verify** 保持原功能oracle，覆盖正向/拒绝/重复/失效/中断；执行现有公开seam的相关回归与实际读回，缺环境明确UNVERIFIED。
- [x] **Step 4 [5 min]: Review** 独立Spec/质量审查；测试作者不签Whitebox；声明fixture/真实宿主/资源各自证明范围。
- [x] **Step 5 [5 min]: Verify** 按execution-contract中本任务checks执行，记录新修订及当前候选；全量跨边界旅程归VERIFY，不以局部绿关闭父义务。
- [x] **Step 6 [5 min]: Commit** 只交所属文件、原始RED/GREEN、版本与未验证项，移交唯一控制器集成；不得写业务phase或另起DAG。

### Task P2_2: 真实宿主/平台来源与独立证据准入

**Files:** lib/delivery/evidence.js, lib/delivery/gate.js, test/delivery-evidence.test.js, test/delivery-gate.test.js, test/delivery-cases/2_2.mjs
**Interfaces:** Comet.Run.managedDelivery.v1: same RunState/lock/transaction, no second currentPhase; SDD.Gate.v1: pure evaluate(inputs,receipts,policy), no dispatch; Knowledge.Closeout.v1: Kp before archive, Kt before overall completion; Runner.Dispatch.v1: trusted launcher binds run/gate/input/policy/attempt/epoch, worker cannot write control state
**Dependencies:** P2_1
**Owns:** lib/delivery/evidence.js, lib/delivery/gate.js, test/delivery-evidence.test.js, test/delivery-gate.test.js, test/delivery-cases/2_2.mjs
**Parallel safe:** true
**Acceptance IDs:** A05, A06, A18, A19, B03, B06, B07

原工作包身份：2.2.a, 2.2.b, 2.2.c。当前修订：2026-10-26-comet-050-adoption-v1；未执行。

- [x] **Step 1 [5 min]: Test** 同一执行者换role、自写pass、旧摘要/旧attempt/不明来源拒绝；不要求自建签发/通信服务；先观察真实RED，记录当前Run/版本/原始输出，不以缺环境当行为RED。
- [x] **Step 2 [5 min]: Implement** 从现有宿主真实执行记录、测试进程/CI和资源读回绑定原Run与制品；Gate保持纯函数；复用现有模块和原生接口，最小GREEN。
- [x] **Step 3 [5 min]: Verify** 保持原功能oracle，覆盖正向/拒绝/重复/失效/中断；执行现有公开seam的相关回归与实际读回，缺环境明确UNVERIFIED。
- [x] **Step 4 [5 min]: Review** 独立Spec/质量审查；测试作者不签Whitebox；声明fixture/真实宿主/资源各自证明范围。
- [x] **Step 5 [5 min]: Verify** 按execution-contract中本任务checks执行，记录新修订及当前候选；全量跨边界旅程归VERIFY，不以局部绿关闭父义务。
- [x] **Step 6 [5 min]: Commit** 只交所属文件、原始RED/GREEN、版本与未验证项，移交唯一控制器集成；不得写业务phase或另起DAG。

### Task P2_3: 薄CLI与历史报告边界

**Files:** bin/cli.js, lib/adapters/legacy-evidence.js, test/delivery-cli.test.js, test/delivery-cases/2_3.mjs
**Interfaces:** Comet.Run.managedDelivery.v1: same RunState/lock/transaction, no second currentPhase; SDD.Gate.v1: pure evaluate(inputs,receipts,policy), no dispatch; Knowledge.Closeout.v1: Kp before archive, Kt before overall completion; Runner.Dispatch.v1: trusted launcher binds run/gate/input/policy/attempt/epoch, worker cannot write control state
**Dependencies:** P2_2
**Owns:** bin/cli.js, lib/adapters/legacy-evidence.js, test/delivery-cli.test.js, test/delivery-cases/2_3.mjs
**Parallel safe:** true
**Acceptance IDs:** A20, B10

原工作包身份：2.3.a, 2.3.b。当前修订：2026-10-26-comet-050-adoption-v1；未执行。

- [x] **Step 1 [5 min]: Test** 输入错1/验证失败2/通过0按仓库契约；原生上游保持自身语义，历史报告不签新流程；先观察真实RED，记录当前Run/版本/原始输出，不以缺环境当行为RED。
- [x] **Step 2 [5 min]: Implement** 保留必要机器检查退出码和只读旧报告，不恢复旧业务阶段命令；复用现有模块和原生接口，最小GREEN。
- [x] **Step 3 [5 min]: Verify** 保持原功能oracle，覆盖正向/拒绝/重复/失效/中断；执行现有公开seam的相关回归与实际读回，缺环境明确UNVERIFIED。
- [x] **Step 4 [5 min]: Review** 独立Spec/质量审查；测试作者不签Whitebox；声明fixture/真实宿主/资源各自证明范围。
- [x] **Step 5 [5 min]: Verify** 按execution-contract中本任务checks执行，记录新修订及当前候选；全量跨边界旅程归VERIFY，不以局部绿关闭父义务。
- [x] **Step 6 [5 min]: Commit** 只交所属文件、原始RED/GREEN、版本与未验证项，移交唯一控制器集成；不得写业务phase或另起DAG。

### Task P2_4: 原Comet共同硬门与保守失效

**Files:** integrations/comet/application/composition.json, integrations/comet/application/bindings.mjs, integrations/comet/application/extensions, integrations/comet/patches/0005-comet-050-kt-closeout.patch, test/delivery-cases/2_4.mjs
**Interfaces:** Comet.Run.managedDelivery.v1: same RunState/lock/transaction, no second currentPhase; SDD.Gate.v1: pure evaluate(inputs,receipts,policy), no dispatch; Knowledge.Closeout.v1: Kp before archive, Kt before overall completion; Runner.Dispatch.v1: trusted launcher binds run/gate/input/policy/attempt/epoch, worker cannot write control state
**Dependencies:** P1_1, P2_3, P3_1, P1_6
**Owns:** integrations/comet/application/composition.json, integrations/comet/application/bindings.mjs, integrations/comet/application/extensions, integrations/comet/patches/0005-comet-050-kt-closeout.patch, test/delivery-cases/2_4.mjs
**Parallel safe:** true
**Acceptance IDs:** D01, D02, D03, D04, D05, D06, D07, D08, C07, N03, N04, N06

原工作包身份：2.4.a, 2.4.b, 2.4.c, 2.4.d。当前修订：2026-10-26-comet-050-adoption-v1；未执行。

- [x] **Step 1 [5 min]: Test** 缺R直接Design、跳transition/archive、手改回执、旧字节复活和控制写绕行均拒绝；先观察真实RED，记录当前Run/版本/原始输出，不以缺环境当行为RED。
- [x] **Step 2 [5 min]: Implement** 在原Run/Guard/continuation上最小接R/A/T/P/V/Kp/Kt，不添加phase/队列/author账本；复用现有模块和原生接口，最小GREEN。
- [x] **Step 3 [5 min]: Verify** 保持原功能oracle，覆盖正向/拒绝/重复/失效/中断；执行现有公开seam的相关回归与实际读回，缺环境明确UNVERIFIED。
- [x] **Step 4 [5 min]: Review** 独立Spec/质量审查；测试作者不签Whitebox；声明fixture/真实宿主/资源各自证明范围。
- [x] **Step 5 [5 min]: Verify** 按execution-contract中本任务checks执行，记录新修订及当前候选；全量跨边界旅程归VERIFY，不以局部绿关闭父义务。
- [x] **Step 6 [5 min]: Commit** 只交所属文件、原始RED/GREEN、版本与未验证项，移交唯一控制器集成；不得写业务phase或另起DAG。

### Task P2_5: 架构A的grill与独立共识

**Files:** lib/adapters/architecture-review.js, test/architecture-review-adapter.test.js, test/delivery-cases/2_5.mjs
**Interfaces:** Comet.Run.managedDelivery.v1: same RunState/lock/transaction, no second currentPhase; SDD.Gate.v1: pure evaluate(inputs,receipts,policy), no dispatch; Knowledge.Closeout.v1: Kp before archive, Kt before overall completion; Runner.Dispatch.v1: trusted launcher binds run/gate/input/policy/attempt/epoch, worker cannot write control state
**Dependencies:** P2_4
**Owns:** lib/adapters/architecture-review.js, test/architecture-review-adapter.test.js, test/delivery-cases/2_5.mjs
**Parallel safe:** true
**Acceptance IDs:** E03, E04, H06, N04, N06

原工作包身份：2.5.a, 2.5.b。当前修订：2026-10-26-comet-050-adoption-v1；未执行。

- [x] **Step 1 [5 min]: Test** 作者自审、少票/旧票/改绑摘要拒绝；T维持独立充分性审查不强加相同quorum；先观察真实RED，记录当前Run/版本/原始输出，不以缺环境当行为RED。
- [x] **Step 2 [5 min]: Implement** 现有宿主/技能执行grill及真实独立consensus，原manifest/原票/tally绑定同摘要；复用现有模块和原生接口，最小GREEN。
- [x] **Step 3 [5 min]: Verify** 保持原功能oracle，覆盖正向/拒绝/重复/失效/中断；执行现有公开seam的相关回归与实际读回，缺环境明确UNVERIFIED。
- [x] **Step 4 [5 min]: Review** 独立Spec/质量审查；测试作者不签Whitebox；声明fixture/真实宿主/资源各自证明范围。
- [x] **Step 5 [5 min]: Verify** 按execution-contract中本任务checks执行，记录新修订及当前候选；全量跨边界旅程归VERIFY，不以局部绿关闭父义务。
- [x] **Step 6 [5 min]: Commit** 只交所属文件、原始RED/GREEN、版本与未验证项，移交唯一控制器集成；不得写业务phase或另起DAG。

### Task P1_3: 原生宿主命令、技能与实际执行接线

**Files:** lib/adapters/comet.js, lib/adapters/harness.js, test/comet-driver.test.js, openspec/changes/delivery-foundation-rearchitecture/host-probes, test/delivery-cases/1_3.mjs, lib/adapters/comet-executor.js, test/comet-execution-binding.test.js, mcp-capabilities.yaml, .mcp.json, tools/register-mcps.mjs
**Interfaces:** Comet.Run.managedDelivery.v1: same RunState/lock/transaction, no second currentPhase; SDD.Gate.v1: pure evaluate(inputs,receipts,policy), no dispatch; Knowledge.Closeout.v1: Kp before archive, Kt before overall completion; Runner.Dispatch.v1: trusted launcher binds run/gate/input/policy/attempt/epoch, worker cannot write control state
**Dependencies:** P1_2, P2_4, P3_1
**Owns:** lib/adapters/comet.js, lib/adapters/harness.js, test/comet-driver.test.js, openspec/changes/delivery-foundation-rearchitecture/host-probes, test/delivery-cases/1_3.mjs, lib/adapters/comet-executor.js, test/comet-execution-binding.test.js, mcp-capabilities.yaml, .mcp.json, tools/register-mcps.mjs
**Parallel safe:** true
**Acceptance IDs:** F05, F07, A09, N01, N03

原工作包身份：1.3.a, 1.3.b, 1.3.c。当前修订：2026-10-26-comet-050-adoption-v1；未执行。

- [x] **Step 1 [5 min]: Test** 命令可见但不执行、只检查gate_dispatches无作者动作、角色混用、只读权限绕行拒绝；不建app-server RPC或六服务；先观察真实RED，记录当前Run/版本/原始输出，不以缺环境当行为RED。
- [x] **Step 2 [5 min]: Implement** 用现有Claude/Codex宿主实际调用原阶段、方法、独立Agent与工具；显示当前子步骤/阻塞/下一步；复用现有模块和原生接口，最小GREEN。
- [x] **Step 3 [5 min]: Verify** 保持原功能oracle，覆盖正向/拒绝/重复/失效/中断；执行现有公开seam的相关回归与实际读回，缺环境明确UNVERIFIED。
- [x] **Step 4 [5 min]: Review** 独立Spec/质量审查；测试作者不签Whitebox；声明fixture/真实宿主/资源各自证明范围。
- [x] **Step 5 [5 min]: Verify** 按execution-contract中本任务checks执行，记录新修订及当前候选；全量跨边界旅程归VERIFY，不以局部绿关闭父义务。
- [x] **Step 6 [5 min]: Commit** 只交所属文件、原始RED/GREEN、版本与未验证项，移交唯一控制器集成；不得写业务phase或另起DAG。

### Task P1_4: 原生Classic模式与入口绕行证明

**Files:** openspec/changes/delivery-foundation-rearchitecture/mode-qualification.json, openspec/changes/delivery-foundation-rearchitecture/mode-probes, test/delivery-cases/1_4.mjs
**Interfaces:** Comet.Run.managedDelivery.v1: same RunState/lock/transaction, no second currentPhase; SDD.Gate.v1: pure evaluate(inputs,receipts,policy), no dispatch; Knowledge.Closeout.v1: Kp before archive, Kt before overall completion; Runner.Dispatch.v1: trusted launcher binds run/gate/input/policy/attempt/epoch, worker cannot write control state
**Dependencies:** P1_3
**Owns:** openspec/changes/delivery-foundation-rearchitecture/mode-qualification.json, openspec/changes/delivery-foundation-rearchitecture/mode-probes, test/delivery-cases/1_4.mjs
**Parallel safe:** true
**Acceptance IDs:** C07, F06, M01

原工作包身份：1.4.a, 1.4.b, 1.4.c。当前修订：2026-10-26-comet-050-adoption-v1；未执行。

- [x] **Step 1 [5 min]: Test** 成功的无关命令、手写通过、缺检查、force/skip逃生开关不能放行；不再泛研新版SDK；先观察真实RED，记录当前Run/版本/原始输出，不以缺环境当行为RED。
- [x] **Step 2 [5 min]: Implement** 固定Classic，检查所有实际推进/恢复/写入入口共用门；方法与知识路由唯一；复用现有模块和原生接口，最小GREEN。
- [x] **Step 3 [5 min]: Verify** 保持原功能oracle，覆盖正向/拒绝/重复/失效/中断；执行现有公开seam的相关回归与实际读回，缺环境明确UNVERIFIED。
- [x] **Step 4 [5 min]: Review** 独立Spec/质量审查；测试作者不签Whitebox；声明fixture/真实宿主/资源各自证明范围。
- [x] **Step 5 [5 min]: Verify** 按execution-contract中本任务checks执行，记录新修订及当前候选；全量跨边界旅程归VERIFY，不以局部绿关闭父义务。
- [x] **Step 6 [5 min]: Commit** 只交所属文件、原始RED/GREEN、版本与未验证项，移交唯一控制器集成；不得写业务phase或另起DAG。

### Task P1_5: R/A/T/P与测试实现步骤装配

**Files:** test/classic-integration.test.js, openspec/changes/delivery-foundation-rearchitecture/classic-integration-probes, test/delivery-cases/1_5.mjs
**Interfaces:** Comet.Run.managedDelivery.v1: same RunState/lock/transaction, no second currentPhase; SDD.Gate.v1: pure evaluate(inputs,receipts,policy), no dispatch; Knowledge.Closeout.v1: Kp before archive, Kt before overall completion; Runner.Dispatch.v1: trusted launcher binds run/gate/input/policy/attempt/epoch, worker cannot write control state
**Dependencies:** P1_4, P2_1
**Owns:** test/classic-integration.test.js, openspec/changes/delivery-foundation-rearchitecture/classic-integration-probes, test/delivery-cases/1_5.mjs
**Parallel safe:** true
**Acceptance IDs:** C01, C02, C03, C04, C05, C06, C07, C08

原工作包身份：1.5.a, 1.5.b。当前修订：2026-10-26-comet-050-adoption-v1；未执行。

- [x] **Step 1 [5 min]: Test** A通过不代替T；弱TestPack不进Build；P不能派发第二DAG；hook缺席不能绕共同Guard；先观察真实RED，记录当前Run/版本/原始输出，不以缺环境当行为RED。
- [x] **Step 2 [5 min]: Implement** 在同一原生阶段内明确A→T、P→测试自动化→Builder→Reviewer并实际调用技能；复用现有模块和原生接口，最小GREEN。
- [x] **Step 3 [5 min]: Verify** 保持原功能oracle，覆盖正向/拒绝/重复/失效/中断；执行现有公开seam的相关回归与实际读回，缺环境明确UNVERIFIED。
- [x] **Step 4 [5 min]: Review** 独立Spec/质量审查；测试作者不签Whitebox；声明fixture/真实宿主/资源各自证明范围。
- [x] **Step 5 [5 min]: Verify** 按execution-contract中本任务checks执行，记录新修订及当前候选；全量跨边界旅程归VERIFY，不以局部绿关闭父义务。
- [x] **Step 6 [5 min]: Commit** 只交所属文件、原始RED/GREEN、版本与未验证项，移交唯一控制器集成；不得写业务phase或另起DAG。

### Task P3_2: 首个真实R到V纵向切片

**Files:** openspec/changes/delivery-foundation-rearchitecture/pilot-journey, test/delivery-cases/3_2.mjs, openspec/changes/delivery-foundation-rearchitecture/pilot-journey/same-run-delivery.case.json
**Interfaces:** Comet.Run.managedDelivery.v1: same RunState/lock/transaction, no second currentPhase; SDD.Gate.v1: pure evaluate(inputs,receipts,policy), no dispatch; Knowledge.Closeout.v1: Kp before archive, Kt before overall completion; Runner.Dispatch.v1: trusted launcher binds run/gate/input/policy/attempt/epoch, worker cannot write control state
**Dependencies:** P2_5, P3_1, P1_5
**Owns:** openspec/changes/delivery-foundation-rearchitecture/pilot-journey, test/delivery-cases/3_2.mjs, openspec/changes/delivery-foundation-rearchitecture/pilot-journey/same-run-delivery.case.json
**Parallel safe:** false
**Acceptance IDs:** B01, B02, B03, B04, B05, B06, B07, F08, A15, N03, N04, N05, N06

原工作包身份：3.2.a, 3.2.b。当前修订：2026-10-26-comet-050-adoption-v1；未执行。

- [x] **Step 1 [5 min]: Test** 任何阶段缺证据回责任作者；真实修复后同候选重验；不得先等六角色镜像/全部知识服务或用mock角色替代；先观察真实RED，记录当前Run/版本/原始输出，不以缺环境当行为RED。
- [x] **Step 2 [5 min]: Implement** 在现有宿主和一个真实Change上跑R/A/T/P、测试自动化、TDD、代码审查及独立Whitebox；复用现有模块和原生接口，最小GREEN。
- [x] **Step 3 [5 min]: Verify** 保持原功能oracle，覆盖正向/拒绝/重复/失效/中断；执行现有公开seam的相关回归与实际读回，缺环境明确UNVERIFIED。
- [x] **Step 4 [5 min]: Review** 独立Spec/质量审查；测试作者不签Whitebox；声明fixture/真实宿主/资源各自证明范围。
- [x] **Step 5 [5 min]: Verify** 按execution-contract中本任务checks执行，记录新修订及当前候选；全量跨边界旅程归VERIFY，不以局部绿关闭父义务。
- [x] **Step 6 [5 min]: Commit** 只交所属文件、原始RED/GREEN、版本与未验证项，移交唯一控制器集成；不得写业务phase或另起DAG。

### Task P3_3: 原Run恢复、重复和旧证据

**Files:** openspec/changes/delivery-foundation-rearchitecture/pilot-recovery, test/delivery-cases/3_3.mjs, openspec/changes/delivery-foundation-rearchitecture/pilot-recovery/real-comet-recovery.case.json
**Interfaces:** Comet.Run.managedDelivery.v1: same RunState/lock/transaction, no second currentPhase; SDD.Gate.v1: pure evaluate(inputs,receipts,policy), no dispatch; Knowledge.Closeout.v1: Kp before archive, Kt before overall completion; Runner.Dispatch.v1: trusted launcher binds run/gate/input/policy/attempt/epoch, worker cannot write control state
**Dependencies:** P3_2
**Owns:** openspec/changes/delivery-foundation-rearchitecture/pilot-recovery, test/delivery-cases/3_3.mjs, openspec/changes/delivery-foundation-rearchitecture/pilot-recovery/real-comet-recovery.case.json
**Parallel safe:** true
**Acceptance IDs:** A10, A11, A12, F07, N09, N11

原工作包身份：3.3.a, 3.3.b。当前修订：2026-10-26-comet-050-adoption-v1；未执行。

- [x] **Step 1 [5 min]: Test** 并发写者、旧attempt/失效epoch、失联结果未知不得新开operation或复活批准；先观察真实RED，记录当前Run/版本/原始输出，不以缺环境当行为RED。
- [x] **Step 2 [5 min]: Implement** 中断后由原Comet重载当前版本/步骤/原执行，重复调用不重复副作用；复用现有模块和原生接口，最小GREEN。
- [x] **Step 3 [5 min]: Verify** 保持原功能oracle，覆盖正向/拒绝/重复/失效/中断；执行现有公开seam的相关回归与实际读回，缺环境明确UNVERIFIED。
- [x] **Step 4 [5 min]: Review** 独立Spec/质量审查；测试作者不签Whitebox；声明fixture/真实宿主/资源各自证明范围。
- [x] **Step 5 [5 min]: Verify** 按execution-contract中本任务checks执行，记录新修订及当前候选；全量跨边界旅程归VERIFY，不以局部绿关闭父义务。
- [x] **Step 6 [5 min]: Commit** 只交所属文件、原始RED/GREEN、版本与未验证项，移交唯一控制器集成；不得写业务phase或另起DAG。

### Task P3_4: 原生OpenSpec唯一归档适配

**Files:** lib/adapters/spec.js, test/spec-closeout.test.js, test/delivery-cases/3_4.mjs
**Interfaces:** Comet.Run.managedDelivery.v1: same RunState/lock/transaction, no second currentPhase; SDD.Gate.v1: pure evaluate(inputs,receipts,policy), no dispatch; Knowledge.Closeout.v1: Kp before archive, Kt before overall completion; Runner.Dispatch.v1: trusted launcher binds run/gate/input/policy/attempt/epoch, worker cannot write control state
**Dependencies:** P2_4, P3_2
**Owns:** lib/adapters/spec.js, test/spec-closeout.test.js, test/delivery-cases/3_4.mjs
**Parallel safe:** true
**Acceptance IDs:** A11, B08, N07

原工作包身份：3.4.a, 3.4.b。当前修订：2026-10-26-comet-050-adoption-v1；未执行。

- [x] **Step 1 [5 min]: Test** Kp缺失拒绝；归档中断/目录移动/冲突先调和；不得再sync一次或新建第二closeout；先观察真实RED，记录当前Run/版本/原始输出，不以缺环境当行为RED。
- [x] **Step 2 [5 min]: Implement** 保留必要SpecAdapter及active/archive同Run位置读回、场景合并、唯一归档操作；复用现有模块和原生接口，最小GREEN。
- [x] **Step 3 [5 min]: Verify** 保持原功能oracle，覆盖正向/拒绝/重复/失效/中断；执行现有公开seam的相关回归与实际读回，缺环境明确UNVERIFIED。
- [x] **Step 4 [5 min]: Review** 独立Spec/质量审查；测试作者不签Whitebox；声明fixture/真实宿主/资源各自证明范围。
- [x] **Step 5 [5 min]: Verify** 按execution-contract中本任务checks执行，记录新修订及当前候选；全量跨边界旅程归VERIFY，不以局部绿关闭父义务。
- [x] **Step 6 [5 min]: Commit** 只交所属文件、原始RED/GREEN、版本与未验证项，移交唯一控制器集成；不得写业务phase或另起DAG。

### Task I01: 必要资源与既有连接器登记

**Files:** infra/delivery/registry.json, infra/delivery/registry.schema.json, infra/delivery/secrets.refs.example.json, infra/delivery/qualification-policy.json, tools/infra/registry.mjs, tools/infra/secret-refs.mjs, test/infra-registry.test.js
**Interfaces:** Registry.v1 -> project/resource/owner/credentialRef/lockRef/authority/domain/retention, no secret values; SecretRef.v1 -> existing authenticated connector or purpose-bound native host reference, no new secret service or mandatory model API key; Qualification.v2 -> exact installed command or necessary service identity, version/license/permissions/readback/recovery, image evidence only for deployed dependencies
**Dependencies:** P0_4
**Owns:** infra/delivery/registry.json, infra/delivery/registry.schema.json, infra/delivery/secrets.refs.example.json, infra/delivery/qualification-policy.json, tools/infra/registry.mjs, tools/infra/secret-refs.mjs, test/infra-registry.test.js
**Parallel safe:** true
**Acceptance IDs:** F01, A19, U01, U07, N08

原工作包身份：该节点原无子工作包；不新增身份。当前修订：2026-10-26-comet-050-adoption-v1；未执行。

- [x] **Step 1 [5 min]: Test** 不因服务账号可读、key存在、同名组或本地目录就认定权限/受众资格；先观察真实RED，记录当前Run/版本/原始输出，不以缺环境当行为RED。
- [x] **Step 2 [5 min]: Implement** 只登记实际试点、资料域、Outline文集、源/目标owner和已有身份引用；复用现有模块和原生接口，最小GREEN。
- [x] **Step 3 [5 min]: Verify** 保持原功能oracle，覆盖正向/拒绝/重复/失效/中断；执行现有公开seam的相关回归与实际读回，缺环境明确UNVERIFIED。
- [x] **Step 4 [5 min]: Review** 独立Spec/质量审查；测试作者不签Whitebox；声明fixture/真实宿主/资源各自证明范围。
- [x] **Step 5 [5 min]: Verify** 按execution-contract中本任务checks执行，记录新修订及当前候选；全量跨边界旅程归VERIFY，不以局部绿关闭父义务。
- [x] **Step 6 [5 min]: Commit** 只交所属文件、原始RED/GREEN、版本与未验证项，移交唯一控制器集成；不得写业务phase或另起DAG。

### Task I02: 退休六角色常驻部署与按需临时作业边界

**Files:** infra/delivery/runner/compose.yaml, infra/delivery/runner/Dockerfile, infra/delivery/runner/image.lock.json, infra/delivery/runner/role-policy.json, infra/delivery/runner/workspace-mounts.json, infra/delivery/runner/authority-registration.example.json, tools/infra/runner.mjs, test/infra-runner-isolation.test.js
**Interfaces:** HostInfra.v2 -> existing host command/tool permission evidence and retirement of resident role deployment, optional temporary jobs only; Host.RoleBoundary.v2 -> real independent sessions, native read/tool/path scopes and protected CI or connector authorization, no mandatory role containers; Authority.v2 -> one original Comet writer and workspace under native lock and transaction; host invocation refuses conflicting original Run writers and does not create a peer controller
**Dependencies:** I01, P1_1, P1_3
**Owns:** infra/delivery/runner/compose.yaml, infra/delivery/runner/Dockerfile, infra/delivery/runner/image.lock.json, infra/delivery/runner/role-policy.json, infra/delivery/runner/workspace-mounts.json, infra/delivery/runner/authority-registration.example.json, tools/infra/runner.mjs, test/infra-runner-isolation.test.js
**Parallel safe:** true
**Acceptance IDs:** A09, A10, A11, A19, C07, D01, D08, H03, H09, U07, F05, F07, M02, N03

原工作包身份：该节点原无子工作包；不新增身份。当前修订：2026-10-26-comet-050-adoption-v1；未执行。

- [x] **Step 1 [5 min]: Test** 默认安装/命令不能创建六角色服务；缺临时Docker不阻普通命令；未批准不删知识/控制卷；只读与控制写仍由宿主权限/CI拒绝；先观察真实RED，记录当前Run/版本/原始输出，不以缺环境当行为RED。
- [x] **Step 2 [5 min]: Implement** 退出六服务compose及默认启动/资格前置，保留必要通用检查和按需作业；记录旧容器/卷/镜像归属；复用现有模块和原生接口，最小GREEN。
- [x] **Step 3 [5 min]: Verify** 保持原功能oracle，覆盖正向/拒绝/重复/失效/中断；执行现有公开seam的相关回归与实际读回，缺环境明确UNVERIFIED。
- [x] **Step 4 [5 min]: Review** 独立Spec/质量审查；测试作者不签Whitebox；声明fixture/真实宿主/资源各自证明范围。
- [x] **Step 5 [5 min]: Verify** 按execution-contract中本任务checks执行，记录新修订及当前候选；全量跨边界旅程归VERIFY，不以局部绿关闭父义务。
- [x] **Step 6 [5 min]: Commit** 只交所属文件、原始RED/GREEN、版本与未验证项，移交唯一控制器集成；不得写业务phase或另起DAG。

### Task I03: 必要Outline栈与受管文集

**Files:** infra/delivery/outline/compose.yaml, infra/delivery/outline/images.lock.json, infra/delivery/outline/outline.env.example, infra/delivery/outline/oidc-registration.example.json, infra/delivery/outline/storage-policy.json, infra/delivery/outline/collection-registration.example.json, tools/infra/outline.mjs, test/infra-outline.test.js
**Interfaces:** OutlineInfra.v1 validate|qualify|up|probe|stop -> actual API/UI/storage/principal evidence; OutlineDomain.v1 -> instance/collection immutable IDs, actual effective reader set and registered owner; OutlineState.v1 -> durable database+attachment storage; cache is not rights authority; API contracts include fixed create UUID and lastRevision only if verified
**Dependencies:** I01
**Owns:** infra/delivery/outline/compose.yaml, infra/delivery/outline/images.lock.json, infra/delivery/outline/outline.env.example, infra/delivery/outline/oidc-registration.example.json, infra/delivery/outline/storage-policy.json, infra/delivery/outline/collection-registration.example.json, tools/infra/outline.mjs, test/infra-outline.test.js
**Parallel safe:** true
**Acceptance IDs:** U01, U02, U03, U04, U05, U06, U07, U08, H04, H05, L02, L04, N05

原工作包身份：该节点原无子工作包；不新增身份。当前修订：2026-10-26-comet-050-adoption-v1；未执行。

- [x] **Step 1 [5 min]: Test** healthy不是发布权限；额外对象存储无实际需要不增建，缺owner/受众不能自动发布；先观察真实RED，记录当前Run/版本/原始输出，不以缺环境当行为RED。
- [x] **Step 2 [5 min]: Implement** 复用必要Outline/Postgres/Redis和既有附件方案，验证真实API/权限/数据持久化与恢复；复用现有模块和原生接口，最小GREEN。
- [x] **Step 3 [5 min]: Verify** 保持原功能oracle，覆盖正向/拒绝/重复/失效/中断；执行现有公开seam的相关回归与实际读回，缺环境明确UNVERIFIED。
- [x] **Step 4 [5 min]: Review** 独立Spec/质量审查；测试作者不签Whitebox；声明fixture/真实宿主/资源各自证明范围。
- [x] **Step 5 [5 min]: Verify** 按execution-contract中本任务checks执行，记录新修订及当前候选；全量跨边界旅程归VERIFY，不以局部绿关闭父义务。
- [x] **Step 6 [5 min]: Commit** 只交所属文件、原始RED/GREEN、版本与未验证项，移交唯一控制器集成；不得写业务phase或另起DAG。

### Task I04: 项目LLMWiki stdio MCP

**Files:** infra/delivery/llmwiki/package.lock.json, infra/delivery/llmwiki/project-root-policy.json, infra/delivery/llmwiki/index-policy.json, infra/delivery/llmwiki/mcp-profile.json, tools/infra/llmwiki.mjs, test/infra-llmwiki-paths.test.js
**Interfaces:** ProjectWikiInfra.v1 validate|qualify|probe -> canonical project/wiki/index identity and MCP read/write observations; ProjectRoot.v1 -> projectID/repoID/wikiRoot/worktree mapping, contained paths only; KnowledgeWrite.v1 -> approved curated entry plus source/revision and independent readback; no task/phase/spec authority
**Dependencies:** I01, P1_1
**Owns:** infra/delivery/llmwiki/package.lock.json, infra/delivery/llmwiki/project-root-policy.json, infra/delivery/llmwiki/index-policy.json, infra/delivery/llmwiki/mcp-profile.json, tools/infra/llmwiki.mjs, test/infra-llmwiki-paths.test.js
**Parallel safe:** true
**Acceptance IDs:** C04, C06, E01, E06, H08, F01, B09, N05

原工作包身份：该节点原无子工作包；不新增身份。当前修订：2026-10-26-comet-050-adoption-v1；未执行。

- [x] **Step 1 [5 min]: Test** 跨项目路径/绕索引写、整仓入库、无授权或错误schema拒绝；不新增常驻HTTP服务；先观察真实RED，记录当前Run/版本/原始输出，不以缺环境当行为RED。
- [x] **Step 2 [5 min]: Implement** 由现有宿主启动项目MCP，实际检索/精华写入/索引与版本读回；复用现有模块和原生接口，最小GREEN。
- [x] **Step 3 [5 min]: Verify** 保持原功能oracle，覆盖正向/拒绝/重复/失效/中断；执行现有公开seam的相关回归与实际读回，缺环境明确UNVERIFIED。
- [x] **Step 4 [5 min]: Review** 独立Spec/质量审查；测试作者不签Whitebox；声明fixture/真实宿主/资源各自证明范围。
- [x] **Step 5 [5 min]: Verify** 按execution-contract中本任务checks执行，记录新修订及当前候选；全量跨边界旅程归VERIFY，不以局部绿关闭父义务。
- [x] **Step 6 [5 min]: Commit** 只交所属文件、原始RED/GREEN、版本与未验证项，移交唯一控制器集成；不得写业务phase或另起DAG。

### Task I05: 代码Wiki与可选Graph

**Files:** infra/delivery/code-knowledge/compose.yaml, infra/delivery/code-knowledge/images.lock.json, infra/delivery/code-knowledge/deepwiki-profile.json, infra/delivery/code-knowledge/graph-profile.json, infra/delivery/code-knowledge/repository-scope.json, tools/infra/code-knowledge.mjs, test/infra-code-knowledge.test.js
**Interfaces:** CodeKnowledgeInfra.v1 validate|qualify|probe -> selfhost code-wiki and separate graph provenance/freshness evidence; CodeWiki.v1 -> repository immutableID/commit and wiki generation manifest, approved code access scope; CodeGraph.v1 -> structure-only index with exact input commit/coverage; removable optimization, no gate or knowledge authority
**Dependencies:** I01, P1_1
**Owns:** infra/delivery/code-knowledge/compose.yaml, infra/delivery/code-knowledge/images.lock.json, infra/delivery/code-knowledge/deepwiki-profile.json, infra/delivery/code-knowledge/graph-profile.json, infra/delivery/code-knowledge/repository-scope.json, tools/infra/code-knowledge.mjs, test/infra-code-knowledge.test.js
**Parallel safe:** true
**Acceptance IDs:** F01, F03, A20, C06, N05

原工作包身份：该节点原无子工作包；不新增身份。当前修订：2026-10-26-comet-050-adoption-v1；未执行。

- [x] **Step 1 [5 min]: Test** 新鲜度/来源不明不能充当设计事实；禁Graph仍正确，不把代码Wiki当正式团队知识；先观察真实RED，记录当前Run/版本/原始输出，不以缺环境当行为RED。
- [x] **Step 2 [5 min]: Implement** 按真实需要自托管deepwiki-open并绑定repo/commit；CodeGraph默认可关闭；复用现有模块和原生接口，最小GREEN。
- [x] **Step 3 [5 min]: Verify** 保持原功能oracle，覆盖正向/拒绝/重复/失效/中断；执行现有公开seam的相关回归与实际读回，缺环境明确UNVERIFIED。
- [x] **Step 4 [5 min]: Review** 独立Spec/质量审查；测试作者不签Whitebox；声明fixture/真实宿主/资源各自证明范围。
- [x] **Step 5 [5 min]: Verify** 按execution-contract中本任务checks执行，记录新修订及当前候选；全量跨边界旅程归VERIFY，不以局部绿关闭父义务。
- [x] **Step 6 [5 min]: Commit** 只交所属文件、原始RED/GREEN、版本与未验证项，移交唯一控制器集成；不得写业务phase或另起DAG。

### Task I06: 已有Git/CI/制品与目标环境

**Files:** infra/delivery/platform/repository-registration.json, infra/delivery/platform/ci-policy.json, infra/delivery/platform/registry-registration.example.json, infra/delivery/platform/environment-registration.example.json, infra/delivery/platform/artifact-retention.json, tools/infra/platform.mjs, test/infra-platform.test.js
**Interfaces:** PlatformInfra.v1 validate|probe -> repository identity/permissions/check policy/registry/environment evidence, no implicit remote policy writes; IntegrationIdentity.v1 -> PR head/mergeSHA -> build artifact digest -> target deployment identity; Environment.v1 -> isolated endpoint/owner/rollback authorization and readback oracle
**Dependencies:** I01
**Owns:** infra/delivery/platform/repository-registration.json, infra/delivery/platform/ci-policy.json, infra/delivery/platform/registry-registration.example.json, infra/delivery/platform/environment-registration.example.json, infra/delivery/platform/artifact-retention.json, tools/infra/platform.mjs, test/infra-platform.test.js
**Parallel safe:** true
**Acceptance IDs:** A13, A14, A16, A17, A19, F06, F09, B08, N10

原工作包身份：该节点原无子工作包；不新增身份。当前修订：2026-10-26-comet-050-adoption-v1；未执行。

- [x] **Step 1 [5 min]: Test** 错SHA/外repo/不明身份/排队或历史artifact不能当本次生产成功；真实外部写要具体授权；先观察真实RED，记录当前Run/版本/原始输出，不以缺环境当行为RED。
- [x] **Step 2 [5 min]: Implement** 登记实际平台/required checks/构建digest/目标owner，沿已有流水线提供事实；复用现有模块和原生接口，最小GREEN。
- [x] **Step 3 [5 min]: Verify** 保持原功能oracle，覆盖正向/拒绝/重复/失效/中断；执行现有公开seam的相关回归与实际读回，缺环境明确UNVERIFIED。
- [x] **Step 4 [5 min]: Review** 独立Spec/质量审查；测试作者不签Whitebox；声明fixture/真实宿主/资源各自证明范围。
- [x] **Step 5 [5 min]: Verify** 按execution-contract中本任务checks执行，记录新修订及当前候选；全量跨边界旅程归VERIFY，不以局部绿关闭父义务。
- [x] **Step 6 [5 min]: Commit** 只交所属文件、原始RED/GREEN、版本与未验证项，移交唯一控制器集成；不得写业务phase或另起DAG。

### Task P4_6: 归档后同Run Kt恢复

**Files:** integrations/comet/patches/0003-post-archive-closeout.patch, test/delivery-cases/4_6.mjs, integrations/comet/patches/tests/4_6.patch
**Interfaces:** Comet.Run.managedDelivery.v1: same RunState/lock/transaction, no second currentPhase; SDD.Gate.v1: pure evaluate(inputs,receipts,policy), no dispatch; Knowledge.Closeout.v1: Kp before archive, Kt before overall completion; Runner.Dispatch.v1: trusted launcher binds run/gate/input/policy/attempt/epoch, worker cannot write control state
**Dependencies:** P3_3, P3_4
**Owns:** integrations/comet/patches/0003-post-archive-closeout.patch, test/delivery-cases/4_6.mjs, integrations/comet/patches/tests/4_6.patch
**Parallel safe:** true
**Acceptance IDs:** H01, H02, H03, H04, H05, H06, H07, H08, H09, N07, N11

原工作包身份：4.6.a, 4.6.b, 4.6.c。当前修订：2026-10-26-comet-050-adoption-v1；未执行。

- [ ] **Step 1 [5 min]: Test** 重复hook/回调/重启不得重复archive或发布；unknown维持原handle与操作，不把归档当completed；先观察真实RED，记录当前Run/版本/原始输出，不以缺环境当行为RED。
- [ ] **Step 2 [5 min]: Implement** 原归档后仍发现同Run pending知识义务；按原operation/目标UUID/版本查询恢复；复用现有模块和原生接口，最小GREEN。
- [ ] **Step 3 [5 min]: Verify** 保持原功能oracle，覆盖正向/拒绝/重复/失效/中断；执行现有公开seam的相关回归与实际读回，缺环境明确UNVERIFIED。
- [ ] **Step 4 [5 min]: Review** 独立Spec/质量审查；测试作者不签Whitebox；声明fixture/真实宿主/资源各自证明范围。
- [ ] **Step 5 [5 min]: Verify** 按execution-contract中本任务checks执行，记录新修订及当前候选；全量跨边界旅程归VERIFY，不以局部绿关闭父义务。
- [ ] **Step 6 [5 min]: Commit** 只交所属文件、原始RED/GREEN、版本与未验证项，移交唯一控制器集成；不得写业务phase或另起DAG。

### Task P4_7: 知识发布预授权与最小权限

**Files:** lib/adapters/knowledge-authorization.js, test/knowledge-authorization.test.js, openspec/changes/delivery-foundation-rearchitecture/authorization-journey, test/delivery-cases/4_7.mjs, tools/infra/knowledge-authz.mjs, infra/delivery/knowledge
**Interfaces:** Comet.Run.managedDelivery.v1: same RunState/lock/transaction, no second currentPhase; SDD.Gate.v1: pure evaluate(inputs,receipts,policy), no dispatch; Knowledge.Closeout.v1: Kp before archive, Kt before overall completion; Runner.Dispatch.v1: trusted launcher binds run/gate/input/policy/attempt/epoch, worker cannot write control state
**Dependencies:** P4_6, I03
**Owns:** lib/adapters/knowledge-authorization.js, test/knowledge-authorization.test.js, openspec/changes/delivery-foundation-rearchitecture/authorization-journey, test/delivery-cases/4_7.mjs, tools/infra/knowledge-authz.mjs, infra/delivery/knowledge
**Parallel safe:** true
**Acceptance IDs:** U01, U02, U03, U04, U05, U06, U07, U08, N08

原工作包身份：4.7.a, 4.7.b, 4.7.c。当前修订：2026-10-26-comet-050-adoption-v1；未执行。

- [ ] **Step 1 [5 min]: Test** Agent自批/扩大受众/过期授权/内容版本漂移拒绝；不以新token服务或六OS账号代替权限证明；先观察真实RED，记录当前Run/版本/原始输出，不以缺环境当行为RED。
- [ ] **Step 2 [5 min]: Implement** 用已有平台/连接器权限核源交集、完整受众、有效grant及作者/审查/发布/owner职责；复用现有模块和原生接口，最小GREEN。
- [ ] **Step 3 [5 min]: Verify** 保持原功能oracle，覆盖正向/拒绝/重复/失效/中断；执行现有公开seam的相关回归与实际读回，缺环境明确UNVERIFIED。
- [ ] **Step 4 [5 min]: Review** 独立Spec/质量审查；测试作者不签Whitebox；声明fixture/真实宿主/资源各自证明范围。
- [ ] **Step 5 [5 min]: Verify** 按execution-contract中本任务checks执行，记录新修订及当前候选；全量跨边界旅程归VERIFY，不以局部绿关闭父义务。
- [ ] **Step 6 [5 min]: Commit** 只交所属文件、原始RED/GREEN、版本与未验证项，移交唯一控制器集成；不得写业务phase或另起DAG。

### Task P4_4: 实际Kp到归档到Kt知识闭环

**Files:** lib/adapters/llmwiki.js, lib/adapters/outline.js, lib/adapters/code-wiki.js, lib/sdd-paths.js, tools/mcp/llmwiki.sh, test/knowledge-closeout.test.js, lib/knowledge-seed.js, bin/cli.js, test/delivery-cases/4_4.mjs
**Interfaces:** Comet.Run.managedDelivery.v1: same RunState/lock/transaction, no second currentPhase; SDD.Gate.v1: pure evaluate(inputs,receipts,policy), no dispatch; Knowledge.Closeout.v1: Kp before archive, Kt before overall completion; Runner.Dispatch.v1: trusted launcher binds run/gate/input/policy/attempt/epoch, worker cannot write control state
**Dependencies:** P3_4, P4_6, P4_7, I03, I04
**Owns:** lib/adapters/llmwiki.js, lib/adapters/outline.js, lib/adapters/code-wiki.js, lib/sdd-paths.js, tools/mcp/llmwiki.sh, test/knowledge-closeout.test.js, lib/knowledge-seed.js, bin/cli.js, test/delivery-cases/4_4.mjs
**Parallel safe:** true
**Acceptance IDs:** C06, D06, D07, E01, E02, E06, N07, N08

原工作包身份：4.4.a, 4.4.b, 4.4.c, 4.4.d。当前修订：2026-10-26-comet-050-adoption-v1；未执行。

- [ ] **Step 1 [5 min]: Test** Kp阻归档、Kt阻完成；同Run重复触发不重复写；输出必须提前声明，不能排除源码/权限保住旧V；先观察真实RED，记录当前Run/版本/原始输出，不以缺环境当行为RED。
- [ ] **Step 2 [5 min]: Implement** 调用真实LLMWiki/Outline工具，作者产出后冻结，独立审查、实际写入与读回；复用现有模块和原生接口，最小GREEN。
- [ ] **Step 3 [5 min]: Verify** 保持原功能oracle，覆盖正向/拒绝/重复/失效/中断；执行现有公开seam的相关回归与实际读回，缺环境明确UNVERIFIED。
- [ ] **Step 4 [5 min]: Review** 独立Spec/质量审查；测试作者不签Whitebox；声明fixture/真实宿主/资源各自证明范围。
- [ ] **Step 5 [5 min]: Verify** 按execution-contract中本任务checks执行，记录新修订及当前候选；全量跨边界旅程归VERIFY，不以局部绿关闭父义务。
- [ ] **Step 6 [5 min]: Commit** 只交所属文件、原始RED/GREEN、版本与未验证项，移交唯一控制器集成；不得写业务phase或另起DAG。

### Task P4_1: 受保护CI硬门

**Files:** .github/workflows/delivery-gate.yml, tools/ci/verify-delivery.mjs, test/ci-delivery-gate.test.js, test/delivery-cases/4_1.mjs
**Interfaces:** Comet.Run.managedDelivery.v1: same RunState/lock/transaction, no second currentPhase; SDD.Gate.v1: pure evaluate(inputs,receipts,policy), no dispatch; Knowledge.Closeout.v1: Kp before archive, Kt before overall completion; Runner.Dispatch.v1: trusted launcher binds run/gate/input/policy/attempt/epoch, worker cannot write control state
**Dependencies:** P3_3, I06
**Owns:** .github/workflows/delivery-gate.yml, tools/ci/verify-delivery.mjs, test/ci-delivery-gate.test.js, test/delivery-cases/4_1.mjs
**Parallel safe:** true
**Acceptance IDs:** A13, F06, F09, N10

原工作包身份：4.1.a, 4.1.b。当前修订：2026-10-26-comet-050-adoption-v1；未执行。

- [ ] **Step 1 [5 min]: Test** 缺项/skip/超时/旧报告或worker可改的策略不得通过；不从本地测试推断远端保护生效；先观察真实RED，记录当前Run/版本/原始输出，不以缺环境当行为RED。
- [ ] **Step 2 [5 min]: Implement** 在精确集成SHA上验证必需检查与当前证据，用真实平台合并阻断读回；复用现有模块和原生接口，最小GREEN。
- [ ] **Step 3 [5 min]: Verify** 保持原功能oracle，覆盖正向/拒绝/重复/失效/中断；执行现有公开seam的相关回归与实际读回，缺环境明确UNVERIFIED。
- [ ] **Step 4 [5 min]: Review** 独立Spec/质量审查；测试作者不签Whitebox；声明fixture/真实宿主/资源各自证明范围。
- [ ] **Step 5 [5 min]: Verify** 按execution-contract中本任务checks执行，记录新修订及当前候选；全量跨边界旅程归VERIFY，不以局部绿关闭父义务。
- [ ] **Step 6 [5 min]: Commit** 只交所属文件、原始RED/GREEN、版本与未验证项，移交唯一控制器集成；不得写业务phase或另起DAG。

### Task P4_2: 同digest构建、部署与回滚

**Files:** tools/ci/release.mjs, test/release-protocol.test.js, openspec/changes/delivery-foundation-rearchitecture/release-journey, test/delivery-cases/4_2.mjs
**Interfaces:** Comet.Run.managedDelivery.v1: same RunState/lock/transaction, no second currentPhase; SDD.Gate.v1: pure evaluate(inputs,receipts,policy), no dispatch; Knowledge.Closeout.v1: Kp before archive, Kt before overall completion; Runner.Dispatch.v1: trusted launcher binds run/gate/input/policy/attempt/epoch, worker cannot write control state
**Dependencies:** P4_1
**Owns:** tools/ci/release.mjs, test/release-protocol.test.js, openspec/changes/delivery-foundation-rearchitecture/release-journey, test/delivery-cases/4_2.mjs
**Parallel safe:** false
**Acceptance IDs:** A14, A16, A17, F09, N10

原工作包身份：4.2.a, 4.2.b。当前修订：2026-10-26-comet-050-adoption-v1；未执行。

- [ ] **Step 1 [5 min]: Test** tag漂移/错digest/未知部署结果先查原操作，不重复部署或假称流水线绿等于完成；先观察真实RED，记录当前Run/版本/原始输出，不以缺环境当行为RED。
- [ ] **Step 2 [5 min]: Implement** 沿既有CI/CD完成目标环境读回和已授权回滚，代码验收与部署事实分开；复用现有模块和原生接口，最小GREEN。
- [ ] **Step 3 [5 min]: Verify** 保持原功能oracle，覆盖正向/拒绝/重复/失效/中断；执行现有公开seam的相关回归与实际读回，缺环境明确UNVERIFIED。
- [ ] **Step 4 [5 min]: Review** 独立Spec/质量审查；测试作者不签Whitebox；声明fixture/真实宿主/资源各自证明范围。
- [ ] **Step 5 [5 min]: Verify** 按execution-contract中本任务checks执行，记录新修订及当前候选；全量跨边界旅程归VERIFY，不以局部绿关闭父义务。
- [ ] **Step 6 [5 min]: Commit** 只交所属文件、原始RED/GREEN、版本与未验证项，移交唯一控制器集成；不得写业务phase或另起DAG。

### Task P4_5: 可选Ponytail hook装配

**Files:** hooks.yaml, hooks, tools/adapters/claude-code.sh, test/delivery-hook-assembly.test.js, test/delivery-cases/4_5.mjs
**Interfaces:** Comet.Run.managedDelivery.v1: same RunState/lock/transaction, no second currentPhase; SDD.Gate.v1: pure evaluate(inputs,receipts,policy), no dispatch; Knowledge.Closeout.v1: Kp before archive, Kt before overall completion; Runner.Dispatch.v1: trusted launcher binds run/gate/input/policy/attempt/epoch, worker cannot write control state
**Dependencies:** P4_4
**Owns:** hooks.yaml, hooks, tools/adapters/claude-code.sh, test/delivery-hook-assembly.test.js, test/delivery-cases/4_5.mjs
**Parallel safe:** true
**Acceptance IDs:** E05, E06, H02, N02

原工作包身份：4.5.a, 4.5.b。当前修订：2026-10-26-comet-050-adoption-v1；未执行。

- [ ] **Step 1 [5 min]: Test** hook缺席/重复/静默失败/会话压缩不能跳门，也不能拥有派发/phase/验收权；先观察真实RED，记录当前Run/版本/原始输出，不以缺环境当行为RED。
- [ ] **Step 2 [5 min]: Implement** 仅辅助事实提醒/触发原Comet检查，沿hooks.yaml单一源验证注册/升级/并存；复用现有模块和原生接口，最小GREEN。
- [ ] **Step 3 [5 min]: Verify** 保持原功能oracle，覆盖正向/拒绝/重复/失效/中断；执行现有公开seam的相关回归与实际读回，缺环境明确UNVERIFIED。
- [ ] **Step 4 [5 min]: Review** 独立Spec/质量审查；测试作者不签Whitebox；声明fixture/真实宿主/资源各自证明范围。
- [ ] **Step 5 [5 min]: Verify** 按execution-contract中本任务checks执行，记录新修订及当前候选；全量跨边界旅程归VERIFY，不以局部绿关闭父义务。
- [ ] **Step 6 [5 min]: Commit** 只交所属文件、原始RED/GREEN、版本与未验证项，移交唯一控制器集成；不得写业务phase或另起DAG。

### Task I07: 复用既有调度和外部告警

**Files:** infra/delivery/monitor/monitor-registration.example.json, infra/delivery/monitor/health-contract.json, infra/delivery/monitor/alert-policy.json, infra/delivery/monitor/supervisor-policy.json, infra/delivery/monitor/fault-domain-policy.json, tools/infra/monitor.mjs, test/infra-monitor.test.js
**Interfaces:** Health.v1 -> heartbeat_age, complete_scan_watermark, unresolved_isolation/deadlines and authority identity; read-only; Monitor.v1 -> external fault-domain registration and alert delivery/ack/escalation only, never business phase/retry/ACL; Supervisor.v2 -> existing scheduler invokes original Comet maintenance and recovery after checking the old writer, no resident controller requirement; bounded attempts and escalation
**Dependencies:** I01, P2_4
**Owns:** infra/delivery/monitor/monitor-registration.example.json, infra/delivery/monitor/health-contract.json, infra/delivery/monitor/alert-policy.json, infra/delivery/monitor/supervisor-policy.json, infra/delivery/monitor/fault-domain-policy.json, tools/infra/monitor.mjs, test/infra-monitor.test.js
**Parallel safe:** true
**Acceptance IDs:** L08, L09, L10, L11, A11, H09, N09

原工作包身份：该节点原无子工作包；不新增身份。当前修订：2026-10-26-comet-050-adoption-v1；未执行。

- [x] **Step 1 [5 min]: Test** 漏事件/不进水位/离线/隔离失败必须告警并由原Comet补偿；不得起独立controller服务；先观察真实RED，记录当前Run/版本/原始输出，不以缺环境当行为RED。
- [x] **Step 2 [5 min]: Implement** 已有CI/宿主定时器触发同Comet权限维护；监控只观察水位/期限并告警；复用现有模块和原生接口，最小GREEN。
- [x] **Step 3 [5 min]: Verify** 保持原功能oracle，覆盖正向/拒绝/重复/失效/中断；执行现有公开seam的相关回归与实际读回，缺环境明确UNVERIFIED。
- [x] **Step 4 [5 min]: Review** 独立Spec/质量审查；测试作者不签Whitebox；声明fixture/真实宿主/资源各自证明范围。
- [x] **Step 5 [5 min]: Verify** 按execution-contract中本任务checks执行，记录新修订及当前候选；全量跨边界旅程归VERIFY，不以局部绿关闭父义务。
- [x] **Step 6 [5 min]: Commit** 只交所属文件、原始RED/GREEN、版本与未验证项，移交唯一控制器集成；不得写业务phase或另起DAG。

### Task I08: 原生状态与知识数据备份恢复

**Files:** infra/delivery/recovery/backup-policy.json, infra/delivery/recovery/restore-policy.json, infra/delivery/recovery/retention-policy.json, infra/delivery/recovery/authority-transfer.schema.json, infra/delivery/recovery/operations-runbook.md, tools/infra/recovery.mjs, test/infra-recovery.test.js, infra/delivery/backup, tools/infra/backup-restore.mjs, test/infra-backup-restore.test.js, test/delivery-cases/i08.mjs
**Interfaces:** Backup.v1 -> consistent manifest of Comet state/transaction/receipts/approved payload plus knowledge/database/objects/config refs; Restore.v1 -> restore into quarantine, authenticate current permissions, fence old writer, verify same operation and readback before release; Retention.v1 -> R10 A: unresolved Run/knowledge obligation retains sole workspace; cleanup requires verified completed or separately approved migration+restore proof
**Dependencies:** I03, I04, P4_4, P4_6
**Owns:** infra/delivery/recovery/backup-policy.json, infra/delivery/recovery/restore-policy.json, infra/delivery/recovery/retention-policy.json, infra/delivery/recovery/authority-transfer.schema.json, infra/delivery/recovery/operations-runbook.md, tools/infra/recovery.mjs, test/infra-recovery.test.js, infra/delivery/backup, tools/infra/backup-restore.mjs, test/infra-backup-restore.test.js, test/delivery-cases/i08.mjs
**Parallel safe:** true
**Acceptance IDs:** A10, A11, H08, H09, L06, L11, B08, U07, N11

原工作包身份：该节点原无子工作包；不新增身份。当前修订：2026-10-26-comet-050-adoption-v1；未执行。

- [ ] **Step 1 [5 min]: Test** 缺附件/未完成义务/旧写者仍活不得释放恢复；不复制一套可并行运行的业务状态；先观察真实RED，记录当前Run/版本/原始输出，不以缺环境当行为RED。
- [ ] **Step 2 [5 min]: Implement** 实际备份Comet原目录/事务/义务及知识DB/附件，隔离恢复后重新核权限并读回；复用现有模块和原生接口，最小GREEN。
- [ ] **Step 3 [5 min]: Verify** 保持原功能oracle，覆盖正向/拒绝/重复/失效/中断；执行现有公开seam的相关回归与实际读回，缺环境明确UNVERIFIED。
- [ ] **Step 4 [5 min]: Review** 独立Spec/质量审查；测试作者不签Whitebox；声明fixture/真实宿主/资源各自证明范围。
- [ ] **Step 5 [5 min]: Verify** 按execution-contract中本任务checks执行，记录新修订及当前候选；全量跨边界旅程归VERIFY，不以局部绿关闭父义务。
- [ ] **Step 6 [5 min]: Commit** 只交所属文件、原始RED/GREEN、版本与未验证项，移交唯一控制器集成；不得写业务phase或另起DAG。

### Task P4_8: 撤权、隔离、告警与新授权恢复

**Files:** lib/adapters/knowledge-revocation.js, test/knowledge-revocation.test.js, openspec/changes/delivery-foundation-rearchitecture/revocation-journey, test/delivery-cases/4_8.mjs, openspec/changes/delivery-foundation-rearchitecture/revocation-journey/post-delivery-permissions.case.json
**Interfaces:** Comet.Run.managedDelivery.v1: same RunState/lock/transaction, no second currentPhase; SDD.Gate.v1: pure evaluate(inputs,receipts,policy), no dispatch; Knowledge.Closeout.v1: Kp before archive, Kt before overall completion; Runner.Dispatch.v1: trusted launcher binds run/gate/input/policy/attempt/epoch, worker cannot write control state
**Dependencies:** P4_4, I07, I08
**Owns:** lib/adapters/knowledge-revocation.js, test/knowledge-revocation.test.js, openspec/changes/delivery-foundation-rearchitecture/revocation-journey, test/delivery-cases/4_8.mjs, openspec/changes/delivery-foundation-rearchitecture/revocation-journey/post-delivery-permissions.case.json
**Parallel safe:** false
**Acceptance IDs:** L01, L02, L03, L04, L05, L06, L07, L08, L09, L10, L11, N09

原工作包身份：4.8.a, 4.8.b, 4.8.c, 4.8.d。当前修订：2026-10-26-comet-050-adoption-v1；未执行。

- [ ] **Step 1 [5 min]: Test** Web/分享/搜索/附件/MCP逐渠道实测；告警不能充当隔离，未知不当公开，新授权前不恢复；先观察真实RED，记录当前Run/版本/原始输出，不以缺环境当行为RED。
- [ ] **Step 2 [5 min]: Implement** 真实事件加周期全量核验，以原Comet维护作业实现3分钟发现/2分钟隔离及故障补偿；复用现有模块和原生接口，最小GREEN。
- [ ] **Step 3 [5 min]: Verify** 保持原功能oracle，覆盖正向/拒绝/重复/失效/中断；执行现有公开seam的相关回归与实际读回，缺环境明确UNVERIFIED。
- [ ] **Step 4 [5 min]: Review** 独立Spec/质量审查；测试作者不签Whitebox；声明fixture/真实宿主/资源各自证明范围。
- [ ] **Step 5 [5 min]: Verify** 按execution-contract中本任务checks执行，记录新修订及当前候选；全量跨边界旅程归VERIFY，不以局部绿关闭父义务。
- [ ] **Step 6 [5 min]: Commit** 只交所属文件、原始RED/GREEN、版本与未验证项，移交唯一控制器集成；不得写业务phase或另起DAG。

### Task P4_3: 当前证据索引与分层交付

**Files:** openspec/changes/delivery-foundation-rearchitecture/acceptance-index.json, openspec/changes/delivery-foundation-rearchitecture/verification.md, test/delivery-cases/4_3.mjs, openspec/changes/delivery-foundation-rearchitecture/legacy-entry-inventory.json
**Interfaces:** Comet.Run.managedDelivery.v1: same RunState/lock/transaction, no second currentPhase; SDD.Gate.v1: pure evaluate(inputs,receipts,policy), no dispatch; Knowledge.Closeout.v1: Kp before archive, Kt before overall completion; Runner.Dispatch.v1: trusted launcher binds run/gate/input/policy/attempt/epoch, worker cannot write control state
**Dependencies:** P4_5, P4_8
**Owns:** openspec/changes/delivery-foundation-rearchitecture/acceptance-index.json, openspec/changes/delivery-foundation-rearchitecture/verification.md, test/delivery-cases/4_3.mjs, openspec/changes/delivery-foundation-rearchitecture/legacy-entry-inventory.json
**Parallel safe:** true
**Acceptance IDs:** B10, N12

原工作包身份：4.3.a, 4.3.b。当前修订：2026-10-26-comet-050-adoption-v1；未执行。

- [ ] **Step 1 [5 min]: Test** 历史镜像/旧六角色probe或不存在目标不能充当新PASS；保留全部原失败；先观察真实RED，记录当前Run/版本/原始输出，不以缺环境当行为RED。
- [ ] **Step 2 [5 min]: Implement** 按修订和最终候选索引单测/装配/真实宿主/业务平台证据，明确缺口；复用现有模块和原生接口，最小GREEN。
- [ ] **Step 3 [5 min]: Verify** 保持原功能oracle，覆盖正向/拒绝/重复/失效/中断；执行现有公开seam的相关回归与实际读回，缺环境明确UNVERIFIED。
- [ ] **Step 4 [5 min]: Review** 独立Spec/质量审查；测试作者不签Whitebox；声明fixture/真实宿主/资源各自证明范围。
- [ ] **Step 5 [5 min]: Verify** 按execution-contract中本任务checks执行，记录新修订及当前候选；全量跨边界旅程归VERIFY，不以局部绿关闭父义务。
- [ ] **Step 6 [5 min]: Commit** 只交所属文件、原始RED/GREEN、版本与未验证项，移交唯一控制器集成；不得写业务phase或另起DAG。

### Task P5_1: 实际宿主能力与团队使用

**Files:** openspec/changes/delivery-foundation-rearchitecture/team-host-matrix, test/delivery-cases/5_1.mjs
**Interfaces:** Comet.Run.managedDelivery.v1: same RunState/lock/transaction, no second currentPhase; SDD.Gate.v1: pure evaluate(inputs,receipts,policy), no dispatch; Knowledge.Closeout.v1: Kp before archive, Kt before overall completion; Runner.Dispatch.v1: trusted launcher binds run/gate/input/policy/attempt/epoch, worker cannot write control state
**Dependencies:** P4_3
**Owns:** openspec/changes/delivery-foundation-rearchitecture/team-host-matrix, test/delivery-cases/5_1.mjs
**Parallel safe:** false
**Acceptance IDs:** A09, A10, A11, A12, F03, F08

原工作包身份：5.1.a, 5.1.b。当前修订：2026-10-26-comet-050-adoption-v1；未执行。

- [ ] **Step 1 [5 min]: Test** 不同宿主不能互推支持；缺只读或必要权限能力标不支持，不重建六服务绕过；先观察真实RED，记录当前Run/版本/原始输出，不以缺环境当行为RED。
- [ ] **Step 2 [5 min]: Implement** 只在实际目标宿主验证命令发现、技能、权限、独立执行/会话恢复；并行worktree集成后父目标重验；复用现有模块和原生接口，最小GREEN。
- [ ] **Step 3 [5 min]: Verify** 保持原功能oracle，覆盖正向/拒绝/重复/失效/中断；执行现有公开seam的相关回归与实际读回，缺环境明确UNVERIFIED。
- [ ] **Step 4 [5 min]: Review** 独立Spec/质量审查；测试作者不签Whitebox；声明fixture/真实宿主/资源各自证明范围。
- [ ] **Step 5 [5 min]: Verify** 按execution-contract中本任务checks执行，记录新修订及当前候选；全量跨边界旅程归VERIFY，不以局部绿关闭父义务。
- [ ] **Step 6 [5 min]: Commit** 只交所属文件、原始RED/GREEN、版本与未验证项，移交唯一控制器集成；不得写业务phase或另起DAG。

### Task P5_2: F10正向明确另期

**Files:** services/delivery-control, test/delivery-control.test.js, test/delivery-cases/5_2.mjs
**Interfaces:** Comet.Run.managedDelivery.v1: same RunState/lock/transaction, no second currentPhase; SDD.Gate.v1: pure evaluate(inputs,receipts,policy), no dispatch; Knowledge.Closeout.v1: Kp before archive, Kt before overall completion; Runner.Dispatch.v1: trusted launcher binds run/gate/input/policy/attempt/epoch, worker cannot write control state
**Dependencies:** P5_1
**Owns:** services/delivery-control, test/delivery-control.test.js, test/delivery-cases/5_2.mjs
**Parallel safe:** true
**Acceptance IDs:** F10

原工作包身份：5.2.a, 5.2.b。当前修订：2026-10-26-comet-050-adoption-v1；未执行（F10另期NOT-EXERCISED）。

- [ ] **Step 1 [5 min]: Record** 保持原NOT-EXERCISED与未来启用条件，不建设Control API或扩大本期完成条件。
- [ ] **Step 2 [5 min]: Review** 不得把未启用拒绝负例算正向PASS，也不得让本期P5_3等依赖另期API。
- [ ] **Step 3 [5 min]: Commit** 保留F10未验处置和原ID，不提交API实现。

### Task P5_3: 运维与交接

**Files:** openspec/changes/delivery-foundation-rearchitecture/operations-runbook.md, openspec/changes/delivery-foundation-rearchitecture/team-recovery, test/delivery-cases/5_3.mjs
**Interfaces:** Comet.Run.managedDelivery.v1: same RunState/lock/transaction, no second currentPhase; SDD.Gate.v1: pure evaluate(inputs,receipts,policy), no dispatch; Knowledge.Closeout.v1: Kp before archive, Kt before overall completion; Runner.Dispatch.v1: trusted launcher binds run/gate/input/policy/attempt/epoch, worker cannot write control state
**Dependencies:** P5_1, I08
**Owns:** openspec/changes/delivery-foundation-rearchitecture/operations-runbook.md, openspec/changes/delivery-foundation-rearchitecture/team-recovery, test/delivery-cases/5_3.mjs
**Parallel safe:** true
**Acceptance IDs:** A10, A11, H09, N11

原工作包身份：5.3.a, 5.3.b。当前修订：2026-10-26-comet-050-adoption-v1；未执行。

- [ ] **Step 1 [5 min]: Test** 未知进程状态不得重启/删唯一工作区；不把本地锁假装分布式，不新增业务常驻服务；先观察真实RED，记录当前Run/版本/原始输出，不以缺环境当行为RED。
- [ ] **Step 2 [5 min]: Implement** 原命令/既有调度的恢复、升级/回退、知识维护、R10保留与必要依赖运维手册；复用现有模块和原生接口，最小GREEN。
- [ ] **Step 3 [5 min]: Verify** 保持原功能oracle，覆盖正向/拒绝/重复/失效/中断；执行现有公开seam的相关回归与实际读回，缺环境明确UNVERIFIED。
- [ ] **Step 4 [5 min]: Review** 独立Spec/质量审查；测试作者不签Whitebox；声明fixture/真实宿主/资源各自证明范围。
- [ ] **Step 5 [5 min]: Verify** 按execution-contract中本任务checks执行，记录新修订及当前候选；全量跨边界旅程归VERIFY，不以局部绿关闭父义务。
- [ ] **Step 6 [5 min]: Commit** 只交所属文件、原始RED/GREEN、版本与未验证项，移交唯一控制器集成；不得写业务phase或另起DAG。

### Task VERIFY: 同最终候选和实际Run全量验收

**Files:** openspec/changes/delivery-foundation-rearchitecture/verification-report.md, openspec/changes/delivery-foundation-rearchitecture/grill-report.md, openspec/changes/delivery-foundation-rearchitecture/verification-results.json, openspec/changes/delivery-foundation-rearchitecture/acceptance-index.json, openspec/changes/delivery-foundation-rearchitecture/execution-state.json, openspec/changes/delivery-foundation-rearchitecture/execution-ledger.jsonl
**Interfaces:** Comet.Run.managedDelivery.v1: same RunState/lock/transaction, no second currentPhase; SDD.Gate.v1: pure evaluate(inputs,receipts,policy), no dispatch; Knowledge.Closeout.v1: Kp before archive, Kt before overall completion; Runner.Dispatch.v1: trusted launcher binds run/gate/input/policy/attempt/epoch, worker cannot write control state
**Dependencies:** P0_1, P0_2, P0_3, P0_4, P1_1, P2_1, P3_1, P1_6, P1_2, P2_2, P2_3, P2_4, P2_5, I01, I02, P1_3, P1_4, P1_5, P3_4, I03, I04, I05, I06, P3_2, P3_3, P4_6, P4_7, P4_1, P4_2, P4_4, P4_5, I07, I08, P4_8, P4_3, P5_1, P5_2, P5_3
**Owns:** openspec/changes/delivery-foundation-rearchitecture/verification-report.md, openspec/changes/delivery-foundation-rearchitecture/grill-report.md, openspec/changes/delivery-foundation-rearchitecture/verification-results.json, openspec/changes/delivery-foundation-rearchitecture/acceptance-index.json, openspec/changes/delivery-foundation-rearchitecture/execution-state.json, openspec/changes/delivery-foundation-rearchitecture/execution-ledger.jsonl
**Parallel safe:** false
**Acceptance IDs:** A01, A02, A03, A04, A05, A06, A07, A08, A09, A10, A11, A12, A13, A14, A15, A16, A17, A18, A19, A20, B01, B02, B03, B04, B05, B06, B07, B08, B09, B10, F01, F02, F03, F04, F05, F06, F07, F08, F09, F10, C01, C02, C03, C04, C05, C06, C07, C08, D01, D02, D03, D04, D05, D06, D07, D08, E01, E02, E03, E04, E05, E06, H01, H02, H03, H04, H05, H06, H07, H08, H09, U01, U02, U03, U04, U05, U06, U07, U08, L01, L02, L03, L04, L05, L06, L07, L08, L09, L10, L11, M01, M02, N01, N02, N03, N04, N05, N06, N07, N08, N09, N10, N11, N12

原工作包身份：该节点原无子工作包；不新增身份。当前修订：2026-10-26-comet-050-adoption-v1；未执行。

- [ ] **Step 1 [5 min]: Test** 旧PASS/fixture/安装成功/诊断轮绿色/缺资源都不能填分母；F10另期保留，运行和原始终态必须同版本；先观察真实RED，记录当前Run/版本/原始输出，不以缺环境当行为RED。
- [ ] **Step 2 [5 min]: Implement** 执行本期129required/103场景及关联维护、独立Whitebox/Grill与三报告；随后原Comet唯一closeout和后审；复用现有模块和原生接口，最小GREEN。
- [ ] **Step 3 [5 min]: Verify** 保持原功能oracle，覆盖正向/拒绝/重复/失效/中断；执行现有公开seam的相关回归与实际读回，缺环境明确UNVERIFIED。
- [ ] **Step 4 [5 min]: Review** 独立Spec/质量审查；测试作者不签Whitebox；声明fixture/真实宿主/资源各自证明范围。
- [ ] **Step 5 [5 min]: Verify** 按execution-contract中本任务checks执行，记录新修订及当前候选；全量跨边界旅程归VERIFY，不以局部绿关闭父义务。
- [ ] **Step 6 [5 min]: Commit** 只交所属文件、原始RED/GREEN、版本与未验证项，移交唯一控制器集成；不得写业务phase或另起DAG。
