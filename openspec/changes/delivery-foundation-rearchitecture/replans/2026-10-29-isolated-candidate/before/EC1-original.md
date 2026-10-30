### Task EC1: Comet入口闭环（方案一路由落地）

**Files:** docs/superpowers/plans/2026-10-26-comet-entry-closure-tdd.md, scripts/init-comet.sh, test/init-comet.test.js, bin/comet, openspec/changes/delivery-foundation-rearchitecture/pilot-journey/evidence/entry-closure
**Interfaces:** Comet.EntryRoute.v1: /comet路由技能读配置确定性转发——full→组合应用sdd-managed-delivery入口（comet-run.mjs start，六门在环）；hotfix/tweak→内置comet-hotfix/comet-tweak；恢复→resume（managed）或state next（stock）；出生守卫拒绝state init <x> full
**Dependencies:** VERIFY
**Owns:** docs/superpowers/plans/2026-10-26-comet-entry-closure-tdd.md, scripts/init-comet.sh, test/init-comet.test.js, bin/comet, openspec/changes/delivery-foundation-rearchitecture/pilot-journey/evidence/entry-closure
**Parallel safe:** false
**Acceptance IDs:** 无新增；验收=计划T5证据四件套（不占用原130检查身份）

原工作包身份：不在原39节点/69工作包身份内；task-dag.json冻结镜像与alias policy（不新增任务权威）不含本节。当前增补：2026-10-26-entry-closure-v1（双宇宙入口缺口方案一，docs/research/2026-10-26-comet-dual-universe-entry-gap.md）；未执行。T1–T5内部DAG、RED/GREEN与决策默认值以计划文件为准，实际文件所有权按受领Agent指定。

- [ ] **T1: Test** init-comet.sh可测化（ROOT参数化）与失败即报错：Hash空即exit 1、装后注册表自检、不吞错；见计划T1。
- [ ] **T2: Implement** stock/OpenSpec技能补装：真实拷贝官方资产子集+OpenSpec六技能，清单校验、幂等、superpowers=0；见计划T2。
- [ ] **T3: Implement** /comet路由技能按官方dispatcher模式生成：full→managed入口、hotfix/tweak→内置、恢复分流、断链测试；见计划T3。
- [ ] **T4: Implement** bin/comet wrapper：managed子命令透传组合包comet-run.mjs，state init full出生守卫拒绝；见计划T4。
- [ ] **T5: Verify** 真实仓库端到端证据四件套（R门拒/R门过/resume不另建/出生守卫）落盘entry-closure/并清理测试change；见计划T5。
