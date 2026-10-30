# r4 业务 VERIFY 旅程状态（2026-10-30 出局报告）

## 已真实完成（本工作树，隔离 HOME=/private/tmp/claude-501/r4-home，node24）

1. v10（63a9a02a…）真实安装到本项目注册表（.comet/applications/.../current.json version=10）。
2. Run `minicraft-html-game-r4` 真实启动（comet-classic-full@1，受管 initialState isolation=current）。
3. 经 REVISION_CONFLICT → 文档化 `next` 恢复 → 分支绑定恢复（精确 argv）后 Run 可解析。
4. `classic.composition.prepare` 执行 → 1 wait → resolve approved（决策 id：human-delegate-claude-session-20261030）。
5. `full.open` claim（session-id=真实 claude 线程 b061b013-…，会话文件在 ~/.claude/projects）→ record-outcome（open-complete）→ 派生 submissionId（B-② epoch-qualified）record-evidence（contentHash e1be0efc…）。
6. `full.open.confirm` wait → **人类委托批准**（decision-id: human-delegate-requirements-approval-20261030）。
7. `full.open.revalidate` 执行 → **R 门 `classic.extension.requirements-open` 现身（pending）**。

## 当前停点与精确恢复命令

```bash
export PATH="$HOME/.nvm/versions/node/v24.15.0/bin:$PATH"
export HOME=/private/tmp/claude-501/r4-home
APP="$PWD/$(ls .comet/applications/sdd-managed-delivery/versions/63a9a02a*/application.json | sed 's|^\./||')"
printf '{"operation":"next","runId":"minicraft-html-game-r4"}' > /tmp/claude-501/r4-recover.json
comet runtime dispatch --application-file "$APP" --project-root "$PWD" --request /tmp/claude-501/r4-recover.json --json
node "$(ls .comet/applications/sdd-managed-delivery/versions/63a9a02a*/scripts/comet-run.mjs)" inspect --project-root "$PWD" --run-id minicraft-html-game-r4
```

## R 门通过的剩余构造清单（全部字段/形状已核实）

1. 端口扩展：`admissionOptionsFor` 补全受保护上下文（authority/actionBinding/sourceQualification/purpose/environment/consumedCollections/issuedExecutions——现缺，admitManagedEvidence 会拒 PROTECTED_CONTEXT_REQUIRED）。
2. claude 会话读取器（lib/adapters/claude-host-source.js 已起草于本报告后继提交）：定位 ~/.claude/projects/<slug>/<uuid>.jsonl，提取一条 Bash tool_use/tool_result 对（command/output 摘要）与一条 assistant 文本（review 声明摘要）。
3. 驱动器（/tmp 脚本，不触发 Write 钩子）：cometLaunchAuthority(secret≥32) → ActionBinding（schema 字段全列出：profile/action/revision/methods/allowedPaths/workPackage/inputs/outputs + schemaVersion）→ issueDispatch(role=verifier) → collectResult（sourceVerifier 回读真实 claude 会话记录，qualifiedObservation 要求 facts 绑定全部派发键+principal+observation 命令/结果/计数）→ envelope（EvidenceEnvelope 字段齐备）→ admitEvidence(managed)。
4. 独立审查：第二条 claude 线程（独立根会话，身份互异由 gate 身份集强制）输出确认声明，digest 进 verifyReview 绑定。
5. v11 重编译（claude-host-source 进 vendored 闭包）+ 重装 + R 门 record-outcome。
6. 停驻的 R 动作 id：minicraft-html-game-r4:7（inputHash dfa553a1edb6264b）。

## 结构性发现（本次 VERIFY 的核心结论）

- 沙箱内三种 agent CLI 均不可孵化：codex exec（进程内 app-server EPERM）、claude -p（嵌套未认证，桌面凭据不传递）、zcode（Electron Mach-port EPERM）——真实线程必须来自操作者终端，协作界面已就绪。
- Comet Hook Router 已在真实拦截会话写入（对 r4 Run fail-closed 要求恢复）——产品控制平面在真实运行，not演示。
- 端口缺口（PROTECTED_CONTEXT_REQUIRED 字段族）由阅读 admitManagedEvidence 源码定位，属六步①③的自然延伸，非设计缺陷。
