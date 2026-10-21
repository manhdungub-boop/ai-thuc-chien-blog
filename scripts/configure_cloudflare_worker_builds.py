#!/usr/bin/env python3
"""Safely set existing Workers Builds production triggers to use the repository build script."""
import json
import os
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ACCOUNT_ID = "92cf091bbac8b4879ec65feb30b4715b"
REPO_NAME = "ai-thuc-chien-blog"
REPO_ID = "1423636651"
TARGET_BUILD_COMMAND = "npm run build"
WORKERS = (
    {
        "name": "ai-thuc-chien-blog",
        "tag": "f0142edba057434191f9d452ba159e00",
        "trigger_uuid": "fefb9a7f-85ff-474e-b2ad-fb83eb000c05",
    },
    {
        "name": "ai-thuc-chien-blog-moi",
        "tag": "b1481a57488a4839b9a745f93b7dad61",
        "trigger_uuid": "c0af6fef-ce6b-4516-a092-433c59f2c9a6",
    },
)


def api_request(path, token, method="GET", payload=None):
    url = "https://api.cloudflare.com/client/v4" + path
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    req = Request(
        url,
        data=body,
        method=method,
        headers={
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "AI-Thuc-Chien-Build-Config/1.0",
        },
    )
    try:
        with urlopen(req, timeout=30) as response:
            data = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:800]
        raise RuntimeError(f"Cloudflare API returned HTTP {exc.code}: {detail}") from None
    except URLError as exc:
        raise RuntimeError(f"Cloudflare API connection failed: {exc.reason}") from None
    except json.JSONDecodeError:
        raise RuntimeError("Cloudflare API returned invalid JSON") from None

    if not data.get("success"):
        errors = data.get("errors") or data.get("messages") or []
        raise RuntimeError("Cloudflare API error: " + json.dumps(errors, ensure_ascii=False)[:800])
    return data.get("result")


def validate_trigger(triggers, spec):
    matches = [t for t in triggers if t.get("trigger_uuid") == spec["trigger_uuid"]]
    if len(matches) != 1:
        raise ValueError(f"{spec['name']}: expected one matching trigger; found {len(matches)}")

    trigger = matches[0]
    if trigger.get("external_script_id") != spec["tag"]:
        raise ValueError(f"{spec['name']}: Worker tag mismatch; refusing to update")

    repo = trigger.get("repo_connection") or {}
    if repo.get("repo_name") != REPO_NAME or str(repo.get("repo_id")) != REPO_ID:
        raise ValueError(f"{spec['name']}: repository identity mismatch; refusing to update")

    if trigger.get("root_directory") != "/":
        raise ValueError(f"{spec['name']}: root directory changed; inspect before updating")

    # The deploy command may legitimately include environment or project-specific flags.
    # We never send it in the PATCH payload; just require a value and verify it stays unchanged.
    deploy_command = trigger.get("deploy_command")
    if not isinstance(deploy_command, str) or not deploy_command.strip():
        raise ValueError(f"{spec['name']}: deploy command missing or empty; refusing to update")

    if "main" not in (trigger.get("branch_includes") or []):
        raise ValueError(f"{spec['name']}: production branch main not configured; refusing to update")

    if not trigger.get("build_token_uuid"):
        raise ValueError(f"{spec['name']}: build token UUID missing; refusing to update")

    return trigger


def build_update_payload(current):
    """Return a build-only patch; never include deploy_command or other trigger fields."""
    if current.get("build_command") == TARGET_BUILD_COMMAND:
        return None
    return {"build_command": TARGET_BUILD_COMMAND}


def configure_worker(token, spec):
    base = f"/accounts/{ACCOUNT_ID}/builds/workers/{spec['tag']}/triggers"
    current = validate_trigger(api_request(base, token) or [], spec)
    original_deploy_command = current["deploy_command"]

    payload = build_update_payload(current)
    if payload is not None:
        api_request(
            f"/accounts/{ACCOUNT_ID}/builds/triggers/{spec['trigger_uuid']}",
            token,
            method="PATCH",
            payload=payload,
        )

    updated = validate_trigger(api_request(base, token) or [], spec)
    if updated.get("deploy_command") != original_deploy_command:
        raise RuntimeError(
            f"{spec['name']}: deploy command changed during build-only update; stop and investigate"
        )
    if updated.get("build_command") != TARGET_BUILD_COMMAND:
        raise RuntimeError(f"{spec['name']}: build command did not persist")

    print(
        f"PASS: {spec['name']} uses npm run build; "
        "existing deploy command and target identity are preserved"
    )


def main():
    token = os.environ.get("CLOUDFLARE_WORKERS_BUILDS_API_TOKEN", "").strip()
    if not token:
        print(
            "ERROR: set the GitHub Actions secret CLOUDFLARE_WORKERS_BUILDS_API_TOKEN first.",
            file=sys.stderr,
        )
        return 2

    try:
        for spec in WORKERS:
            configure_worker(token, spec)
    except (RuntimeError, ValueError) as exc:
        print("ERROR:", str(exc), file=sys.stderr)
        return 1

    print("SUCCESS: both verified Workers Builds triggers now use the shared build script.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
