#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
from dataclasses import asdict, dataclass
from pathlib import Path

REQUIRED_HEADER_PARTS = (
    "Implementation Plan",
    "REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development",
    "**Goal:**",
    "**Architecture:**",
    "**Tech Stack:**",
    "## Global Constraints",
)
MARKERS = (
    "T" + "BD",
    "T" + "ODO",
    "implement " + "later",
    "fill in " + "details",
    "Similar " + "to Task",
)
STEP_RE = re.compile(r"^- \[ \] \*\*Step \d+ \[(\d+) min\]:")
TASK_RE = re.compile(r"^### Task ([A-Za-z0-9_-]+):", re.MULTILINE)


@dataclass(frozen=True)
class Issue:
    code: str
    line: int
    message: str


def _line_number(text: str, offset: int) -> int:
    return text.count("\n", 0, offset) + 1


def _strip_fenced_code(text: str) -> str:
    result: list[str] = []
    in_fence = False
    for line in text.splitlines(keepends=True):
        if line.lstrip().startswith("```"):
            in_fence = not in_fence
            result.append("\n" if line.endswith("\n") else "")
        elif in_fence:
            result.append("\n" if line.endswith("\n") else "")
        else:
            result.append(line)
    return "".join(result)


def validate_plan_text(text: str) -> list[Issue]:
    issues: list[Issue] = []
    prose = _strip_fenced_code(text)
    for part in REQUIRED_HEADER_PARTS:
        if part not in prose:
            issues.append(Issue("MISSING_HEADER", 1, f"Missing required header part: {part}"))

    for marker in MARKERS:
        offset = prose.find(marker)
        if offset >= 0:
            issues.append(
                Issue("UNRESOLVED_MARKER", _line_number(prose, offset), f"Found {marker}")
            )

    lines = prose.splitlines()
    for index, line in enumerate(lines, start=1):
        if line.startswith("- [ ] **Step "):
            match = STEP_RE.match(line)
            if not match or int(match.group(1)) not in range(2, 6):
                issues.append(
                    Issue("STEP_DURATION", index, "Step duration must be 2 through 5 minutes")
                )

    task_matches = list(TASK_RE.finditer(prose))
    for index, match in enumerate(task_matches):
        start = match.start()
        end = task_matches[index + 1].start() if index + 1 < len(task_matches) else len(prose)
        block = prose[start:end]
        task_line = _line_number(prose, start)
        for section in ("**Files:**", "**Interfaces:**", "**Dependencies:**", "**Owns:**", "**Parallel safe:**", "**Acceptance IDs:**"):
            if section not in block:
                issues.append(Issue("MISSING_TASK_SECTION", task_line, f"Missing {section}"))
        if not re.search(r"^- \[ \] \*\*Step \d+ \[[2-5] min\]: Commit", block, re.MULTILINE):
            issues.append(Issue("MISSING_COMMIT", task_line, "Task has no timed commit step"))
    return issues


HASH_RE = re.compile(r"^[0-9a-f]{64}$")


def _paths_overlap(left: str, right: str) -> bool:
    left_parts = tuple(part for part in left.strip("/").split("/") if part)
    right_parts = tuple(part for part in right.strip("/").split("/") if part)
    shorter = min(len(left_parts), len(right_parts))
    return left_parts[:shorter] == right_parts[:shorter]


def validate_dag(dag: dict[str, object]) -> list[Issue]:
    issues: list[Issue] = []
    tasks = {task["id"]: task for task in dag.get("tasks", [])}
    waves = dag.get("waves", [])
    wave_of = {
        task_id: wave_index
        for wave_index, wave in enumerate(waves)
        for task_id in wave
    }
    for task_id, task in tasks.items():
        for dependency in task.get("depends_on", []):
            if dependency not in wave_of or wave_of.get(dependency, 10**9) >= wave_of.get(task_id, -1):
                issues.append(Issue("DAG_DEPENDENCY", 0, f"{task_id} depends on {dependency} outside an earlier wave"))
    for wave in waves:
        for left_index, left_id in enumerate(wave):
            for right_id in wave[left_index + 1:]:
                for left_path in tasks[left_id].get("owns", []):
                    for right_path in tasks[right_id].get("owns", []):
                        if _paths_overlap(left_path, right_path):
                            issues.append(Issue("DAG_OWNERSHIP", 0, f"{left_id} and {right_id} overlap"))
    return issues


def validate_drift_lock(lock: dict[str, object]) -> list[Issue]:
    issues: list[Issue] = []
    for key in ("architecture_sha256", "plan_sha256"):
        if not HASH_RE.fullmatch(str(lock.get(key, ""))):
            issues.append(Issue("LOCK_HASH", 0, f"{key} must be lowercase SHA-256"))
            break
    if lock.get("change_policy") != "halt-and-replan":
        issues.append(Issue("LOCK_POLICY", 0, "change_policy must be halt-and-replan"))
    return issues


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--dag", type=Path)
    parser.add_argument("--lock", type=Path)
    args = parser.parse_args()
    try:
        issues = validate_plan_text(args.plan.read_text(encoding="utf-8"))
        if args.dag:
            issues.extend(validate_dag(json.loads(args.dag.read_text(encoding="utf-8"))))
        if args.lock:
            issues.extend(validate_drift_lock(json.loads(args.lock.read_text(encoding="utf-8"))))
    except (OSError, json.JSONDecodeError) as error:
        print(json.dumps({"valid": False, "error": str(error)}, ensure_ascii=False))
        return 2
    print(json.dumps(
        {"valid": not issues, "issues": [asdict(issue) for issue in issues]},
        ensure_ascii=False,
    ))
    return 0 if not issues else 1


if __name__ == "__main__":
    raise SystemExit(main())
