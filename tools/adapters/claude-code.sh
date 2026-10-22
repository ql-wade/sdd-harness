#!/usr/bin/env bash
# Claude Code adapter：hooks.yaml → .claude/settings.json + hooks/.compiled.env
#
# 职责：
#   1. 编译 deny 策略为 hooks/.compiled.env（pre-tool-gate.sh 运行时读取，避免 bash 解析 YAML）
#   2. 生成 .claude/settings.json 的 hooks 段（合并已有配置，不覆盖用户其他设置）
#   3. 建立 .claude/skills/<name> → .agents/skills/<name> 软链（CC 原生技能注入）
#
# 幂等：重复运行安全。受管块边界：凡 command 引用 hooks/{pre-tool-gate,
# session-context,stop-reminder}.sh 且不指向插件基础设施的条目都是本 adapter
# 的受管条目——升级时整体替换（旧格式不残留、不产生第二个 Guard），用户自有
# 条目永不动。
#
# 注册分工与固定事件集（V_P1_2_PLUGIN_REGISTRATION_DIVISION，契约 §7.2/§7.3）：
#   - 插件生命周期 Hook（Ponytail 入口管理的 SessionStart/SubagentStart/
#     UserPromptSubmit 等）由插件入口注册；来源标记 = command 引用插件基础设施
#     （CLAUDE_PLUGIN_ROOT / .claude/plugins/）。插件条目不参与项目受管块的
#     移交与去重，安装/升级/卸载都不移除；项目正确性不依赖插件与项目 Hook 的
#     执行先后。
#   - 本 adapter 固定生成 PreToolUse、SessionStart(startup|resume)、Stop 三个
#     事件——不是任意事件/脚本的通用编译器。hooks.yaml 出现固定事件集之外的
#     事件（如 SubagentStart/UserPromptSubmit/PostToolUse）或携带插件来源脚本
#     时显式拒绝并列出冲突；新增事件必须修改受管生成逻辑并验证 settings
#     matcher，YAML 追加不生效。
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
    *) { echo "❌ 未知参数: ${arg}（支持: --uninstall）" >&2; exit 1; } ;;
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
PLUGIN_SOURCE_RE = re.compile(r"CLAUDE_PLUGIN_ROOT|\.claude/plugins/")

# 来源分类（§7.2）：插件条目（命令引用插件基础设施）与用户条目一样不可移除；
# 只有本项目受管脚本条目参与卸载。
def hook_source(hook):
    text = str(hook.get("command", ""))
    if PLUGIN_SOURCE_RE.search(text):
        return "plugin"
    if MANAGED_SCRIPT_RE.search(text):
        return "managed"
    return "user"

if os.path.exists(settings_path):
    try:
        settings = json.load(open(settings_path, encoding="utf-8"))
    except Exception as err:
        print(f"❌ uninstall: settings.json unreadable, refusing to edit ({err})", file=sys.stderr)
        raise SystemExit(1)
    hooks = settings.get("hooks", {})
    removed = 0
    for group in list(hooks.keys()):
        entries = hooks.get(group) or []
        kept = []
        for entry in entries:
            entry_hooks = entry.get("hooks", []) if isinstance(entry, dict) else []
            sources = {hook_source(h) for h in entry_hooks}
            if "plugin" in sources:
                kept.append(entry)
            elif "managed" in sources:
                removed += 1
            else:
                kept.append(entry)
        if kept:
            hooks[group] = kept
        else:
            del hooks[group]
    if not hooks:
        settings.pop("hooks", None)
    os.makedirs(os.path.dirname(settings_path), exist_ok=True)
    json.dump(settings, open(settings_path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print("✅ uninstall：受管 hook 条目已移除 %d 个，用户与插件条目保留（插件条目由插件入口管理）" % removed)
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

# ---- 注册分工与固定事件集门（§7.2/§7.3，V_P1_2_PLUGIN_REGISTRATION_DIVISION）----
# 在任何产物写入之前判定：违规策略既不进 settings.json 也不进 hooks/.compiled.env。
PLUGIN_SOURCE_RE = re.compile(r"CLAUDE_PLUGIN_ROOT|\.claude/plugins/")
FIXED_EVENT_SET = ("PreToolUse", "SessionStart", "Stop")
unknown_events = [f"{field(p, 'id')} (hook: {field(p, 'hook')})" for p in policies
                  if field(p, "hook") and field(p, "hook") not in FIXED_EVENT_SET]
plugin_scripts = [f"{field(p, 'id')} (script: {field(p, 'script')})" for p in policies
                  if field(p, "script") and PLUGIN_SOURCE_RE.search(field(p, "script"))]
if unknown_events:
    raise SystemExit(
        "❌ hooks.yaml 使用了 adapter 固定事件集之外的事件: " + ", ".join(unknown_events)
        + "。本 adapter 只生成 PreToolUse/SessionStart(startup|resume)/Stop；新增事件必须"
          "修改受管生成逻辑并验证 settings matcher，YAML 追加不生效（§7.3）")
if plugin_scripts:
    raise SystemExit(
        "❌ hooks.yaml 携带插件来源的生命周期脚本（§7.2 注册分工）: " + ", ".join(plugin_scripts)
        + "。插件生命周期 Hook 由插件入口注册，项目受管块不得复制——请从 hooks.yaml 移除该条目")

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

def entry_hooks(entry):
    return [h for h in (entry.get("hooks") or []) if isinstance(h, dict)]

# 来源分类（§7.2）：插件标记优先——即使插件条目引用了与本项目同名的受管脚本，
# 只要命令指向插件基础设施就归插件入口管理，绝不参与项目受管块的移交与去重。
def hook_source(hook):
    text = str(hook.get("command", ""))
    if PLUGIN_SOURCE_RE.search(text):
        return "plugin"
    if MANAGED_SCRIPT_RE.search(text):
        return "managed"
    return "user"

def is_ours(entry):
    return any(hook_source(h) == "managed" for h in entry_hooks(entry))

def is_plugin(entry):
    return any(hook_source(h) == "plugin" for h in entry_hooks(entry))

def normalize_command(text):
    return str(text).strip(" \t" + chr(34) + chr(39))

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
    """受管块移交：只移除本项目受管脚本条目（来源分类 = managed，含旧格式），再追加当前格式。
    插件条目（plugin）与用户自有条目（user）永不触碰——插件 Hook 由插件入口管理，
    项目正确性不依赖对它们的改写。这样升级不会留下第二个 Guard。"""
    arr = settings.get("hooks", {}).get(group, [])
    arr = [e for e in arr if not is_ours(e)]
    arr.append(ours)
    settings.setdefault("hooks", {})[group] = arr

MANAGED_ENTRIES = {
    "PreToolUse": {"matcher": pre_matcher, "hooks": [{"type": "command", "command": '"$CLAUDE_PROJECT_DIR"/' + pre}]},
    "SessionStart": {"matcher": "startup|resume", "hooks": [{"type": "command", "command": '"$CLAUDE_PROJECT_DIR"/' + session}]},
    "Stop": {"hooks": [{"type": "command", "command": '"$CLAUDE_PROJECT_DIR"/' + stop}]},
}
for group, ours in MANAGED_ENTRIES.items():
    upsert_hook_array(group, ours)

# ---- 相同事件/命令重复注册检查（§7.2：接入时检查，拒绝并列出冲突）----
# 组合视图写入前扫描受管事件组：插件条目按来源标记、不参与本项目去重；
# 用户条目或用户条目与本项目受管条目之间出现相同 event+command 即为重复注册。
conflicts = []
for group, ours in MANAGED_ENTRIES.items():
    ours_commands = {normalize_command(h.get("command", "")) for h in entry_hooks(ours)}
    seen = {}
    for entry in settings.get("hooks", {}).get(group, []):
        if is_ours(entry):
            continue
        for hook in entry_hooks(entry):
            source = hook_source(hook)
            command = normalize_command(hook.get("command", ""))
            if source == "plugin":
                # 插件条目不参与项目受管块的去重/移交；但若它注册了与项目受管块
                # 相同的事件+命令（例如插件包装器内嵌本项目脚本），属于双重注册，
                # 显式拒绝并列出冲突——处置权在插件入口，本 adapter 绝不改写它。
                if any(ours in command for ours in ours_commands):
                    conflicts.append((group, entry.get("matcher", ""), str(hook.get("command", "")), "plugin entry duplicates the project managed command (resolve at the plugin entry)"))
                continue
            if command in ours_commands:
                conflicts.append((group, entry.get("matcher", ""), str(hook.get("command", "")), "user entry duplicates the project managed command"))
            elif command in seen:
                conflicts.append((group, entry.get("matcher", ""), str(hook.get("command", "")), "user entry duplicates another user registration"))
            seen[command] = True
if conflicts:
    listing = "\n".join(f"  - [{group}] matcher={matcher!r} command={command!r} — {reason}" for group, matcher, command, reason in conflicts)
    raise SystemExit("❌ 相同事件/命令的重复注册，拒绝写入组合视图（§7.2）:\n" + listing
                     + "\n  请先移除重复条目（或确认其为插件入口管理的注册，移入插件配置）")

plugin_marked = sum(1 for entries in settings.get("hooks", {}).values() for entry in (entries or []) if is_plugin(entry))

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
if plugin_marked:
    print("ℹ️  插件 Hook 条目 %d 个：按来源标记为插件注册，保留原样，不参与项目受管块移交/去重（§7.2）" % plugin_marked)
PYEOF

link_skills
