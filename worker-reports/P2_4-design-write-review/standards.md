# P2_4 独立 Standards 审查

结论：**APPROVE_FOR_CONSTRUCTION_ONLY**。已确认规范违规0项；无高置信度 Fowler smell 需阻断。仅支持这份窄修建设工件，whole P2_4、真实身份/权限、业务场景均未接纳。Spec 轴由另一独立审查员负责，本报告不代签。

候选 `5ec97b25db76241658b16f64e2eda1468da07424`，base `9c9b70b92f1c5f548c5f84cad24c644657a4c30d`；fingerprint `40de314253079e045ab09445ef8f6e52fc28f1ee9c5e0d023c359de89a0eb814`。按 `git diff 9c9b70b...HEAD` 审查，单提交、工作区前后干净。

规范依据：`AGENTS.md` §1/4/5/7（范围、单一事实源、依赖最少、fail closed、控制面验证）、README、scaffold-architecture、ADR-0015/0020、skill-architecture。相关范围未找到额外 CONTRIBUTING/CODING_STANDARDS 或局部 AGENTS。

## Standards 核查

- `0002` 中 registered test-intent 新许可位于原 fixed host authorizeWrite、原 HMAC verifyDispatch、同 Run、signed allowedPaths 之后；再要求 Design、当前 R、原 protected-path inspector 与精确 grant。未把 prefix、惯例文件名或邻居 grant 变成新许可。登记 setter 调用原 host 与 authority fence，旧字段/路径校验和归档拒绝保留。
- lexical project target 在 physical external exemption 前保留归属；archive/control 规则先行，受管物理逃逸关闭式拒绝。真外部/普通非 managed 对照保留，未把 scope exemption 描述成作者授权。`isManagedControlPath` 复用同一规则，无第二策略源。
- A/T 指引消费当前 phase；Design 留在已有作者修订及原 Runtime 独立重审，Build/Verify 保留原 event，未知 phase 不猜 transition。Schema、transition table、host 接口及 requiredGates/computeGateInputs 与官方6da逐字节一致。无新 phase/queue/ledger/持久字段、依赖或方法正文改动。
- 新测试沿公开 Native guard/CLI 边界，保留负例和原断言。正例是固定 fixture execution/tool/path map 加真实本地 HMAC；appendFileSync 仅是 fixture 数据变更，报告明确没有冒作实际 Tool.Write/作者身份。原 P2_5 host 未替换。

## 独立证据核对

实际只读重算3份源、26份展示报告、200份原始证据及全部 **47,244** distribution 条目，哈希/类型/执行位或 link target 一致；重算 fingerprint 一致。所有15轮 raw stdout/stderr/display 及输入前后摘要匹配，失败与测试准备错误均保留。原44/44零skip、原生345通过/4个Windows条件skip、generated三族0的记录一致；**本审查未重新执行这些运行测试**。

官方0003、4_6、upstream.lock 与 base 一致；主6da选定源码/入口/manifest六项与既存保全摘要一致。`git diff --check` exit2仅报1844/1919两个单空格 unified-patch context DATA，非新增TS尾空白；未改DATA以掩盖输出。

核对数据：`/private/tmp/P2_4-design-write-standards-evidence-20261026.json`，SHA256 `5edb58b7bc6b6a3aaac6ea07e6394573a4ea5a9f1fbaf2ed30dceb4b998587ec`。Core原始 stdout SHA `bcf6559be43680218ec8793b779e387400967337b6fd93aae5b549ebaf8f873f`；native原始 stdout SHA `086f2cba9f4f8d248262a1941e0f4520830215ac654a43b66fab094bc73cb4f3`。

## 接纳边界

hostname/env 同 Run fence 仍不证明可信进程内每个调用者是 Controller；原 requireRunAuthority 的兼容行为未改，不能凭其名字宣称完整 actor 权限。真实 protected bootstrap/每动作当前授权、实际 author/controller launch与角色 principal、I02 OS/mount/独立凭据及真实 Edit-Shell-MCP 正负链、方法来源/应用、并发/死亡恢复、平台/知识旅程仍须独立资格化。当前0.4.5/40de工件不代表官方0.5选型或旧证据可继承。

未改任何源码、锁、计划、主配置、原始证据或 I02 候选；未执行 Docker、模型、API、秘密操作，未创建 worker/Goal。审查时间 2026-10-25T16:52:45.833251+00:00。
