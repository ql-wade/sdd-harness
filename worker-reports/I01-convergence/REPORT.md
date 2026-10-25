# I01 收敛返工交接

I01 的登记、秘密引用和拒绝门代码已可审查；I01 整体运行资格仍未完成。本报告不接纳业务场景、不更新原任务/DAG/台账，不关闭 Comet 当前 profile 的任何完整旅程。

基线：`36fcf5c4780dc4caa2b85a98b5d0bf70c360af97`。分支：`codex/comet-registry-qualification`。只修改 I01 的七个独占实现/配置/测试文件和本报告目录。事实来源是主检出的当前 HANDOFF、tasks I01、infrastructure-plan/tasks、原 DAG 和已通过的架构回执；文件摘要见 `evidence/authority-inputs.json`。隔离树里的旧任务状态不继承。

## 本次改动

- `registry.mjs`：validate、status、qualify、up 共用登记准入；拒绝空白 owner/用途、缺失或无效 GitHub 身份、无效资源/域/恢复字段。锁引用检查同时覆盖 `..`、现存 symlink、缺失文件的 symlink 父目录及悬空 symlink。自动清理缺少 destructionPrecondition，或该值只是带空白的 UNVERIFIED，均拒绝。
- `registry.mjs`：缺少 npm/docker/tar/gh 或子进程失败时返回结构化不可核验结果，修复 nullable stderr 的崩溃；回执绑定实际 registry、ref catalog、policy、lock 和已提供工件摘要。锁中缺少 digest/size 时保持 UNVERIFIED。缺少独立平台/健康/恢复证据的原因不再误称服务不存在。
- `secret-refs.mjs`：解析前校验整个目录，拒绝空白用途、重复绑定、null 条目；拒绝输出中的凭据形状值和宿主路径。普通 Agent 的 publisher/isolator 访问仍拒绝。合法声明绑定也只返回 UNRESOLVED，不返回值。
- `registry.schema.json` 与 qualification policy 同步边界；配置中保留历史认证失败，另列新鲜身份观察，避免把当前读回或标签当作长期动作授权。
- 只登记已核验的 Comet 源和本项目 Outline 文集。24 个 purpose-bound refs 仍是 NOT_PROVISIONED。现有 OIDC/DB/S3 配置仅登记项目内入口与字段名/存在性，未读取、保存、复用值，也不声称隔离树拥有该配置。

## 实际证据

| 证据 | 实际结果 | 边界 |
| --- | --- | --- |
| GitHub 只读 API | repo `1285806550` / `ql-wade/sdd-harness`、caller `262266039` / `ql-wade` 均匹配 | 仅操作者身份；无 CI 修改、发布或签发授权 |
| Outline process / health | 本项目容器 healthy；固定 image ID；`/_health` 200 / OK | 健康不证明受众或动作权限 |
| Outline DB 元数据 | 固定 owner/team/collection 关系匹配，owner 未停用，文集未归档 | 原观察未读取 key 值；DB 元数据不替代 HTTP 资格 |
| 本次三 API 专项核验 | 原控制器经人授权、独立脚本审查和宿主审批实际执行一次，exit 0；owner/team/collection 匹配，permission=null、sharing=true；直接用户成员只有 owner/admin，分页完整 | 只调用 auth.info、collections.info、collections.memberships；不能推出完整 groups/继承/分享受众，更不授予 publisher/isolator/issuer |
| Runner 观察 | controller 容器存在，但 exit 1 且未配置命令 | Docker 并未缺席；本节点没有启动或修改 Runner |

三 API 原始白名单报告 SHA256 为 `c5c538218fe6d48ba2cc066b82247a36e8a72fd362c11518490e9095e3e60c99`，与本目录副本完全相同。白名单实际为 10 个字段。历史两次自动审批拒绝均保留在 `evidence/http-qualification-block.json`；两项拒绝动作当时都未执行，之后仅原控制器按新的明确人授权执行限定动作。授权引用、计划、执行脚本和控制器回执的摘要都在该文件，未以本地授权文件自批。

探针只位于被忽略的 `.local/I01-convergence/`，未进入交付接口：默认 dry-run；读取 key 前断言固定 app image 和 `127.0.0.1:3000` 的实际容器映射；SQL 只读并实时检查删除/过期/停用与 owner/team/collection；hash-only 不恢复、不创建 token；HTTP 禁任意 URL/重定向。key 只在本地管道及进程内存，stdout 仅常量状态，报告只保留白名单元数据。授权读 API 的原生 activity/SSO 记账如实保留，不代表调用写 API。工人未重复执行核验。

## 实际执行的验证

| 命令/用例 | 结果 | 证据 |
| --- | --- | --- |
| 原始代码的私有重放，运行新增十项公开接口控制 | 0/10 通过，10 项真实行为 RED；非环境缺席充当 RED | `evidence/baseline-red.txt`、原始代码摘要及 log provenance |
| 新增缺失锁的 symlink 父目录控制；清理前置 UNVERIFIED 空白控制 | 各 1 项真实 RED，修复共享根因后纳入同一回归 | `evidence/lock-parent-red.txt`、`retention-trim-red.txt` |
| `node --test test/infra-registry.test.js` | 最终 36/36，0 fail、0 skipped | `evidence/registry-green.txt` |
| `node --test test/infra-platform.test.js test/infra-knowledge-authz.test.js test/infra-runner-isolation.test.js test/infra-monitor.test.js test/infra-backup-restore.test.js test/infra-recovery.test.js` | 98/98，0 fail、0 skipped | `evidence/related-green.txt` |
| `python3 -B .local/I01-convergence/outline-readonly-probe-selftest.py` | 8/8，全模拟，无真实 DB/HTTP | `evidence/probe-review-and-selftest.json` |
| `registry.mjs validate --json` / `status --json` | 均 exit 0 | `evidence/registry-command-results.json` |
| `registry.mjs qualify --resource outline-managed-collection --json` / `up --resource outline-managed-collection --json` | 均 exit 2，ready=false；up 确实拒绝，无服务启动 | 同上及逐条原回执；这是拒绝门验证，不是资格通过 |
| `git diff --check`、两个 `.mjs` 的 `node --check`、JSON parse | 通过 | 工具实际执行记录；最终文件摘要见 manifest |
| `bash scripts/check.sh` | exit 1；规则层和技能层先通过，Whitebox fixture 在受保护 `.agents/` 内 `os.utime` 得 EPERM，未进入后续总回归 | `evidence/repository-check.json`；未放宽断言、未改 vendored 快照 |

测试只使用私有 fixture，finally 清理。真实、模拟与声明证据分别保存；日志副本规范化宿主/fixture 路径、假凭据形状和尾部空白，原始 log 在 `.local/I01-convergence/`，原始/规范化 SHA256 可逐一核对。最终登记数据更改后的 36 项回归已确认进程终止且 exit 0；98 项关联回归在实现/测试代码未再改变的版本完成，之后仅补入登记元数据与报告。

## 原 I01 子项的完成边界

| 子项 | 本工人交付 | 未完成 |
| --- | --- | --- |
| Step 1 测试 | 保留原 26 项，新增十项公开行为及两组进一步边界，真实 RED→GREEN | 当前 profile 场景/检查的最终业务接纳不在此测试结论中 |
| Step 2 实现 | schema、只读解析、共同准入与资格拒绝门；无秘密值输出 | 真实 service secret-store/运行时挂载和全部组件的完整资格证据没有就绪 |
| Step 3 独立读回 | 新鲜 GitHub 身份和本次限定 Outline HTTP 证据齐全 | 仍无完整受众、动作 grant、全部平台/许可证/恢复兼容证据；代码独立复审待原控制器接纳 |
| Step 4 提交 | 仅自有路径提交/交 diff，由原控制器串行合入 | 不自行勾选任务或关闭环境义务 |
| Step 5 当前登记 | 已证实的项目/源/文集/owner 与三 API 可读性登记；用途和 action authority 分开 | 24 refs 未 provision；完整受众未知；其它组件不凭模板冒充已登记资源 |
| Step 6 当前证据 | 真实拒绝、回归、观察、授权历史、摘要可复查 | I01 整体 ready、独立审查和 VERIFY 同一 Run 完整旅程尚未通过 |

## 交回原 owner 的具体缺口

| 缺口 | 配置/责任入口 | 解锁条件 |
| --- | --- | --- |
| Outline 登记事实冲突 | I03 / P4_7：`infra/delivery/outline/collection-registration.example.json` 与 `infra/delivery/knowledge/authorization-model.json` | 前者仍是实例/文集/owner 未登记，后者引用该示例却声明历史 LIVE。由 owner 统一正式登记，不能让历史通道观察继承为本 profile 资格 |
| 完整受众与动作授权 | I03 / P4_7，正式源域/文集登记和独立服务身份 | 逐渠道当前证据；独立 publisher/isolator/issuer 最小授权及授权核验。owner 可读、permission=null、sharing=true 均不能替代 |
| 24 个运行时引用 | 本项目真实 secret-store/受控挂载入口；配置定位已在 refs 目录，实际角色和凭据由对应基础设施 owner 提供 | 受限服务主体、用途/项目隔离和实际授权读回。不得借用此次 owner key 或其它项目材料 |
| 组件资格 | 各组件 owner 的 lock/源工件、平台、许可证、API/恢复证据 | 当前通用资格入口未收到可独立核验的整套证据，保守为 UNVERIFIED；受管 image/health 的观察不能替代完整 Qualification.v1 |
| 备份与保留 | I08 / 有权资源 owner；registry retention | backupOwner、RPO/RTO、保留期、加密 owner、销毁前置及恢复演练确认前，autoCleanup=false |
| Runner 运行 | I02：Runner image/compose/entrypoint | 修复实际 exit 1 / 无命令，证明角色隔离和受控执行；不归因为 Docker 缺席 |
| 仓库总检查 | 原控制器/相应验证 owner | 按宿主规则完成受保护 Whitebox fixture 的总检查；本工人不越界修改快照或将失败当通过 |

以上未完项全部保持未完成，不因基础设施已存在、fixture 绿色或只读核验成功而放宽关闭条件。
