# ci-parity-050 — CI 环境自足装配（P4_1 后续，run 40431704560 根因收敛）

- 任务：让 `npm test`（本地 1134/1134 绿的同等环境）在 CI 复现。
- 失败 run：40431704560，headSha 96967bd，workflow **scaffold quality gates**
  （`.github/workflows/quality-gates.yml`），失败步骤 `Gate/audit regression suite`。
- 边界修正（重要）：控制器任务书写的是 `delivery-gate.yml`，但该 run 实际是
  **quality-gates.yml** 的 `checks` job；`delivery-gate.yml` 不跑测试（它是
  merge 判定读back门，且已带 fetch-depth: 0）。ci-policy.json 的两个候选检查
  （`checks` + `delivery-gate`）中，跑 npm test 的是 `checks`。因此本任务把环境
  装配落在 quality-gates.yml；**delivery-gate.yml 未做任何改动**（其内容受
  test/ci-delivery-gate.test.js 逐字断言约束，无需环境装配）。

## 一、CI 失败根因映射（对照 --log-failed 全量 38 条 not-ok）

| 失败类 | 测试 | 根因 | 修复归属 |
| --- | --- | --- | --- |
| A 钉版 Comet 构建缺失 | C08 四测(#89-92)、legacy asset helper(#420)、spec-closeout managed Run(#857/871-873)、adoption 登记(#694) | CI 无 `.sdd/`（上游不提交），测试读 `.sdd/vendor/comet/<commit>/builds/<fp>` | **本任务**（workflow 装配） |
| A' 历史（零补丁）构建 | #694 `adoption buildFingerprint` | registry 钉的是零补丁指纹 `29f2332b…`，当前 lock 构建是 `de39629a…`——**两个 build 都要在盘** | **本任务**（双构建步骤） |
| B OpenSpec 隔离候选/宿主 CLI | #89-92（1.11.0 候选 + 宿主 `openspec` PATH） | CI 无 `.sdd/tools/openspec-*`，宿主无 openspec | **本任务**（workflow 装配） |
| C PyYAML 6.0.3（`python3 -I` 可见） | I05 全部(#456-484) + I02 runner 域(#707-725) | 解析器钉死 PyYAML==6.0.3 且 `-I` 隔离模式；ubuntu 系统 python 无该包。**与 docker 无关**（I02/I05 设计上不触碰容器守护进程） | **本任务**（venv 供给） |
| D 完整 git 历史 | F04(#411)/B09(#414) 解析路径 | checkout 默认 depth=1 | **本任务**（fetch-depth: 0） |
| E `.log` fixture 提交缺口 | packaging(#208)、drift gate(#382)、F04(#411)、B09(#414) | `.gitignore:21` `*.log` 静默吞掉了**所有 verbatim 镜像里的 .log fixture**：本地盘上 196 个文件从未进 git（`integrations/comet/application/**` 28 个、`foundation/baselines/**` 140 个、`foundation/release/**` 28 个）。本地绿是因为盘上文件在；任何 fresh clone 缺 14 个文件（如 packaged whitebox-verify 125/139）→ 封存 exportDigest/sealed cache 校验失败 | **不在本任务边界** —— 控制器需 `git add -f`（见"四"） |

另有两项**本地（非 CI）现状**如实记录：
- 真实仓当前 `npm test` = 1132/1134（红 #382/#411）。根因是**未提交的本地
  `package.json` 改动**（corepack 自动写入 `packageManager: pnpm@11.1.0+sha512…`
  + em-dash 由 `\u2014` 转义形态重写为裸字符）污染了 assetData 摘要输入。
  stash 该文件后同样红（另有 196 文件缺口叠加）。CI 端无此扰动（干净 checkout）。
- `execution-ledger.jsonl` 的 +1 行是控制器 01:23 UTC 的治理记录（GOVERNANCE_MISS…），
  非本任务写入，未触碰。

## 二、workflow 改动（.github/workflows/quality-gates.yml）

`checks` job 环境自足化（job id 保持 `checks` = 检查名；未加任何新 secret/权限）：

1. `fetch-depth: 0` — 基线解析走 `git cat-file/show` 定版提交。
2. `node-version: 24.15.0`（upstream.lock.json `toolchain.node` 钉版；build.mjs
   逐字拒绝其他版本）+ `cache: npm`。
3. `npm install -g pnpm@10.18.3`（`toolchain.pnpm` 钉版；build 内 `pnpm --version`
   逐字校验）。
4. 供给装配：按 lock 从 codeload 下载归档 → 显式 `sha256sum --check` + 字节数核对
   （工具内 `prepareCometSource` 还会再验一遍 sha256+bytes）→
   `prepare-source.mjs` → `build.mjs`（产出 `de39629a…`）；
   再以 `patches:[]` 的 lock 副本（写在 `$RUNNER_TEMP`，不进树）跑第二次
   `build.mjs`，确定性复现 registry 钉的零补丁指纹 `29f2332b…`
   （fingerprintOf 可本地精确复算，两指纹均验证 MATCH，见 evidence/12）。
5. OpenSpec 隔离（**按控制器 2026-10-27 设计变更**）：版本单一事实源 =
   `toolchain-baseline.json` `openspec.isolated_candidate`（脚本回退值 1.15.0；
   非精确 semver 一律拒绝），安装到 `.sdd/tools/openspec-<version>`，
   `COMET_OPENSPEC` 经 `$GITHUB_ENV` 指向其 `.bin/openspec`；同时
   `npm i -g` 同版本作 ephemeral 宿主 CLI（C08 current-host 观察腿）。
   workflow 内**不硬编码 1.11.0/1.15.0**（仅事实源回退值）。
6. PyYAML venv（`$RUNNER_TEMP`，`pyyaml==6.0.3`）经 `$GITHUB_PATH` 前置 ——
   venv 自身 site-packages 在 `python3 -I` 下可见（本地实测），I02/I05 解析器
   因此获得钉版 strict loader。Docker 不供给（按设计无需）。
7. `timeout-minutes: 60`。

## 三、本地验证（全部实录，evidence/）

| # | 验证 | 结果 |
| --- | --- | --- |
| 01 | 供给装配全链（fresh codeload 下载→sha256/bytes→prepare→build），在 HEAD 96967bd 的干净 clone 内、node 24.15.0 下真实执行 | PASS，fingerprint `de39629a…` 与测试钉版一致 |
| 12 | 零补丁第二构建 | PASS，fingerprint `29f2332b…` 与 registry adoption 钉版一致 |
| 02 | openspec 隔离安装（npm registry 精确版本） | PASS，`node_modules/.bin/openspec` + `bin/openspec.js` 均可用，版本应答正确 |
| 11 | C08 current-host 腿模拟（PATH 解析 openspec 1.11.0、scratch root、CI 式 env） | PASS，`status --json` 暴露全部 dependency edges（与登记 closure 同形） |
| 03 | PyYAML 6.0.3 venv + `python3 -I` | PASS（PATH 解析的 python3 -I 下 import 6.0.3） |
| 04 | `code-knowledge.mjs validate --json`（venv PATH，即 #471 的动作） | exit 0 |
| 07 | clone（补齐 196 个被忽略 fixture 后）foundation 全文件 | **61/61**（#382/#411/#414 在"干净 package.json + 完整镜像"下全绿） |
| 13 | **clone 全量 `npm test`**（HEAD checkout + 完整历史 + 双构建 + 隔离 openspec + venv + node 24.15.0 + 196 fixture 在盘 + COMET_OPENSPEC） | **1134/1134，0 skip** |
| 10/14 | workflow 约束测试（ci-delivery-gate + infra-platform + infra-runner-isolation 146 测）与 actionlint 1.7.12 + YAML parse | 146/146；actionlint 两文件 PASS |
| 05 | 真实仓全量（改 workflow 后） | 1132/1134（仅上述本地 package.json 扰动 + 196 缺口的 #382/#411；与 workflow 改动无关，stash 验证排除因果） |

克隆目录必须叫 `sdd-harness`（llmwiki 项目 slug 取主仓目录名；GitHub runner
固定 checkout 到 `…/work/<repo>/<repo>`，天然满足；中间一次 11 失败的运行
即此路径假象，见 evidence/09）。

## 四、控制器待办（CI 变绿还差的两件事，均在本任务边界外）

1. **提交 196 个被 `*.log` 忽略的 fixture**（精确清单：
   `evidence/missing-ignored-fixtures.txt`，含路径与计数）：
   ```bash
   xargs -a <(grep -v '^#' worker-reports/ci-parity-050/evidence/missing-ignored-fixtures.txt | grep -v '^$') git add -f
   ```
   或在 .gitignore 加负规则后 add。不补则 #208/#382/#411/#414 在任何 fresh
   checkout 恒红（本地盘文件不等于 git 内容——这正是本次 CI/本地分歧的核心教训）。
2. **处理本地 package.json 的未提交改动**（corepack 写入的 `packageManager` +
   em-dash 重写）：还原或显式提交并重封 foundation 基线，二选一，但现状会让
   本地 drift gate 误报、掩盖真实判断。

openspec 1.15.0 升级的本地同版本全量复验由控制器进行（其 2026-10-27 消息）；
workflow 侧已就绪——事实源字段一改，CI 自动跟随，无需再动 workflow。

## 五、预判

- 上述两件待办落地后推送：`checks` 预期全绿（1134/1134 的同等环境已在本地
  clone 完整复现；宿主 openspec 由 CI 的 1.15.0（升级后）充当 current-host
  观察对象，测试只要求 semver + edges + closure 接受——1.11.0/1.15.0 实测
  同形）。
- 若只合 workflow 不补 196 文件：#208/#382/#411/#414 仍红（根因 E，非环境）。
- delivery-gate job 自身步骤（platform validate / readback / verify-delivery）
  不依赖上述任何环境件，之前未红；未改动。
