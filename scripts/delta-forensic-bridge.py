#!/usr/bin/env python3
"""Thin FIL -> DeltaStore JSON bridge.

Loads the DeltaStore source directory as an isolated namespace package so the
forensic recorder does not require importing unrelated optional Delta modules.
"""

from __future__ import annotations

import argparse
import importlib
import json
import sys
import types
from pathlib import Path
from typing import Any, Dict


def load_forensic_session(source_dir: Path):
    source_dir = source_dir.resolve()
    if not (source_dir / "forensics.py").exists():
        raise FileNotFoundError(
            f"DeltaStore forensic module not found at {source_dir / 'forensics.py'}"
        )

    package_name = "_fil_delta_runtime"
    package = types.ModuleType(package_name)
    package.__path__ = [str(source_dir)]
    package.__package__ = package_name
    sys.modules[package_name] = package
    module = importlib.import_module(f"{package_name}.forensics")
    return module.ForensicSession


def reply(payload: Dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload, sort_keys=True, default=str) + "\n")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-dir", required=True)
    parser.add_argument("--db", required=True)
    parser.add_argument("--session-id", required=True)
    parser.add_argument("--redact-sensitive-text", action="store_true")
    args = parser.parse_args()

    session = None
    try:
        request = json.loads(sys.stdin.read() or "{}")
        ForensicSession = load_forensic_session(Path(args.source_dir))
        session = ForensicSession(
            args.session_id,
            args.db,
            include_sensitive_text=not args.redact_sensitive_text,
        )

        op = request.get("op")
        data = request.get("data") or {}

        if op == "status":
            result = {
                "state": session.get_state(),
                "structure": session.structure(),
                "invariants": session.verify_invariants().__dict__,
            }
        elif op == "append_turn":
            result = session.append_turn(**data)
        elif op == "record_context_artifact":
            result = session.record_context_artifact(**data)
        elif op == "record_boundary_observation":
            result = session.record_boundary_observation(**data)
        elif op == "create_branch":
            result = {"timeline_id": session.create_branch(**data)}
        elif op == "switch_branch":
            result = {"state": session.switch_branch(**data)}
        elif op == "go_to_event":
            result = {"state": session.go_to_event(**data)}
        elif op == "state":
            result = session.get_state()
        elif op == "structure":
            result = session.structure()
        elif op == "verify":
            result = session.verify_invariants().__dict__
        elif op == "export_jsonl":
            result = {"path": str(session.export_jsonl(data["path"]))}
        elif op == "flush":
            session.flush()
            result = {"flushed": True}
        else:
            raise ValueError(f"Unsupported op: {op!r}")

        reply({"ok": True, "result": result})
        return 0
    except Exception as exc:
        reply({"ok": False, "error": f"{type(exc).__name__}: {exc}"})
        return 1
    finally:
        if session is not None:
            session.close()


if __name__ == "__main__":
    raise SystemExit(main())
