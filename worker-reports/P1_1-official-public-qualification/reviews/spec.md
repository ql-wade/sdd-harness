# Spec 独立审查：Comet 官方对齐研究与拟迁移方向

时间：2026-10-25T16:18:02.779614+00:00。仅 Spec 轴；不是三方模型共识，不消费或复用材料外发授权。本轴只读文件/冻结证据并静态核对发布包，未执行fixture、改源码/锁/台账/Run/配置/服务/凭据。唯一写入为本报告。

## 结论

**PASS：限于当前研究结论和候选资格切片；生产升级、迁移或启用仍 NO-GO。** 最新两份项目提案已撤回八个伪原生命令，保留原五phase内R/A/T/P、测试作者/Builder、V、Kp→Archive→Kt的分工，并准确披露public factory、custom入口和旧Run边界。未发现需要否决该有限研究方向的新增Spec缺陷；下述是必须保留的迁移准入阻断，不是把未声称完成的工作伪报为当前实现bug。

## 已证迁移阻断及最小处理

1. **P1—完整应用绑定尚未验。** 精确包 `classic-sdk-status.js:68–69` 拒绝custom owner进入内置state路径；所以不能仅包一层/comet再复用原phase Skill中的state命令。按已写PUBLIC-BINDING-GAPS，入口、执行/证据、Wait、Unknown调和及冷恢复必须绑定同一已锁application身份/版本/内容hash与Run，经其public dispatch；维持拒绝，不改owner冒充classic-full。原full用户Wait不能由A/T自动审查代填，已有目标授权不能直接充当任意新proposal同意。需实际loader/CLI/宿主正负例后才关闭此项。

2. **P1—归档后Kt硬门没有现成factory位置。** `classic-application.js:110–120` 的checkpoint集合无archive.execute/deliver之后，冻结fixture也真实验证插入被拒。最小原领域接缝必须保留真实Archive事实、同Run Kt pending、原UUID/operation及Unknown先读回、Kt缺失不completed；不能另起controller接尾。ADR0020第5项的权限事件/周期维护、独立隔离/恢复义务与时限仍归原Comet/原任务，不能因机械Run completed删除。

3. **P1—本项目安全/业务等价性未证。** A/T/P机械顺序及缺料/坏内容/旧hash拒绝不等于原R/A/T独立语义审查、P plan-only工具边界、测试作者→有效RED→Builder→独立V、全下游单调失效和还原字节不复活。新机械合同明确排除最后一项及真实身份/OS/ACL/平台/知识。按原任务建立义务→官方接缝→保留适配/负例映射，完整回归后逐项减patch；不能凭公开exports或一次factory绿删0002/0003。129当前检查/103场景、F10另期记录不变。

## 冻结证据与可接受范围

本轴独立核对 FROZEN-MANIFEST **82/82文件**的路径、字节数和SHA256，0不符；其SHA256为 `5d4979ea48ee3e4b2d13445b36ca2659e82dfe231d2da6f270947bdd8324eaf5`。另将四个关键JS/package文件直接与精确0.5.0 tar成员比对，相同。tar SHA256 `a36d88cd065e92266d483a6bf4946f9d61149a12f3075df107bfde3f4ad9c47f`，gitHead `aeb1a6598034e28ce46b8422d4dbd8785e607bd7`。

qualification-WZMDPs 的四进程receipt与最终快照为同Run mechanical-classic-full、rev51 completed；实际本地Build/Verify机器检查、OpenSpec1.14.3 Archive/local Git交付属于已冻结机械证据。Root另复跑WOp14F四阶段0、14包4462文件0extra，是Root复跑证据，本轴未冒称重跑。两者都不是真实独立角色/用户同意、TDD、生产OpenSpec1.11.0、LLMWiki/Outline、CI/CD或完整用户旅程；工厂已能跑完，不能仍只称“暂到Build”，也不能升格业务完成。业务接纳增量0。

**旧活动0.4.5 Run继续原已锁patched Runtime、定义和恢复义务；不得自动或借compat改绑到0.5。** 官方兼容承诺不覆盖自增gate/签名/operation。保留6da及5ec/40de的历史证据和负例；不继承为0.5通过，不复制/双写两套可推进状态。

## 来源与限制

官网定制指导保留机器检查、用户批准、机器Archive且应用入口分离，与精确包实现吻合。现场web open无法访问相关页；本轴采用Root留存的官网.md与精确发布包代码互核，不声称新做实时网页运行验收。原静态REPORT/SHORT-REPORT中的“尚未运行”属于早期研究，当前机械事实以本次冻结manifest/summary为准。无源/锁/计划变更授权来自本报告。

官方定位：[定制指导](https://docs.comet.rpamis.com/zh/skill-creator/classic-customization)、[精确工厂](https://github.com/rpamis/comet/blob/aeb1a6598034e28ce46b8422d4dbd8785e607bd7/domains/comet-classic/classic-application.ts)、[custom应用拒绝](https://github.com/rpamis/comet/blob/aeb1a6598034e28ce46b8422d4dbd8785e607bd7/domains/comet-classic/classic-sdk-status.ts)、[精确运行/迁移边界](https://github.com/rpamis/comet/blob/aeb1a6598034e28ce46b8422d4dbd8785e607bd7/docs/architecture/runtime-sdk-native-classic-integration.zh.md)。

## 输入摘要

以下hash绑定本次最终读回；研究期间Root修订过两份未冻结提案，本结论只针对此表版本。未把外发授权、fixture成功或历史报告当新资格。

| 输入 | SHA256 |
| --- | --- |
| `repo/openspec/changes/delivery-foundation-rearchitecture/official-comet-best-practices-review.md` | `802f39c2d7ac9e3f7357d12b0496a1849a78053f38c05278d835bc5820a6d3e9` |
| `repo/openspec/changes/delivery-foundation-rearchitecture/command-surface-proposal.md` | `988e2ade1e3f23e68f7034cadb9685d7302b059ccbcc1061a91d34c42cbd65f6` |
| `repo/docs/architecture/adr/0020-comet-command-knowledge-convergence.md` | `dc9d74aa1b10afd65f37da0383b874a15ae8c246e3f9d43bdda9b6bccf77406f` |
| `repo/docs/architecture/comet-ai-devops-convergence.md` | `3f3e754406b4195c7edf5dbd33c02f4327125dc309bb5a0113620afb461851a1` |
| `repo/openspec/changes/delivery-foundation-rearchitecture/classic-gate-runtime-contract.md` | `1dfa8dde0743dde7fbf65ec2c7903fa72d2b236b232f2751aa4b43a95825e3dd` |
| `repo/openspec/changes/delivery-foundation-rearchitecture/classic-post-archive-recovery.md` | `eba901d19e75243259ded6592c63c5a4465f27894aee5896e2d082275fc8199a` |
| `repo/openspec/changes/delivery-foundation-rearchitecture/knowledge-preauthorization-contract.md` | `77034c339078a78c93bdfa511c9cfe224cae9a7e858b9992c399d64017408a42` |
| `repo/openspec/changes/delivery-foundation-rearchitecture/tasks.md` | `2ca7fb9c9fe50f96ebcdc9b159cf907cc0e1f26f45adf05a0e03b9bfa406d6a1` |
| `repo/openspec/changes/delivery-foundation-rearchitecture/task-dag.json` | `ce4dedfc5e0b928ad6357fa61b25166819e8c76feb533d5cfcdc7d86b4aef566` |
| `repo/openspec/changes/delivery-foundation-rearchitecture/execution-contract.json` | `680f5be65f90d68516a9b0d2129e04d7617cdfd908356fe5082b71000d7f2326` |
| `fit/FROZEN-MANIFEST.json` | `5d4979ea48ee3e4b2d13445b36ca2659e82dfe231d2da6f270947bdd8324eaf5` |
| `fit/PUBLIC-BINDING-GAPS.md` | `0f166c9e9ec88bf3710390c0c39ce8c61ea8fe49b622ca7383cc4156ae116f59` |
| `fit/MIGRATION-PROPOSAL.md` | `4bcafb0633bdcf0f7a9bbd92a89105190a85716178f1fb67eb34275659a28555` |
| `fit/QUALIFICATION-CONTRACT.md` | `be2c263f4610df9256d855e0a203fcc0a2255576a6a1049f95ccec76bb464542` |
| `fit/qualification-summary.json` | `a63ffdaad78c6e7a15e5d2699e6fe14c9e31407462cd79a184faad35347a98a4` |
| `fit/classic-customization.md` | `76f3aba7191cd0268a0a5d687b7fe49bdeeb44170648d67a7ae669ac6edee0a4` |
| `fit/pinned-runtime-sdk-native-classic.txt` | `50d0cdbea4135e952dadc99254076a1c967584714c4bfb3d6e8949cb18623d18` |
| `fit/pinned-changelog.txt` | `d616c1accaec7c6cd7e5ab0a701050296ca9f0d910c70532b81c9a601f2a5f29` |
| `repo/.local/comet-reset/official-public-qualification/root-verification.json` | `a229643f4c0c054ae1a5a9d839a1856a26d9803250523193e26176e05ad2cac7` |
| `fit/comet-0.5.0/package/dist/domains/comet-classic/classic-application.js` | `bf2852d7070d9c5d3a2293be0d68281cf31908b1bb6bff9d613eb27fa801be7b` |
| `fit/comet-0.5.0/package/dist/domains/comet-classic/classic-sdk-status.js` | `b00d16d2fb25457d03e20fded8c0852949536bcf70d7b97f79b109cc12d2c470` |
| `fit/comet-0.5.0/package/dist/domains/comet-classic/classic-sdk-application.js` | `94334342cf9f92d5692c8f6e8dd122b8db68fb76a32c627b76b50cb051a7cd75` |
| `fit/comet-0.5.0/package/package.json` | `d371b2edf9f81813509329b852852032a8ada0617cdce18d22c9b9c81001a0a5` |
