# 架构迁移实施交接

> 当前修订提示（2026-10-20）：Ponytail 应用设计已按用户要求补入主架构 §6.9、design.md、architecture.md 与 classic-closeout-and-hook-contract.md §6–8。原执行锁和评审回执保留为旧制品历史，本轮不静默刷新。先由唯一实施控制器按 halt-and-replan 接纳该补充、核对 P1_6/P1_2/P4_5/I02 的检查与归属并重冻结；下文“计划 PASS/可执行”的历史结论不覆盖本补充。运行实现、任务完成数与场景通过数未因此增加。

本包只做计划，由用户另选 Agent 实施；没有启动实施、服务、发布或远端策略修改。接收方先读此文，再读 execution-prompt.md。

## 权威与当前事实

目标架构是 docs/architecture/delivery-architecture.md、ADR-0019 和本 Change design/spec。架构共识已通过，仅授权分批实施。tasks.md 是唯一任务进度，task-dag.json 是依赖/归属投影；原30父任务、69工作包和92场景保留，新增I01–I08和最终VERIFY，共39节点、105项required检查。原0.1–0.4文档完成状态保留，产品受管运行验收为0/92。

迁移期间接收 Agent 以 planner 作为唯一实施控制器；被建设系统运行后仅由 Comet 控制业务阶段、状态、重试和恢复。TeamAI只分发，Ponytail只辅助。不得同时启动第二个planner/implement-spec或让worker改控制状态。

## 接收后按顺序执行

1. 读取AGENTS/README/权威架构/技能分工，检查工作区和已有改动；只接纳本任务文件，不整体覆盖或提交当前脏工作区。此包未提交，先建立可回滚的本地变更基线。
2. 先运行下方可用的静态校验，核对 planning-toolkit/manifest.json 的所有摘要。工具是选定planner的原样静态快照，不是新调度器；不要调用仓库旧版planner guard，它还依赖Superpowers且不支持本包schema2。
3. 绑定一个实际可用的接收方控制器/进度源。当前串行波次是能力保守值；若选择并行，先证明隔离工作区、原生派发/等待/恢复和归属无冲突，记录批准的重规划并重新冻结，不能直接改max_workers。
4. 从P1_1和P1_6前置开始：复核精确工具链、源码及现有部分实现；显式备份并替换原样方法快照，固定Matt tdd/diagnosing-bugs/code-review、planner、test-authoring、whitebox-verify、openspec-lifecycle-guard，保留grill及共识。不得依赖本机共享技能路径、软链接分发或重启Superpowers。方法不可用是阻塞，不可改成提示词跳过。
5. 按DAG接入I01–I08；详见infrastructure-plan.md与infrastructure-tasks.json。I01登记实际owner、镜像/源码摘要、secretRefs和授权，值不入Git。缺项的组件不启动；不得复用PAV等其它项目资源。
6. 各任务执行独立测试设计→实际行为RED→最小GREEN→回归→独立审查→串行接纳。环境错误不是行为RED。测试不足回test-authoring，产品缺陷回Builder；Whitebox不替作者修测试。部分已有源码准备/构建工具不等于P1_1完成，构建工具仍须独立审查和完整资格验证。
7. runner及case尚未实现的检查见execution-contract.json的availability/implementedBy；先由归属任务编写，再执行。0=通过、1=无效输入/前置缺失、2=验证失败；缺真实环境标UNVERIFIED并非零退出。第三方工具保留自己的退出码约定。不得以不存在的命令、静态清单、fixture或skip声称运行通过。
8. 绑定实际宿主Goal与20分钟监督再实施，含未知ETA/证据/阻塞汇报；本聊天旧sdd监督已暂停，不继承它的执行身份。监督只观察，不能派发或写业务phase。
9. VERIFY依赖全部前置，执行105检查及92场景的独立Whitebox Journey和证据Grill；缺必需项保留未验收。OpenSpec归档需Kp，Outline Kt未完成时同一Comet Run仍须恢复并阻断整体完成。归档后审计与实际权限读回不可省略。

## 基础设施准入与授权

I01登记/密钥；I02固定Runner和真实角色隔离；I03 Outline数据库/缓存/认证/对象存储；I04单项目LLMWiki；I05自托管deepwiki-open及独立Code Graph；I06 Git/CI/Registry/隔离环境；I07跨Runner故障域监控及原实例进程监督；I08一致备份、隔离恢复和R10未完成保留。

尚需真实owner/身份/文集/源域、不可变组件摘要、专用秘密引用、受众与grant、外部监控和授权告警渠道、RPO/RTO等。远端分支保护修改、生产部署和消息发送均未由本次计划授权；先完成可审查配置，再按动作取得授权。源可读不代表可再发布。正常依赖下3分钟发现+2分钟隔离目标必须实测；宿主故障告警需外部故障域，同机容器不能替代。

## 可直接运行的计划校验

从仓库根执行（Python3，标准库；生命周期工具要求Python3.12+）：

```sh
python3 openspec/changes/delivery-foundation-rearchitecture/planning-toolkit/scripts/plan_guard.py \
  --repo-root . \
  --plan openspec/changes/delivery-foundation-rearchitecture/tasks.md \
  --architecture openspec/changes/delivery-foundation-rearchitecture/architecture.md \
  --dag openspec/changes/delivery-foundation-rearchitecture/task-dag.json \
  --lock openspec/changes/delivery-foundation-rearchitecture/drift-lock.json \
  --contract openspec/changes/delivery-foundation-rearchitecture/execution-contract.json
```

guard 0仅证明计划结构/摘要/追踪关系，1不通过、2输入不可读。不要将其与产品CLI的退出码含义混淆。变更接口/需求/计划先停止、保留旧锁与证据、审查重规划，再freeze；本次历史保存在.local/plan-history/infra-handoff-20261020（本地辅助历史不作为跨机必需输入）。

## 报告边界

现有真实Comet原生探针证明：缺R回执仍能推进design，需由计划中的受控扩展修复；不是已实现门禁。新Runner、Outline、DeepWiki、平台合并阻断、权限撤销和故障SLO均未验收。保留原92场景和条件能力准入；不以首版本地通过偷换团队API认证。完整交付后才更新verification-report/grill-report/results并关闭目标。
