# P2_4 Design 写门与返工指引窄修

输入 `9c9b70b92f1c5f548c5f84cad24c644657a4c30d`。仅修改原 P2_4 两个补丁和公开用例，沿原 DAG。候选 fingerprint 为 `40de314253079e045ab09445ef8f6e52fc28f1ee9c5e0d023c359de89a0eb814`，通过原六补丁顺序和原官方构建工具生成；官方 0003、4_6 和 upstream.lock 未改。旧主树 6da 与首个 2699 候选保留，Root 后续独立审查及受控主重建尚未执行。

## 结果与边界

- 完整 **Core44：44/44，零 skip**，包含原38项及新增6组；相关原生4文件 **345通过、4个Windows条件跳过**；classic/native/entry三族generated检查全部通过。精确命令、实际cwd、UTC、输入前后摘要、退出码和原始/显示哈希见 [runs.jsonl](runs.jsonl)。
- managed `test_intent` 登记复用固定host与原同Run authority fence，原相对/受保护路径与字段校验保留。无host standalone和foreign environment不能重指；原可信Runtime正常登记可用。该fence只比较既有hostname/env绑定，**不证明同一可信进程内每个调用者的Controller身份或OS隔离**。
- 新写许可先经过现host对固定执行/工具的判定、真实HMAC、同Run和原路径范围；再要求Design、当前R、受保护登记目标与**精确签名allowedPaths项**同时成立。目录prefix、惯例文件名、另一个文件的grant都不能产生新许可。登记后链接/目录类型错误返回拒绝。
- 实测发现登记testIntent/designDoc、源文件、普通文档、控制与archive词法目标都能借symlink被旧physical external exemption放行。修复统一保留词法归属并拒绝受管项目目标的物理逃逸，复用原owner/control规则；真正外部和普通非managed对照维持原语义。这个external scope结果**不是受管作者授权**。
- A/T在Design拒绝后指向已有作者修订及原Runtime的新独立审查；Build/Verify保留原repair事件。缺/无效阶段只提示读回。实际Native拒绝输出、Design非法transition仍拒、Verify原事件和同Run均已执行。未新增phase、queue、ledger、持久field或digest输入。

## 证据层级

作者正例使用单独的、严格固定执行/工具/路径映射及原 `createLaunchAuthority` 真实fixture HMAC。默认映射为空仍拒绝，readonly记录即使有有效HMAC也不能写；**它不是实际Native作者launch、宿主Tool.Write通道或OS身份资格证据**。原P2_5 false host未改，也没有把其fs.appendFileSync绿链冒作身份验证。真实author/controller per-action授权、I02/P1_3隔离、方法实际应用、平台和知识旅程、whole P2_4仍UNVERIFIED，业务场景接纳数0。

三个真实RED链：01无host setter居然exit0；03合法fixture HMAC请求被Design旧写门拦且拒绝提示非法event；07/08六类词法目标的escape。04纯数据phase表为6失败/2通过。02的fixture输出scope/JSON通道错误和11的错误CWD分别属于测试准备失败，原字节保留，未计行为RED。私有缓存先装build后prepare的SOURCE_BASELINE_DRIFT也单独保留。最终44项只在未变40de完整跑一次，随后generated读回；未运行全scaffold回归。

最终Core stdout SHA256：`bcf6559be43680218ec8793b779e387400967337b6fd93aae5b549ebaf8f873f`。注册字段/HMAC/调用点见 [caller-map.json](caller-map.json)；转换表、state schema、host接口与输入摘要体的字节不变见 [source-boundaries.json](source-boundaries.json)。原生skip四项仅Windows case-variant，未当作通过。

## 保全与交接

旧I04 224 个索引文件及P3 179 个记录逐字节一致；主/工人各7个活配置前后相同，main无写入。官方6da选定源码、Runtime入口和distribution manifest一致。详见 [preservation.json](preservation.json)。原始证据及各版本位于ignored `.local/P2_4-design-write/`，各case原始命令/断言索引为 [case-audit-index.json](case-audit-index.json)，回收此树前须由Root保留。

与既有P2_4约定相同，`git diff --check` 对tracked unified-patch中的两个单空格空context marker（当前1844/1919）报告尾空白；它们是补丁DATA，保留以维持已测hash。实际新增TS/test/report文本另查无尾空白，未通过改变断言或重签结果消告警。

Root应对精确候选双轴复验，再更新owned patch SHA并受控联编新分发/相关锁；不覆写旧6da、2699或40de，不把本报告当产品Run完成或许可签发。
