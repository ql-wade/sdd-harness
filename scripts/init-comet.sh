#!/bin/bash -p
set -euo pipefail
printf '%s\n' 'Comet 0.5.1 initialization is blocked until managed entry qualification completes.' >&2
exit 2

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE_BIN="$HOME/.nvm/versions/node/v24.15.0/bin"
COMET_JS="$ROOT/.sdd/vendor/comet/aeb1a6598034e28ce46b8422d4dbd8785e607bd7/builds/de39629a80fb32f16f3fa12515523988d775f957a62e16941542438c3b61908a/work/bin/comet.js"
OPENSPEC_BIN="$ROOT/.sdd/tools/openspec-1.15.0/node_modules/.bin/openspec"
export PATH="$NODE_BIN:$PATH"
export COMET_OPENSPEC="${COMET_OPENSPEC:-$OPENSPEC_BIN}"

echo "== Comet 0.5.0 Managed Init =="

# Step 1: Check prerequisites
if [ ! -x "$NODE_BIN/node" ]; then echo "FAIL: Node 24.15.0 not found"; exit 1; fi
echo "OK: Node 24.15.0"
if [ ! -f "$COMET_JS" ]; then echo "FAIL: Comet build not found"; exit 1; fi
echo "OK: Comet 0.5.0"

# Step 2: OpenSpec (install if missing)
if [ ! -x "$OPENSPEC_BIN" ]; then
  mkdir -p "$(dirname "$OPENSPEC_BIN")"
  echo '{"private":true}' > "$(dirname "$OPENSPEC_BIN")/package.json"
  (cd "$(dirname "$OPENSPEC_BIN")" && npm install @fission-ai/openspec@1.15.0 --no-fund --no-audit)
fi
echo "OK: OpenSpec 1.15.0"

# Step 3: Workspace config
mkdir -p "$ROOT/.comet"
if [ ! -f "$ROOT/.comet/config.yaml" ]; then
  printf 'schema: comet.project.v1\ndefault_workflow: classic\nworkflows:\n  classic: true\n  native: true\nambient_resume: false\nclassic:\n  artifact_layout: legacy\n  language: en\n' > "$ROOT/.comet/config.yaml"
fi
echo "OK: .comet/config.yaml"

# Step 4: Install composition package
HASH=$(node "$COMET_JS" application install \
  "$ROOT/integrations/comet/application/package/application.json" \
  --project "$ROOT" --preview 2>/dev/null | \
  grep -o '"confirmationHash":"[^"]*"' | cut -d'"' -f4)
if [ -n "$HASH" ]; then
  node "$COMET_JS" application install \
    "$ROOT/integrations/comet/application/package/application.json" \
    --project "$ROOT" --confirmation-hash "$HASH" 2>&1 | tail -3
fi
echo "OK: composition package"

# Step 5: Install Claude Code skills
SKILL_HASH=$(node "$COMET_JS" application install \
  "$ROOT/integrations/comet/application/package/application.json" \
  --project "$ROOT" --host claude-code --preview 2>/dev/null | \
  grep -o '"confirmationHash":"[^"]*"' | cut -d'"' -f4)
if [ -n "$SKILL_HASH" ]; then
  find "$ROOT/.claude/skills" -type l -delete 2>/dev/null || true
  node "$COMET_JS" application install \
    "$ROOT/integrations/comet/application/package/application.json" \
    --project "$ROOT" --host claude-code \
    --confirmation-hash "$SKILL_HASH" 2>&1 | tail -3
fi
echo "OK: Claude Code skills"

# Step 6: CLI wrapper
mkdir -p "$ROOT/bin"
printf '#!/usr/bin/env bash\nset -euo pipefail\nNODE_BIN="%s"\nCOMET_JS="%s"\nOPENSPEC_BIN="%s"\nexport PATH="$NODE_BIN:$PATH"\nexport COMET_OPENSPEC="${COMET_OPENSPEC:-$OPENSPEC_BIN}"\nexec "$NODE_BIN/node" "$COMET_JS" "$@"\n' \
  "$NODE_BIN" "$COMET_JS" "$OPENSPEC_BIN" > "$ROOT/bin/comet"
chmod +x "$ROOT/bin/comet"
echo "OK: ./bin/comet"

# Step 7: Bootstrap hooks
bash "$ROOT/tools/bootstrap.sh" 2>&1 | tail -2

# Verify
echo ""
echo "== Verify =="
"$ROOT/bin/comet" --version
echo ""
echo "== Done =="
echo "  CLI: ./bin/comet"
echo "  Slash: /comet in Claude Code"
