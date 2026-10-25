# I03 建设边界与输入盘点

基线 2a45bb414cb4d72b9f2a48e00390c6ae8b81f441 / codex/comet-outline-qualification。主合同 4414780d… / case 56e3967c…，当前129 checks /103 cases；I03 只消费 I01 已双审建设工件，不继承动作/凭据权限。

公开入口为 validate/qualify/up/probe/stop。读取 registry、refs、四份 JSON 域文件、Compose/env 文本、可选 publish-request 和 endpoint。先校验所有被消费的对象/版本、components/collections/redirectUris/readers 等数组及元素、嵌套 owner/audience/provider/client/state/contracts，之后才允许 map/find/循环/诊断字符串转换。请求文件 null/数组/错误嵌套不能导致 TypeError；缺文件/坏JSON为输入错误，已解析的非法结构为验证拒绝。

qualify/up 必须消费 validate 的全部违规；镜像 digestAuthenticated 与旧 upGate/admittedBy 文本只作声明，不能产生实际资格或动作授权。任何 HTTP timeout/403/409/5xx 不能当作 absence 或盲重建/覆盖。所有输出统一秘密形状和宿主路径脱敏。未知/重复 CLI options 不应被忽略。

collection/parents/page/groups/shares/public 构成必需有效受众闭包，搜索/附件属于独立访问通道；分页必须完整、无重复/缺页，principal 必须可映射。无独立 Reader/Publisher/Isolator/Issuer 和真实浏览器/渠道证据时，保持 UNVERIFIED；本地请求判断不能替代活 ACL。

本轮可直接执行的真实观察仅限既有项目的无凭据 _health、受限容器/镜像元数据、静态安装源码和配置字段名/存在性。c5c538…是已消耗的一次历史三 API 观察，不刷新、不重跑；不读取 key、env 值、cookie/session，不创建 token/user/docs/ACL/grant，不启停/部署。

原生静态源码已确认 Outline 1.11.0，license 为 Business Source License 1.1；create schema/handler接受 id、update schema接受 lastRevision。静态支持不等于实际 create UUID、409、登录、附件或恢复通过，后续计划必须精确授权并验收。

Compose 需要验证脚本规则与实际参数装配两层：项目独立网络/具名卷/loopback、各服务实际必需配置引用，而非仅存在服务名。真实部署的秘密绑定、OIDC主体映射、对象存储访问、数据/附件重启恢复仍需独立资格，模板/组件 fixture 不关闭 whole I03。
