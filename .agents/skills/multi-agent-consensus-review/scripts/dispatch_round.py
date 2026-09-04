#!/usr/bin/env python3
"""Dispatch one bounded, read-only consensus-review round.

This is the project-owned adapter used by ``ralph_loop.py``.  It deliberately
keeps provider-specific CLI details here and leaves approval to
``review_gate.py``.
"""

from __future__ import annotations

import concurrent.futures
import hashlib
import json
import os
import shlex
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, Iterable, List, Sequence, Tuple

from model_policy import (
    CLAUDE_HIGH_TIER_EFFORT,
    CLAUDE_HIGH_TIER_MODEL,
    CODEX_HIGH_TIER_EFFORT,
    CODEX_HIGH_TIER_MODEL,
    ModelPolicyError,
    ZCODE_HIGH_TIER_MODEL,
    resolve_model_selection,
)


PARTICIPANTS = ("claude-code", "zcode", "codex-agent")
ZCODE_BUNDLE_CLI = Path("/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs")
ZCODE_PROJECT_CONFIG = "zcode.json"


def read_json(path: Path) -> Dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"JSON root must be an object: {path}")
    return value


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def digest_path(path: Path) -> str:
    h = hashlib.sha256()
    if path.is_file():
        h.update(path.name.encode("utf-8"))
        h.update(b"\0")
        h.update(path.read_bytes())
        return h.hexdigest()
    for child in sorted(path.rglob("*")):
        if ".git" in child.parts or not child.is_file():
            continue
        h.update(child.relative_to(path).as_posix().encode("utf-8"))
        h.update(b"\0")
        h.update(child.read_bytes())
        h.update(b"\0")
    return h.hexdigest()


def command_from_env(variable: str, default: Sequence[str]) -> List[str]:
    raw = os.environ.get(variable, "").strip()
    return shlex.split(raw) if raw else list(default)


def zcode_command() -> List[str]:
    override = os.environ.get("CAR_ZCODE_COMMAND", "").strip()
    if override:
        return shlex.split(override)
    found = shutil.which("zcode")
    if found:
        return [found]
    if ZCODE_BUNDLE_CLI.is_file():
        return ["node", str(ZCODE_BUNDLE_CLI)]
    return ["zcode"]


def resolve_zcode_api_key() -> str | None:
    for name in ("BIGMODEL_API_KEY", "ZCODE_API_KEY"):
        value = os.environ.get(name, "").strip()
        if value:
            return value
    config_path = Path.home() / ".zcode" / "v2" / "config.json"
    try:
        config = read_json(config_path)
    except (OSError, ValueError, json.JSONDecodeError):
        return None
    providers = config.get("provider")
    if not isinstance(providers, dict):
        return None
    for provider_id in ("builtin:bigmodel-coding-plan", "builtin:bigmodel", "bigmodel"):
        provider = providers.get(provider_id)
        if not isinstance(provider, dict):
            continue
        options = provider.get("options")
        if not isinstance(options, dict):
            continue
        value = options.get("apiKey")
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def write_zcode_project_config(run_dir: Path, zcode_selection: Dict[str, Any] | None = None) -> Path:
    config_path = run_dir / ZCODE_PROJECT_CONFIG
    if zcode_selection is None:
        main_model = ZCODE_HIGH_TIER_MODEL
        lite_model = ZCODE_HIGH_TIER_MODEL
    else:
        main_model = str(zcode_selection["model"])
        lite_model = str(zcode_selection.get("lite_model", main_model))
    config = {
        "provider": {
            "bigmodel": {
                "kind": "anthropic",
                "name": "BigModel Coding Plan",
                "options": {
                    "apiKeyEnv": "BIGMODEL_API_KEY",
                    "apiKeyRequired": True,
                    "baseURL": "https://open.bigmodel.cn/api/anthropic",
                },
                "models": {
                    "GLM-5.3": {
                        "name": "GLM-5.3",
                        "reasoning": {
                            "enabled": True,
                            "variants": ["low", "high", "max"],
                            "defaultVariant": "max",
                        },
                    },
                },
            }
        },
        "model": {
            "main": main_model,
            "lite": lite_model,
        },
        "mcp": {"servers": {}},
    }
    config_path.write_text(json.dumps(config, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return config_path


def write_or_verify_model_selection(run_dir: Path, selection: Dict[str, Dict[str, Any]]) -> str:
    """Freeze model discovery for all Ralph rounds in one review run."""
    run_dir.mkdir(parents=True, exist_ok=True)
    path = run_dir / "model-selection.json"
    content = json.dumps(selection, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    if path.exists():
        existing = path.read_text(encoding="utf-8")
        if existing != content:
            raise ModelPolicyError(
                f"model selection changed during review run; refusing to continue: {path}"
            )
    else:
        path.write_text(content, encoding="utf-8")
    return sha256_text(content)


def agent_command(agent: str) -> List[str]:
    if agent == "claude-code":
        return command_from_env("CAR_CLAUDE_COMMAND", ("claude",))
    if agent == "zcode":
        return zcode_command()
    if agent == "codex-agent":
        return command_from_env("CAR_CODEX_COMMAND", ("codex",))
    raise ValueError(f"unknown participant: {agent}")


def criteria_prompt(manifest: Dict[str, Any]) -> str:
    return ", ".join(str(item) for item in manifest["criteria"])


def compact_context(value: str, limit: int = 12000) -> str:
    """Keep re-ballot context bounded so disagreement logs cannot cause timeouts."""
    if len(value) <= limit:
        return value
    marker = "\n... [middle of prior context elided by dispatcher] ...\n"
    remaining = max(0, limit - len(marker))
    head = remaining // 2
    tail = remaining - head
    return value[:head] + marker + value[-tail:]


def make_prompt(manifest: Dict[str, Any], round_number: int, schema_text: str, previous: str, debate: str, agent_id: str) -> str:
    prior_context = ""
    if round_number > 0:
        prior_context = f"""
This is a re-ballot after a disagreement. Re-read the unchanged artifact; do
not carry forward an approval or rejection without re-scoring it. The prior
tally and initiator-organized debate log are evidence about what must be
resolved, not authoritative conclusions.

Previous tally:
{compact_context(previous)}

Debate log:
{compact_context(debate)}
"""
    return f"""You are one independent reviewer in a unanimous multi-Agent review.

Review ID: {manifest['review_id']}
Round: {round_number}
Your Agent ID: {agent_id}. Use that exact value in the ballot's agent field.
Review type: {manifest['review_type']}
Initiator: {manifest['initiator']}
Required participants: {', '.join(manifest['participants'])}
Artifact: {manifest['artifact']}
Artifact SHA-256: {manifest['artifact_sha256']}
Scope: {manifest['scope']}
Decision being gated: {manifest['decision']}
Required criteria: {criteria_prompt(manifest)}

Read the artifact in read-only mode. You may use the CLI's built-in file reader
or a single read-only filesystem operation against exactly the supplied
artifact path. Do not inspect other files, environment variables, home
directories, credentials, or repository history. Do not edit files, run
destructive commands, access the network/browser, or assume another reviewer
will cover a risk. Cite concrete evidence for every material finding. Score
every criterion from 0 to 10 and provide an overall score. APPROVE is allowed
only when you would authorize the gated decision now, overall score is at least
{manifest['thresholds']['overall']}, every criterion is at least
{manifest['thresholds']['criterion']}, and there are no blocking findings. Use
REJECT for a material problem and ABSTAIN only for genuinely missing evidence
or an authority boundary.

Return exactly one JSON object matching this schema. The schema is embedded so
that every CLI receives the same contract even when its workspace sandbox does
not allow reading files outside the artifact:

{schema_text}

Do not wrap it in Markdown and do not add prose before or after it. The JSON
object must contain only the schema fields, use the exact review ID, round,
artifact digest, and Agent ID above, and include a complete score for every
required criterion. This is a bounded single pass: read only the supplied
artifact using the permitted read-only mechanism, do not use network/browser,
write/edit/destructive tools, package managers, or launch subagents, and emit
the JSON ballot immediately after the review. Before emitting it, validate the
ballot internally: every finding with severity BLOCKER must set blocking=true,
no BLOCKER finding may set blocking=false, and an APPROVE ballot must contain
no blocking finding.
{prior_context}
"""


def write_debate_log(manifest: Dict[str, Any], round_number: int, run_dir: Path, previous_tally: Path, debate_path: Path) -> str:
    if round_number <= 0:
        return ""
    if debate_path.exists():
        return debate_path.read_text(encoding="utf-8")

    tally = read_json(previous_tally) if previous_tally.exists() else {}
    prior_round_dir = previous_tally.parent
    lines = [
        f"# Debate round {round_number}",
        "",
        "## Objective",
        "Resolve the findings that prevented unanimous approval in the prior round.",
        "",
        "## Prior tally",
        f"- Status: {tally.get('status', 'UNKNOWN')}",
        f"- Dissenters: {', '.join(tally.get('dissenters', [])) or 'none listed'}",
        f"- Artifact SHA-256: {manifest['artifact_sha256']}",
        "",
        "## Disputed findings",
    ]
    findings = tally.get("findings", [])
    if findings:
        for finding in findings:
            lines.extend([
                f"### {finding.get('id', 'UNKNOWN')} — {finding.get('severity', 'UNKNOWN')}",
                f"- Agent: {finding.get('agent', 'UNKNOWN')}",
                f"- Claim: {finding.get('claim', '')}",
                f"- Evidence: {finding.get('evidence', '')}",
                "- Resolution question: Is this finding supported by the immutable artifact, and does it block the gated decision?",
                "",
            ])
    else:
        lines.extend([
            "No structured finding was recorded; reconcile the score/verdict against the rubric and artifact evidence.",
            "",
        ])
    lines.extend([
        "## Initiator coordination",
        f"- Initiator: {manifest['initiator']}",
        "- This log is generated from the immutable prior tally and ballots. The initiator may coordinate but may not resolve an objection unilaterally.",
        "- Resolution candidate: every participant independently re-reads the artifact, classifies each objection as RESOLVED, INVALIDATED, or REMAINS_OPEN, and submits a complete fresh ballot.",
        "",
        "## Prior ballot summaries",
    ])
    for ballot_path in sorted(prior_round_dir.glob("ballot-*.json")):
        try:
            ballot = read_json(ballot_path)
        except (OSError, ValueError, json.JSONDecodeError):
            continue
        lines.extend([
            f"### {ballot.get('agent', ballot_path.stem)}",
            f"- Verdict: {ballot.get('verdict', 'UNKNOWN')}",
            f"- Overall: {ballot.get('score', {}).get('overall', 'UNKNOWN')}",
            f"- Summary: {ballot.get('summary', '')}",
        ])
        for finding in ballot.get("findings", []):
            lines.append(f"- Finding {finding.get('id', 'UNKNOWN')}: {finding.get('claim', '')}")
        lines.append("")
    content = "\n".join(lines).rstrip() + "\n"
    debate_path.parent.mkdir(parents=True, exist_ok=True)
    debate_path.write_text(content, encoding="utf-8")
    return content


def extract_json_object(text: str) -> Dict[str, Any]:
    decoder = json.JSONDecoder()
    candidates: List[Dict[str, Any]] = []
    for index, char in enumerate(text):
        if char != "{":
            continue
        try:
            value, _ = decoder.raw_decode(text[index:])
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict) and {"review_id", "round", "agent", "verdict", "score", "findings"}.issubset(value):
            candidates.append(value)
    if len(candidates) != 1:
        raise ValueError(f"expected exactly one ballot JSON object, found {len(candidates)}")
    return candidates[0]


def run_agent(agent: str, prompt: str, manifest: Dict[str, Any], round_dir: Path, logs_dir: Path, artifact_root: Path, skill_root: Path, output_schema_path: Path, model_selection: Dict[str, Dict[str, Any]]) -> Tuple[str, str | None]:
    base = agent_command(agent)
    selected = model_selection[agent]
    raw_output_path = logs_dir / f"round-{round_dir.name[-2:]}-{agent}.last-message"
    stdout_path = logs_dir / f"round-{round_dir.name[-2:]}-{agent}.stdout"
    stderr_path = logs_dir / f"round-{round_dir.name[-2:]}-{agent}.stderr"
    env = os.environ.copy()
    env.update({
        "REVIEW_AGENT_ID": agent,
        "REVIEW_RUN_DIR": str(round_dir.parent),
        "REVIEW_ROUND": round_dir.name[-2:],
        "REVIEW_ROUND_DIR": str(round_dir),
        "REVIEW_MANIFEST": str(round_dir.parent / "manifest.json"),
        "REVIEW_ARTIFACT": manifest["artifact"],
        "CAR_REVIEW_READ_ONLY": "1",
    })
    timeout = float(os.environ.get("CAR_AGENT_TIMEOUT", "900"))
    if agent == "claude-code":
        argv = base + [
            "--bare",
            "--disable-slash-commands",
            "--model", str(selected["model"]),
            "--effort", str(selected["effort"]),
            "-p", prompt,
            "--permission-mode", "plan",
            "--no-session-persistence",
            "--output-format", "text",
            "--tools", "Read,Grep,Glob",
            "--add-dir", str(skill_root),
        ]
        input_text = None
    elif agent == "zcode":
        zcode_cwd = round_dir.parent
        api_key = resolve_zcode_api_key()
        if api_key:
            env["BIGMODEL_API_KEY"] = api_key
        argv = base + [
            "--prompt", prompt,
            "--mode", "plan",
            "--cwd", str(zcode_cwd),
            "--no-color",
        ]
        input_text = None
    else:
        argv = base + [
            "exec", "--ephemeral", "--skip-git-repo-check", "--ignore-user-config",
            "--model", str(selected["model"]),
            "-c", f'model_reasoning_effort="{selected["effort"]}"',
            "-s", "read-only", "-C", str(artifact_root),
            "--output-schema", str(output_schema_path),
            "-o", str(raw_output_path), "-",
        ]
        input_text = prompt

    try:
        result = subprocess.run(
            argv,
            cwd=artifact_root,
            env=env,
            input=input_text,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        stdout_path.write_text("", encoding="utf-8")
        stderr_path.write_text(str(exc), encoding="utf-8")
        return agent, f"process failure: {exc}"

    stdout = result.stdout
    if raw_output_path.exists():
        try:
            final_message = raw_output_path.read_text(encoding="utf-8")
        except OSError:
            final_message = ""
    else:
        final_message = stdout
    stdout_path.write_text(stdout + ("\n--- last message ---\n" + final_message if final_message != stdout else ""), encoding="utf-8")
    stderr_path.write_text(result.stderr, encoding="utf-8")
    if result.returncode != 0:
        return agent, f"process exited {result.returncode}; see {stderr_path}"
    try:
        ballot = extract_json_object(final_message)
    except ValueError as exc:
        return agent, f"invalid ballot JSON: {exc}; see {stdout_path}"
    ballot_path = round_dir / f"ballot-{agent}.json"
    ballot_path.write_text(json.dumps(ballot, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    validate = subprocess.run(
        [sys.executable, str(skill_root / "scripts" / "review_gate.py"), "validate", "--manifest", str(round_dir.parent / "manifest.json"), "--ballot", str(ballot_path), "--round", str(round_dir.name[-2:])],
        capture_output=True,
        text=True,
    )
    if validate.returncode != 0:
        return agent, f"ballot failed schema/gate validation: {validate.stderr.strip() or validate.stdout.strip()}"
    return agent, None


def main() -> int:
    manifest_path = Path(os.environ["REVIEW_MANIFEST"]).resolve()
    manifest = read_json(manifest_path)
    round_number = int(os.environ["REVIEW_ROUND"])
    round_dir = Path(os.environ["REVIEW_ROUND_DIR"]).resolve()
    run_dir = Path(os.environ["REVIEW_RUN_DIR"]).resolve()
    skill_root = Path(__file__).resolve().parents[1]
    artifact = Path(manifest["artifact"]).resolve()
    if sorted(manifest.get("participants", [])) != sorted(PARTICIPANTS):
        print("manifest participants are not the required three", file=sys.stderr)
        return 2
    try:
        model_selection = resolve_model_selection()
    except ModelPolicyError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    round_dir.mkdir(parents=True, exist_ok=True)
    logs_dir = run_dir / "logs"
    logs_dir.mkdir(parents=True, exist_ok=True)
    try:
        write_zcode_project_config(run_dir, model_selection["zcode"])
        model_selection_sha256 = write_or_verify_model_selection(run_dir, model_selection)
    except ModelPolicyError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    base_schema = read_json(skill_root / "references" / "ballot.schema.json")
    criteria_properties = {
        criterion: {"type": "number", "minimum": 0, "maximum": 10}
        for criterion in manifest["criteria"]
    }
    criteria_schema = base_schema["properties"]["score"]["properties"]["criteria"]
    criteria_schema["properties"] = criteria_properties
    criteria_schema["additionalProperties"] = False
    criteria_schema["required"] = list(manifest["criteria"])
    output_schema_path = run_dir / "ballot-output-schema.json"
    output_schema_path.write_text(json.dumps(base_schema, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    previous_tally_path = run_dir / f"round-{round_number - 1:02d}" / "tally.json"
    debate_path = Path(os.environ.get("REVIEW_DEBATE_LOG", str(run_dir / "debate" / f"round-{round_number:02d}.md"))).resolve()
    debate = write_debate_log(manifest, round_number, run_dir, previous_tally_path, debate_path)
    previous = previous_tally_path.read_text(encoding="utf-8") if previous_tally_path.exists() else ""
    common_prompt = make_prompt(manifest, round_number, output_schema_path.read_text(encoding="utf-8"), previous, debate, "<AGENT_ID>")
    prompt_hash = sha256_text(common_prompt)
    artifact_before = digest_path(artifact)
    artifact_root = artifact if artifact.is_dir() else artifact.parent

    errors: List[str] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(PARTICIPANTS)) as pool:
        futures = [pool.submit(run_agent, agent, common_prompt.replace("<AGENT_ID>", agent), manifest, round_dir, logs_dir, artifact_root, skill_root, output_schema_path, model_selection) for agent in PARTICIPANTS]
        for future in concurrent.futures.as_completed(futures):
            agent, error = future.result()
            if error:
                errors.append(f"{agent}: {error}")

    artifact_after = digest_path(artifact)
    if artifact_before != artifact_after:
        errors.append("artifact digest changed during dispatch")
    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1

    meta = {
        "round": round_number,
        "participants": list(PARTICIPANTS),
        "artifact_sha256": manifest["artifact_sha256"],
        "prompt_sha256": prompt_hash,
        "model_selection_sha256": model_selection_sha256,
        "models_verified": all(item.get("verified") is True for item in model_selection.values()),
        "model_selection": model_selection,
        "fresh_processes": True,
        "read_only": True,
        "artifact_edited": False,
        "status": "OK",
    }
    (round_dir / "dispatch-meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({"status": "OK", "round": round_number, "participants": list(PARTICIPANTS)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
