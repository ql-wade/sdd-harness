# P1_2 non-command 返工：独立 Spec 补充

**结论：原P2在本限定source/assembly范围闭合；新增确认阻断0，可消费此源码修订。** 不签whole P1_2、实际Host/角色/OS；F04/B09保持未闭合。

对象仅 `a666a99c2969f3abca7d2b9073db966708fed0a1`，parent `d0b7c0f171dca7c5afb7f57a4db98e2397733745`。原Spec报告仍SHA `7d5e519aff1e03e94f7f607a5a154ea035b1a71933f7a9c508ed25965ab03456`，不修改或重绑；独立Standards返工报告SHA `4ef1c93b4fe8286652d3e96e6b4e3598415c3369f0e4644a357386fc52fada0f`仅作背景，不替代本轴复验。

依据原spec F02“保留用户条目，不重复Guard，配置可回退”和P1_2 Step3“脚本行为和settings matcher同测，用户条目不丢”。原RED实际到达adapter重复扫描，两个不同prompt被误判为command=''的相同注册，exit1；不是缺模块/工具的SETUP失败。

源码delta仅在重复event+command扫描中对type!=command立即continue。该判断使非command数据不再被当作可执行命令去重；原handler保全仍保留prompt正文、timeout、嵌套metadata、组matcher/note。归属正则、plugin优先、真正command冲突、受管写入、脚本引用和deny政策均未改；没有新权限、调度或宽松例外。

独立只选三个公开临时TARGET_ROOT用例，**3/3、0fail/0skip、exit0**：

1. legacy owned command与两个不同prompt同组，实际安装仅生成一个当前command；prompt及组metadata完整；重复安装字节一致，卸载只余原prompt组。
2. 原plugin wrapper的同事件/命令冲突仍明确拒绝，settings不变。
3. 原重复user command仍明确拒绝。

Node24.15.0、既有Python，11个外部拒绝器校准97，测试期间调用0；12项输入前后摘要一致。UTC19:40:20–19:40:21，session49959终态，无遗留句柄。实际命令封存在 `/private/tmp/P1_2-mixed-hook-rework-spec-replay-20261026.py`；原始证据目录 `/private/tmp/P1_2-mixed-rework-spec-owrotop9/`，metadata SHA `97ca103fa22a64d38f5e6742edd9d2ce27070dfc91d94ff9d22ea5518b557aba`，stdout SHA `efb899e2decac93d1a75c403fe5c5ec3a6a583d6624da29399beb2395a5fd9f8`。

新manifest SHA `e270de3e5105a5616845134faea207deb81520f6e50901228a871b7d56204676`的16项bytes/hash、13对raw/display全部匹配；d0b7旧40份报告/证据与parent Git字节一致。作者19/19与2/2不与本轴3项累加，不据其扩业务分母。候选及原报告结束仍clean/原字节。

本轴未重跑未变运输。原74/72/2仍为未通过记录，完整Foundation closure与oldRun两个检查不因本次prompt修复而关闭，不能认定oracle过时或放宽F04/B09。Root须联合3056与当前Asset锁、最终adapter统一发行并按原语义复验；仍失败则继续处理真实缺陷。无Docker/model/API/secret、下载、全局配置、源码/锁/计划写入或新Goal/worker，业务接受增量0。
