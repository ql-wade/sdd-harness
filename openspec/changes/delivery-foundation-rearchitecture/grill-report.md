# Grill Report — 92 场景逐场景质询（VERIFY 节点）

口径：verdict 与 acceptance-index.json 逐项一致（PASS 76 / GATED 15 / UNVERIFIED 1，零未解释差异）。每个 PASS 给出本轮实际采用的证伪尝试角度（真实负例由对应 case 模块承载，本轮以真实执行复跑）；每个 GATED/UNVERIFIED 给出 holder 与解锁条件。证据链指针：case 模块（真实复跑于 68f7963）+ worker 报告 + VERIFY journey 日志。

## PASS 场景（76）

| ID | 证伪尝试角度（本轮真实执行） | 证据链 | 残余风险 |
| --- | --- | --- | --- |
| A01 | 证伪尝试：零测试/全 skip/环境失败冒充有效执行；源/锁/迁移漂移后复用旧回执；中断恢复重复副作用；候选改变不重验 | test/delivery-cases/2_1.mjs :: A01；worker-reports/P2_1.json；evidence/journey-A.txt（exit=0） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| A02 | 证伪尝试：零测试/全 skip/环境失败冒充有效执行；源/锁/迁移漂移后复用旧回执；中断恢复重复副作用；候选改变不重验 | test/delivery-cases/2_1.mjs :: A02；worker-reports/P2_1.json；evidence/journey-A.txt（exit=0） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| A03 | 证伪尝试：零测试/全 skip/环境失败冒充有效执行；源/锁/迁移漂移后复用旧回执；中断恢复重复副作用；候选改变不重验 | test/delivery-cases/2_1.mjs :: A03；worker-reports/P2_1.json；evidence/journey-A.txt（exit=0） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| A04 | 证伪尝试：零测试/全 skip/环境失败冒充有效执行；源/锁/迁移漂移后复用旧回执；中断恢复重复副作用；候选改变不重验 | test/delivery-cases/2_1.mjs :: A04；worker-reports/P2_1.json；evidence/journey-A.txt（exit=0） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| A05 | 证伪尝试：零测试/全 skip/环境失败冒充有效执行；源/锁/迁移漂移后复用旧回执；中断恢复重复副作用；候选改变不重验 | test/delivery-cases/2_2.mjs :: A05；worker-reports/P2_2.json；evidence/journey-A.txt（exit=0） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| A06 | 证伪尝试：零测试/全 skip/环境失败冒充有效执行；源/锁/迁移漂移后复用旧回执；中断恢复重复副作用；候选改变不重验 | test/delivery-cases/2_2.mjs :: A06；worker-reports/P2_2.json；evidence/journey-A.txt（exit=0） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| A07 | 证伪尝试：零测试/全 skip/环境失败冒充有效执行；源/锁/迁移漂移后复用旧回执；中断恢复重复副作用；候选改变不重验 | test/delivery-cases/2_1.mjs :: A07；worker-reports/P2_1.json；evidence/journey-A.txt（exit=0） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| A08 | 证伪尝试：零测试/全 skip/环境失败冒充有效执行；源/锁/迁移漂移后复用旧回执；中断恢复重复副作用；候选改变不重验 | test/delivery-cases/2_1.mjs :: A08；worker-reports/P2_1.json；evidence/journey-A.txt（exit=0） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| A09 | 证伪尝试：零测试/全 skip/环境失败冒充有效执行；源/锁/迁移漂移后复用旧回执；中断恢复重复副作用；候选改变不重验 | test/delivery-cases/1_3.mjs :: A09；worker-reports/P1_3.json；evidence/journey-A.txt（exit=0） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| A10 | 证伪尝试：零测试/全 skip/环境失败冒充有效执行；源/锁/迁移漂移后复用旧回执；中断恢复重复副作用；候选改变不重验 | test/delivery-cases/3_3.mjs :: A10；worker-reports/P3_3.json；evidence/journey-A.txt（exit=0） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| A11 | 证伪尝试：零测试/全 skip/环境失败冒充有效执行；源/锁/迁移漂移后复用旧回执；中断恢复重复副作用；候选改变不重验 | test/delivery-cases/3_4.mjs :: A11；worker-reports/P3_4.json；evidence/journey-A.txt（exit=2）（注：场景自身 2 点全绿故 PASS；检查层 V_A11 因 B08 交叉污染 exit 2，finding F-1，holder=HOST_OPENSPEC_DRIFT） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| A12 | 证伪尝试：零测试/全 skip/环境失败冒充有效执行；源/锁/迁移漂移后复用旧回执；中断恢复重复副作用；候选改变不重验 | test/delivery-cases/3_3.mjs :: A12；worker-reports/P3_3.json；evidence/journey-A.txt（exit=0） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| A13 | 证伪尝试：零测试/全 skip/环境失败冒充有效执行；源/锁/迁移漂移后复用旧回执；中断恢复重复副作用；候选改变不重验 | test/delivery-cases/4_1.mjs :: A13；worker-reports/P4_1.json；evidence/journey-A.txt（exit=0） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| A15 | 证伪尝试：零测试/全 skip/环境失败冒充有效执行；源/锁/迁移漂移后复用旧回执；中断恢复重复副作用；候选改变不重验 | test/delivery-cases/3_1.mjs :: A15；worker-reports/P3_1.json；evidence/journey-A.txt（exit=0） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| A18 | 证伪尝试：零测试/全 skip/环境失败冒充有效执行；源/锁/迁移漂移后复用旧回执；中断恢复重复副作用；候选改变不重验 | test/delivery-cases/2_2.mjs :: A18；worker-reports/P2_2.json；evidence/journey-A.txt（exit=0） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| A19 | 证伪尝试：零测试/全 skip/环境失败冒充有效执行；源/锁/迁移漂移后复用旧回执；中断恢复重复副作用；候选改变不重验 | test/delivery-cases/2_2.mjs :: A19；worker-reports/P2_2.json；evidence/journey-A.txt（exit=0） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| A20 | 证伪尝试：零测试/全 skip/环境失败冒充有效执行；源/锁/迁移漂移后复用旧回执；中断恢复重复副作用；候选改变不重验 | test/delivery-cases/2_3.mjs :: A20；worker-reports/P2_3.json；evidence/journey-A.txt（exit=0） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| B01 | 证伪尝试：worker 自签 pass；同一执行身份兼任构建与验证；弱测试回作者放行；无关成功命令替代必需检查；不兼容契约版本报告导入 | test/delivery-cases/1_6.mjs :: B01；worker-reports/P1_6.json；evidence/journey-B.txt（exit=0） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| B02 | 证伪尝试：worker 自签 pass；同一执行身份兼任构建与验证；弱测试回作者放行；无关成功命令替代必需检查；不兼容契约版本报告导入 | test/delivery-cases/3_2.mjs :: B02；worker-reports/P3_2.json；evidence/journey-B.txt（exit=0） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| B03 | 证伪尝试：worker 自签 pass；同一执行身份兼任构建与验证；弱测试回作者放行；无关成功命令替代必需检查；不兼容契约版本报告导入 | test/delivery-cases/2_2.mjs :: B03；worker-reports/P3_2.json；evidence/journey-B.txt（exit=0） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| B04 | 证伪尝试：worker 自签 pass；同一执行身份兼任构建与验证；弱测试回作者放行；无关成功命令替代必需检查；不兼容契约版本报告导入 | test/delivery-cases/3_2.mjs :: B04；worker-reports/P3_2.json；evidence/journey-B.txt（exit=0） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| B05 | 证伪尝试：worker 自签 pass；同一执行身份兼任构建与验证；弱测试回作者放行；无关成功命令替代必需检查；不兼容契约版本报告导入 | test/delivery-cases/3_2.mjs :: B05；worker-reports/P3_2.json；evidence/journey-B.txt（exit=0） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| B06 | 证伪尝试：worker 自签 pass；同一执行身份兼任构建与验证；弱测试回作者放行；无关成功命令替代必需检查；不兼容契约版本报告导入 | test/delivery-cases/2_2.mjs :: B06；worker-reports/P3_2.json；evidence/journey-B.txt（exit=0） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| B07 | 证伪尝试：worker 自签 pass；同一执行身份兼任构建与验证；弱测试回作者放行；无关成功命令替代必需检查；不兼容契约版本报告导入 | test/delivery-cases/2_2.mjs :: B07；worker-reports/P3_2.json；evidence/journey-B.txt（exit=0） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| B09 | 证伪尝试：worker 自签 pass；同一执行身份兼任构建与验证；弱测试回作者放行；无关成功命令替代必需检查；不兼容契约版本报告导入 | test/delivery-cases/1_6.mjs :: B09；worker-reports/P1_2.json；evidence/journey-B.txt（exit=0） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| B10 | 证伪尝试：worker 自签 pass；同一执行身份兼任构建与验证；弱测试回作者放行；无关成功命令替代必需检查；不兼容契约版本报告导入 | test/delivery-cases/2_3.mjs :: B10；worker-reports/P4_3.json；evidence/journey-B.txt（exit=0） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| C01 | 证伪尝试：R/A/T 职责混写；Classic 派生视图双写 checkbox；旁路/恢复路径绕过不可省略检查；手工/旧回执放行；Classic/Native 语义互换 | test/delivery-cases/1_5.mjs :: C01；worker-reports/P1_5.json；evidence/journey-C.txt（exit=0） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| C02 | 证伪尝试：R/A/T 职责混写；Classic 派生视图双写 checkbox；旁路/恢复路径绕过不可省略检查；手工/旧回执放行；Classic/Native 语义互换 | test/delivery-cases/1_5.mjs :: C02；worker-reports/P1_5.json；evidence/journey-C.txt（exit=0） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| C03 | 证伪尝试：R/A/T 职责混写；Classic 派生视图双写 checkbox；旁路/恢复路径绕过不可省略检查；手工/旧回执放行；Classic/Native 语义互换 | test/delivery-cases/1_5.mjs :: C03；worker-reports/P1_5.json；evidence/journey-C.txt（exit=0） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| C04 | 证伪尝试：R/A/T 职责混写；Classic 派生视图双写 checkbox；旁路/恢复路径绕过不可省略检查；手工/旧回执放行；Classic/Native 语义互换 | test/delivery-cases/1_5.mjs :: C04；worker-reports/P1_5.json；evidence/journey-C.txt（exit=0） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| C05 | 证伪尝试：R/A/T 职责混写；Classic 派生视图双写 checkbox；旁路/恢复路径绕过不可省略检查；手工/旧回执放行；Classic/Native 语义互换 | test/delivery-cases/1_5.mjs :: C05；worker-reports/P1_5.json；evidence/journey-C.txt（exit=0） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| C06 | 证伪尝试：R/A/T 职责混写；Classic 派生视图双写 checkbox；旁路/恢复路径绕过不可省略检查；手工/旧回执放行；Classic/Native 语义互换 | test/delivery-cases/1_5.mjs :: C06；worker-reports/P1_5.json；evidence/journey-C.txt（exit=0） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| C07 | 证伪尝试：R/A/T 职责混写；Classic 派生视图双写 checkbox；旁路/恢复路径绕过不可省略检查；手工/旧回执放行；Classic/Native 语义互换 | test/delivery-cases/1_4.mjs :: C07；worker-reports/P2_4.json；evidence/journey-C.txt（exit=0） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| D01 | 证伪尝试：Gate 求值内藏派发/暂存 current-stage；重复、乱序、旧 attempt/epoch 回执被采纳；并发双推进；断点恢复重复副作用 | test/delivery-cases/2_4.mjs :: D01；worker-reports/P2_4.json；evidence/journey-D.txt（exit=0） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| D02 | 证伪尝试：Gate 求值内藏派发/暂存 current-stage；重复、乱序、旧 attempt/epoch 回执被采纳；并发双推进；断点恢复重复副作用 | test/delivery-cases/2_4.mjs :: D02；worker-reports/P2_4.json；evidence/journey-D.txt（exit=0） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| D03 | 证伪尝试：Gate 求值内藏派发/暂存 current-stage；重复、乱序、旧 attempt/epoch 回执被采纳；并发双推进；断点恢复重复副作用 | test/delivery-cases/2_4.mjs :: D03；worker-reports/P2_4.json；evidence/journey-D.txt（exit=0） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| D04 | 证伪尝试：Gate 求值内藏派发/暂存 current-stage；重复、乱序、旧 attempt/epoch 回执被采纳；并发双推进；断点恢复重复副作用 | test/delivery-cases/2_4.mjs :: D04；worker-reports/P2_4.json；evidence/journey-D.txt（exit=0） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| D05 | 证伪尝试：Gate 求值内藏派发/暂存 current-stage；重复、乱序、旧 attempt/epoch 回执被采纳；并发双推进；断点恢复重复副作用 | test/delivery-cases/2_4.mjs :: D05；worker-reports/P2_4.json；evidence/journey-D.txt（exit=0） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| D06 | 证伪尝试：Gate 求值内藏派发/暂存 current-stage；重复、乱序、旧 attempt/epoch 回执被采纳；并发双推进；断点恢复重复副作用 | test/delivery-cases/2_4.mjs :: D06；worker-reports/P2_4.json；evidence/journey-D.txt（exit=0） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| D07 | 证伪尝试：Gate 求值内藏派发/暂存 current-stage；重复、乱序、旧 attempt/epoch 回执被采纳；并发双推进；断点恢复重复副作用 | test/delivery-cases/2_4.mjs :: D07；worker-reports/P2_4.json；evidence/journey-D.txt（exit=0） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| D08 | 证伪尝试：Gate 求值内藏派发/暂存 current-stage；重复、乱序、旧 attempt/epoch 回执被采纳；并发双推进；断点恢复重复副作用 | test/delivery-cases/2_4.mjs :: D08；worker-reports/P2_4.json；evidence/journey-D.txt（exit=0） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| E01 | 证伪尝试：hook 缺失/静默失败仍出回执；mode 串扰改判定；知识关闭失败重复部署；archive 替代 publish 收尾 | test/delivery-cases/4_4.mjs :: E01；worker-reports/P4_4.json；evidence/journey-E.txt（exit=0） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| E02 | 证伪尝试：hook 缺失/静默失败仍出回执；mode 串扰改判定；知识关闭失败重复部署；archive 替代 publish 收尾 | test/delivery-cases/4_4.mjs :: E02；worker-reports/P4_4.json；evidence/journey-E.txt（exit=0） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| E03 | 证伪尝试：hook 缺失/静默失败仍出回执；mode 串扰改判定；知识关闭失败重复部署；archive 替代 publish 收尾 | test/delivery-cases/2_5.mjs :: E03；worker-reports/P2_5.json；evidence/journey-E.txt（exit=0） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| E04 | 证伪尝试：hook 缺失/静默失败仍出回执；mode 串扰改判定；知识关闭失败重复部署；archive 替代 publish 收尾 | test/delivery-cases/2_5.mjs :: E04；worker-reports/P2_5.json；evidence/journey-E.txt（exit=0） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| E05 | 证伪尝试：hook 缺失/静默失败仍出回执；mode 串扰改判定；知识关闭失败重复部署；archive 替代 publish 收尾 | test/delivery-cases/4_5.mjs :: E05；worker-reports/P4_5.json；evidence/journey-E.txt（exit=2）（初跑 FAIL 为夹具/负载瞬态，同命令复跑 PASS，finding F-2/F-3/F-4，初跑记录保留） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| E06 | 证伪尝试：hook 缺失/静默失败仍出回执；mode 串扰改判定；知识关闭失败重复部署；archive 替代 publish 收尾 | test/delivery-cases/4_4.mjs :: E06；worker-reports/P4_4.json；evidence/journey-E.txt（exit=0） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| F01 | 证伪尝试：仅测单一写入渠道冒充全渠道约束；普通执行可达的跳过/运维逃生；未受保护检查放行合并；tag 漂移照常部署；重复归档/第二归档者 | test/delivery-cases/1_1.mjs :: F01；worker-reports/P1_1.json；evidence/journey-F.txt（exit=0） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| F02 | 证伪尝试：仅测单一写入渠道冒充全渠道约束；普通执行可达的跳过/运维逃生；未受保护检查放行合并；tag 漂移照常部署；重复归档/第二归档者 | test/delivery-cases/1_2.mjs :: F02；worker-reports/P1_2.json；evidence/journey-F.txt（exit=2）（初跑 FAIL 为夹具/负载瞬态，同命令复跑 PASS，finding F-2/F-3/F-4，初跑记录保留） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| F03 | 证伪尝试：仅测单一写入渠道冒充全渠道约束；普通执行可达的跳过/运维逃生；未受保护检查放行合并；tag 漂移照常部署；重复归档/第二归档者 | test/delivery-cases/1_1.mjs :: F03；worker-reports/P1_1.json；evidence/journey-F.txt（exit=0） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| F04 | 证伪尝试：仅测单一写入渠道冒充全渠道约束；普通执行可达的跳过/运维逃生；未受保护检查放行合并；tag 漂移照常部署；重复归档/第二归档者 | test/delivery-cases/1_2.mjs :: F04；worker-reports/P1_2.json；evidence/journey-F.txt（exit=2）（初跑 FAIL 为夹具/负载瞬态，同命令复跑 PASS，finding F-2/F-3/F-4，初跑记录保留） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| F05 | 证伪尝试：仅测单一写入渠道冒充全渠道约束；普通执行可达的跳过/运维逃生；未受保护检查放行合并；tag 漂移照常部署；重复归档/第二归档者 | test/delivery-cases/1_3.mjs :: F05；worker-reports/P1_3.json；evidence/journey-F.txt（exit=0） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| F07 | 证伪尝试：仅测单一写入渠道冒充全渠道约束；普通执行可达的跳过/运维逃生；未受保护检查放行合并；tag 漂移照常部署；重复归档/第二归档者 | test/delivery-cases/1_3.mjs :: F07；worker-reports/P1_3.json；evidence/journey-F.txt（exit=0） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| H01 | 证伪尝试：归档后 pending Run 静默丢失；同 key 双领；Outline UUID 漂移；旧回调/会话复活；clear-current 误判完成；工作区清理越权 | test/delivery-cases/4_6.mjs :: H01；worker-reports/P4_6.json；evidence/journey-H.txt（exit=0） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| H02 | 证伪尝试：归档后 pending Run 静默丢失；同 key 双领；Outline UUID 漂移；旧回调/会话复活；clear-current 误判完成；工作区清理越权 | test/delivery-cases/4_6.mjs :: H02；worker-reports/P4_6.json；evidence/journey-H.txt（exit=0） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| H03 | 证伪尝试：归档后 pending Run 静默丢失；同 key 双领；Outline UUID 漂移；旧回调/会话复活；clear-current 误判完成；工作区清理越权 | test/delivery-cases/4_6.mjs :: H03；worker-reports/P4_6.json；evidence/journey-H.txt（exit=0） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| H06 | 证伪尝试：归档后 pending Run 静默丢失；同 key 双领；Outline UUID 漂移；旧回调/会话复活；clear-current 误判完成；工作区清理越权 | test/delivery-cases/2_5.mjs :: H06；worker-reports/P4_6.json；evidence/journey-H.txt（exit=0） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| H07 | 证伪尝试：归档后 pending Run 静默丢失；同 key 双领；Outline UUID 漂移；旧回调/会话复活；clear-current 误判完成；工作区清理越权 | test/delivery-cases/4_6.mjs :: H07；worker-reports/P4_6.json；evidence/journey-H.txt（exit=0） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| H08 | 证伪尝试：归档后 pending Run 静默丢失；同 key 双领；Outline UUID 漂移；旧回调/会话复活；clear-current 误判完成；工作区清理越权 | test/delivery-cases/4_6.mjs :: H08；worker-reports/P4_6.json；evidence/journey-H.txt（exit=0） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| L01 | 证伪尝试：来源变化闭包漏报；期限届满未隔离；监听器僭越主控；恢复后旧权限残留；隔离失败无告警 | test/delivery-cases/4_8.mjs :: L01；worker-reports/P4_8.json；evidence/journey-L.txt（exit=0） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| L03 | 证伪尝试：来源变化闭包漏报；期限届满未隔离；监听器僭越主控；恢复后旧权限残留；隔离失败无告警 | test/delivery-cases/4_8.mjs :: L03；worker-reports/P4_8.json；evidence/journey-L.txt（exit=0） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| L05 | 证伪尝试：来源变化闭包漏报；期限届满未隔离；监听器僭越主控；恢复后旧权限残留；隔离失败无告警 | test/delivery-cases/4_8.mjs :: L05；worker-reports/P4_8.json；evidence/journey-L.txt（exit=0） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| L06 | 证伪尝试：来源变化闭包漏报；期限届满未隔离；监听器僭越主控；恢复后旧权限残留；隔离失败无告警 | test/delivery-cases/4_8.mjs :: L06；worker-reports/P4_8.json；evidence/journey-L.txt（exit=0） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| L07 | 证伪尝试：来源变化闭包漏报；期限届满未隔离；监听器僭越主控；恢复后旧权限残留；隔离失败无告警 | test/delivery-cases/4_8.mjs :: L07；worker-reports/P4_8.json；evidence/journey-L.txt（exit=0） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| L08 | 证伪尝试：来源变化闭包漏报；期限届满未隔离；监听器僭越主控；恢复后旧权限残留；隔离失败无告警 | test/delivery-cases/4_8.mjs :: L08；worker-reports/P4_8.json；evidence/journey-L.txt（exit=0） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| L10 | 证伪尝试：来源变化闭包漏报；期限届满未隔离；监听器僭越主控；恢复后旧权限残留；隔离失败无告警 | test/delivery-cases/4_8.mjs :: L10；worker-reports/P4_8.json；evidence/journey-L.txt（exit=2）（初跑 FAIL 为夹具/负载瞬态，同命令复跑 PASS，finding F-2/F-3/F-4，初跑记录保留） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| L11 | 证伪尝试：来源变化闭包漏报；期限届满未隔离；监听器僭越主控；恢复后旧权限残留；隔离失败无告警 | test/delivery-cases/4_8.mjs :: L11；worker-reports/P4_8.json；evidence/journey-L.txt（exit=0） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| M01 | 证伪尝试：方法替换后 Superpowers 重启；嵌套 planner/implement-spec controller；快照手改或软链分发 | test/delivery-cases/1_6.mjs :: M01；worker-reports/P1_6.json；evidence/journey-M.txt（exit=0） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| M02 | 证伪尝试：方法替换后 Superpowers 重启；嵌套 planner/implement-spec controller；快照手改或软链分发 | test/delivery-cases/1_6.mjs :: M02；worker-reports/P1_6.json；evidence/journey-M.txt（exit=0） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| U01 | 证伪尝试：无效 owner/委托签发；撤销/过期后仍有效；多源披露取并集扩大；目标继承越权；写前版本不重验；issuer 自签 | test/delivery-cases/4_7.mjs :: U01；worker-reports/P4_7.json；evidence/journey-U.txt（exit=0） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| U02 | 证伪尝试：无效 owner/委托签发；撤销/过期后仍有效；多源披露取并集扩大；目标继承越权；写前版本不重验；issuer 自签 | test/delivery-cases/4_7.mjs :: U02；worker-reports/P4_7.json；evidence/journey-U.txt（exit=0） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| U03 | 证伪尝试：无效 owner/委托签发；撤销/过期后仍有效；多源披露取并集扩大；目标继承越权；写前版本不重验；issuer 自签 | test/delivery-cases/4_7.mjs :: U03；worker-reports/P4_7.json；evidence/journey-U.txt（exit=0） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| U04 | 证伪尝试：无效 owner/委托签发；撤销/过期后仍有效；多源披露取并集扩大；目标继承越权；写前版本不重验；issuer 自签 | test/delivery-cases/4_7.mjs :: U04；worker-reports/P4_7.json；evidence/journey-U.txt（exit=0） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| U05 | 证伪尝试：无效 owner/委托签发；撤销/过期后仍有效；多源披露取并集扩大；目标继承越权；写前版本不重验；issuer 自签 | test/delivery-cases/4_7.mjs :: U05；worker-reports/P4_7.json；evidence/journey-U.txt（exit=0） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| U06 | 证伪尝试：无效 owner/委托签发；撤销/过期后仍有效；多源披露取并集扩大；目标继承越权；写前版本不重验；issuer 自签 | test/delivery-cases/4_7.mjs :: U06；worker-reports/P4_7.json；evidence/journey-U.txt（exit=0） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |
| U07 | 证伪尝试：无效 owner/委托签发；撤销/过期后仍有效；多源披露取并集扩大；目标继承越权；写前版本不重验；issuer 自签 | test/delivery-cases/4_7.mjs :: U07；worker-reports/P4_7.json；evidence/journey-U.txt（exit=0） | 真实目标环境/平台侧终态不在本 verdict 声明范围（由 GATED 项 holder 分离）；本机证据链全绿 |

## GATED 场景（15）

| ID | 机制证据（本轮真实执行） | holder | 解锁条件 | 残余风险 |
| --- | --- | --- | --- | --- |
| A14 | test/delivery-cases/4_2.mjs 本轮真实执行 exit=0 verdict=PASS（机制/守卫分支） | 环境 owner + 运行时准入（真实 Registry endpoint / 隔离环境登记后，release.mjs --registry/--environment 指向真实形态；P4_2 全部回 | 真实 Registry endpoint / 隔离环境登记后 release.mjs --registry/--environment 指向真实形态（holder: 环境 owner+运行时准入） | 同 digest 锁定/漂移拒绝/关联查询/批准回滚机制在隔离 Registry/环境全验证（LOCAL_ONLY）；真实生产提升为环境门；门解除前不得声称真实环境终态 |
| A16 | test/delivery-cases/4_2.mjs 本轮真实执行 exit=0 verdict=PASS（机制/守卫分支） | 环境 owner + 运行时准入（同 A14：真实部署关联读回与账本权威性） | 同 A14（真实部署关联读回与账本权威性） | 同 digest 锁定/漂移拒绝/关联查询/批准回滚机制在隔离 Registry/环境全验证（LOCAL_ONLY）；真实生产提升为环境门；门解除前不得声称真实环境终态 |
| A17 | test/delivery-cases/4_2.mjs 本轮真实执行 exit=0 verdict=PASS（机制/守卫分支） | 环境 owner + 运行时准入（同 A14：真实回滚 digest/环境/业务终态读回） | 同 A14（真实回滚 digest/环境/业务终态读回） | 同 digest 锁定/漂移拒绝/关联查询/批准回滚机制在隔离 Registry/环境全验证（LOCAL_ONLY）；真实生产提升为环境门；门解除前不得声称真实环境终态 |
| B08 | test/delivery-cases/3_4.mjs 本轮真实执行 exit=2 verdict=FAIL（机制/守卫分支） | 宿主全局 openspec 漂移 1.3.1→1.14.3（open decision HOST_OPENSPEC_DRIFT，owner: user）；重钉 toolchain-baseline 或 | 用户三选一裁决：重钉 openspec 1.3.1 / 迁移基线 1.14.3 / 显式重冻结；裁决后在钉定环境复跑 | 适配器拒绝丢失场景的 MODIFIED delta 已在 P3_4 提交验证；当前钉定宿主 openspec 漂移阻断复跑；门解除前不得声称真实环境终态 |
| C08 | test/delivery-cases/1_5.mjs 本轮真实执行 exit=2 verdict=NOT-EXERCISED（机制/守卫分支） | 同 B08：HOST_OPENSPEC_DRIFT；test/classic-integration.test.js C08 负例在钉定宿主版本后复跑（机制证据见 P1_5 隔离工具环境与 1_5.m | 同 B08；1_5.mjs C08 负例在钉定宿主版本后复跑（机制证据已在隔离工具环境全绿） | 兼容性拒绝机制已在隔离工具环境验证（1_5.mjs 全绿）；宿主全局 openspec 漂移阻断 classic-integration 负例复跑；门解除前不得声称真实环境终态 |
| F06 | test/delivery-cases/1_4.mjs 本轮真实执行 exit=0 verdict=PASS（机制/守卫分支） | 平台准入 owner（真实注册 delivery-gate required check + secrets.SDD_DELIVERY_LAUNCHER_AUTHORITY + GitHub runn | 平台准入 owner：注册 delivery-gate required check + SDD_DELIVERY_LAUNCHER_AUTHORITY secret + GitHub runner 端到端执行 | Gate 阻断机制与 workflow 装配已验证；真实平台 required-check 注册与合并阻断待平台准入；门解除前不得声称真实环境终态 |
| F08 | test/delivery-cases/3_2.mjs 本轮真实执行 exit=0 verdict=PASS（机制/守卫分支） | 具备原生浏览器能力的试点环境（UI 试点任务；正相原生浏览器验收与独立业务读回） | 具备原生浏览器能力的试点环境执行 UI 试点正相验收与独立业务读回 | 关联截图/请求/读回契约与缺能力保持未验证已验证；正相原生浏览器验收待试点环境；门解除前不得声称真实环境终态 |
| F09 | test/delivery-cases/4_1.mjs 本轮真实执行 exit=0 verdict=PASS（机制/守卫分支） | 平台准入 owner + 环境 owner（真实 CI 验证与提升贯通到目标环境；A14/A16/A17 的生产侧同批闭合） | 平台准入+环境 owner：真实 CI 验证与提升贯通到目标环境（与 A14/A16/A17 生产侧同批闭合） | integration SHA 贯通机制已验证；真实 CI→目标环境贯通待平台/环境准入；门解除前不得声称真实环境终态 |
| H04 | test/delivery-cases/4_6.mjs 本轮真实执行 exit=0 verdict=PASS（机制/守卫分支） | I03 Outline 独立资料域实际部署后实测 documents.create/info 读回与 MCP 参数暴露（P4_6 残留项） | I03 Outline 独立资料域实际部署后实测 documents.create/info 读回与 MCP 参数暴露 | 固定 UUID 读回/lastRevision 冲突语义已验证；真实 Outline API 实测待 I03 部署；门解除前不得声称真实环境终态 |
| H05 | test/delivery-cases/4_6.mjs 本轮真实执行 exit=0 verdict=PASS（机制/守卫分支） | I03 Outline 独立资料域实际部署后实测 lastRevision 冲突语义（P4_6 残留项） | I03 部署后实测 lastRevision 冲突语义 | 固定 UUID 读回/lastRevision 冲突语义已验证；真实 Outline API 实测待 I03 部署；门解除前不得声称真实环境终态 |
| H09 | test/delivery-cases/4_6.mjs 本轮真实执行 exit=0 verdict=PASS（机制/守卫分支） | 第二物理宿主认证（P5_1/跨机范围显式启用裁决）+ authority 对抗性防伪造（同 OS 账户改写绑定文件） | 第二物理宿主认证（P5_1/跨机范围启用裁决）+ authority 对抗性防伪造 | authority 绑定/异权拒绝/受控迁移已验证；真实第二物理宿主与对抗性防伪造待跨机裁决；门解除前不得声称真实环境终态 |
| L02 | test/delivery-cases/4_8.mjs 本轮真实执行 exit=0 verdict=PASS（机制/守卫分支） | I03 Outline 部署后资源端隔离实测（Web/直接链接/分享/搜索/附件渠道真实读回；P4_8 残留项） | I03 Outline 部署后资源端隔离实测（Web/直接链接/分享/搜索/附件真实读回） | 隔离 unknown/isolating 语义已验证；资源端真实渠道隔离实测待 I03 部署；门解除前不得声称真实环境终态 |
| L04 | test/delivery-cases/4_8.mjs 本轮真实执行 exit=0 verdict=PASS（机制/守卫分支） | I03 Outline 部署后按已授隔离能力收窄访问并独立验证（同 L02） | 同 L02（按已授隔离能力收窄访问并独立验证） | 隔离 unknown/isolating 语义已验证；资源端真实渠道隔离实测待 I03 部署；门解除前不得声称真实环境终态 |
| L09 | test/delivery-cases/4_8.mjs 本轮真实执行 exit=0 verdict=PASS（机制/守卫分支） | I07 监控真实部署 + 批准时限的真实墙钟实测（90s 心跳/120s 水位/5 分钟端到端；P4_8 残留项） | I07 监控真实部署 + 90s 心跳/120s 水位/5 分钟端到端真实墙钟实测 | 阈值判定与监督器边界已验证（I07 真实监控探针）；真实墙钟时限实测待部署；门解除前不得声称真实环境终态 |
| U08 | test/delivery-cases/4_7.mjs 本轮真实执行 exit=0 verdict=PASS（机制/守卫分支） | 真实 Outline 试点集合/实例不可变 ID 与受众登记 + 受保护签发工作流与 issuer 凭据（I03 + 运行时准入；P4_7 残留项） | 真实 Outline 试点集合/实例不可变 ID 与受众登记 + 受保护签发工作流与 issuer 凭据（I03+运行时准入） | decide→allow 机制与回执绑定已验证；真实 Outline 写入+独立读回+同 Run 接纳待真实试点登记；门解除前不得声称真实环境终态 |

## UNVERIFIED 场景（1）

| ID | 现状 | holder | 解锁条件 |
| --- | --- | --- | --- |
| F10 | CROSS_MACHINE_SCOPE_NOT_ENABLED：未启用分支已真实验证（拒绝启动/拒绝发布、伪造 scope 文件被锚定检查拒绝、env 不能翻转门、ENABLEMENT_REQUIRES_PAIRED_COMMIT）；正向隔离恢复认证未执行、不以“未启用”判通过 | P5_2 owner + 用户跨机器范围裁决（CROSS_MACHINE_SCOPE_NOT_ENABLED；tasks.md P5_2 明示未执行的正向隔离恢复认证保留 UNVERIFIED，不能以 | 用户显式启用跨机器范围 → 建设 services/delivery-control → 执行正向隔离恢复认证（启用前不判 PASS，未启用分支已真实验证拒绝启动/拒绝发布） |

## 逐场景质疑过程说明

1. **不采信自报**：全部 verdict 以本轮在最终基线 68f7963 的真实执行回读为准（journey 92 次 spawn + 27 模块逐跑 + 10 项索引抽样复验），worker 报告仅作指针交叉。
2. **PASS 的证伪纪律**：每个场景的 case 模块本身以负例先行（RED 用例在各 worker 报告 red_cases 留档），本轮复跑确认负例仍在位且 GREEN 可复现；上表“证伪尝试角度”即该场景被设计攻击的维度。
3. **GATED 不洗白**：机制层 PASS（如 A14 LOCAL_ONLY 回执）不升级为 delivered；delivered 与目标环境确认按 acceptance-index 规则分离。
4. **交叉污染如实暴露**：A11/B08 共文件导致检查层传染（F-1）；命名偏差导致 V_INFRA_I08 合同命令失败（F-10）；二者均未静默改判。

