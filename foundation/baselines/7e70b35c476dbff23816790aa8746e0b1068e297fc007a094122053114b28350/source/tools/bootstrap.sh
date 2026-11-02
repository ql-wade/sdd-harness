#!/usr/bin/env bash
# bootstrap.sh — scaffold 初始化（幂等，可重复运行）
#
# 用法：
#   bash tools/bootstrap.sh                  # 基础初始化（hooks + skills + check）
#   bash tools/bootstrap.sh --with-llmwiki   # 额外安装 LLMWiki MCP（clone + venv）
#   bash tools/bootstrap.sh --uninstall      # 卸载受管条目（用户配置保留，可回退）
#
# 隔离/分发模式：SDD_TARGET_ROOT=<dir> 时，bootstrap 只做与该目标目录相关的
# 组合动作——adapter 落地（settings + compiled env + skills 软链）+ 目标项目
# MCP 注册（源仓库分发注册产物合并，包装器缺文件不悬空注册）+ foundation
# 发布视图/锁 pull（tools/foundation-export.mjs export）。npm/源侧 MCP 注册/
# LLMWiki/仓库自检都是源仓库根动作，目标模式下跳过。重复运行幂等（重复 pull
# 字节一致）。
#
# 步骤（源仓库模式）：环境检测 → hooks 策略落地（CC adapter）→ MCP 注册（按
# mcp-capabilities.yaml）→ foundation 校验 → LLMWiki（可选）

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TARGET_ROOT="${SDD_TARGET_ROOT:-$ROOT}"

UNINSTALL=false
WITH_LLMWIKI=false
while [ $# -gt 0 ]; do
  case "$1" in
    --with-llmwiki) WITH_LLMWIKI=true ;;
    --uninstall) UNINSTALL=true ;;
    *) echo "❌ 未知参数: $1（支持: --with-llmwiki、--uninstall）" >&2; exit 1 ;;
  esac
  shift
done

say()  { printf '%s\n' "$*"; }
fail() { printf '❌ %s\n' "$*" >&2; exit 1; }

# ---- 卸载：只移除受管条目，用户配置保留（F02 配置可回退）----
if [ "$UNINSTALL" = true ]; then
  say "🧹 scaffold uninstall（目标: ${TARGET_ROOT}）"
  bash "$SCRIPT_DIR/adapters/claude-code.sh" --uninstall
  say "✅ 卸载完成。重新接入: SDD_TARGET_ROOT 不设或指向目标目录后 bash tools/bootstrap.sh"
  exit 0
fi

if [ "$TARGET_ROOT" != "$ROOT" ]; then
  # ---- 目标目录模式（隔离测试 / 成员工作区接入）----
  say "🚀 scaffold bootstrap（target 模式）"
  say "   target: ${TARGET_ROOT}"
  say ""
  say "── 1/3 hooks 控制平面（Claude Code adapter → target）──"
  SDD_TARGET_ROOT="$TARGET_ROOT" bash "$SCRIPT_DIR/adapters/claude-code.sh"
  say ""
  say "── 2/3 目标项目 MCP 注册（按源仓库分发注册产物合并）──"
  # 源：本仓库 .mcp.json（mcp-capabilities.yaml 的生成注册产物，单一事实源链）。
  # 合并语义：分发名是受管键（升级按名整体替换）；目标内其余条目原样保留；
  # 包装器型（\${CLAUDE_PROJECT_DIR}/…）条目只在目标内该文件真实存在时注册，
  # 不落悬空命令；npx 型逐字注册（pin 由源侧 emission gate 保证）。幂等：
  # 合并结果与现文件字节一致时不写。
  SDD_TARGET_ROOT="$TARGET_ROOT" python3 - "$ROOT" "$TARGET_ROOT" <<'PYMCP'
import json, os, sys, tempfile

source_root, target_root = sys.argv[1], sys.argv[2]
source_mcp = os.path.join(source_root, '.mcp.json')
target_mcp = os.path.join(target_root, '.mcp.json')
with open(source_mcp, encoding='utf-8') as fh:
    distributed = json.load(fh).get('mcpServers', {})

config = {'mcpServers': {}}
if os.path.exists(target_mcp):
    with open(target_mcp, encoding='utf-8') as fh:
        config = json.load(fh)
    if not isinstance(config, dict) or not isinstance(config.get('mcpServers', {}), dict):
        raise SystemExit('target .mcp.json unreadable; refusing to edit')
config['mcpServers'] = config.get('mcpServers', {})

registered, skipped = [], []
for name in sorted(distributed):
    entry = distributed[name]
    command = str(entry.get('command', ''))
    if command != 'npx':
        if '${CLAUDE_PROJECT_DIR}' not in command:
            skipped.append(name + ' (非 npx 且无目标内路径锚点)')
            continue
        local = command.replace('${CLAUDE_PROJECT_DIR}', target_root)
        if not os.path.exists(local):
            # 诚实注册：目标内没有包装器文件就不注册，避免悬空命令。
            if name in config['mcpServers'] and config['mcpServers'][name] == entry:
                config['mcpServers'].pop(name)
                registered.append(name + ' (目标缺包装器，移除既有悬空注册)')
            else:
                skipped.append(name + ' (目标缺包装器文件，不悬空注册)')
            continue
    if config['mcpServers'].get(name) == entry:
        registered.append(name + ' (已是受管注册)')
        continue
    config['mcpServers'][name] = entry
    registered.append(name)

payload = json.dumps(config, ensure_ascii=False, indent=2) + '\n'
existing = None
if os.path.exists(target_mcp):
    with open(target_mcp, encoding='utf-8') as fh:
        existing = fh.read()
if existing != payload:
    fd, tmp = tempfile.mkstemp(dir=target_root, prefix='.mcp.json.sdd-')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as fh:
            fh.write(payload)
        os.replace(tmp, target_mcp)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)
print('✅ 目标 MCP 注册：' + (', '.join(registered) if registered else '无新增（已是受管状态）'))
for item in skipped:
    print('ℹ️  跳过 ' + item)
PYMCP
  say ""
  say "── 3/3 foundation 发布视图 + 锁 pull（幂等）──"
  # 发布 commit：目标自身是 git 工作区用其 HEAD；否则记源仓库 HEAD（资产来源）。
  TARGET_COMMIT="$(git -C "$TARGET_ROOT" rev-parse HEAD 2>/dev/null || git -C "$ROOT" rev-parse HEAD)"
  node "$SCRIPT_DIR/foundation-export.mjs" export --root "$TARGET_ROOT" --out "$TARGET_ROOT/foundation" --release-commit "$TARGET_COMMIT" --freeze-baseline
  node "$SCRIPT_DIR/foundation-export.mjs" verify --root "$TARGET_ROOT" --lock "$TARGET_ROOT/foundation/foundation-lock.json"
  say ""
  say "✅ target bootstrap 完成（跳过源仓库动作：npm / 源侧 MCP 注册 / LLMWiki / 仓库自检）"
  exit 0
fi

cd "$ROOT"

say "🚀 scaffold bootstrap"
say "   root: $ROOT"

# ---- 1. 环境检测 ----
say ""
say "── 1/5 环境检测 ─────────────────────────────"
node --version >/dev/null 2>&1 || fail "node 未安装（需 >=18）：brew install node / apt install nodejs"
say "✅ node $(node --version)"
git --version >/dev/null 2>&1 || fail "git 未安装"
say "✅ git $(git --version | awk '{print $3}')"
bash --version | head -1 | grep -q bash || fail "bash 不可用"
say "✅ bash"
if command -v python3 >/dev/null 2>&1; then
  say "✅ python3 $(python3 --version | awk '{print $2}')"
else
  say "⚠️  python3 不可用：hooks JSON 解析与 CC adapter 需要（brew install python3）"
fi

# npm 依赖（lib/ 验证工具需要 commander/fs-extra/chalk）
if [ ! -d node_modules ]; then
  say "📦 安装 npm 依赖…"
  npm install --no-audit --no-fund
fi

# ---- 2. hooks 策略落地（Claude Code adapter）----
say ""
say "── 2/5 hooks 控制平面（Claude Code adapter）──"
bash "$SCRIPT_DIR/adapters/claude-code.sh"

# ---- 3. MCP 注册 ----
say ""
say "── 3/5 MCP 注册（按 mcp-capabilities.yaml）──"
node "$SCRIPT_DIR/register-mcps.mjs"

# ---- 4. foundation 发布视图/锁校验（防双写漂移）----
say ""
say "── 4/5 foundation 校验（exporter verify）──"
if [ -f "$ROOT/foundation/foundation-lock.json" ]; then
  node "$SCRIPT_DIR/foundation-export.mjs" verify --root "$ROOT" --lock "$ROOT/foundation/foundation-lock.json"
else
  say "ℹ️  无 foundation/foundation-lock.json —— 跳过（生成: node tools/foundation-export.mjs export）"
fi

# ---- 5. LLMWiki（可选）----
if [ "$WITH_LLMWIKI" = true ]; then
  say ""
  say "── 5/5 LLMWiki MCP 安装 ────────────────────"
  SDD_HOME="${SDD_HOME:-$HOME/.sdd}"
  LLMWIKI_DIR="$SDD_HOME/repos/llmwiki"
  if [ ! -x "$LLMWIKI_DIR/.venv/bin/python" ]; then
    say "📦 clone lucasastorian/llmwiki → $LLMWIKI_DIR"
    git clone https://github.com/lucasastorian/llmwiki "$LLMWIKI_DIR"
    # 供应链 pin：固定到已验证 commit（升级 = 显式改这里 + 重跑 bootstrap）
    git -C "$LLMWIKI_DIR" checkout 075c5b4996ff4e07f9d3c57c1f14fd2b54a955db
    say "🐍 创建 venv + 安装 mcp 包（pinned）…"
    python3 -m venv "$LLMWIKI_DIR/.venv"
    "$LLMWIKI_DIR/.venv/bin/pip" install --quiet "mcp[cli]==1.27.0"
  fi
  say "✅ LLMWiki venv 就绪：$LLMWIKI_DIR/.venv"
  node "$SCRIPT_DIR/register-mcps.mjs" --with-llmwiki
else
  say ""
  say "── 5/5 LLMWiki（跳过；需要时加 --with-llmwiki）──"
fi

# ---- 校验 ----
say ""
say "── 校验 ─────────────────────────────────────"
bash "$ROOT/scripts/agent-instructions-check.sh"
bash "$ROOT/scripts/agent-skill-check.sh"

say ""
say "✅ bootstrap 完成。下一步："
say "   1. 填 AGENTS.md / openspec/project.md 的 TODO(team) 内容"
say "   2. bash scripts/check.sh 确认骨架完整"
say "   3. 重启 Claude Code 会话使 hooks/skills 生效"
