# I05 worker report — revision 2026-10-26-comet-050-adoption-v1

Task: I05 代码Wiki与可选Graph（tasks.md "### Task I05"）。
处置依据：amendment `replans/2026-10-26-comet-050-adoption/amendment.json`（无 I05 专属 delta，处置即 tasks.md Step 2 /
infrastructure-tasks.json I05.green："按真实需要自托管deepwiki-open并绑定repo/commit；CodeGraph默认可关闭"）。
本次为**核验+登记**，不强制部署；真实需要未出现，故**未部署**（不做无需要的部署）。

Scope honored: 只改 I05 Owns 文件 + 本报告目录。实际 diff（125 insertions, 0 deletions，未 commit）：
- `infra/delivery/code-knowledge/deepwiki-profile.json`（+19：新增 service.knowledgeAuthority/knowledgePolicy 与顶层 deployment 登记）
- `tools/infra/code-knowledge.mjs`（+36：WIKI_KNOWLEDGE_AUTHORITY_FORBIDDEN 门、validateWikiDeployment 登记门、validate 回执 deployment 读回、qualify 新类别 wiki-deployment-demand）
- `test/infra-code-knowledge.test.js`（+70：新登记断言测试，含 4 个负例）
未改：compose.yaml、images.lock.json、graph-profile.json、repository-scope.json（无新事实，原登记仍准确）；
未 commit、无对外网络写、未动 mcp-capabilities.yaml（P1_3 所有）。

## 1. Record（读侧事实，2026-10-26）

- I05 节 + amendment + infrastructure-tasks.json I05（red/green/probes）+ execution-contract V_INFRA_I05
  （command=`node --test test/infra-code-knowledge.test.js`，cli_contract 0/1/2，UNVERIFIED 不得 skip 转绿）已读。
- 前次执行（run impl-dfr-20261020-r1，commit 9458bfd；I05-convergence rework）已交付全部 7 个 Owns 文件：
  上游已固定 `https://github.com/AsyncFuncAI/deepwiki-open` @ `3e0f503b0cc815c1525a063911524d233bda2400`（MIT），
  镜像 digest-pinned `ghcr.io/asyncfuncai/deepwiki-open@sha256:90a0cfaf…`（digestAuthenticated=false）、
  compose 仅声明（loopback 端口、internal 网络、无 host bind、镜像只经 lock 占位符解析）、
  graph 默认 enabled=false、repository-scope deny-by-default 且 approvedSources 为空。
- 本次盘点（evidence/supply-inventory.txt）：**本地无任何 deepwiki-open 供给或部署** ——
  `.sdd/repos/` 仅 llmwiki；docker daemon 可用（29.6.2）但无 deepwiki/codewiki 容器、镜像、卷；
  `infra/delivery/registry.json` 无 code-knowledge 资源条目（registry 只登记已供给资源）。
  ⇒ NOT_DEPLOYED 是真实观察，不是缺环境。

## 2. Implement（登记增量；无部署动作）

1. **NOT_DEPLOYED + 按需部署条件登记**（deepwiki-profile.json 顶层 `deployment`）：
   - `status: NOT_DEPLOYED`、`noNeedNoDeployment: true`、`onDemandTrigger.status: NOT_TRIGGERED`；
   - 触发条件（真实需要）=「设计阶段实际消费代码解释：当设计任务需要超出静态阅读可得的代码解释、且现有本地事实不足时」；
   - 四项准入前置如实登记（digest 认证、批准源授权、upGate 开启、凭据供给——当前全部未满足）；
   - 本地供给盘点观察记入 `localSupplyObserved`，证据指向本报告。
2. **"不把代码Wiki当正式团队知识"从隐式变显式机器检查**：
   - profile 新增 `service.knowledgeAuthority: false` + knowledgePolicy（Kp/Kt 与团队知识库权威不由它承担）；
   - 工具新增翻转门 `WIKI_KNOWLEDGE_AUTHORITY_FORBIDDEN`（缺失/翻转 true 均违规，exit 2）；
   - 与 freshness fail-closed（FRESHNESS_POLICY_UNSET / SOURCE_NOT_AUTHORIZED / COMMIT_MISMATCH_STALE /
     COMMIT_AGE_EXCEEDED / COVERAGE_INSUFFICIENT，manifest 级通过也整体保持 UNVERIFIED）共同构成
     "新鲜度/来源不明不能充当设计事实"的登记+断言双落点（既有测试全覆盖，本次引用不重复实现）。
3. **部署登记门**（validateWikiDeployment）：
   - 登记缺失 → `WIKI_DEPLOYMENT_STATUS_UNREGISTERED`；
   - NOT_DEPLOYED 但触发条件缺失 → `WIKI_ON_DEMAND_TRIGGER_UNREGISTERED`；
   - 未过 upGate 准入自称任何已部署状态 → `WIKI_DEPLOYMENT_STATUS_NOT_ADMITTED`。
4. **读回 oracle**：validate 回执 `wiki.deployment{status,onDemandTriggerRegistered,knowledgeAuthority}`；
   qualify 新类别 `wiki-deployment-demand` = RECORDED（按需部署事实），receipt 保持诚实 ready=false。
5. **CodeGraph 默认关闭 + 禁Graph仍正确不阻流程**：既有登记核验有效——graph-profile `enabled:false,status:DISABLED,
   removable:true,gateAuthority:false,knowledgeAuthority:false`；`probe --case graph-disabled-correctness`
   真实重跑主校验链（非读开关文本），本次实测 exit 0 / VERIFIED / violations=0；正交性（fixture 打开 enabled 主链仍绿）
   与权威翻转负例均已有测试钉版。

## 3. Verify（钉版运行；原始输出见 evidence/）

- RED 先行：新登记测试在实现前真实红（`evidence/red-registration-test.txt`：100 tests / 99 pass / 1 fail，
  断言 `service.knowledgeAuthority` undefined）——行为 RED，非缺环境。
- Own suite：`node --test test/infra-code-knowledge.test.js` → **100/100 pass, exit 0**（`green-own-test.txt`）。
- 四个钉版 probe（infrastructure-tasks.json I05.probes）：
  1. `node --test test/infra-code-knowledge.test.js` → exit 0；
  2. `node tools/infra/code-knowledge.mjs validate --registry infra/delivery/registry.json --json` →
     exit 0，ok=true，VALIDATED，回执含 deployment 读回（`green-probe-validate.json.txt`）；
  3. `probe --case pinned-code-wiki --json` → exit 2，executed=false，UNVERIFIED，liveReadback=false
     （无端点/manifest，fail-closed 如实；`unverified-probe-pinned-code-wiki.txt`）；
  4. `probe --case graph-disabled-correctness --json` → exit 0，executed=true，VERIFIED（`green-probe-graph-disabled.txt`）。
- 附加 oracle：`up` → exit 2 `UP_REFUSED_IMAGES_LOCK_NOT_READY`（`up-refusal.txt`）；
  `qualify` → exit 2，ready=false，unverifiedCount=8（RECORDED×3 / UNVERIFIED×8，无 VERIFIED）。
- 消费方回归：`test/knowledge-closeout.test.js` 20/20 exit 0（`green-consumer-knowledge-closeout.txt`）；
  delivery-cases 1_4（11/13）/1_5（5/6）仅 setup 两类失败，stash 本任务三文件后基线复现同一失败
  （comet patched build "six locked patches" 0!==6，P1_1/P1_2 域共享树在途状态）——**非 I05 归因，零新增失败**
  （`green-consumer-delivery-cases.txt` + `preexisting-delivery-case-failures.txt`）。
- `bash scripts/check.sh` 未跑绿：其全量回归含上述共享树既有红（I06 报告同类记录）；I05 相关切片全绿，
  归一控制器在一致树上执行。

## 4. NOT_DEPLOYED / UNVERIFIED 清单（诚实缺口，不得读为已做）

NOT_DEPLOYED（按需部署，未触发真实需要）：
1. deepwiki-open 运行时实例：无容器/无端点/无生成记录；compose 仅声明。
2. 本地源码供给：`.sdd/repos/` 无 deepwiki-open。

UNVERIFIED（本地不可证，均已在域文件登记且 qualify 如实报出）：
1. 镜像 digest 独立认证（digestAuthenticated=false；公共 OCI 元数据≠运行时/来源权威）。
2. 上游发行物/API/启动契约执行时核验（SELECTED 仅固定公共源码+镜像元数据）。
3. 源摄入授权（approvedSources 空，authorizationEvidence UNAUTHORIZED；deny-by-default）。
4. 凭据供给（3 个 secret-ref 全部 NOT_PROVISIONED）。
5. wiki 生成 manifest 与新鲜度实测（策略阈值未定 → FRESHNESS_POLICY_UNSET fail-closed）。
6. API/MCP 私有认证/分页/版本暴露读回（无实例）。
7. CodeGraph coverage 证据（停用期间不要求也不声称）。
8. 备份/恢复演练。

## 5. Risks / handoff

- 按需触发是登记条件而非自动机制：设计阶段出现真实代码解释需要时，须先满足四项准入前置
  （digest 认证→批准源→upGate→凭据），工具链已按此顺序 fail-closed 拒绝。
- `localSupplyObserved` 是 2026-10-26 时点观察；若后续有人手工起容器，registry/域文件不会自动感知，
  需重跑盘点并更新登记（deployment.status 翻转受 WIKI_DEPLOYMENT_STATUS_NOT_ADMITTED 门约束）。
- 共享树在途改动（1_4/1_5 setup 六补丁失败）归 P1_1/P1_2 worker；集成时以一致树重跑。
- 未 commit（边界）；唯一控制器集成时提交 3 个 Owns 文件 + 本报告目录。
