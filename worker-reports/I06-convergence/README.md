# I06 平台资格与最小只读接线候选

本候选沿原I06任务/唯一DAG，基点2509fe9；只改原7个owned文件及本交接目录。Root唯一串行合入，Comet唯一业务主控。当前只是输入准入、真实只读观察器和后续动作计划，**I06 whole、profile与正式F06/F09/A13–17/A19/B08/N10仍未验收**。

实际新增：所有validate/qualify/probe先消费相同闭合版本/类型/nullable/nested/duplicate/unknown与I01 refs/policy角色检查；无效refs不得触发外部I/O。IntegrationIdentity保持旧本地机制接口，但跨项目、原operation不符、歧义check都阻断；无版本的历史本地链只作LOCAL_ONLY兼容，不授运行或平台权。显式支持旧生产者approvedBy元数据和null previousApprovedDigest，未批准/无保留项仍拒绝。

只读GitHub接口先核个人operator与登记repo/owner ID，固定GET白名单和GitHub主机，不从响应URL/秘密locator构造请求。所有分页记录ID/计数/next边界，非2xx、超时、漏页、异仓next或缺ID保持未知；候选SHA、workflow/run/check、制品SHA/digest和部署ID逐项关联。GitHub ZIP artifact digest和OCI image digest分开。分页协议与artifact字段依据[GitHub REST分页](https://docs.github.com/en/rest/using-the-rest-api/using-pagination-in-the-rest-api)、[Actions artifacts](https://docs.github.com/en/rest/actions/artifacts)。

已实现登记OCI和独立目标GET读回，拒绝跳转/URL凭据/越界路径，响应有界；OCI manifest/config按原字节重哈希并读revision label，**标签本身不证明构建来源，签名/来源仍UNVERIFIED**。[OCI Distribution](https://github.com/opencontainers/distribution-spec/blob/main/spec.md)、[Image Manifest](https://github.com/opencontainers/image-spec/blob/main/manifest.md)是协议来源。独立目标必须精确匹配project/environment/candidate/digest/原operation和注册的业务终态；不能用容器健康代替。当前两类实例仍UNSELECTED，实际没有访问任何Registry/目标或凭据。

## 真实事实

2026-10-25 08:38:08–08:38:18 UTC，正常gh仅GET：账号262266039/ql-wade与repo1285806550匹配；master=cd646185…且protected=false。protection详情404保持UNVERIFIED，不能把非2xx等同不存在。ruleset集合0、2活动workflow，52条旧SHA的live-integration check（1queued/51cancelled），artifact/deployment集合本次观测均0。旧TLS/INVALID只留history；新operator可读不等于CI/source/control运行主体就绪或admin写授权。

另一次当前本地intake SHA2509fe9 GET在08:53:01–06 UTC得到422，记录CANDIDATE_READBACK_UNVERIFIED，不推断提交不存在。旧SHA check不能给它放行。所有真实请求/结果与离线测试分账，见evidence/live-*；当前没有required check登记、保护写、push/PR/merge/dispatch/部署/回滚操作。

旧远端live-integration workflow349307181的cron是17 18 * * *，还接workflow_dispatch/workflow_call，命令npm run test:e2e:live:nightly。quality-gates349307182的3个job是core-e2e/claude-reference-adapter-e2e/preview-adapter-smoke；早期评论“仅preview”是过滤器漏数字的错误，已纠正。blobSHA和最小源码投影在remote-workflow-projection.json。没有取消、修改或触发它们，是否替换归P4_1具体授权。

## 作者验证

真实有效RED包括：无效refs直达网络、版本绕过共同准入、跨项目/正常响应错correlation、candidate非2xx早返假成功，以及V8短私密片段诊断回显。原错误/失败保留。私密诊断改静态label/code，不靠token形状regex；外仓fullname、未受信路径、原server body不再回显。长marker弱测试与一次fixture语法错误均不计行为RED。

最终固定NVM Node24.15.0且PATH同bin：I06加直接消费者79/79、0fail/0skip，rollback兼容切片6/6。一次更宽直接批次95项89过/6失败：4项是本次严格形状对旧本地rollback载荷的兼容缺口，已在own代码显式修复；其余2项P5_3 runbook旧报告门缺席，未改跨owner源码/断言也未豁免。没有重跑无关全仓。79/6是组件与本地机制证据，不是平台或同Run验收。

原始UTC/cwd/argv/PATH/inputSHA/exit/stdout留ignored .local/platform-convergence/raw；本目录仅便携显示副本，observations列raw/display hash和bytes。canonical TestPack在ignored test-pack.json（绝对trusted-root必须留原始审计），test-pack.display.json只供查看，不可直接当原包验证；已实际PACK_STRUCTURE_VALID，但不代表业务通过。

## 后续实际动作

[platform-action-plan.json](platform-action-plan.json)给出固定repo/master、建议保护context delivery-gate/checks、CI分支/验证分支、当前SHA到CI/OCI/目标的关联、6类主体与purpose refs、额外未登记policy-admin ref建议、每步授权/唯一Comet operation/回退与独立读回。它是未执行的可审查方案，不是授权。

阻塞项必须补真实登记：CI/source/control运行身份、保护策略和check/app/attempt来源、独立OCI及签名/来源机制、隔离环境真实endpoint/owner/业务oracle、retention与已批准rollback材料。现refs的NOT_PROVISIONED不能因operator可读而升级。真实writer仍属P4_1/P4_2；Source/control actor及secret-store使用由既有I01/I02/P1_3边界核验，I06不读取/复制值。

本树冻结contract dff53…/case56e396…；Root后续67f06…仅改MCP注册所有权，I06不rebase/刷锁/编辑MCP三文件。保留39/69/130/104及本期129/103分母，未改canonical/tasks/台账/Root锁或其它owner，5项活配置摘要不变。P4_1早读source/refs与P5_3 runbook问题作为typed intake交回，未跨改。
