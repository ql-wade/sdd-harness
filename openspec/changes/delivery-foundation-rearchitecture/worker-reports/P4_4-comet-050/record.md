# P4_4 worker report — revision 2026-10-26-comet-050-adoption-v1

Task: P4_4 实际Kp到归档到Kt知识闭环（comet-050）。本报告记录真实宿主执行：闭环在钉版
0.5.0 供给（upstream aeb1a659 + 0005 Kt closeout patch，build de39629a…，钉版 node
24.15.0）的一次性 /tmp 世界里跑通——真实 classic Run（公开 `comet state`/`comet check`
面驱动 open→verify→archive-confirm）→ Kp 真实写入（I04 供给的 LLMWiki stdio MCP 活体会话）
→ 真实 `comet archive`（钉版 openspec **1.15.0**，COMET_OPENSPEC seam，透明调用日志证明
恰一次）→ 同 Run Kt pending 发现 + 活体 Outline 401 拒绝路径。

## Scope honored（只改 Owns 文件 + 本报告目录）

- `test/delivery-cases/4_4.mjs`（重写为 comet-050 闭环面；旧 0.4.5/0003 面整体消亡，见 RED）
- `test/knowledge-closeout.test.js`（+1 活体往返测试；原 20 项语义全保留全绿）
- `lib/adapters/llmwiki.js`（`invokeMcpPublish` 对齐活体验证的 JSON-RPC 形状——见 §3）
- 本报告目录 `worker-reports/P4_4-comet-050/`。未 commit；世界全部在 /tmp，测试后清理。

Owns 清单其余文件未改：`lib/adapters/outline.js`/`code-wiki.js`/`lib/sdd-paths.js`/
`tools/mcp/llmwiki.sh`/`lib/knowledge-seed.js`/`bin/cli.js` 本任务只读消费（其语义已被
既有 20+61 项相邻绿灯钉住）。组合包（integrations/comet/application/**）零改动——R3 已
定型，本任务只读消费其 packaged validator。

## 1. Record（读侧事实）

- **P4_6**：归档后同 Run Kt 恢复四语义已证（resolver 停驻/镜像真值表/幂等重入/unknown
  handle）；其 UNVERIFIED 清单点名本任务：真实 Outline 发布与组合包到归档旅程。
- **P4_7**：`publication-surface-registration.json`（rev comet-050）已登记——kpSurface
  = 项目内 stdio MCP（无需外部授权，BOUNDARY_REGISTERED）；ktSurface = 外部受管文集发布，
  **五个 requiredEntries 全部 NOT_PROVISIONED**（protected issuance / source permission
  readback / target audience 五通道 live readback / publisher credential 物化 / …）。
- **I04**：LLMWiki 供给活体已核验（venv python 3.11.13 + mcp SDK 1.27.0，protocolVersion
  2025-11-25，10 工具，create/read/search round-trip + native SQLite 读回一致）。
- **I03**：Outline 本地栈 API 可达（http://127.0.0.1:3000；未认证 API 拒绝）。
- **openspec 钉版对齐**：本任务按修订指令用 **1.15.0**
  （`.sdd/tools/openspec-1.15.0`，`--version` 实测 1.15.0）——与 3_4（spec-adapter 家族
  的当前 pin，`OPENSPEC_CLI` 同路径）一致；P4_6 记录的 1.11.0 是该任务自己的 seam 快照，
  toolchain-baseline 的 1.11.0 条目属历史 comet-build 期钉版。差异如实登记，不默默选边。
- 组合包六门扩展含 `knowledge-project-closeout`（gate Kp @ full.verify.check.evidence，
  artifactRef `.sdd/delivery/gates/kp/receipt-bundle.json`，validator
  `sdd.delivery.gate.kp`，judgment 委托 lib/delivery/gate.js evaluate）。

## 2. RED（真实行为 RED，非缺环境）

钉版 node 跑修订前 4_4.mjs：**6/6 fail**
（`evidence/RED-4_4-pre050.txt`）——全部是 0.4.5/0003 面在 0.5.0 供给上真实消亡（lock 不含
0003 的 setup 断言失败→`state init --managed-delivery` usage 拒绝→drive 失败→六个用例连锁
崩），与 P4_6/P3_3 记录的同类 RED。`knowledge-closeout.test.js` 基线 **20/20 绿**
（`evidence/RED-knowledge-closeout.txt`——判定层基点，不是 RED，是回归基线）。

## 3. 闭环实测表（GREEN：钉版 node 全绿，33 段 proof 全钉）

世界：真实 classic Run `demo`（公开 state/check 面）+ 隔离 HOME + COMET_OPENSPEC→
openspec-1.15.0（外裹透明调用记录器）+ 一次性 LLMWiki workspace。

| 闭环段 | 实测（真实进程/字节） | 结果 |
| --- | --- | --- |
| **Kp 作者+冻结** | 知识作者**子进程**（pinned node）产出正文（frontmatter capability/source + 3 行可复用经验），sha256 冻结；digest 与字节重算一致 | PASS |
| **Kp 独立审查** | 另一**子进程**（exec 独立身份）复核：digest 绑定、经验行齐、frontmatter 齐 → pass 回执 boundPayloadDigest=冻结 digest | PASS |
| **Kp MCP 真实写入** | Python 子进程（venv python + mcp SDK ClientSession）spawn 真实 `local_server`：initialize（**2025-11-25**，server LLM Wiki 1.27.0）→ tools/list（10 工具，含 create/read/search）→ list_knowledge_bases → **create**（活体验证参数 knowledge_base/title/content/tags/path）→ read → search | PASS（create 响应含 `/wiki/concepts/closeout-order.md`） |
| **Kp 读回一致（三信道）** | ① MCP 会话 read：响应以冻结正文**逐字节结尾**；② 磁盘文件（filesystem is truth）：sha256==冻结 digest；③ 独立进程只读 native SQLite：documents 行 digest==冻结 digest（version 1）+ chunks_fts MATCH 命中 | PASS（三信道同字节） |
| **Kp 判定层** | `buildKpOperation` 确定性 operationId；`buildKpCloseoutReceipt` 只从确认读回铸造 `{id,digest}`；真实 `bin/cli.js knowledge-closeout` 判定：**kp.ok=true**（对真实 MCP 写入的 wiki）、kt 阻断 NO_PUBLISH_OPERATION、exit 2 | PASS |
| **Kp 组合扩展（verify.check.evidence）** | packaged `sdd.delivery.gate.kp` validator（bindings.mjs→lib/delivery/gate.js evaluate，R3 冻结包只读消费）：launcher 签发 verifier dispatch→evidence envelope（含三信道证据 uri+digest）→admitEvidence（independent-acceptance）→evaluate **pass**；validator **accepted=true**；同一 payload 无回执 → **refused MISSING_OBSERVATION: archive/knowledge-closeout-verified**（3_2 拒绝面的活体正面对照）；扩展声明工件写入 `.sdd/delivery/gates/kp/receipt-bundle.json`（writeProtocolFields 全字段，内容寻址 digest 绑定） | PASS |
| **归档** | `sealCloseout`（Kp 在**归档移动之前**落印，单 closeout owner）→ managed spec adapter `closeout` → 真实 `comet archive` → **openspec 1.15.0 恰被调用一次**（调用日志 `archive demo --yes`，1 条）；归档目录恰 1、主规格同步（旧 scenario 保留 + Audit trail 新增）、readback ok、**同 runId**、overallCompletionEligible=false；Kp bundle 字节归档后稳定 | PASS |
| **Kt 同 Run pending 发现** | 归档后 `state next`＝kind delivery（"do not archive again"，无完成宣称）；0005 resolver 以真实归档状态+真实 evidence 求值：required+pending → 停驻 `full.archive.execute`（非 completed）；managed recover 同 runId、archived、不满足整体完成 | PASS（P4_6 机制在本闭环内复证） |
| **Kt 活体 Outline 发布** | 对本地栈真实 POST `documents.create`（固定派生 documentId、deriveOutlineTargetId 确定性）→ **HTTP 401 `authentication_required`**（逐字记录）；无 publisher 凭据（P4_7 ktSurface 五条目 NOT_PROVISIONED）→ 如实 **UNVERIFIED-NEEDS-GRANT** | 401 路径 PASS；授权发布 UNVERIFIED |
| **Kt 账本/授权面** | publish ledger pending → `evaluateKtFromLedger` 阻断 **PUBLICATION_UNKNOWN**（"unknown is never absence"，同 Run 持续发现原 pending operation）；真实 `knowledge-authz decide`（committed policy/ledger/model，**无 fixture 覆盖**）→ exit 2 **deny AUDIENCE_OUTSIDE_INTERSECTION**（交集空 fail-closed——P4_7 授权前提清单的活体形态） | PASS |

逐段证据：`evidence/scenario-proof-knowledge-closeout.json`（33 段 proof + 20 条命令日志，
含 MCP 会话输出）。

### llmwiki.js 供给事实对齐（Owns 内的实施修复）

- 旧 `invokeMcpPublish` 的 create 参数 `{kb,name}` 是从未对活体验证的猜测形状；活体形状是
  `{knowledge_base,title,content,tags,path}`（create）/`{knowledge_base,path}`（read），且
  initialize 协议版本实测为 **2025-11-25**（非 2024-11-05）。已对齐。
- **活体发现的真缺陷并修复**：真实服务器并发处理工具请求——一次性写入 create+read 帧会让
  read 抢在 create 提交前执行而报 not-found（复现 1/3 概率）。改为顺序会话纪律（每帧等前一
  帧响应），stress 6/6 稳定；`RESPONDED` 现携带 `createText`/`readbackText`/
  `readbackConsistent`（read 字节后缀 + digest 复核），settle 点是 read 回帧（D06：读回不
  可选）。TIMEOUT/LAUNCHER_UNAVAILABLE 语义不变（原 20 项测试全绿证）。

## 4. 验证（真实命令与结果）

| 命令 | 结果 |
| --- | --- |
| `~/.nvm/…/v24.15.0/bin/node --test test/delivery-cases/4_4.mjs` | **5/5 pass**（GREEN-4_4-pinned-node.txt） |
| `~/.nvm/…/v24.15.0/bin/node --test test/knowledge-closeout.test.js` | **21/21 pass**（GREEN-knowledge-closeout.txt；复跑 x2 仍 21/21，stability 文件） |
| `~/.nvm/…/v24.15.0/bin/node --test test/delivery-cases/4_6.mjs` | **6/6 pass**（adjacent-4_6-pinned.txt） |
| `node --test test/delivery-cases/4_6.mjs`（host node） | **6/6 pass**（adjacent-4_6-host.txt） |
| `~/.nvm/…/v24.15.0/bin/node --test test/delivery-cases/3_4.mjs` | **9/9 pass**（adjacent-3_4.txt——同 1.15.0 seam 的 spec-adapter 家族不破） |
| `node --test test/adapter-quoting.test.js test/foundation-distribution.test.js test/infra-llmwiki-paths.test.js test/classic-integration.test.js test/delivery-test-contract.test.js` | **192/192 pass**（llmwiki 消费邻域） |
| `node --test test/knowledge-revocation.test.js test/infra-registry.test.js` | **61/61 pass** |
| 新增/产物 JSON python3 json.load 校验 | OK（scenario-proof） |

已知先在（非本任务造成，已留档）：`5_1.mjs` 12/14（两处失败：acceptance-index 分母漂移
+ architecture.md 裁决标记缺失——读的是并行在跑工件，本任务零改动；**stash 本任务三文件后
复跑仍 12/14**，note-5_1-preexisting.txt）。全量 `npm test` 未跑（时间盒；直接相邻面与
llmwiki 消费邻域全绿；P2_4 已记录 infra-runner-isolation 的先在失败属供给重锁波次）。

## 5. UNVERIFIED / 边界（如实登记）

- **授权 Outline 发布 + 多信道读回**：无 publisher 凭据（P4_7 ktSurface 五条目全
  NOT_PROVISIONED）；活体未认证尝试被 401 拒绝并逐字记录。前置清单 = P4_7
  `publication-surface-registration.json#ktSurface.requiredEntries`（protected issuance
  workflow / source permission readback / 五通道 target audience live readback / publisher
  credential 物化 / auto-publish 链路）。
- **knowledgeCloseout 状态字段持久化写路径**：0.5.0 公开面拒绝该字段写（P4_6 活体已证）；
  停驻行在本任务以钉版 resolver seam + 真实归档状态复证（KT_RESOLVER_PARKED）。
- **组合包 Run dispatch 面到归档**：本任务证的是 classic Run + packaged Kp validator
  （repo-side 只读消费面，与 comet-executor 同一入口）；组合包完整 dispatch 旅程到归档归
  VERIFY。
- LLMWiki launcher 的 managed-host 接纳（真实宿主经注册入口发现）仍属 I04 接纳条件；
  本任务证明的是组件 stdio 供给面（与 I04 同口径）。
- 同 Run 旅程分母冻结与全量跨边界旅程归 VERIFY，不以局部绿关闭父义务。
- 我未执行 Step 4 独立 Spec/质量审查（review 归独立评审人）；Whitebox 签名不在本 worker。

## 6. 交接

- 改动文件（绝对路径）：
  `/Users/mac/Code/sdd-harness/test/delivery-cases/4_4.mjs`（重写）、
  `/Users/mac/Code/sdd-harness/test/knowledge-closeout.test.js`（+1 活体测试）、
  `/Users/mac/Code/sdd-harness/lib/adapters/llmwiki.js`（invokeMcpPublish 活体形状+顺序会话）、
  本报告目录 11 份证据文件。
- 后续消费点：VERIFY（闭环旅程分母 + 授权 Outline 窗口）；P4_8（外部发布监控/备份面）；
  供给/接纳波次（knowledgeCloseout 持久化写路径）；I04 接纳（launcher 宿主发现）。
