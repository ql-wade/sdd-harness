# I05 公开输入盘点

本轮沿原 I05，基点 afae696。公开入口 validate / qualify / up / probe（pinned-code-wiki 与 graph-disabled-correctness）经过同一配置输入、项目、语义准入；形状校验先于 map/find/includes/属性读取。本表同时保留后续目标约束；manifest全字段及实际HTTP/MCP生产者尚未完成，不能按输入盘点声明为实现。

| 输入 | 消费与约束 |
| --- | --- |
| argv/options | 固定命令与 option 白名单，重复/缺值/未知/位置参数拒绝；错误结构化，不回显值 |
| registry / refs | 项目 id、GitHub immutable ID/fullname/principal；I01 共享 refs validator；null/非数组/空元素/未知版本先拒绝 |
| 四份域 JSON | schemaVersion1、interface/kind、项目绑定；lock components 对象与唯一组件；wiki service/upstream/provider/generation/freshness/access；graph source/coverage/removable/lifecycle；scope 与 approvedSources 全部元素 |
| Compose | 固定原生服务、镜像锁引用、loopback、具名卷、独立网络、实际 backend/frontend ports 与持久目录；Graph 为可选独立件，不能成为 Wiki 启动依赖 |
| manifest | 已有本地声明的生成状态、immutable ID、commit、阈值/时间检查；完整类型/覆盖/未来时间/来源证明与真实生成manifest生产者仍待后续I05；本地声明通过不能升级为真实来源或动作grant |
| endpoint | 本轮只校验无 userinfo 的 loopback HTTP origin、无路径/query/fragment，不再隐式发API；后续获准probe才接固定原生health及真实读取，须禁redirect，非2xx/未知不能变成健康或不存在 |

源码与镜像布尔字段只表示登记，不能使 qualify/up 报真实资格。源 status 字段不签发 source/provider/Reader grant。旧项目索引、错误 commit 或生成失败保持拒绝。默认配置不进行摄入/模型调用，未经当前角色/范围验证不得变成第二执行主控。

公开上游只读观察与本地 fixture 分开；raw 原样保存在本工作树 ignored .local/I05-convergence，tracked 命令/cwd/PATH 用显式占位映射并记录 raw metadata SHA。不会读取/重跑旧 I01/I03 owner-key 脚本，也不借其它项目凭据。
