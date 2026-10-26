#!/usr/bin/env python3
"""Render a STRUCTURE_PASS Journey evidence ledger (schema 3.0) into a summary.

Output is a derived view (header line 'derived-from-ledger: <path>'); it is
NOT execution evidence (R3 consensus). Covers journey/case/hop/mandatory
counts, the A-J dimension status table, grill findings graded P0/P1/P2,
run.sources and the provenance trust level.
Usage: python3 render_journey_summary.py <ledger.json> [--json]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

SCHEMA_VERSION = "3.0"
SEVERITIES = ("P0", "P1", "P2")


def build_summary(document: dict, ledger_path: str) -> dict:
    journeys = document.get("journeys") or []
    run = document.get("run") or {}
    dimensions: list[dict] = []
    findings: list[dict] = []
    for journey in journeys:
        journey_id = journey.get("journey_id") or ""
        for dim, entry in sorted((journey.get("dimensions") or {}).items()):
            if not isinstance(entry, dict):
                continue
            dimensions.append({
                "journey": journey_id,
                "dim": dim,
                "status": entry.get("status"),
                "detail": entry.get("reason") or "; ".join(entry.get("evidence") or []),
            })
        for finding in (journey.get("grill") or {}).get("findings") or []:
            if isinstance(finding, dict):
                findings.append({
                    "severity": finding.get("severity"),
                    "finding_id": finding.get("finding_id"),
                    "claim": finding.get("claim"),
                    "status": finding.get("status"),
                    "journey": journey_id,
                })
    counts = {
        "journeys": len(journeys),
        "cases": sum(len(journey.get("cases") or []) for journey in journeys),
        "expected_hops": sum(len(journey.get("expected_hops") or []) for journey in journeys),
        "mandatory_hops": sum(
            1 for journey in journeys for hop in (journey.get("expected_hops") or [])
            if isinstance(hop, dict) and hop.get("mandatory") is True
        ),
        "mandatory_paths": sum(
            1 for journey in journeys for path in (journey.get("required_paths") or [])
            if isinstance(path, dict) and path.get("mandatory") is True
        ),
    }
    return {
        "derived_from_ledger": str(ledger_path),
        "schema_version": document.get("schema_version"),
        "run_id": run.get("run_id"),
        "counts": counts,
        "dimensions": dimensions,
        "findings": findings,
        "sources": [
            {key: source.get(key) for key in
             ("component", "repo", "revision", "dirty_fingerprint", "build_digest")}
            for source in (run.get("sources") or []) if isinstance(source, dict)
        ],
        "provenance": {
            "level": (run.get("provenance") or {}).get("level"),
            "observer": (run.get("provenance") or {}).get("observer"),
            "tool_output_capture": (run.get("provenance") or {}).get("tool_output_capture"),
        },
    }


def render_markdown(summary: dict) -> str:
    counts = summary["counts"]
    lines = [
        "# Journey Ledger Summary",
        "",
        f"derived-from-ledger: {summary['derived_from_ledger']}",
        "（派生视图：由 STRUCTURE_PASS 账本渲染，不构成执行证据；真实性需独立验证）",
        "",
        f"run_id: `{summary['run_id']}`（schema {summary['schema_version']}）",
        "",
        "## 计数",
        "",
        "| 指标 | 值 |",
        "|------|-----|",
        f"| Journey | {counts['journeys']} |",
        f"| Case | {counts['cases']} |",
        f"| 预期 Hop | {counts['expected_hops']} |",
        f"| 强制 Hop | {counts['mandatory_hops']} |",
        f"| 强制 Path | {counts['mandatory_paths']} |",
        "",
        "## A-J 维度状态",
        "",
        "| Journey | 维度 | 状态 | 说明/证据 |",
        "|---------|------|------|-----------|",
    ]
    for row in summary["dimensions"]:
        status = {"pass": "PASS", "n_a": "N/A"}.get(row["status"], str(row["status"]))
        lines.append(f"| {row['journey']} | Journey-{row['dim']} | {status} | {row['detail']} |")
    lines += ["", "## Findings 分级（P0/P1/P2）", ""]
    for severity in SEVERITIES:
        selected = [f for f in summary["findings"] if f.get("severity") == severity]
        lines += [f"### {severity}（{len(selected)} 条）", ""]
        if not selected:
            lines += ["- 无", ""]
        else:
            lines += [
                "| Finding | Journey | Claim | 状态 |",
                "|---------|---------|-------|------|",
            ]
            lines += [
                f"| {f['finding_id']} | {f['journey']} | {f['claim']} | {f['status']} |"
                for f in selected
            ]
            lines.append("")
    lines += [
        "## run.sources",
        "",
        "| Component | Repo | Revision | Fingerprint | Build digest |",
        "|-----------|------|----------|-------------|--------------|",
    ]
    lines += [
        f"| {s['component']} | {s['repo']} | {s['revision']} | "
        f"{s['dirty_fingerprint']} | {s['build_digest']} |"
        for s in summary["sources"]
    ]
    provenance = summary["provenance"]
    lines += [
        "",
        "## Provenance",
        "",
        f"- trust level: **{provenance['level']}**",
        f"- observer: {provenance['observer']}",
        f"- tool_output_capture: {provenance['tool_output_capture']}",
        "",
    ]
    return "\n".join(lines)


def _selftest() -> int:
    fixture = Path(__file__).resolve().parent.parent / "tests" / "green-fixture" / "ledger.json"
    summary = build_summary(json.loads(fixture.read_text(encoding="utf-8")), str(fixture))
    assert summary["counts"] == {
        "journeys": 1, "cases": 1, "expected_hops": 1, "mandatory_hops": 1, "mandatory_paths": 1,
    }, summary["counts"]
    assert [row["dim"] for row in summary["dimensions"]] == list("ABCDEFGHIJ")
    assert summary["dimensions"][0]["status"] == "pass"
    assert summary["findings"] == []
    assert summary["sources"] and summary["sources"][0]["component"] == "PRODUCER"
    assert summary["provenance"]["level"] == "local-observed"
    markdown = render_markdown(summary)
    assert "derived-from-ledger:" in markdown and "Journey-A" in markdown
    json.dumps(summary)  # must stay JSON-serializable for --json
    print(f"SELFTEST_PASS: green-fixture ledger renders ({len(markdown.splitlines())} markdown lines)")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("ledger", type=Path, nargs="?", help="Path to STRUCTURE_PASS ledger JSON")
    parser.add_argument("--json", action="store_true", help="Emit the summary object as JSON")
    parser.add_argument("--selftest", action="store_true", help="Run selftest on tests/green-fixture")
    args = parser.parse_args(argv)
    if args.selftest:
        return _selftest()
    if args.ledger is None:
        parser.error("ledger is required unless --selftest")
    try:
        document = json.loads(args.ledger.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        print(f"INVALID: {exc}", file=sys.stderr)
        return 2
    if not isinstance(document, dict) or document.get("schema_version") != SCHEMA_VERSION:
        print(f"INVALID: schema_version must be '{SCHEMA_VERSION}' (STRUCTURE_PASS ledger expected)",
              file=sys.stderr)
        return 2
    summary = build_summary(document, str(args.ledger))
    if args.json:
        print(json.dumps(summary, ensure_ascii=False, indent=2))
    else:
        print(render_markdown(summary))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
