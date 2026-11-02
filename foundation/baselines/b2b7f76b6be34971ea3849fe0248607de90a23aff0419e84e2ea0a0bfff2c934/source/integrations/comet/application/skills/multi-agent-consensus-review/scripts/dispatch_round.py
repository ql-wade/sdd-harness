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
import plistlib
import os
import selectors
import shlex
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any, Dict, Iterable, List, Sequence, Tuple

from model_policy import ModelPolicyError, resolve_model_selection
from cli_process import spawn, finish, run as run_cli, install_signal_handlers


PARTICIPANTS = ("claude-code", "zcode", "codex-agent")
ZCODE_BUNDLE_CLI = Path("/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs")
ZCODE_APP_MACOS_DIR = Path("/Applications/ZCode.app/Contents/Frameworks/ZCode Helper.app/Contents/MacOS")
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


def zcode_electron_binary() -> Path | None:
    """Use the hidden Electron helper so inherited MCP runtimes stay off the Dock."""
    binary = ZCODE_APP_MACOS_DIR / "ZCode Helper"
    try:
        info = plistlib.loads((binary.parent.parent / "Info.plist").read_bytes())
    except (OSError, ValueError, plistlib.InvalidFileException):
        return None
    if binary.is_file() and os.access(binary, os.X_OK) and info.get("LSUIElement"):
        return binary
    return None


def zcode_command() -> List[str]:
    override = os.environ.get("CAR_ZCODE_COMMAND", "").strip()
    if override:
        return shlex.split(override)
    found = shutil.which("zcode")
    if found:
        return [found]
    binary = zcode_electron_binary()
    # shortcut: >= 0.17.0 app-bundle CLIs are built for electron-node; plain
    # node dies in sqlite migration ("transaction ownership mismatch").
    if binary is not None and ZCODE_BUNDLE_CLI.is_file():
        return [str(binary), str(ZCODE_BUNDLE_CLI)]
    if ZCODE_BUNDLE_CLI.is_file():
        raise OSError("ZCode background helper unavailable; silent execution is required")
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


def zcode_protocol_enabled(base: Sequence[str]) -> bool:
    """Use the current ZCode Protocol adapter for the bundled 0.16.x CLI."""
    requested = os.environ.get("CAR_ZCODE_PROTOCOL", "auto").strip().casefold()
    if requested in {"1", "true", "yes", "on"}:
        return True
    if requested in {"0", "false", "no", "off"}:
        return False
    return any("zcode.cjs" in item for item in base)


def _zcode_personal_provider_config(api_key: str, model_id: str) -> Dict[str, Any]:
    """Build an ephemeral current-ZCode personal provider registry.

    ZCode 0.16.9's standalone app-server does not import the Electron account
    provider overlay.  A temporary personal BigModel provider keeps the
    public model identity stable while avoiding writes to the user's state.
    """
    return {
        "schemaVersion": 1,
        "config": {
            "providerConfigRules": {
                "providerRules": [{
                    "providerId": "bigmodel",
                    "providerName": "BigModel",
                    "enabled": True,
                    "config": {
                        "group": "standard-personal",
                        "access": {"type": "api-key", "apiKey": api_key},
                        "api": {
                            "type": "anthropic-messages",
                            "baseUrl": "https://open.bigmodel.cn/api/anthropic",
                        },
                        "personalModelIds": [model_id],
                        "modelOrder": [model_id],
                    },
                }]
            },
            "modelConfigRules": {
                "providerModelRules": [{
                    "providerId": "bigmodel",
                    "modelId": model_id,
                    "config": {
                        "properties": {"contextWindow": 1_000_000},
                        "optionSpecs": {
                            "reasoningLevel": {"values": ["low", "high", "max"]}
                        },
                    },
                }],
                "manualProviderModelRules": [],
            },
            "defaultModelSelection": {
                "providerId": "bigmodel",
                "modelId": model_id,
                "options": {"reasoningLevel": "max"},
            },
        },
    }


def _zcode_model_id(model_selection: Dict[str, Any]) -> str:
    model = model_selection.get("model")
    if not isinstance(model, str) or not model.strip():
        raise ModelPolicyError("zcode model selection is missing 'model'; resolve model_policy first")
    return model.split("/", 1)[-1]


def _prepare_zcode_protocol_env(api_key: str, model_selection: Dict[str, Any]) -> Tuple[tempfile.TemporaryDirectory[str], Dict[str, str]]:
    """Create private writable ZCode runtime state for one fresh reviewer."""
    temp = tempfile.TemporaryDirectory(prefix="consensus-zcode-")
    root = Path(temp.name)
    data_base = root / "data"
    runtime = root / "runtime"
    (data_base / ".zcode" / "v2").mkdir(parents=True, exist_ok=True)
    runtime.mkdir(parents=True, exist_ok=True)
    bundled_source = Path("/Applications/ZCode.app/Contents/Resources/config/provider/zcode-builtin.json")
    if not bundled_source.is_file():
        temp.cleanup()
        raise FileNotFoundError(f"ZCode built-in provider config is missing: {bundled_source}")
    bundled = runtime / "zcode-builtin.json"
    shutil.copy2(bundled_source, bundled)
    model_id = _zcode_model_id(model_selection)
    personal = data_base / ".zcode" / "v2" / "provider_config.json"
    personal.write_text(
        json.dumps(_zcode_personal_provider_config(api_key, model_id), ensure_ascii=False),
        encoding="utf-8",
    )
    personal.chmod(0o600)
    # Keep encrypted shared credentials out of the review run.  The personal
    # provider above is sufficient for model calls and the key is not logged.
    return temp, {
        "ZCODE_DATA_BASE_DIR": str(data_base),
        "ZCODE_BUILTIN_PROVIDER_CONFIG_FILE": str(bundled),
        "ZCODE_AGENT_PROVIDER": "glm",
        "BIGMODEL_API_KEY": api_key,
    }


def _zcode_model_ref(model_selection: Dict[str, Any]) -> Dict[str, Any]:
    return {"providerId": "bigmodel", "modelId": _zcode_model_id(model_selection), "options": {"reasoningLevel": "max"}}


def _zcode_assistant_text(value: Any, session_id: str | None = None, parent_message_id: str | None = None) -> str:
    """Take only the latest completed assistant's text in the current user turn."""
    while isinstance(value, dict) and "messages" not in value:
        value = next((value[key] for key in ("snapshot", "result", "data")
                      if isinstance(value.get(key), dict)), None)
    messages = value.get("messages", []) if isinstance(value, dict) else []
    if not isinstance(messages, list):
        return ""
    for message in reversed(messages):
        if not isinstance(message, dict):
            continue
        info = message.get("info") if isinstance(message.get("info"), dict) else {}
        if session_id is not None and info.get("sessionId", info.get("sessionID")) != session_id:
            continue
        if parent_message_id is not None and info.get("parentMessageId", info.get("parentID")) != parent_message_id:
            continue
        role = info.get("role", message.get("role"))
        if role == "user":
            break
        if role == "assistant" and info.get("finish", message.get("finish")) == "stop" and not info.get("error"):
            return "\n".join(part["text"] for part in message.get("parts", [])
                             if isinstance(part, dict) and part.get("type") == "text"
                             and isinstance(part.get("text"), str) and not part.get("ignored")).strip()
    return ""


def run_zcode_protocol(
    base: Sequence[str],
    prompt: str,
    artifact_root: Path,
    round_dir: Path,
    logs_dir: Path,
    selected: Dict[str, Any],
    timeout: float,
) -> Tuple[str | None, str | None]:
    """Run one fresh, read-only ZCode 0.16.9 app-server session."""
    api_key = resolve_zcode_api_key()
    if not api_key:
        return None, "ZCode BigModel API key is unavailable for the ephemeral provider"
    temp: tempfile.TemporaryDirectory[str] | None = None
    protocol_log: List[str] = []
    process: subprocess.Popen[str] | None = None
    stop_file = Path(os.environ["REVIEW_STOP_FILE"]) if os.environ.get("REVIEW_STOP_FILE") else None
    stderr_log = None
    selector = None
    session_id = None
    turn_id = None
    user_message_id = None
    terminal = False
    terminal_error = None
    protocol_events = []
    cleanup_path = logs_dir / f"round-{round_dir.name[-2:]}-zcode.cleanup.json"
    receipt_created = False
    try:
        with cleanup_path.open("x", encoding="utf-8") as receipt:
            json.dump({"status": "running"}, receipt)
        receipt_created = True
        temp, env_overlay = _prepare_zcode_protocol_env(api_key, selected)
        env = os.environ.copy()
        # The helper mutates the parent env to support the subprocess, but
        # explicitly copy the final values into the child and never log them.
        env.update(env_overlay)
        # No-op under plain node; required when base is the app-bundle binary.
        env["ELECTRON_RUN_AS_NODE"] = "1"
        env.pop("ZCODE_BUILTIN_PROVIDER_BUNDLED_CONFIG_FILE", None)
        env.pop("ZCODE_PERSONAL_PROVIDER_CONFIG_FILE", None)
        argv = list(base) + ["app-server", "--cwd", str(artifact_root)]
        stderr_log = (logs_dir / f"round-{round_dir.name[-2:]}-zcode.stderr").open("w", encoding="utf-8")
        process = spawn(
            argv,
            cwd=artifact_root,
            env=env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=stderr_log,
            text=True,
            bufsize=1,
        )
        if process.stdin is None or process.stdout is None:
            return None, "ZCode app-server pipes were not created"
        selector = selectors.DefaultSelector()
        selector.register(process.stdout, selectors.EVENT_READ)
        next_id = 1
        send_started = False
        input_id = f"consensus-{uuid.uuid4()}"
        final_value: Any = None

        os.set_blocking(process.stdin.fileno(), False)

        def write_packet(packet: Dict[str, Any]) -> None:
            remaining = memoryview((json.dumps(packet, ensure_ascii=False) + "\n").encode("utf-8"))
            with selectors.DefaultSelector() as writable:
                writable.register(process.stdin, selectors.EVENT_WRITE)
                while remaining:
                    if stop_file is not None and stop_file.exists():
                        raise InterruptedError("review stop file present")
                    if time.monotonic() >= deadline:
                        raise TimeoutError("ZCode protocol timed out writing to app-server")
                    if not writable.select(max(0.0, min(0.2, deadline - time.monotonic()))):
                        continue
                    try:
                        remaining = remaining[os.write(process.stdin.fileno(), remaining):]
                    except BlockingIOError:
                        continue

        def send(method: str, params: Dict[str, Any], request_id: str | None = None) -> str:
            nonlocal next_id
            request_id = request_id or str(next_id)
            next_id += 1
            write_packet({"id": request_id, "method": method, "params": params})
            return request_id

        def answer_server_request(message: Dict[str, Any]) -> bool:
            method = message.get("method")
            if method == "session/requestRuntimePreferences":
                result: Dict[str, Any] = {
                    "nativeSearchEnhancementsEnabled": True,
                    "memoryEnabled": False,
                    "askUserQuestionAutoResolutionEnabled": True,
                    "modelContextBudgetStrategy": "preflight-v1",
                }
            elif method == "interaction/requestProviderRuntimeHeaders":
                result = {
                    "headersApplied": True,
                    "requestAuth": {
                        "apiKey": api_key,
                        "headers": {"Authorization": f"Bearer {api_key}"},
                    },
                }
            elif method == "interaction/requestPermission":
                result = {"decision": "deny", "reason": "consensus review is read-only"}
            elif method == "interaction/requestUserInput":
                result = {"cancelled": True}
            else:
                return False
            write_packet({"id": message.get("id"), "result": result})
            return True

        pending = b""

        def receive(deadline: float) -> Dict[str, Any] | None:
            nonlocal pending
            while time.monotonic() < deadline:
                if stop_file is not None and stop_file.exists():
                    raise InterruptedError("review stop file present")
                if b"\n" in pending:
                    line, _, pending = pending.partition(b"\n")
                    try:
                        value = json.loads(line)
                    except (ValueError, UnicodeError):
                        continue
                    if isinstance(value, dict):
                        return value
                    continue
                if not selector.select(max(0.0, min(0.2, deadline - time.monotonic()))):
                    continue
                chunk = os.read(process.stdout.fileno(), 65536)
                if not chunk:
                    return None
                pending += chunk
            return None

        def observe_turn(message: Dict[str, Any]) -> None:
            nonlocal turn_id, user_message_id, terminal, terminal_error
            if not send_started or message.get("method") != "session/event":
                return
            params = message.get("params")
            if not isinstance(params, dict) or params.get("sessionId") != session_id:
                return
            kind = params.get("type")
            event_turn = params.get("turnId")
            payload = params.get("payload") or {}
            if not isinstance(payload, dict):
                return
            if kind in {"turn.started", "turn.completed", "turn.failed"}:
                protocol_events.append({"type": kind, "turnId": event_turn, "inputId": payload.get("inputId")})
            if kind == "turn.started" and event_turn and turn_id is None and payload.get("inputId") == input_id:
                turn_id = event_turn
                user_message_id = payload.get("messageId")
            if not turn_id or event_turn != turn_id:
                return
            if kind in {"turn.completed", "turn.failed"}:
                terminal = True
                result_type = payload.get("resultType")
                if kind == "turn.failed" or result_type != "success":
                    terminal_error = f"ZCode root turn failed: {result_type or kind}"

        def read_until(target_id: str, deadline: float) -> Dict[str, Any]:
            nonlocal terminal, session_id, final_value
            while (message := receive(deadline)) is not None:
                protocol_log.append(str(message.get("method", "response")))
                if message.get("method") and answer_server_request(message):
                    continue
                observe_turn(message)
                if str(message.get("id")) == str(target_id):
                    return message
            raise TimeoutError(f"ZCode protocol timed out waiting for request {target_id}")

        deadline = time.monotonic() + timeout
        capability_id = send("runtime/capabilities", {})
        read_until(capability_id, min(deadline, time.monotonic() + 30))
        create_id = send("session/create", {
            "workspace": {"workspacePath": str(artifact_root), "workspaceKey": str(artifact_root)},
            "mode": "plan",
            "model": _zcode_model_ref(selected),
            "thoughtLevel": "max",
            "persistence": "deferred",
        })
        created = read_until(create_id, min(deadline, time.monotonic() + 90))
        if "error" in created:
            return None, f"ZCode session/create failed: {created['error']}"
        session_id = str(created.get("result", {}).get("session", {}).get("sessionId", ""))
        if not session_id:
            return None, "ZCode session/create returned no session id"
        mode_id = send("session/setMode", {"sessionId": session_id, "mode": "plan"})
        read_until(mode_id, min(deadline, time.monotonic() + 30))
        subscribe_id = send("session/subscribe", {"sessionId": session_id, "deliveryKind": "desktop-continuous", "includeSnapshot": True})
        read_until(subscribe_id, min(deadline, time.monotonic() + 30))
        send_started = True
        send_id = send("session/send", {
            "sessionId": session_id,
            "inputId": input_id,
            "content": prompt,
            "modelSelection": _zcode_model_ref(selected),
            "toolDenylist": ["Bash", "Edit", "Write", "NotebookEdit"],
        })
        sent = read_until(send_id, min(deadline, time.monotonic() + 30))
        if "error" in sent:
            return None, f"ZCode session/send failed: {sent['error']}"
        while time.monotonic() < deadline and not terminal:
            message = receive(deadline)
            if message is None:
                break
            protocol_log.append(str(message.get("method", "notification")))
            if message.get("method") and answer_server_request(message):
                continue
            observe_turn(message)
        if terminal_error:
            return None, terminal_error
        if not terminal:
            return None, "ZCode root turn did not complete before EOF or timeout"
        read_id = send("session/read", {"sessionId": session_id, "deliveryKind": "desktop-continuous", "messageLimit": 100})
        snapshot = read_until(read_id, min(deadline, time.monotonic() + 30))
        if "error" in snapshot:
            return None, f"ZCode session/read failed: {snapshot['error']}"
        final_value = snapshot.get("result", snapshot)
        if not user_message_id:
            return None, "ZCode root turn is missing its user message identity"
        text_output = _zcode_assistant_text(final_value, session_id, user_message_id)
        if not text_output:
            return None, f"ZCode returned no assistant text; terminal={terminal}; methods={protocol_log[-20:]}"
        (logs_dir / f"round-{round_dir.name[-2:]}-zcode.last-message").write_text(text_output, encoding="utf-8")
        return text_output, None
    except (OSError, TimeoutError, ValueError, json.JSONDecodeError) as exc:
        return None, f"ZCode protocol failure: {exc}"
    finally:
        cleanup = {"status": "complete", "errors": []}
        if process is not None:
            try:
                cleanup = finish(process)
            except OSError as exc:
                cleanup = {"status": "unverified", "errors": [f"process cleanup: {exc}"]}
        actions = []
        if selector is not None:
            actions.append(("selector", selector.close))
        if process is not None:
            actions.extend(("pipe", stream.close) for stream in (process.stdin, process.stdout) if stream is not None)
        if stderr_log is not None:
            actions.append(("stderr", stderr_log.close))
        if temp is not None:
            actions.append(("temporary provider data", temp.cleanup))
        for label, action in actions:
            try:
                action()
            except OSError as exc:
                cleanup["status"] = "unverified"
                cleanup["errors"].append(f"{label}: {exc}")
        if receipt_created:
            cleanup.update(session_id=session_id, turn_id=turn_id, user_message_id=user_message_id, events=protocol_events)
            try:
                cleanup_path.write_text(json.dumps(cleanup, indent=2) + "\n", encoding="utf-8")
            except OSError as exc:
                # The initial running receipt stays non-complete; keep the model output.
                print(f"ZCode cleanup receipt unavailable: {exc}", file=sys.stderr)


def write_zcode_project_config(run_dir: Path, zcode_selection: Dict[str, Any] | None = None) -> Path:
    config_path = run_dir / ZCODE_PROJECT_CONFIG
    if zcode_selection is None:
        raise ModelPolicyError("zcode model selection is required before writing the project config")
    main_model = str(zcode_selection["model"])
    lite_model = str(zcode_selection.get("lite_model", main_model))
    model_id = _zcode_model_id(zcode_selection)
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
                    model_id: {
                        "name": model_id,
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
    if (round_dir / f"ballot-{agent}.json").exists():
        return agent, "ballot already exists; refusing to overwrite"
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
        if zcode_protocol_enabled(base):
            final_message, protocol_error = run_zcode_protocol(
                base,
                prompt,
                artifact_root,
                round_dir,
                logs_dir,
                selected,
                timeout,
            )
            if final_message is not None:
                stdout_path.write_text(final_message, encoding="utf-8")
                ballot_path = round_dir / f"ballot-{agent}.json"
                try:
                    ballot = extract_json_object(final_message)
                except ValueError as exc:
                    stderr_path.write_text(f"invalid ballot JSON: {exc}\n", encoding="utf-8")
                    return agent, f"invalid ballot JSON: {exc}; see {stdout_path}"
                try:
                    with ballot_path.open("x", encoding="utf-8") as output:
                        output.write(json.dumps(ballot, ensure_ascii=False, indent=2, sort_keys=True) + "\n")
                except FileExistsError:
                    return agent, "ballot appeared during review; refusing to overwrite"
                validate = subprocess.run(
                    [sys.executable, str(skill_root / "scripts" / "review_gate.py"), "validate", "--manifest", str(round_dir.parent / "manifest.json"), "--ballot", str(ballot_path), "--round", str(round_dir.name[-2:])],
                    capture_output=True,
                    text=True,
                )
                if validate.returncode != 0:
                    return agent, f"ballot failed schema/gate validation: {validate.stderr.strip() or validate.stdout.strip()}"
                try:
                    cleanup = read_json(logs_dir / f"round-{round_dir.name[-2:]}-zcode.cleanup.json")
                except (OSError, ValueError) as exc:
                    return agent, f"ballot retained; cleanup receipt unavailable: {exc}"
                if cleanup.get("status") != "complete":
                    return agent, f"ballot retained; process cleanup {cleanup.get('status')}"
                return agent, None
            with stderr_path.open("a", encoding="utf-8") as log:
                log.write("\n" + (protocol_error or "ZCode protocol failed"))
            stdout_path.write_text("", encoding="utf-8")
            return agent, protocol_error or "ZCode protocol failed"
        zcode_cwd = round_dir.parent
        api_key = resolve_zcode_api_key()
        if api_key:
            env["BIGMODEL_API_KEY"] = api_key
        # No-op under plain node; required when base is the app-bundle binary.
        env["ELECTRON_RUN_AS_NODE"] = "1"
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
        with stdout_path.open("w", encoding="utf-8") as stdout_log, stderr_path.open("w", encoding="utf-8") as stderr_log:
            result = run_cli(
                argv, cwd=artifact_root, env=env, input=input_text,
                stdout=stdout_log, stderr=stderr_log, text=True, timeout=timeout,
                stop_file=Path(env["REVIEW_STOP_FILE"]) if env.get("REVIEW_STOP_FILE") else None,
            )
    except subprocess.TimeoutExpired as exc:
        with stderr_path.open("a", encoding="utf-8") as log:
            log.write(f"\nprocess timed out after {timeout}s\n")
        return agent, f"process timed out after {timeout}s; see {stderr_path}"
    except OSError as exc:
        stdout_path.touch(exist_ok=True)
        with stderr_path.open("a", encoding="utf-8") as log:
            log.write(f"\nprocess failure: {exc}\n")
        return agent, f"process failure: {exc}; see {stderr_path}"

    stdout = stdout_path.read_text(encoding="utf-8")
    if raw_output_path.exists():
        try:
            final_message = raw_output_path.read_text(encoding="utf-8")
        except OSError:
            final_message = ""
    else:
        final_message = stdout
    stdout_path.write_text(stdout + ("\n--- last message ---\n" + final_message if final_message != stdout else ""), encoding="utf-8")
    if result.returncode != 0:
        return agent, f"process exited {result.returncode}; see {stderr_path}"
    try:
        ballot = extract_json_object(final_message)
    except ValueError as exc:
        return agent, f"invalid ballot JSON: {exc}; see {stdout_path}"
    ballot_path = round_dir / f"ballot-{agent}.json"
    try:
        with ballot_path.open("x", encoding="utf-8") as output:
            output.write(json.dumps(ballot, ensure_ascii=False, indent=2, sort_keys=True) + "\n")
    except FileExistsError:
        return agent, "ballot appeared during review; refusing to overwrite"
    validate = subprocess.run(
        [sys.executable, str(skill_root / "scripts" / "review_gate.py"), "validate", "--manifest", str(round_dir.parent / "manifest.json"), "--ballot", str(ballot_path), "--round", str(round_dir.name[-2:])],
        capture_output=True,
        text=True,
    )
    if validate.returncode != 0:
        return agent, f"ballot failed schema/gate validation: {validate.stderr.strip() or validate.stdout.strip()}"
    if result.cleanup.get("status") != "complete":
        return agent, f"ballot retained; process cleanup {result.cleanup.get('status')}"
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
        zcode_base = agent_command("zcode")
        if zcode_protocol_enabled(zcode_base):
            # ZCode 0.16.9 rejects the legacy workspace provider shape.  The
            # protocol adapter supplies an ephemeral personal registry instead.
            legacy_config = run_dir / ZCODE_PROJECT_CONFIG
            if legacy_config.exists():
                legacy_config.unlink()
        else:
            write_zcode_project_config(run_dir, model_selection["zcode"])
        model_selection_sha256 = write_or_verify_model_selection(run_dir, model_selection)
    except (ModelPolicyError, OSError) as exc:
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
    install_signal_handlers()
    raise SystemExit(main())
