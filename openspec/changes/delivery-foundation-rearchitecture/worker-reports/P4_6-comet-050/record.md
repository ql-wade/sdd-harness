# P4_6 worker report — revision 2026-10-26-comet-050-adoption-v1

Task: P4_6 归档后同Run Kt恢复（comet-050）。本报告记录真实宿主执行：所有旅程都在钉版
0.5.0 供给（upstream aeb1a659 + 0005 Kt closeout patch，build de39629a…，钉版 node
24.15.0，钉版 openspec 1.11.0 经 COMET_OPENSPEC seam——唯一归档写者）上的一次性 /tmp
世界（隔离 HOME/TMPDIR、真实 CLI 子进程、真实 OpenSpec 归档移动、磁盘字节回读）。

## Scope honored（只改有效 Owns 文件 + 本报告目录）

- `test/delivery-cases/4_6.mjs`（重写为 comet-050 面；旧 0.4.5/0003 面整体消亡，见 RED）
- `openspec/changes/delivery-foundation-rearchitecture/team-recovery/comet-050-post-archive-kt-recovery-probe.json`（新增：四语义探针登记，按任务说明授权）
- 本报告目录 `worker-reports/P4_6-comet-050/`。未 commit；世界全部在 /tmp，测试后清理。

**Owns 清单偏差（如实声明）**：tasks.md 该节 Owns 还列有
`integrations/comet/patches/0003-post-archive-closeout.patch` 与
`integrations/comet/patches/tests/4_6.patch`——两个文件在本修订已被退休处置
（ADR-0022 B1：0005 是 0.5.0 基线上唯一补丁，0003 的最小后继），
`test/infra-runner-isolation.test.js` 明确断言二者必须不存在。重建它们等于分叉供给，
故本任务不创建（4_6.mjs 的 setup 测试反向钉住这一处置）。`test/knowledge-closeout.test.js`
属 P4_4 Owns 且当前 20/20 绿，本任务未改（其 Kt 协议语义已由 P4_4 覆盖；本任务只读消费
lib/adapters/{comet,spec,outline}.js）。

## 1. Record（读侧事实，源码级核对 + 活体探针）

- 0005 只改 `classic-resolver.ts`：`resolveClassicStepId` 在 `archived` 分支前检查
  `knowledgeCloseoutBlocked`（可选字段 `{required?,completed?}`，缺省/null 放行；仅
  `required===true && completed!==true` 阻断→停驻既有步骤 `full.archive.execute`）。
- **活体面事实（钉版 build dist 实测）**：resolver 的活体消费面是 classic Run
  （compat runtime：`comet state/check/archive` 公开命令族 + 变更目录状态文件）；
  组合包（sdd-managed-delivery）的 workflow stateSchema `additionalProperties:false` 且
  无 knowledgeCloseout 属性——组合面 start/initialState 无法携带该字段；`state set
  knowledgeCloseout.*` 被公开面拒绝 `CLASSIC_FIELD_UNKNOWN`（字段白名单实测）。即：
  **0.5.0+0005 供给上不存在任何公开命令写路径**，与 composition.json
  `knowledgeCloseout.writePath = "NOT IN THIS REVISION — supply/admission wave"`
  及 lib/adapters/comet-executor.js `ktCloseout().writePath=UNVERIFIED` 的声明一致。
- 归档后公开续行面（实测）：`comet state next demo` 在 archived=true 上仍 exit 0，
  `nextAction.kind='delivery'`，指引原文 "Do not archive again. Inspect recorded
  authorization and actual delivery…"——公开面自己从不宣称 completed、从不重复归档。
- compat 状态文件内嵌 RunState：无字段时 resolver 放行→run `status='completed',
  currentStep='completed'`（fail-open 的活体形态）；字段 required+pending 时 resolver
  停驻 `full.archive.execute`（reconcile 语义下 status 保持 running，不停驻 completed）。
- 重复 `comet archive` 幂等收敛（已归档重入 6/6 步 vs 首归档 8/8 步），归档目录恒 1。

## 2. RED（真实行为 RED，非缺环境）

钉版 node 跑修订前 4_6.mjs：**12/12 fail**
（`evidence/RED-pre050-old-face.txt`）。全部是 0.4.5/0003 面在 0.5.0 供给上真实消亡：
lock 不含 0003（setup 断言失败）、`state init <change> full --managed-delivery` 被
0.5.0 usage 拒绝（H02/H06/H03…）、`dispatch-gate`/`knowledge-publish`/`resume-probe`
等命令面不存在。与 P3_3 记录的同类 RED。

## 3. 四语义实测表（GREEN：pinned node 6/6、host node 6/6；49 行 proof 全钉）

世界：真实 classic Run 经公开 `comet state`/`comet check` 面从 open 驱动到
archive-confirm（Kp 以 sealCloseout 在归档前落印——单 closeout owner、复验
phase/verify_result/archive_confirmation），再经 managed spec adapter（P3_4 组件，只读
消费）发起真实 `comet archive`（openspec 1.11.0 执行规格同步+变更移动，恰一次）。

| 语义 | 测试点 | 实测结果（真实 CLI + 钉版 dist resolver + 磁盘字节） |
| --- | --- | --- |
| a) 归档后同 Run 发现 pending Kt、completed 被阻 | KTA | 真实归档完成（1 个归档目录、主规格同步、readback ok）且 run_id 逐字节稳定（CLI `state get`＝managed inspect/recover＝磁盘状态文件投影，三面一致）；归档后 `state next` 仍发现同 Run（kind=delivery、"do not archive again"，绝非完成宣称）；**0005 活体**：钉版 build 的 dist classic-resolver 以该 Run 的真实 ClassicState+真实 evidence 求值——`{required:true,completed:false}` → `full.archive.execute`（停驻，非 completed）；字段缺省/null/非必需 → `completed`（fail-open 逐字保留）；managed recover：同 runId、archived、overallCompletionEligible=false |
| b) Kt 补齐后 completed | KTB | 同一真实状态 + `{required:true,completed:true}` → resolver `completed`；lib 镜像谓词（lib/adapters/comet.js）在同一真实状态上 5 行真值表全等（absent/null/pending/done/not-required）；三重合成完成判定（resolver completed ∧ 镜像不阻 ∧ ledger 满足）＝true；**写路径如实记录**：所用面＝0005 头部声明的 managed host layer 内存字段契约 + 活体负向证明——`state set <change> knowledgeCloseout.completed true` 被公开面拒绝 `CLASSIC_FIELD_UNKNOWN`（持久化写字段＝供给/接纳波次义务，未伪造） |
| c) 重复触发不重复归档/发布 | KTC | managed closeout 重复→`reconciled='already-archived'`、**native=null（零派发）**、同 runId、归档目录恒 1、主规格字节稳定；`state next` 重放×3 全部 kind=delivery 稳定；**真实重启**：全新 bin/comet.js 子进程（钉版 node）重入 `archive demo`→exit 0、归档目录仍 1、主规格字节稳定、子进程 `state get run_id` 同 runId；第二次 Kp seal 被拒 `ARCHIVE_ALREADY_SEALED`（单 closeout owner；上游幂等收敛不等于第二写者） |
| d) unknown 维持原 handle | KTD | 发布超时→`buildTimeoutObservation` 保持原 operationKey/documentId；目标 id 派生确定（重派生恒等，重试重定向固定文档、不铸第二逻辑页）；ledger 判定 `PUBLICATION_UNKNOWN`（"unknown is never absence"，同 Run 恢复入口持续发现原 pending operation）；非可执行 directive（readback/reconcile）被拒 `DIRECTIVE_NOT_EXECUTABLE`（恢复只能读回原 operation）；异 documentId directive 被拒 `TARGET_ID_MISMATCH`；unknown 上铸回执被拒 `PUBLICATION_UNKNOWN`；双独立信道读回同一 operation→`exists`→ledger 满足、回执 target=原文档 |

逐行证据：`evidence/scenario-proof-post-archive-kt.json`（49 行 proof + 23 条命令日志）；
探针登记：`team-recovery/comet-050-post-archive-kt-recovery-probe.json`。

实施中修复的真实缺陷（自研 harness，非上游）：初版把外层测试注册在场景子进程也会执行
的路径上（`node file.mjs --kt-scenario` 下 node:test 自执行注册的测试）→ 递归扇出。
按 3_4 的纪律把外层测试全部收进 `else` 分支后根治（这正是 3_3/3_4 的既有模式）。

## 4. 相邻回归（真实命令与结果）

| 命令 | 结果 |
| --- | --- |
| `~/.nvm/versions/node/v24.15.0/bin/node --test test/delivery-cases/4_6.mjs` | **6/6 pass, 0 fail**（evidence/GREEN-4_6-pinned-node.txt） |
| `node --test test/delivery-cases/4_6.mjs`（host node v22.13.1，场景子进程自动解析钉版 node） | **6/6 pass, 0 fail**（evidence/GREEN-4_6-host-node.txt） |
| `node --test test/delivery-cases/3_3.mjs`（host node，P3_3 记录的运行方式） | **11/11 pass, 0 fail**（evidence/adjacent-3_3-host-node.txt） |
| `~/.nvm/versions/node/v24.15.0/bin/node --test test/delivery-cases/3_4.mjs` | **9/9 pass**（自带锁版 node 前置；evidence/adjacent-3_4.txt） |
| `~/.nvm/versions/node/v24.15.0/bin/node --test test/delivery-cases/2_4.mjs` | **24/24 pass**（evidence/adjacent-2_4.txt） |
| `node --test test/delivery-cases/3_2.mjs` | **13/13 pass**（evidence/adjacent-3_2.txt） |
| `node --test test/knowledge-closeout.test.js`（P4_4 面，只读消费其适配器） | **20/20 pass**（evidence/adjacent-knowledge-closeout.txt） |
| 新增 JSON 按 check.sh 纪律 python3 json.load 校验 | 全部 OK |

已知相邻敏感（先在、非本任务造成，已留档）：3_3 的角色链四用例（V_A10/A11/F07/A12b）
对父 node 版本敏感——钉版 node 下 fixture 套件以 unverified 入账致 gate blocked
（evidence/adjacent-3_3.txt + NOTE-adjacent-3_3-node-sensitivity.txt）；host node 下
11/11 绿，与 P3_3 记录一致。本任务未改 3_3 消费的任何文件。全量 `npm test` 未跑
（时间盒；直接相邻面全绿，且 P2_4 已记录 infra-runner-isolation 的先在失败属供给重锁波次）。

## 5. UNVERIFIED / 边界（如实登记）

- **真实 Outline 发布 API**（create/update/读回打真实例）：本切片的对象是 runtime
  publish ledger 上的判定层（P4_4 组件，只读消费）；活体写+读回归 P4_4/P4_8 与部署验证波次。
- **knowledgeCloseout 状态字段的持久化写路径**：0.5.0 公开面拒绝该字段写（活体负向已证）；
  受管接纳写入属供给/接纳波次（composition.json/executor 均如此声明）。停驻行是在钉版
  build 的 patched resolver seam 上以 Run 真实状态+真实 evidence 求值证明——不是伪造的
  状态文件（写入状态文件会被 classic 面以 unknown field 拒绝，已核实）。
- **组合包 Run 面走到归档**：R→P 切片归 P3_2；组合包完整到归档旅程与 Kp 扩展活体拒绝
  归 P4_4/VERIFY（组合包 stateSchema 现不含该字段——写路径并入同一波次）。
- 同 Run 旅程分母冻结（journey recipe freeze）与全量跨边界旅程归 VERIFY，不以局部绿关闭父义务。
- H02/H03/H05/H06/H08/H09 的 0.4.5 断言面已随旧面消亡：其中 H03/H06 的 same-Run
  单写者/旧证据语义已由 P3_3 C050 组合面证明；H04/H05 的文档身份/冲突语义由本任务 KTD
  与 P4_4 knowledge-closeout 套件承接；H08/H09（丢失状态不伪造/跨机权威）归 I08/VERIFY。
- 我未执行 Step 4 独立 Spec/质量审查（review 归独立评审人）；Whitebox 签名不在本 worker。

## 6. 交接

- 改动文件（绝对路径）：`/Users/mac/Code/sdd-harness/test/delivery-cases/4_6.mjs`（重写）、
  `/Users/mac/Code/sdd-harness/openspec/changes/delivery-foundation-rearchitecture/team-recovery/comet-050-post-archive-kt-recovery-probe.json`（新增）、
  本报告目录 11 份证据文件。
- 后续消费点：VERIFY（旅程分母冻结 + 活体 Outline 窗口 step 9）；P4_4/P4_8（真实 Kp→归档→Kt
  端到端与外部发布）；供给/接纳波次（knowledgeCloseout 持久化写路径 + 组合包 stateSchema 决策）。
