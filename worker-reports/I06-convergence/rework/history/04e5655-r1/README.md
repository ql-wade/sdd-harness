# I06 生产链关联返工

基点04e565564652ad0f312dc96b0de95d89401ad2cc；本包只覆盖原I06 construction返工。Root仍是唯一控制器与进度写点。whole I06、comet-managed-v2、source/control actor及同Run平台/知识终态仍UNQUALIFIED；正式case关闭0，授权范围没有增加。

## 修复依据与行为

Spec指出：完整候选run只有31时，artifact回指999且SHA相同仍被标为matchesCandidate并exit0；run缺workflow_id同样exit0。先以原公开CLI健康对照亲见exit0，再分别得到0≠2的有效RED；没有用缺工具或新模块缺席代替行为RED。

现在run按完整workflow库存的ID关联，要求原run ID、候选SHA、登记repository/source repository ID及workflow路径一致；路径同时支持裸文件名和GitHub返回的@ref形式。artifact只有在完整候选run集中找到原生产run、仓库和SHA一致时才能matchesCandidate。当前run回指的artifact若换成旧SHA，不能藏成历史制品。历史不同run/不同SHA的ZIP元数据仍可观察，但matchesCandidate=false。漏页/完整集合未知不接受一个有效前缀。

原健康fixture补充的是GitHub实际响应中的head_repository和path；它们没有被当作授权或签名。run.conclusion=null的queued状态、历史artifact.digest=null可保留为合法元数据；null/missing source repository或workflow_run不能推定生产身份，分类UNVERIFIED/OBSERVED_WITH_GAPS并exit2。字段来源见[workflow runs](https://docs.github.com/en/rest/actions/workflow-runs?apiVersion=2022-11-28)、[artifacts](https://docs.github.com/en/rest/actions/artifacts?apiVersion=2022-11-28)。没有新增伪造的trusted/source证明字段。

## 同生产链消费盘点

| 消费点 | 已证明的观察边界 | 未证明的运行/交付义务 |
| --- | --- | --- |
| workflow/run | 完整库存ID、登记仓库/source ID、当前SHA、workflow路径一致 | workflow批准、原生Run/attempt、source/control actor权威仍未核验 |
| check | 当前SHA及返回check/app ID元数据 | appID/name不能证明可信check来源，未据此批准生产者 |
| artifact | 原生产run属于完整候选集，repo/source/SHA一致；ZIP digest与OCI digest继续分开 | metadata/digest字符串不证明ZIP原字节、签名/来源或生产attempt；OCI独立读回与signing/provenance仍属既有接口/owner |
| deployment | 只投影登记仓库路由下的ID/SHA；UNSELECTED占位不能成为已登记环境 | GitHub部署记录不含已认证原Comet operation、制品字节及独立业务终态，productionCorrelation始终UNVERIFIED |
| 本地IntegrationIdentity/OCI/target | 本轮未改其原有project/SHA/digest/correlation拒绝语义，直接消费者及rollback回归实际重跑 | 本地链仍LOCAL_ONLY；HTTP只作已登记目标的观察传输，首版CLI+固定Runner不因此新增常驻服务；目标保持UNSELECTED |

[GitHub deployment API](https://docs.github.com/en/rest/deployments/deployments?apiVersion=2022-11-28)的部署记录不是目标业务读回。没有访问Registry/环境、live GET、策略写、push、dispatch、部署、回滚或secret API。

## 实际作者自检

- 第一片：健康对照1过、两个目标反例2失败，RED exit1；最小关联修复后同3例GREEN。
- 第二片：原健康/合法nullable/已有拒绝共3过，源/路径/状态/冲突和未选环境10个真实反例失败；修复后同链15/15。
- 最终：原79项加17项生产链/完整性/nullable矩阵，96/96，0fail/0skip；必要rollback切片6/6。Node固定v24.15.0，父与裸node子进程同bin/PATH均已实际校准。
- 未重跑原95宽组或全仓。P5_3原两项runbook/旧报告门失败仍保留，未跨owner修复或豁免。

commands.json逐项记录UTC、准确argv/cwd/inputSHA、退出码和原始/显示日志SHA。绝对路径原始字节只留ignored .local/platform-convergence/rework/04e5655-r1；本包是标明转换规则的便携显示副本，不能冒充raw stdout。生成显示副本时一度保留TAP空白行尾，git show --check返回非零；只在显示副本去除行尾空格，raw字节与SHA不变。此格式失败不计业务RED。原始04e提交的62文件（61个索引项和索引自身）、50份raw、10受保护材料、5项活配置、5份平台登记均已逐项比较，字节未变。当前原始/显示Hash与bytes见evidence-index.json和observations.json。

新canonical TestPack留ignored，test-pack.display.json仅是显示副本；PACK_STRUCTURE_VALID只证结构与引用，不是独立验收。Root双轴复审与串行接纳仍待执行；不改canonical tasks/DAG/contract/锁/台账/ACL，不自签运行通过。
