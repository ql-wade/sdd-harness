# P3_1 cwd 文件目标根返工

状态：建设工件候选，待独立双审与 root 的精确 main 集成复验；P3_1 整体仍未验收。父提交为 `d72fd3eed19665dba43aa0bed636c47659f7639f`，未 rebase，也未修改 canonical 契约、Scope、DAG、锁、台账或其它 owner 文件。

## 实际缺陷与最小修复

已先用 `rg` 盘点全部六个源码 caller，记录在 `call-site-inventory.json`。文件动作之外的 CLI 参数、原生 Run、source/admission 引用路径保留原有语义。

公开 CLI 在私有 cwd 中放入内容不同的同名 `package.json`：相对 inspect 竟把私有字段判为 PASS/0，却显示 `package.json`；要求真实仓库文件字节反而失败。`01-cwd-collision-red` 的两项均为有效行为 RED，不是依赖、导入或匹配失败。统一目标后同一命令 `02-cwd-collision-green` 为 2/2。

生产改动仅一个无状态文件目标解析函数和它的调用：绝对路径沿用原字符串，inspect 的相对路径以固定 repoRoot 解析；legacy 含空白路径的存在检查、stat、read 与显示路径使用同一目标语义。readState 共用该解析函数，但其相对基址仍是本次 evidenceDir。不会扩大路径权限或构造新的状态、授权、shell 解析器。

原 d72 的 regular-file/non-empty、混合 selector 拒绝、文件/命令 typed 分离、component legacy 限制均保持。正式路径仍不会因为空白而隐式执行；既有外部绝对路径规则也未改变。

## 作者自检

完整窄回归命令：`node --test --test-reporter=tap test/delivery-cases/3_1.mjs test/comet-flow-acceptance.test.js`。

| 记录 | 范围 | 实际结果 |
| --- | --- | --- |
| 01 | 不同 cwd 同名 package.json 的错误接纳与错误拒绝 | 2 fail，有效 RED |
| 02 | 相同 CLI 反例复跑 | 2 pass |
| 03 | Node 25.2.1：原 64 + 新 8 | 72/72；0 fail/skip |
| 04 | Node 22.13.1：同一套原 64 + 新 8 | 72/72；0 fail/skip |
| 05 | 正式 A01，无 CLI override / callback | UNVERIFIED/2、0 动作 |

新增八项覆盖 cwd 撞名、读取与显示/字节长度一致、外部绝对路径、现存相对空格文件、component legacy 的 cwd 撞名、readState 的 evidenceDir 基址，以及仓库目录/缺失目标被 cwd 文件遮蔽。测试只用私有 fixture，finally 清理；原 64 项回归全部保留。没有重复无关全量。

每次实际 UTC、cwd、argv、退出码和输入源码摘要见 `runs.jsonl`。原始 stdout/stderr 和精确未脱敏元数据在本目录 ignored `raw/*.log`，分发投影在 `display/`；双摘要均保存。采集脚本自己的退出码不是业务测试退出码，以记录中的 `exit_code` 为准。

最终 5 份源码摘要与 03/04/05 的实际输入一致。153 份既有报告/raw 字节未改；原 59 项 manifest、d72 的 18 份分发与 16 份 raw 均仍匹配。三个活 Claude 配置文件仍不存在，`.mcp.json` SHA 不变。逐文件核对见 `before.json` / `after.json`。旧 CURRENT、报告和 manifest 未被覆写，新入口仅本目录 CURRENT。

## 保持未完成的边界

实际 adapter/source/OS/身份以及完整受管旅程仍 UNVERIFIED；本次没有调用 provider、key、.once 或真实服务，没有业务动作或权限写入。P2_4 ← P3_1 与 I02 ← P3_1 的建设工件边仍未应用，须该修复通过两项独立审查、root 精确 main 集成并复验后，才交 root 受控处理。

104 场景候选映射未改：原合并 21 项加后续 7 项需 owner，另 76 项仅静态锚点；全部 104 项仍缺真实 typed 命令/路径/冻结值。19 个 literal 未定位不等于 19 个功能缺失。原 Scope/F10 记录没有改写；本 worker 的组件结果不能签总体、平台、知识恢复或同一 Run 旅程通过。
