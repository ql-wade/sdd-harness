#!/usr/bin/env python3
from __future__ import annotations

import argparse
import shutil
from datetime import datetime, timezone
from pathlib import Path

SKILL_NAME = "claude-parallel-tdd-planner"
RUNTIME_MANIFEST = (
    "SKILL.md",
    "references/architecture-intake.md",
    "references/openspec-workflow.md",
    "references/openspec-closeout.md",
    "references/automation.md",
    "references/completion-verification.md",
    "references/plan-contract.md",
    "references/parallel-execution.md",
    "references/execution-prompt-template.md",
    "scripts/plan_guard.py",
    "scripts/openspec_lifecycle.py",
    "scripts/render_execution_prompt.py",
    "scripts/install_global.py",
    "tests/test_planner.py",
    "tests/test_lifecycle.py",
    "tests/run_all.sh",
)


def install(source: Path, target_root: Path, dry_run: bool) -> list[Path]:
    source = source.resolve()
    target_root = target_root.resolve()
    target = target_root / SKILL_NAME
    if source == target:
        raise ValueError("source and target must differ")
    missing = [relative for relative in RUNTIME_MANIFEST if not (source / relative).is_file()]
    if missing:
        raise FileNotFoundError("missing runtime files: " + ", ".join(missing))
    copied = [target / relative for relative in RUNTIME_MANIFEST]
    if dry_run:
        return copied

    target_root.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    stage = target_root / f".{SKILL_NAME}.stage-{stamp}"
    if stage.exists():
        raise FileExistsError(stage)
    for relative in RUNTIME_MANIFEST:
        destination = stage / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source / relative, destination)
    if target.exists():
        backup = target_root / f"{SKILL_NAME}.backup-{stamp}"
        target.rename(backup)
    stage.rename(target)
    return copied


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--target-root", type=Path, required=True)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    for path in install(args.source, args.target_root, args.dry_run):
        print(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
