# P1_2 transport：新的独立 Standards 复核

结论：**PASS_PACKET_SOURCE_TRANSPORT_CONSTRUCTION_ONLY**。这份新审查可供Root接纳精确9c9的packet/源字节运输construction；**不认证安装、Hook、Host、模型、真实角色或whole P1_2**，不代替另一轴Spec。不是恢复旧双审，也不借旧aggregate给自己签结论。

候选 `9c9b70b92f1c5f548c5f84cad24c644657a4c30d`，比较基点 `ddb7849190c19e6d28f6d5dafeb00740def4e330`。五个触点 `tools/foundation-export.mjs`、`tools/adapters/claude-code.sh`、`test/foundation-distribution.test.js`、`foundation/.gitattributes`、lock当前字节与9c9相同；前三份也与作者8220树相同。依据AGENTS的范围/事实源/最少依赖/fail-closed/装配分层、ADR0020单主控边界。

## 有限代码判断

packet是完整文件数据，不执行所携带脚本；sourceCommit/exportDigest/完整文件metadata/inputDigest/packetSHA和逐文件base64/byte/hash/mode闭合。接收先比对外部expected精确SHA及文件集，再写fresh私有stage并复用FoundationLock验证；链接/特殊路径经现有helper拒绝。大小/文件数/模式有界，没有新增依赖、业务phase、queue或进度源。TeamAI使用staging且autoApply/自动更新/环境注入关闭；它不是主控或知识层选型。

外部expected的可信来源**是调用者前置**：API参数及自算hash不能自证Controller身份、项目授权或发布许可；P1_3必须从固定受保护输入提供expected/hash，不能让worker拿packet自签。当前接纳只是资产字节，不能据此执行安装或写原生Run。

## 新 custody 核对

- Root main71原始stdout/stderr hash、实际71/71/0fail/0skip和输入前后摘要核对通过；当时六份源输入与9c9匹配。stdout SHA：`469b9b39edbc82a02cce3a58eab848e28261ac88bdf7a8c1bf6c54b8685cd355`。本次未重跑测试。
- 当前11种方法245文件的源/发布/selected sealed副本逐项一致；selected `2aba3aa…` manifest277条核对通过，关键生成视图与9c9相同。未通过大段读取或复制方法正文取证。
- 作者索引60份展示文件、normalization对应56份raw及9份大harness archive仅重算hash/bytes，全部匹配；原raw位于8220工作树。原packet fixture记录首轮/重复均558/558、无missing/different/extra。其snapshot与当前2aba不同，不能改摘要冒作当前真实运输。Root71及当前代码字节绑定支持construction。
- cold证据是原生TeamAI扫描staging；其中12个builtin额外文件并非245份canonical方法，也不是冷coding-agent/模型执行或代码Wiki入库资格。原始日志与portable display分别核对，没有把展示副本当raw。

## 明确保留的安装阻断

**既有P2，Hook安装前须由原P1_2修复：** `tools/adapters/claude-code.sh` 的 `is_ours` 对entry内任一managed handler为真，`upsert_hook_array` 随即过滤整个entry；mixed group中的用户/plugin handler也会丢失。该helper与pre9c基点逐字节相同，属于既有缺陷，不能被新Bash caller或71绿色覆盖。本次只静态确认，没有调用adapter、安装或写settings。

这个缺陷不改变**不调用adapter**的packet字节运输判断；但本报告对adapter安装绝不报PASS。实际Hook/安装启用前必须修到handler粒度保留用户/plugin及group metadata，并独立验证混合entry的install/repeat/uninstall。原“用户保留”fixture只证明其特定输入，不能升级为普遍保证。

数据索引：`/private/tmp/P1_2-transport-standards-recertification-evidence-20261026.json`，SHA256 `a0ef4433f61b27930309cdd353edfc9af037f92d9594cadf0cd39ab06151bfb1`。本结论仅提供新的Standards原文，Root须合并当前独立Spec的同等窄范围和custody后再决定依赖边，不自动改activation。完整Host/OS/角色/方法实际应用、真实外部发布与知识/业务旅程仍未验收。

未改源码/主配置/锁/计划/状态或原始证据；未启动Docker/服务/模型/API、安装或读取凭据，未新建Goal/worker。审查时间 2026-10-25T18:12:28.612772+00:00。
