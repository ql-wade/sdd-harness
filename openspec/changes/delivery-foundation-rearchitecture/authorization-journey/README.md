# authorization-journey（P4_7）

知识预授权（U01–U08）的旅程登记与真实试点登记记录。契约：
`openspec/changes/delivery-foundation-rearchitecture/knowledge-preauthorization-contract.md`（G04 自动发布边界已确认）。

## 文件

- `pilot-registration.case.json` — 试点源域/目标/owner/grant 的**真实登记**（返工 r1）：
  目标侧（实例 URL、不可变文集 id、principal 映射、渠道级受众读回）来自试点 Outline 栈的
  真实 API 读回；源侧（gh TLS x509）与受保护签发工作流如实 UNVERIFIED。
- `preauthorization.journey.json` — U01–U08 每场景的入口、活体面与预期拒绝/放行码；
  验证绑定 `verification-case-plan.json` 的 U01..U08（case_module `test/delivery-cases/4_7.mjs`）。

## 入口

- 决策面：`node tools/infra/knowledge-authz.mjs validate|verify-grant|revoke|decide|recheck|resolve --json`
  （退出码 0/1/2；无 --now——时效永远按真实时钟判定）
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
