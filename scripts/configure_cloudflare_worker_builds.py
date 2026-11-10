#!/usr/bin/env python3
"""Safely update one explicitly identified Cloudflare Workers Builds Preview trigger.

This updater never queries or modifies Production Workers Builds triggers.
"""
import json
import os
import re
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ACCOUNT_ID = "92cf091bbac8b4879ec65feb30b4715b"
REPO_NAME = "ai-thuc-chien-blog"
REPO_ID = "1423636651"
TARGET_BUILD_COMMAND = "npm run build"
ALLOWED_PREVIEW_DEPLOY_COMMANDS = {
    "npx wrangler preview",
    "npx wrangler@4 deploy --config wrangler.preview.jsonc --keep-vars",
    "npx wrangler@latest deploy --config wrangler.isolated.toml",
    "npx --yes wrangler@4.158.0 deploy --config wrangler.content-preview.toml",
    "npx --yes wrangler@4 deploy --config wrangler.article-fallback-preview.toml && node scripts/test-live-article-fallback-preview.mjs",
    "echo 'No production deployment for this preview-only Worker'",
}


def api_request(path, token, method="GET", payload=None):
    url = "https://api.cloudflare.com/client/v4" + path
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    req = Request(
        url, data=body, method=method,
        headers={
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "AI-Thuc-Chien-Preview-Trigger-Guard/3.0",
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


def preview_spec(tag, trigger_uuid, branch):
    if not tag or not trigger_uuid or not branch or branch == "main":
        raise ValueError("A verified non-production Preview tag, trigger UUID and branch are required.")
    return {
        "name": "preview:" + branch,
        "tag": tag,
        "trigger_uuid": trigger_uuid,
        "branch": branch,
        "kind": "preview",
    }


def validate_trigger(triggers, spec):
    if spec.get("kind") != "preview":
        raise ValueError("This updater accepts Preview triggers only; Production is never queried or modified.")
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
    if trigger.get("deploy_command") not in ALLOWED_PREVIEW_DEPLOY_COMMANDS:
        raise ValueError(f"{spec['name']}: deploy command is not on the Preview-only allowlist; refusing to update")
    if not trigger.get("build_token_uuid"):
        raise ValueError(f"{spec['name']}: build token UUID missing; refusing to update")

    includes = trigger.get("branch_includes") or []
    excludes = trigger.get("branch_excludes") or []
    branch = spec["branch"]
    if branch == "main" or (branch not in includes and "*" not in includes):
        raise ValueError(f"{spec['name']}: preview branch mismatch; refusing to update")
    if "main" in includes or ("*" in includes and "main" not in excludes):
        raise ValueError(f"{spec['name']}: Preview trigger could overlap main; refusing to update")
    return trigger


def changes_for(trigger, spec):
    if spec.get("kind") != "preview":
        raise ValueError("Only Preview trigger changes are supported.")
    desired = {"build_command": TARGET_BUILD_COMMAND}
    return {key: value for key, value in desired.items() if trigger.get(key) != value}


def main():
    token = os.environ.get("CLOUDFLARE_WORKERS_BUILDS_API_TOKEN", "").strip()
    if not token:
        print("ERROR: set the GitHub Actions secret CLOUDFLARE_WORKERS_BUILDS_API_TOKEN first.", file=sys.stderr)
        return 2

    preview_uuid = os.environ.get("PREVIEW_TRIGGER_UUID", "").strip()
    preview_tag = os.environ.get("PREVIEW_WORKER_TAG", "").strip()
    preview_branch = os.environ.get("PREVIEW_BRANCH", "").strip()
    preview_sha = os.environ.get("PREVIEW_COMMIT_SHA", "").strip()
    preview_inputs = (preview_uuid, preview_tag, preview_branch)
    if not all(preview_inputs):
        print("ERROR: exact Preview trigger UUID, Worker tag and non-production branch are required.", file=sys.stderr)
        print("Production Workers Builds triggers are never queried or modified by this updater.", file=sys.stderr)
        return 2
    if preview_sha and not re.fullmatch(r"[0-9a-fA-F]{40}", preview_sha):
        print("ERROR: preview_commit_sha must be a 40-character Git commit SHA.", file=sys.stderr)
        return 2

    try:
        spec = preview_spec(preview_tag, preview_uuid, preview_branch)
        endpoint = f"/accounts/{ACCOUNT_ID}/builds/workers/{spec['tag']}/triggers"
        current = validate_trigger(api_request(endpoint, token) or [], spec)

        patch = changes_for(current, spec)
        if patch:
            api_request(
                f"/accounts/{ACCOUNT_ID}/builds/triggers/{spec['trigger_uuid']}",
                token, method="PATCH", payload=patch,
            )
            print(f"UPDATED: {spec['name']} fields: {', '.join(sorted(patch))}")
        else:
            print(f"NO CHANGE: {spec['name']} build command already matches")

        verified = validate_trigger(api_request(endpoint, token) or [], spec)
        if verified.get("build_command") != TARGET_BUILD_COMMAND:
            raise RuntimeError(f"{spec['name']}: Preview build command did not persist")
        for field in ("deploy_command", "build_token_uuid", "branch_includes", "branch_excludes"):
            if verified.get(field) != current.get(field):
                raise RuntimeError(f"{spec['name']}: protected Preview field {field} unexpectedly changed")
        print(f"PASS: {spec['name']} verified; deploy command, token and branch filters remained unchanged.")

        if preview_sha:
            result = api_request(
                f"/accounts/{ACCOUNT_ID}/builds/triggers/{spec['trigger_uuid']}/builds",
                token, method="POST",
                payload={"branch": preview_branch, "commit_hash": preview_sha},
            ) or {}
            build_uuid = result.get("build_uuid") if isinstance(result, dict) else None
            if not build_uuid:
                raise RuntimeError("Preview build request returned no build UUID")
            print(f"PREVIEW BUILD QUEUED: {preview_branch} at {preview_sha}; build UUID {build_uuid}")

    except (RuntimeError, ValueError) as exc:
        print("ERROR:", str(exc), file=sys.stderr)
        return 1

    print("SUCCESS: only the explicitly supplied non-production Preview trigger was inspected/updated.")
    print("SUCCESS: Production Workers Builds triggers were never queried or modified.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
