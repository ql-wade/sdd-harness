#!/usr/bin/env bash
# check.sh — 提交前总入口：编排窄检查
# 只改一个范围时，可先跑对应窄检查，最后跑本总入口。

set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

bash scripts/agent-instructions-check.sh
bash scripts/agent-skill-check.sh

# 验证工具库回归（gate/audit 机械证据层）
if [ -f package.json ] && grep -q '"test"' package.json; then
  npm test
else
  echo "⚠️ no npm test script — skipped"
fi

# YAML/JSON 静态校验（python3 可用时）
if command -v python3 >/dev/null 2>&1; then
  python3 - <<'PYEOF'
import glob, json, sys

try:
    import yaml
    have_yaml = True
except ImportError:
    have_yaml = False

errors = []
# 根级 load-bearing YAML（控制平面 + 能力清单）+ openspec 树
yaml_files = sorted(set(glob.glob("*.yaml") + glob.glob("openspec/**/*.yaml", recursive=True)))
if have_yaml:
    for f in yaml_files:
        try:
            yaml.safe_load(open(f, encoding="utf-8"))
        except Exception as e:
            errors.append(f"{f}: {e}")
else:
    print(f"  (PyYAML 不可用，跳过 {len(yaml_files)} 个 YAML 的深度校验)")

# 根级 load-bearing JSON（.mcp.json）+ 其余受控 JSON
json_files = sorted(set(glob.glob("*.json") + glob.glob("contracts/**/*.json", recursive=True) + ["package.json"]))
for f in json_files:
    try:
        json.load(open(f, encoding="utf-8"))
    except Exception as e:
        errors.append(f"{f}: {e}")

if errors:
    print("❌ YAML/JSON 校验失败:", file=sys.stderr)
    for e in errors:
        print(f"  {e}", file=sys.stderr)
    sys.exit(1)
print(f"✅ yaml/json 静态校验通过（{len(yaml_files)} YAML, {len(json_files)} JSON）")
PYEOF
else
  echo "⚠️ python3 不可用 — 跳过 YAML/JSON 校验"
fi

echo "✅ Repository checks passed."
