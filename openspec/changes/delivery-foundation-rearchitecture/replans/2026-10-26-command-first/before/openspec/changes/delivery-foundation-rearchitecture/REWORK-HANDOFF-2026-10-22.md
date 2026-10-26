# 七P1返工执行交接（rework-seven-p1-r1 暂停点）

日期：2026-10-22。本文件是唯一控制器的执行层交接；计划层权威仍是 HANDOFF.md（七P1返工交接）+ execution-prompt.md 覆盖段 + drift-lock.json（amendment 3）+ consensus/2026-10-22-plan-r3/（三方全票授权）。

## 工作目录与环境

- 控制器工作区：`/Users/mac/Code/sdd-harness`（主检出，master 分支）
- 计划提交：`ebe5fff`；当前 master：`c4606b9`（暂停记账）
- 实施隔离：`.claude/worktrees/rw-*`（每任务一个 worktree + `rework/<task>` 分支）
- Node 双版本：22.13.1（默认 shell）/ **24.15.0（comet 构建与验证必须用** `PATH=/Users/mac/.nvm/versions/node/v24.15.0/bin:$PATH`）
- 沙箱边界（实测）：会话 Bash 拒 docker.sock（EPERM）与外部评审 CLI；**docker 与外部 CLI 走桌面终端面板**（`mcp__terminal__run_in_terminal`，用户可见逐条审批）。宿主 curl 对 127.0.0.1 受系统代理干扰，容器内验证为准。

## 暂停时状态（2026-10-22T09:45Z）

### 已验收（9 ACCEPTED）
P1_1（工具链重验+llmwiki 项目化落地）、P1_2（分发重验+UTF-8 locale 崩溃修复+F02/F04 锚点）、P2_1（基线重验+real-drift 锚定）、P2_2（gate 纯度重验，零代码）、P2_3（CLI/legacy 重验+quorum 只读复验，双轨）、**P3_1（P1-04 验收器主修复：分母/断言映射/typed 读回/--journey 接口）**、**P2_4（P1-01/02/03 运行时主修复+锁集成 fingerprint d4370930）**、I04（llmwiki 域项目化语义）、I06（16 负码镜像+LOCAL_ONLY 诚实回执）

### 部分验收（4，环境门控步保持未勾）
P1_6 7/8（Step5 宿主会话证明→真实 Runner/host）、I01 3/4（Step3 gh TLS x509→user）、I03 3/4（Step3 真实 Outline 实例→部署波次，**栈已部署见下**）、I05 3/4（Step3 真实容器→docker 可达后）

### 部署波次（已完成，超出原计划的前置解锁）
Outline 栈 6 容器运行中（outline:digest-pinned/postgres:16-alpine/redis:7-alpine/minio:RELEASE.2025-04-22T22-12-26Z/dex OIDC issuer）；images.lock 准入记录（admittedBy/At/reason，5 digest pin，validate 干净）；up-gate 准入语义 TDD 补丁（enabled=true 须带完整 admittedBy/At/reason，否则仍拒）；运行时装配在 `.sdd/outline/runtime/`（gitignored：secrets.env 真实秘密/compose.override.yaml/dex config 三测试主体 owner|member|offboarded@sdd-harness-pilot.test，bcrypt 哈希在案）；OIDC issuer=`http://127.0.0.1:5556/dex`（浏览器侧）与 `http://outline-dex:5556/dex`（容器侧 Outline 拉取）分离，**容器内 discovery 200、Outline listening 3000 已验证**。宿主浏览器访问需代理直连例外：Merge.yaml 已写入 127.0.0.1/::1/localhost DIRECT 规则，**待用户在 Clash Verge 界面重载配置**。

### 在途（已停止，含残留）
- P2_5：worker 停在"计划已成、未写代码"——worktree `rw-p2-5` 干净，恢复直接按原简报重派或续作
- I02：worker 停在本地半边调试——worktree `rw-i02` 有未提交残留（`test/infra-runner-isolation.test.js` 修改 + `worker-reports/I02-rework/`），恢复时先评估残留质量再续作/重派

## 执行顺序（冻结，剩余）

1. 重派/续作 P2_5（P1-02 消费收尾）+ I02（P1-05 真实 Runner；docker 步骤走终端通道执行其 `terminal-channel-commands.sh`）
2. P1_3、P1_4、P1_5（接入复验；依赖 I02 真实资格）
3. 跨边界：P3_2、P3_3、P3_4、P4_4、P4_5、P4_6、P4_7、P4_8、I07、I08（观察配方+机制重验）
4. 终局：P4_3（重建四层索引）→ P5_1、P5_2（F10 未启用态语义不变）、P5_3 → **VERIFY**（118 检查全跑 + 三条真实旅程 + 92 场景 + verification-report.md / grill-report.md / verification-results.json，绑定最终基线）
5. 完成判定：零剩余 required、七 P1 全关闭、三方一致、证据绑定最终基线 → 停 cron。OpenSpec 归档不在此 run（Comet closeout owner）。

## 质量门（不变）

每任务：真实 RED（模块缺席/env 崩溃不算行为 RED）→ 最小 GREEN → 回归（已知环境项外零新增：C08 host-openspec 漂移、B08 preservation、4.8.d 负载时敏抖动、.sdd 状态敏感套件数）→ 独立评审（冷启动、全清单独立复跑、变异重做）→ 控制器串行接纳（逐段断言+磁盘回读+台账）。共享锁 `integrations/comet/upstream.lock.json` 只由控制器集成更新；UNVERIFIED 不转 PASS；历史 PASS 不继承。

## 已知环境事实（照抄，勿重新踩坑）

- llmwiki：项目化落地（SDD_HOME=<repo>/.sdd，clone pin 075c5b4，venv .sdd/venvs/llmwiki-311）；探针命令 `SDD_HOME=<repo>/.sdd LLMWIKI_PYTHON=<repo>/.sdd/venvs/llmwiki-311/bin/python node tools/infra/llmwiki.mjs probe --case worktree-mcp-readback` → exit 0
- Comet 构建：fingerprint d4370930（patches 47d2eebd/3b8aab43 集成后）；**勿复用漂移副本**（worker 构建曾 DRIFT，已隔离 `/Users/mac/Code/claude_tmp/p24-drifted-build-quarantine`）；重建命令=终端通道跑 `rw-fetch-build.sh`+`rw-build.sh` 模式（digest 校验上游 tarball→build.mjs --archive）
- 指纹计算必须用 node（JS JSON.stringify 键序），python json.dumps 会得出不同值
- gh TLS 拦截（x509 -26276）：I01 readback 保持 UNVERIFIED；评审环境曾见 404（类目无关，门是类目无关的诚实 UNVERIFIED）
- check.sh 白盒 fixture：`.gitignore:21 *.log` 排除 6 个 fixture（基线预存，域外）
- uv 需 `UV_CACHE_DIR=$TMPDIR`（沙箱拒 ~/.cache/uv）

## 用户侧待办

- Clash Verge 重载（127.0.0.1 直连规则已写入 Merge.yaml）→ 浏览器实测 Outline 登录
- 9 项 OPEN 裁决（HOST_OPENSPEC_DRIFT、I08_FILENAME_DEVIATION、OV_OVERLAY_CANDIDATE 等——见 execution-state.json open_decisions；均不阻塞实施）

## 恢复程序

1. 读本文件 + execution-state.json + execution-ledger.jsonl 尾部 20 条
2. 评估 rw-i02 残留（`git -C .claude/worktrees/rw-i02 diff` + 未跟踪报告）→ 决定续作/重派
3. 重派 P2_5 + I02（简报可基于本文件+原简报模板重建；r3 共识回执与 P2_3 quorum 证据可复用）
4. 激活 20 分钟监督 cron；按冻结顺序推进至 VERIFY 三产物
