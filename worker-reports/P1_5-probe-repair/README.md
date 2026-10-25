# P1_5 两项探针回归修复

基点 `2d2506f`，仅修改 `test/classic-integration.test.js` 和两份原探针元数据。原任务、DAG、合同、方法正文、共享锁、adapter、活配置均未改；不消费 P1_4 模式资格。本交付不签 P1_5 或 C01–C08 整体验收，也不证明角色、OS、知识库或实际方法执行。

原两失败已真实复现：0通过、2失败、0跳过。其一把历史 OpenSpec1.3.1 观察与已更新的当前宿主1.14.3混用；其二仍绑定旧 Whitebox 快照。原三文件逐字节保存在 `history/2d2506f/`；测试副本用 `.js.txt` 后缀避免自动测试发现，原SHA/bytes见索引。

| 作者验证 | 实际结果 |
| --- | --- |
| 原始两项回归 | 0/2，exit1，完整原始失败保留 |
| C08 历史/当前/隔离及错误依赖 | 4/4，0跳过 |
| 批准方法源与漂移负例 | 2/2，0跳过 |
| 原 `classic-integration.test.js` 全套 | **24/24，0失败、0跳过** |
| 小型作者 TestPack 结构检查 | PACK_STRUCTURE_VALID，仅结构 |

OpenSpec1.3.1 使用原 P1_1.b 的真实538字节 status 捕获（SHA256 `07e4c35d6ba821b7fc2b9810c0e14e67c6fdb126202a6db98c9b3a18c3903357`）重放，当前固定 Core6da 仍拒绝缺失 requires。没有伪造或安装旧CLI。当前宿主1.14.3与隔离1.11.0均实际执行 version/status、独立返回可接受闭包；缺字段、null/string/非字符串数组、未知依赖、循环依赖、缺 applyRequires 共七类反例继续拒绝。所有CLI写入仅在可清理 scratch HOME，未全局升降级。

三个方法的当前 pin 来自已批准 P1_6 提交 `3f69f9c5c3c49f0146974fb28c90c1ed8f403496`，不是任意新源重新计算后自批。批准MF摘要 `8030fd62…e46d2e`、升级清单 `f0da896a…41be4`、sealed2aba清单 `93bb1a56…3cbff` 全部绑定；实际核对11方法245文件，包括 dotfile/fixture.log，当前文件、原基点Git字节、MF逐文件SHA和sealed字节一致。没有复制245份方法正文到报告。planner/test-authoring/Whitebox分别16/17/139文件；planner仅计划协议/纯校验器，完整控制合同不加载。统一算法为完整 `sha256␠␠方法名/相对文件名` 行排序后以LF连接、末尾无LF，再SHA256。旧相对路径算法和旧记录保留历史。私有副本中修改非SKILL文件再重算声称摘要、移除dotfile、添加未批准文件均拒绝，恢复后再次接受。

复验命令（使用固定Node24.15.0，并让其bin位于PATH首位）：

```bash
node --test --test-reporter=tap test/classic-integration.test.js
```

本树原缺Core6da，只从主检出复制既有不可变构建并逐项核47243清单项（41498文件、1276内部链接、4469目录），不是新构建或发行资格。构建 fingerprint `6da90e893105b4b00fc756260076b49e12bdbe40bc4426e4908a75e1d5732a9a`，清单SHA `38448c74…4665`；闭包模块SHA `205cf16f…edf81`。现有隔离OpenSpec1.11.0未重装。初始化复制校验脚本误将清单 `link` 写成 `symlink` 的一次setup失败，以及一次zsh过滤器未引用导致的零执行，均不计行为RED；实际原始行为RED另有完整日志。

`evidence/` 是替换机器路径、去除显示行尾空白后的便携副本，不冒充原始stdout。原始字节仍在本工人树 ignored `.local/p1_5-probe-repair/`；每项raw/display SHA、bytes、实际argv/cwd/PATH/UTC/exit和三原文件摘要见 `evidence-index.json`。`c08-observe.mjs` 是本次实际只读CLI取证脚本；在已有输出目录会拒绝覆盖，可于新隔离树首次复演。直接重跑上面的原suite即可独立复核修复。TestPack原件亦在ignored目录，索引只记录其摘要，没有第二份计划或进度。

测试/取证进程均已终态，无待恢复句柄。原C01–C07组件断言保留；24组通过不等于真实R/A/T、Runner/OS权限、Kp/归档/Kt或同Run交付通过。交原Root独立双审后串行接纳。
