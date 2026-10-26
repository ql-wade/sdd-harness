# I01 — 必要资源与既有连接器登记（2026-10-26-comet-050-adoption-v1，wave 1）

- run：comet-convergence-20261024-r1（revision 2026-10-26-comet-050-adoption-v1）
- 起始 HEAD：48da1fe；node v22.13.1；工作目录 /Users/mac/Code/sdd-harness（共享工作树，多 worker 并行）
- 任务节：tasks.md "### Task I01"（Files/Owns 全集：registry.json / registry.schema.json / secrets.refs.example.json / qualification-policy.json / tools/infra/registry.mjs / tools/infra/secret-refs.mjs / test/infra-registry.test.js）
- 证据：本目录 `evidence/baseline-red.txt`、`evidence/green.txt`、`evidence/negative-checks.txt`、`diff.txt`

## 1. 完成范围（改动文件）

| 文件 | 改动 |
| --- | --- |
| `infra/delivery/registry.json` | ① comet-source 新增 `observation.adoption`（PENDING_RELOCK 登记）；② 新增资源 `llmwiki-project-stack`、`openspec-isolated-tools`；③ outline-managed-collection 的 `domain.runtimeStateLocation` 登记 `.sdd/outline/runtime`；④ authority.note 增补 pilot-contract.md 已核验事实引用 |
| `infra/delivery/secrets.refs.example.json` | 新增 2 个 purpose-bound 引用（均 NOT_PROVISIONED）：`llmwiki-curated-write`（publisher/svc:llmwiki）、`openspec-tools-local`（service/svc:runner） |
| `test/infra-registry.test.js` | 新增 3 个回归测试（采纳登记、知识栈登记不授权、登记不等于 ready）；既有 digest-binding 测试的硬编码 0.4.5 摘要改为从 registry 指向的 lock 动态读取（根因修复，见 §5 冲突） |

未改动：registry.schema.json、qualification-policy.json、tools/infra/registry.mjs、tools/infra/secret-refs.mjs（复用既有 Registry.v1/SecretRef.v1/Qualification.v1 接口，无需扩契约）。未执行 git commit/push、未启动任何服务、未访问任何凭据、无外部写。

## 2. RED 观察（Step 1）

`evidence/baseline-red.txt`：改动前 committed registry `validate` 本身是绿的（ok=true, exit 0）——RED 是语义缺口而非坏文件：登记中完全没有 comet-050 采纳状态与知识栈条目。只读探针（/tmp/i01-red-probe.mjs，对 committed registry 的观察）原始输出：

```
RED: comet-source adoption PENDING_RELOCK(0.5.0,relock=P1_1) missing; knowledge stack resource missing: llmwiki-project-stack; knowledge stack resource missing: openspec-isolated-tools; outline runtime state location not registered under .sdd/outline
exit=1
```

改动后同探针 exit=0（GREEN）。基线套件 node --test test/infra-registry.test.js 改动前 41 pass / 0 fail（不以缺环境当行为 RED）。

## 3. 登记项数（Step 2 实施语义）

- 资源：4 项（comet-source、outline-managed-collection 既有 2 项更新 + llmwiki-project-stack、openspec-isolated-tools 新增 2 项）。
- Comet 供给：`comet-source.observation.adoption` = {revision 2026-10-26-comet-050-adoption-v1, targetBaseline "0.5.0", status **PENDING_RELOCK**, relockOwner P1_1, patchDisposition 0001/0002 retired、0003→0005、0004 retired, amendmentRef}。**不含任何 0.5.0 commit/digest**（不虚构哈希）；note 明示 lockRef 内容是 P1_1 拥有的供给状态、本登记不断言其当前版本。
- 知识栈（登记=清单事实，非权限）：
  - LLMWiki：landing `.sdd/repos/llmwiki`（项目本地 SDD_HOME），lockRef→`infra/delivery/llmwiki/package.lock.json`（I04 既有观测：clone 075c5b4 RECORDED）。
  - Outline：`.sdd/outline/runtime` 落位写入既有资源 domain（同部署的运行态位置，非新权限）。
  - 隔离 OpenSpec 1.11.0：landing `.sdd/tools/openspec-1.11.0`（本机实测 installed version 1.11.0），lockRef→`infra/delivery/runner/image.lock.json`（P1_1 pin：tarball sha256 84820b17…，引用不重验）。
- 秘密引用：24→26（两个新 ref 均为占位 purpose-bound、NOT_PROVISIONED、不对应任何真实凭据）。
- 权限状态：project.authority.readbackStatus 维持 **UNVERIFIED**（未引用既有 latestIdentityObservation 之外新增任何"已授权"结论）；全部资源 audience/retention UNVERIFIED、autoCleanupEnabled=false。

## 4. 负向红线检查（evidence/negative-checks.txt，全 PASS）

- N1 adoption 载荷无 40-hex/sha256（不虚构哈希）；
- N2 全部 audience/retention UNVERIFIED、autoCleanup=false（服务账号可读/key 存在/本地目录存在不产生资格）；
- N3 authority.readbackStatus 仍 UNVERIFIED；
- N4 registry+refs 秘密明文与宿主路径扫描干净（.sdd/… 均为相对路径）；
- N5 登记≠就绪：qualify 两个新资源 exit 2、ready=false、license/image-digest 等 UNVERIFIED（llmwiki 的 clone commit 仅 RECORDED，source-digest 仍 UNVERIFIED）；
- N6 两个栈 observation.scope=KNOWLEDGE_STACK_INVENTORY_ONLY 且 landing 标注 not committed（本地目录不是权限/受众事实）。

## 5. 真实执行的验证命令与结果（evidence/green.txt）

- `node tools/infra/registry.mjs validate --json` → ok=true, 0 violations（registry+refs 联合准入）
- `node tools/infra/platform.mjs validate --json` → ok=true, 0 violations（I06 闭集 shape 准入）
- `node tools/infra/registry.mjs status --json` → 4 资源 lockPresent=true、各 5 项 retention 未确认（如实）
- `node --test test/infra-registry.test.js` → 44 pass / 0 fail（含 3 个新测试）
- `node --test test/infra-platform.test.js` → 47 pass / 0 fail
- `node --test test/infra-knowledge-authz.test.js test/knowledge-authorization.test.js test/knowledge-closeout.test.js test/knowledge-revocation.test.js` → 62 pass / 0 fail
- `node --test test/infra-monitor.test.js` → 17 pass / 0 fail
- `bash scripts/agent-instructions-check.sh`、`bash scripts/agent-skill-check.sh` → exit 0；静态 JSON（registry/refs/.mcp.json）PASS

## 6. 冲突与风险（需控制器/后续任务处理）

1. **并行 P1_1 重锁定竞态（最重要）**：wave 同波的 P1_1 已在共享工作树把 `integrations/comet/upstream.lock.json` 未提交地改为 0.5.0（commit aeb1a659…、sha256 0bb979cf…、patches 清空），导致：
   - `test/infra-runner-isolation.test.js`（I02 拥有）RW_RUNNER_BUILD/I02 多测失败（`UPSTREAM_LOCK_UNREADABLE`、upstream/image-lock 七补丁镜像失配）——属 P1_1/I02 车道，非本改动引入；runner validate 对我的 registry/refs 零违规（catalogGaps 空）。
   - 我拥有的既有 digest-binding 测试硬编码 0.4.5 摘要随之失效——已根因修复为动态读取 lock 实际值（绑定语义不变，不钉死供给版本）。
   - 全量 `bash scripts/check.sh`（含 npm test）当前在共享树上不可能全绿，按"不以局部绿关闭父义务"留归控制器集成与 VERIFY；本任务只声明窄范围绿。
2. **闭集字段契约**：I06 的 platform.mjs 对 registry 资源/项目字段做 UNKNOWN_FIELD 闭集校验；本登记的 adoption/landing 载荷因此放在既有允许的 `observation`（opaque object，与 outline-managed-collection 先例一致）与 domain.note/authority.note 文本内，未新增顶层字段。若后续任务需要结构化 PENDING_RELOCK 消费，应走显式契约修订（platform.mjs 属 I06）。
3. **未验证项**：llmwiki clone commit 对上游的独立确认（需网络证据，维持 RECORDED）；两个新 secret ref 无对应真实凭据（刻意 NOT_PROVISIONED）；outline 运行态位置仅为存在性观测；0.5.0 供给的 commit/digest/构建事实（P1_1 重锁定接纳后由 P1_1 回填，本登记不预写）。
