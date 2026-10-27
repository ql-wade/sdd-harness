# authorization-journey（P4_7）

知识预授权（U01–U08）的旅程登记与真实试点登记记录。契约：
`openspec/changes/delivery-foundation-rearchitecture/knowledge-preauthorization-contract.md`（G04 自动发布边界已确认）。

## 文件

- `pilot-registration.case.json` — 试点源域/目标/owner/grant 的**真实登记**（返工 r1）：
  目标侧（实例 URL、不可变文集 id、principal 映射、渠道级受众读回）来自试点 Outline 栈的
  真实 API 读回；源侧（gh TLS x509）与受保护签发工作流如实 UNVERIFIED。
- `preauthorization.journey.json` — U01–U08 每场景的入口、活体面与预期拒绝/放行码；
  验证绑定 `verification-case-plan.json` 的 U01..U08（case_module `test/delivery-cases/4_7.mjs`）。
- `publication-surface.journey.json` — 修订 2026-10-26-comet-050-adoption-v1 的
  **发布面登记**（谁有权发布什么给谁）：预授权文集域四维度如实
  UNVERIFIED/STRUCTURAL_ONLY/HISTORICAL_PARTIAL；Kp 面（LLMWiki，项目内 stdio MCP，
  外部授权 NOT_REQUIRED、边界登记）；Kt 面（Outline 受管文集，外部 grant REQUIRED，
  五条所需条目全部 NOT_PROVISIONED）；三条负向红线（作者不自批/不经本面改权限策略/
  不从数据库抄 owner key）全部是评估器断言。登记工件：
  `infra/delivery/knowledge/publication-surface-registration.json`（validate --surface 核验）。

## 入口

- 决策面：`node tools/infra/knowledge-authz.mjs validate|verify-grant|revoke|decide|recheck|resolve|authorize-policy-change --json`
  （退出码 0/1/2；无 --now——时效永远按真实时钟判定；authorize-policy-change
  对全部主体一律 POLICY_MUTATION_NOT_AUTHORIZED 且零写入）
- 组合面：`lib/adapters/knowledge-authorization.js`（程序化外壳，零授权逻辑）
- 用例：`node --test test/delivery-cases/4_7.mjs test/knowledge-authorization.test.js test/infra-knowledge-authz.test.js`
- 验证器：`node tools/verify/delivery-journey.mjs --scenario U0x --profile managed-pilot --evidence-dir <dir> --json`

## 活体证据边界（诚实标注）

- 目标侧已活体观测：成员=仅 owner、分享登记表=0、member/offboarded 全通道 403、
  owner 写+独立读回 200、stale revision 409（证据：`worker-reports/P4_7-rework/evidence/`）。
- attachment 渠道 UNVERIFIED：`attachments.create` 500（S3 region 未配置，部署波次基础设施
  缺口）——注册保持 PARTIAL；LIVE 受众宣称缺任一渠道即 `TARGET_CHANNEL_NOT_READ` fail-closed。
- 源侧权限读回 UNVERIFIED（gh TLS x509）；台账 `disclosureAudience` 保持空=未登记，
  committed decide 对源侧仍 fail-closed。LOCAL_FIXTURE 只可签组件结果（回执 provenance
  `DECLARED_ONLY`），绝不冒充活体闭包。
- 修订 2026-10-26 现况：外发授权（14 旧 + 15 新一次共识）与 Outline owner key
  一次只读核验均已消耗，不重跑、不挪用；本修订仅做了无凭据 loopback 可达性观测
  （2026-10-27T03:05Z，health 200、未认证 API 拒绝——可达≠发布权≠受众/grant/动作授权，
  证据 `worker-reports/P4_7-comet-050/evidence/loopback-probe.json`）。
