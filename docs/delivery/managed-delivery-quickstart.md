# 受管交付快速走查（新 session 集成指南）

> 本文由零上下文冷启探针实测产出（2026-10-23，fresh-session-probe）：每条命令都真实执行过。
> 适用前提：项目内已有指纹钉定的 Comet 构建（`.sdd/vendor/comet/<commit>/builds/<fp>/work/bin/comet.js`）。

## 人类需要输入什么（全部输入面）

| 时点 | 人类做什么 | 形式 |
|---|---|---|
| 发起变更 | 决定做什么（一句话） | 对 agent 说，或 `/sdd-new` |
| 关键资源授权 | 启用 runner 栈（upGate ACK）/ 跨机器启用 / 凭据 provisioning | 按需出现 0-3 次；agent 会带证据来问 |
| 范围裁决 | open_decisions 两难（如 F10） | 不阻塞主链时可攒着 |
| 终局验收 | 看三产物 + 评审结论 | 接受或打回 |

**其余全部由 AI agent 驱动**：不知道下一步就问引擎（`comet state next` 会给出 ROUTE+阶段+技能名）。

## 动手走查（10 步，探针逐条实测）

```bash
COMET=.sdd/vendor/comet/*/builds/*/work/bin/comet.js   # gitignored，主检出处
mkdir -p "$TMPDIR/probe-proj" && cd "$TMPDIR/probe-proj" && git init

# 1. 项目脚手架（--platform 合法值：claude-code 等；首次某组件 failed 属已知怪癖，原样重跑即 complete）
node "$COMET" init . --workflow classic --yes --scope project --platform claude-code --json

# 2. 受管初始化（--managed-delivery 开门禁回执面；--knowledge-closeout-required 声明 Kp/Kt 义务）
node "$COMET" state init fresh-session-probe full --isolation current \
  --managed-delivery --knowledge-closeout-required true --json
#   → run authority 自动绑定本机（[BOUND] <hostname>）

# 3. 问引擎下一步（代替人猜）
node "$COMET" state next fresh-session-probe --json
#   → ROUTE: requirements-repair … + /comet-open（缺工件时）

# 4. 补最小工件（proposal/design/tasks），再试门禁：先拒（缺 R 回执）
node "$COMET" guard fresh-session-probe open --apply
#   → 8 项工件检查全 PASS 后仍 1 FAIL: "managed delivery gate premises (enter-design):
#      gate R: no accepted receipt (dispatch and accept through the Runtime before this action)"

# 5. 签发 R 门禁（Runtime 分配 role/inputDigest/attempt/epoch——agent 不能自选）
node "$COMET" state dispatch-gate fresh-session-probe R --json

# 6. 交卷（result.json schema，见下）→ [ACCEPTED] gate R pass (epoch 1)
node "$COMET" state accept-gate fresh-session-probe R --file r-result.json --json

# 7. 同一门禁再次放行：9/9 ALL CHECKS PASSED，[SET] phase=design
node "$COMET" guard fresh-session-probe open --apply

# 8. 之后每阶段同构：state next 问路 → dispatch-gate <A|T|P|V> → 干活 → accept-gate --file
#    A 的结果文件须内嵌全票共识证据+digest；T 须带独立测试设计评审；P 重新签发=generation+1（旧回执作废）

# 9. 知识义务拦截（Kp/Kt）：
node "$COMET" state gates fresh-session-probe --json
#   → COMPLETION: blocked — knowledge-closeout（即使 archived 也算未完成）
#   解除：真实发布知识 → comet state knowledge-closeout <change> --file <receipt.json>
#   回执字段：targetKind(file|external)/target/revision/readbackDigest(sha256)/execution/recordedAt

# 10. 归档（Kp 在手才放行）：comet archive <change> --json
```

## accept-gate result.json schema（引擎会教学式逐条拒绝到正确为止）

```json
{
  "execution": "<dispatch 返回的 execution>",
  "attempt": 1,
  "verdict": "pass",
  "inputDigest": "<dispatch 的 inputDigest，逐字绑定>",
  "report": "<非空评审/产出正文>",
  "reportDigest": "<sha256(report 文本)>"
}
```
常见拒绝：inputDigest 未绑定 dispatch / reportDigest 不是 report 的 sha256 / pass 缺 bound review evidence（P1-02：A 须带全票共识、T 须带独立测试设计评审）。reject verdict 另需非空 findings。

## 已知缺口（反馈给上游/后续）

1. `comet state --help` 未列出 dispatch-gate/accept-gate/gates/knowledge-closeout/knowledge-publish（子命令真实存在）——上游 help 缺口，触发器 T2。
2. `comet init --platform` 合法值不随 help 输出；首次 init 某组件 failed 无诊断（重跑即好）。
3. 本文即为冷启探针发现的缺口 1/3 的补齐；schema 文档缺口 2/3 同步在此闭合。
