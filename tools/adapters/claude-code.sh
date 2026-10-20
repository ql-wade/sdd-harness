#!/usr/bin/env bash
# Claude Code adapter：hooks.yaml → .claude/settings.json + hooks/.compiled.env
#
# 职责：
#   1. 编译 deny 策略为 hooks/.compiled.env（pre-tool-gate.sh 运行时读取，避免 bash 解析 YAML）
#   2. 生成 .claude/settings.json 的 hooks 段（合并已有配置，不覆盖用户其他设置）
#   3. 建立 .claude/skills/<name> → .agents/skills/<name> 软链（CC 原生技能注入）
#
# 幂等：重复运行安全。受管块边界：凡 command 引用 hooks/{pre-tool-gate,
# session-context,stop-reminder}.sh 的条目都是本 adapter 的受管条目——升级时
# 整体替换（旧格式不残留、不产生第二个 Guard），用户自有条目永不动。
#
# 隔离测试：SDD_TARGET_ROOT=<dir> 时，settings.json / .compiled.env / skills
# 软链都落到该目录（临时配置），源仓库的活配置不被触碰（P1_2/F02）。
# 卸载：--uninstall 移除受管条目与生成产物，用户条目保留（配置可回退）。
#
# python3 用于 YAML 的最小化解析（仅本 adapter，非运行时热路径）。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TARGET_ROOT="${SDD_TARGET_ROOT:-$ROOT}"
# 策略源：目标目录自带的 hooks.yaml（隔离/成员工作区模式），缺省回退到本仓库源。
HOOKS_YAML="$TARGET_ROOT/hooks.yaml"
[ -f "$HOOKS_YAML" ] || HOOKS_YAML="$ROOT/hooks.yaml"
SETTINGS="$TARGET_ROOT/.claude/settings.json"
COMPILED="$TARGET_ROOT/hooks/.compiled.env"

UNINSTALL=false
for arg in "$@"; do
  case "$arg" in
    --uninstall) UNINSTALL=true ;;
    *) { echo "❌ 未知参数: $arg（支持: --uninstall）" >&2; exit 1; } ;;
  esac
done

# ---- skills 注入（安装）/ 清除（卸载）——共享工具函数 ----
link_skills() {
  # 在 TARGET_ROOT 注入软链：只对真实目录源 .agents/skills 里的技能建链。
  local skills_src="$TARGET_ROOT/.agents/skills"
  [ -d "$skills_src" ] || { echo "  ⚠️  无 $TARGET_ROOT/.agents/skills —— 跳过 skills 注入"; return 0; }
  mkdir -p "$TARGET_ROOT/.claude/skills"
  # 清除 stage 时代遗留的真实技能目录（sdd-* / trinity-* 等）：
  # 它们不在 .agents/skills 基础层清单内，留着会与新控制平面矛盾（共识评审 F2）。
  shopt -s nullglob
  for dir in "$TARGET_ROOT"/.claude/skills/*/; do
    name="$(basename "$dir")"
    case "$name" in
      sdd-*|trinity-*)
        rm -rf "${dir%/}"
        echo "  🧹 移除遗留技能目录: $name"
        ;;
    esac
  done
  local linked=0
  for dir in "$skills_src"/*/; do
    name="$(basename "$dir")"
    ln -sfn "../../.agents/skills/$name" "$TARGET_ROOT/.claude/skills/$name"
    linked=$((linked+1))
  done
  # 链接解析断言：每个注入的软链必须能解析到存在的 SKILL.md（共识评审 F-003）
  local broken=0
  for link in "$TARGET_ROOT"/.claude/skills/*/; do
    name="$(basename "${link%/}")"
    [ -f "${link%/}/SKILL.md" ] || { echo "❌ broken skill link: $name" >&2; broken=$((broken+1)); }
  done
  shopt -u nullglob
  [ "$broken" -eq 0 ] || exit 1
  echo "✅ .claude/skills 注入 ${linked} 个技能软链（全部可解析）"
}

unlink_skills() {
  # 卸载只删本 adapter 生成的软链（指向 .agents/skills 的 symlink），真实目录不动。
  shopt -s nullglob
  local removed=0
  for link in "$TARGET_ROOT"/.claude/skills/*; do
    [ -L "$link" ] || continue
    local dest
    dest="$(readlink "$link")"
    case "$dest" in
      *".agents/skills/"*)
        rm -f "$link"
        removed=$((removed+1))
        ;;
    esac
  done
  shopt -u nullglob
  echo "  🧹 移除受管技能软链 ${removed} 个（用户自有条目不动）"
}

if [ "$UNINSTALL" = true ]; then
  command -v python3 >/dev/null 2>&1 || { echo "❌ python3 required by claude-code adapter" >&2; exit 1; }
  python3 - "$SETTINGS" <<'PYUNINSTALL'
import json, os, re, sys

settings_path = sys.argv[1]
MANAGED_SCRIPT_RE = re.compile(r"hooks/(pre-tool-gate|session-context|stop-reminder)\.sh")

if os.path.exists(settings_path):
    try:
        settings = json.load(open(settings_path, encoding="utf-8"))
    except Exception as err:
        print(f"❌ uninstall: settings.json unreadable, refusing to edit ({err})", file=sys.stderr)
        raise SystemExit(1)
    hooks = settings.get("hooks", {})
    for group in list(hooks.keys()):
        entries = hooks.get(group) or []
        kept = []
        for entry in entries:
            entry_hooks = entry.get("hooks", []) if isinstance(entry, dict) else []
            is_managed = any(MANAGED_SCRIPT_RE.search(str(h.get("command", ""))) for h in entry_hooks if isinstance(h, dict))
            if not is_managed:
                kept.append(entry)
        if kept:
            hooks[group] = kept
        else:
            del hooks[group]
    if not hooks:
        settings.pop("hooks", None)
    os.makedirs(os.path.dirname(settings_path), exist_ok=True)
    json.dump(settings, open(settings_path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print("✅ uninstall：受管 hook 条目已移除，用户条目保留")
else:
    print("✅ uninstall：无 settings.json，无需清理")
PYUNINSTALL
  rm -f "$COMPILED"
  unlink_skills
  exit 0
fi

command -v python3 >/dev/null 2>&1 || { echo "❌ python3 required by claude-code adapter" >&2; exit 1; }
[ -f "$HOOKS_YAML" ] || { echo "❌ hooks.yaml not found at $HOOKS_YAML" >&2; exit 1; }

python3 - "$HOOKS_YAML" "$COMPILED" "$SETTINGS" "$ROOT" "$TARGET_ROOT" <<'PYEOF'
import json, re, sys, os

yaml_path, compiled_path, settings_path, root, target_root = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5]
raw = open(yaml_path, encoding="utf-8").read()

# ---- 最小 YAML 解析（仅支持本文件的固定结构：两层列表 + 标量字段）----
policies, cur = [], None
for line in raw.splitlines():
    if line.lstrip().startswith("#") or not line.strip():
        continue
    m = re.match(r"^  - id: (.+)$", line)
    if m:
        cur = {"id": m.group(1).strip()}
        policies.append(cur)
        continue
    if cur is None:
        continue
    m = re.match(r"^    hook: (.+)$", line)
    if m: cur["hook"] = m.group(1).strip(); continue
    m = re.match(r"^    matcher: (.+)$", line)
    if m: cur["matcher"] = m.group(1).strip(); continue
    m = re.match(r"^    action: (.+)$", line)
    if m: cur["action"] = m.group(1).strip(); continue
    m = re.match(r"^    script: (.+)$", line)
    if m: cur["script"] = m.group(1).strip(); continue
    m = re.match(r"^    message: (.+)$", line)
    if m: cur["message"] = m.group(1).strip().strip('"'); continue
    m = re.match(r"^    (target|patterns):", line)
    if m:
        cur["_list_key"] = m.group(1); continue
    m = re.match(r"^      - \"?(.+?)\"?$", line)
    if m:
        list_key = cur.setdefault("_list_key", "target")
        prior = cur.get("_first_list_key")
        if prior is None:
            cur["_first_list_key"] = list_key
        elif prior != list_key:
            raise SystemExit(f"❌ policy {cur.get('id')}: multiple list keys ({prior} + {list_key}) not supported by this parser — refusing to silently miscompile")
        cur.setdefault("items", []).append(m.group(1)); continue

def field(p, key, default=""):
    return p.get(key, default)

# ---- 1. 编译 deny 策略 ----
kb_paths = [i.rstrip("/") + "/" for p in policies
            if field(p, "id") == "kb-write-protection" for i in p.get("items", [])]
deny_patterns = [i for p in policies
                 if field(p, "id") == "dangerous-command-blocklist" for i in p.get("items", [])]
deny_msg = next((field(p, "message") for p in policies
                 if field(p, "id") == "dangerous-command-blocklist"), "")
kb_msg = next((field(p, "message") for p in policies
               if field(p, "id") == "kb-write-protection"), "")

os.makedirs(os.path.dirname(compiled_path), exist_ok=True)
with open(compiled_path, "w", encoding="utf-8") as f:
    # ⚠️ 值必须 shell-quote（强制单引号）：本文件会被 pre-tool-gate.sh source，
    #    未加引号时 deny 模式（破坏性命令串）会被当作命令执行。
    def q(s):
        return "'" + s.replace("'", "'\\''") + "'"
    f.write("# Auto-generated by tools/adapters/claude-code.sh — DO NOT EDIT (source: hooks.yaml)\n")
    f.write("KB_PROTECT_PATHS=%s\n" % q(":".join(kb_paths)))
    f.write("DENY_PATTERNS=%s\n" % q("|".join(deny_patterns)))
    f.write("DENY_MESSAGE=%s\n" % q(deny_msg))
    f.write("DENY_KB_MESSAGE=%s\n" % q(kb_msg))

# ---- 2. 合并 .claude/settings.json hooks 段 ----
settings = {}
if os.path.exists(settings_path):
    try:
        settings = json.load(open(settings_path, encoding="utf-8"))
    except Exception:
        settings = {}

MANAGED_SCRIPT_RE = re.compile(r"hooks/(pre-tool-gate|session-context|stop-reminder)\.sh")

pre = os.path.relpath(os.path.join(root, "hooks/pre-tool-gate.sh"), root)
session = os.path.relpath(os.path.join(root, "hooks/session-context.sh"), root)
stop = os.path.relpath(os.path.join(root, "hooks/stop-reminder.sh"), root)

# matcher = 所有 PreToolUse deny 策略 matcher 的并集（顺序保留）。
# 只取第一个会让后续策略（如 dangerous-command-blocklist 的 Bash）成为死代码。
deny_matchers = []
for p in policies:
    if field(p, "hook") == "PreToolUse" and field(p, "action") == "deny":
        m = field(p, "matcher")
        if not m:
            raise SystemExit(f"❌ deny policy {field(p,'id')} has no matcher — refusing to compile")
        for part in m.split("|"):
            if part and part not in deny_matchers:
                deny_matchers.append(part)
if not deny_matchers:
    raise SystemExit("❌ no PreToolUse deny policies found in hooks.yaml")
pre_matcher = "|".join(deny_matchers)

def upsert_hook_array(group, ours):
    """受管块移交：先移除一切引用本 adapter 受管脚本的条目（含旧格式），再追加当前格式。
    用户自有条目（不引用受管脚本）永不触碰。这样升级不会留下第二个 Guard。"""
    arr = settings.get("hooks", {}).get(group, [])
    arr = [
        e for e in arr
        if not any(MANAGED_SCRIPT_RE.search(str(h.get("command", ""))) for h in e.get("hooks", []) if isinstance(h, dict))
    ]
    arr.append(ours)
    settings.setdefault("hooks", {})[group] = arr

upsert_hook_array("PreToolUse", {"matcher": pre_matcher, "hooks": [{"type": "command", "command": '"$CLAUDE_PROJECT_DIR"/' + pre}]})
upsert_hook_array("SessionStart", {"matcher": "startup|resume", "hooks": [{"type": "command", "command": '"$CLAUDE_PROJECT_DIR"/' + session}]})
upsert_hook_array("Stop", {"hooks": [{"type": "command", "command": '"$CLAUDE_PROJECT_DIR"/' + stop}]})

# 编译期断言：每个 deny 策略的 matcher 部件必须出现在产物 matcher 中
emitted = set(pre_matcher.split("|"))
for p in policies:
    if field(p, "hook") == "PreToolUse" and field(p, "action") == "deny":
        missing = [part for part in field(p, "matcher").split("|") if part and part not in emitted]
        if missing:
            raise SystemExit(f"❌ policy {field(p,'id')} matchers {missing} missing from compiled settings — aborting")

os.makedirs(os.path.dirname(settings_path), exist_ok=True)
json.dump(settings, open(settings_path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print("✅ hooks 策略已编译：%s + %s (%d deny 策略)%s" % (
    os.path.relpath(compiled_path, target_root),
    os.path.relpath(settings_path, target_root),
    len(kb_paths + deny_patterns),
    "" if target_root == root else "  [SDD_TARGET_ROOT 隔离模式]",
))
PYEOF

link_skills
