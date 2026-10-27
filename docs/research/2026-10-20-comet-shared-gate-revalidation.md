# Comet 共同门纵向切片再验证

日期：2026-10-20。裁决：**REVISE**。现有 Gate 可接入原 Classic 写入与恢复路径；本轮只证明缺证据时的拒绝能力，未交付受管 Runtime，也未证明可信回执可以正常放行。

## 范围与事实来源

沿用 [上轮预研](2026-10-20-comet-feasibility-grill.md) 的固定 Comet 0.4.5 构建和隔离 OpenSpec 1.11。先在全新临时目录重跑原20条命令，原缺口仍可复现，Runner/Outline qualify 仍均退出2。没有安装正式 overlay 包，因此原生 CLI 与生成脚本的分离不能推导为所有正式安装模式均可绕过。

本轮在临时构建副本中修改 `classic-store.js`，在写入 journal 前、恢复已提交 journal 前调用同一个实验函数，函数实际调用本仓库 `lib/delivery/gate.js`。输入使用明确标记的实验 TestContract，要求 `required-method:grill-me`，回执集合故意为空。**这是拒绝路径的接入位置实验，不是方法真实执行、身份信任或回执准入认证。** 没有添加第二 Run、阶段库或调度器；未改固定构建、上游 lock、项目 Gate、执行状态和任务验收勾选。

- [可复跑实验程序](../../openspec/changes/delivery-foundation-rearchitecture/overlay-prestudy/shared-gate-spike.mjs)
- [本轮机器结果](../../openspec/changes/delivery-foundation-rearchitecture/overlay-prestudy/shared-gate-results.json)：逐命令退出码、输出、源文件与候选摘要。
- [重跑的原基线结果](../../openspec/changes/delivery-foundation-rearchitecture/overlay-prestudy/feasibility-results-r2.json)

## 实际结果

| 公开入口 / 条件 | 原生固定构建 | 临时共同门候选 | 判断 |
| --- | --- | --- | --- |
| `guard boundary-probe open --apply`，缺回执 | exit 0，读回 Design | exit 70，读回 Open，YAML 未变 | 写入位置可拦截正常推进 |
| `state transition boundary-probe open-complete`，缺回执 | exit 0，读回 Design | exit 70，读回 Open，YAML 未变 | 可拦截直接 transition |
| `COMET_FORCE_PHASE=1 state set ... phase design`，缺回执 | exit 0，读回 Design | exit 70，读回 Open，YAML 未变 | 本切片可拦截修复入口 |
| 构造 YAML 已提交的中断 journal，随后锁内操作 | 可继续执行 | exit 70，journal 保留，已提交 YAML 保留 | 恢复拒绝成立；不代表回滚或恢复完成 |
| 上述恢复异常时 `state get ... phase` | exit 0，返回 Design | 仍 exit 0，返回 Design | 状态读回尚不能代表受管流程可用 |
| Ponytail 同一项目、独立 `PLUGIN_DATA` | A 切 lite | B 仍 full；A 读回 lite | 脚本级模式隔离可行；不是 OS 权限隔离 |

Guard 在无 `--apply` 时也可能初始化原 Run；实验先完成这一步并确认仍为 Open，再比较拒绝前后 YAML，避免把合法初始化与推进混淆。事务恢复使用明确构造的故障夹具，不代表普通 worker 已被证明能够篡改 journal。

## Grill 发现与实施约束

1. **共同判定位置有可行性证据。** 在原 store 的两处接点调用现有 Gate，即可覆盖本轮三个推进入口与锁内恢复；不需要外围再造阶段控制器。但仅覆盖 Open→Design，不能外推到 archive、所有 Run 更新和其他阶段。
2. **恢复与读回仍是 P1。** 恢复拒绝可以保全 journal，却无法取消此前已提交的 YAML。标量读取仍可报告 Design。正式实现必须定义同一事务中回执、输入快照与提交点的关系；恢复异常应在权威状态读回明确呈现 blocked/recovery-required，不能让调用方只凭 phase 或 exit 0 判断已放行。不得无条件重放陈旧批准，也不得自动覆盖已提交或人工修改的文件。
3. **不得把这个候选安装为 Runtime。** 它故意始终缺回执，没有可信接纳/正常放行路径；异常使用原生通用 exit 70，尚无正式错误契约。OVR 当前修订评审、受保护控制目录、身份签发、当前 Change/候选/策略绑定和正式 overlay 安装均未完成。
4. **Ponytail 独立数据目录足以解决本轮模式串扰。** 仍需宿主实际支持该变量并正确注册生命周期事件。它只注入方法，不签验收、不推进 Comet；同 OS 账户下不同目录也不构成安全边界。

## 测试工具修复与验证

重验发现 `test/delivery-cases/2_2.mjs` 的子进程未固定 reporter，当前 Node 下输出不是 TAP，造成 `parseTapSummary` 返回 null：8项中4项失败。最小修复仅给实际子测试加 `--test-reporter=tap`，不修改解析器、准入规则或断言。

- 固定 Node 24.15.0 执行 `node --test test/delivery-cases/2_2.mjs`：修复后 **8/8通过**。这是 Gate/证据组件验证，包含实际子进程运行；不是独立宿主身份或实际 Skill 执行验收。
- 可写隔离副本中执行 `bash scripts/check.sh`：**185/185通过**，规则/技能/YAML/JSON 校验通过。保留 Git index 和符号链接语义；不向活技能目录写测试状态。该套件不替代上面单独执行的 `.mjs` 用例。
- 原实验再次执行：20条命令完成；共同门实验有自检断言，原构建和 Gate 内容摘要前后相同。

实验调试中曾因未固定 OpenSpec 入口、未先初始化 Run、错误假设所有标量读取都会失败而触发断言；保留临时记录，不将这些失败描述为产品回归。隔离仓库首次复制未保留软链，规则检查拒绝，修正复制方式后总检查通过，未放宽仓库规则。

## 下一步边界

推荐方向保留：官方 overlay 提供方法组合，原 Classic 独占推进，项目 Gate 提供可信判断。正式实施先处理当前修订 OVR 与恢复/状态读回合同，再完成有可信回执的正向放行和陈旧/伪造/跨 Change 负向验证，随后接真实独立角色和一个实际业务 MCP。Runner、Outline、权限撤销、平台合并/发布和完整100场景均未验收，本轮不增加任何运行验收计数。
