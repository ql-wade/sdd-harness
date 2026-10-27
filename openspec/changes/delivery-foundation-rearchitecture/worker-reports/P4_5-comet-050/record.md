# P4_5-comet-050 worker record — 可选 Ponytail hook 装配

- 任务：P4_5（tasks.md "### Task P4_5"），修订 2026-10-26-comet-050-adoption-v1
- 仓库/HEAD：/Users/mac/Code/sdd-harness @ 922659907068541ba98ee9997aae0d8faf4cbdde（工作树，未 commit——按边界禁止）
- 钉版环境：node v22.13.1 / python3 3.14.7 / macOS darwin 24.6.0 arm64；Comet 0.5.0 基线（toolchain-baseline QUALIFIED 2026-10-26）
- 改动文件（全部在 P4_5 Owns 内）：
  - `test/delivery-hook-assembly.test.js`（+1 用例，仅测试）
  - `openspec/.../worker-reports/P4_5-comet-050/`（本记录与证据）

## 1. Record（装配现状）

见 `evidence/assembly-state.txt`。要点：hooks.yaml（唯一策略源）无 Ponytail 条目且
设计上不可有（§7.2 注册分工：插件生命周期 Hook 由插件入口注册；adapter 固定事件集
= PreToolUse/SessionStart(startup|resume)/Stop，固定集外事件与插件来源脚本都在产物
写入前被拒）。活配置 .claude/settings.json 恰好 3 个受管条目、无插件条目；宿主侧
Ponytail 经 ZCode 插件缓存 5.2.0 注册（与分发快照 5.3.2 的 hooks 清单结构全同，
仅 timeout 15→5；版本偏差如实登记）。registration-matrix（task: P4_5）与
method-profile-manifest 的 hook_registration_division 与实际一致。

## 2. RED（钉版现状观察）

`node --test test/delivery-hook-assembly.test.js test/delivery-cases/4_5.mjs
test/adapter-quoting.test.js` → 24/24 全绿（evidence/RED-4_5-baseline.txt）。
**无行为 RED**：装配语义（含 E05 缺席/静默/超时不可跳门、E06 重复/压缩/子会话、
三方共存、卸载/重装、bootstrap 幂等）在前序波次（rework-seven-p1-r1、P1_2）已实现
并合入；本修订按 tasks.md Step 1 语义如实记录"当前全绿"，不以缺环境或编造失败
充当 RED。发现的唯一覆盖缺口见 §3。

## 3. Implement（装配验证为主，不改策略语义）

- **装配状态核对**：hooks.yaml 侧 Ponytail 不装配（设计排除，非缺席）；插件入口侧
  本宿主已注册。装配条件与可选状态登记见 assembly-state.txt §5。
- **覆盖缺口修补（仅测试）**：adapter 的 §7.2 plugin-source 门（hooks.yaml 携带
  CLAUDE_PLUGIN_ROOT/.claude/plugins/ 脚本即拒绝）此前无直接测试——既有 E06 只钉
  固定事件集那半。新增用例：两种插件来源形态（env 变量形态/路径形态）追加进
  hooks.yaml，adapter 必须非零拒绝、点名策略、且两个产物视图字节不变。
- **可跳门断言既有覆盖核对**（未改，逐项确认）：
  - 缺席：hook-assembly E05（脚本消失→可见失败 + deny 门仍 exit 2 + SDD.Gate
    仍 blocked/MISSING_OBSERVATION）；4_5.mjs E05 同义。
  - 重复：adapter 冲突拒绝（同 event+command REFUSE，含插件包装受管命令）；
    hook-assembly E05 三方共存"每固定事件恰一条受管条目"+ 重复装配字节稳定；
    adapter-quoting 重复装配不增不重排。
  - 静默失败：4_5.mjs E05（exit 0 无注入 = NOT_EVIDENCED，badge/map 在场也不算）；
    hook-assembly E05 失败/静默/超时均不伪造 receipt、世界字节不变、门仍拦。
  - fail-closed：adapter-quoting（不可解析输入必须 deny exit 2；matcher 覆盖每个
    deny 策略——无死代码）。
- **升级/卸载 + bootstrap 幂等**：P1_2 已实现（worker-reports/P1_2.json），本轮
  仅核对覆盖存在且绿：adapter-quoting『target bootstrap repeats and uninstall
  preserve mixed hooks』『mixed hook uninstall removes only owned handlers and
  preserves plugin plus user metadata』；hook-assembly E06 用户启停（卸载只删受管块、
  插件/用户条目保留、重装语义等价 + compiled env 字节一致）；1_2.mjs 插件注册分工
  （init/re-pull/uninstall 全程保留插件条目）。**无需重复实现，未重复实现。**

## 4. Verify（钉版，全绿）

- 三套件：25/25 pass（含新用例）→ `evidence/GREEN-4_5-suites.txt`
- `bash scripts/check.sh` 完整：exit 0（规则层/技能层/whitebox 自测/MCR gate/
  npm test 1157 全绿/YAML-JSON 静态）→ `evidence/GREEN-check-full.log`
- 瞬态：首轮 check.sh 内嵌批次出现 6 个未复现失败（非 P4_5 套件），两次完整复跑
  1157/1157 绿 → `evidence/transient-observation.txt`
- 测试污染红线：活配置 .claude/settings.json 与 hooks/.compiled.env 指纹测试前后
  逐字节不变（assembly-state.txt §2）。

## 5. Step 4/6 边界（未做，如实）

- Step 4 独立 Spec/质量审查不在本 worker（测试作者不签 Whitebox）；本轮自测范围 =
  结构装配 + 脚本行为 + 活配置一致性，非宿主行为证明。
- Step 6 禁止 commit（边界指令）；tasks.md 勾选归控制器，未动。
- 并行工作树中的其他改动（docs、lib/adapters/llmwiki.js、test/delivery-cases/4_4.mjs、
  test/knowledge-closeout.test.js 等）属 P4_4 等兄弟 worker，本 worker 未触碰。

## UNVERIFIED（缺环境/超出证明范围，如实声明）

1. **真实宿主会话内注入**：hooks 上下文实际进入 Claude Code/ZCode 活会话、
   Ponytail 插件 runtime（mode tracker/activate）在宿主内的行为合规——结构装配
   测试不可替代（归宿主验证波/VERIFY，与既有 4_5.mjs 声明一致）。
2. **Ponytail 插件 5.3.2 vs 宿主注册 5.2.0 的运行时差异**：仅静态对比了 hooks
   清单结构全同（timeout 差异已记录）；5.3.2 分发快照在宿主内的升级/替换行为
   未验证（供应链升级需显式改 pin + 验证，不在本任务）。
3. **execution-contract 的 V_E05/V_E06/V_H02 command-first 旅程**
   （node tools/verify/delivery-journey.mjs --scenario …）：契约标注
   NOT_VERIFIED_ON_COMMAND_FIRST、execution_owner=VERIFY、implementedBy=P3_1——
   归 P3_1/VERIFY 波次，本轮只跑 case-module 层，未以此关闭父义务。
4. 首轮 check.sh 的 6 个瞬态失败未定位到用例名（未复现，两次全量绿）；若复现归
   其属主套件处理。
