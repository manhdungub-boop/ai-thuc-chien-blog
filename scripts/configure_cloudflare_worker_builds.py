#!/usr/bin/env python3
"""Safely normalize verified Cloudflare Workers Builds production and optional preview triggers."""
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
EXPECTED_DEPLOY_COMMAND = "npx wrangler deploy"
EXPECTED_PREVIEW_COMMAND = "npx wrangler preview"
PRIMARY_BUILD_TOKEN_NAME = "ai-thuc-chien-blog build token"
ALLOWED_DEPLOY_COMMANDS = {EXPECTED_DEPLOY_COMMAND, EXPECTED_PREVIEW_COMMAND}
PRODUCTION_TRIGGERS = (
    {"name": "ai-thuc-chien-blog", "tag": "f0142edba057434191f9d452ba159e00",
     "trigger_uuid": "fefb9a7f-85ff-474e-b2ad-fb83eb000c05",
     "branch": "main", "kind": "production", "deploy_command": EXPECTED_DEPLOY_COMMAND},
    {"name": "ai-thuc-chien-blog-moi", "tag": "b1481a57488a4839b9a745f93b7dad61",
     "trigger_uuid": "c0af6fef-ce6b-4516-a092-433c59f2c9a6",
     "branch": "main", "kind": "production", "deploy_command": EXPECTED_DEPLOY_COMMAND},
)


def api_request(path, token, method="GET", payload=None):
    url = "https://api.cloudflare.com/client/v4" + path
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    req = Request(
        url, data=body, method=method,
        headers={
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "AI-Thuc-Chien-Build-Config/2.0",
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
    return {
        "name": "preview:" + branch,
        "tag": tag,
        "trigger_uuid": trigger_uuid,
        "branch": branch,
        "kind": "preview",
        "deploy_command": EXPECTED_PREVIEW_COMMAND,
    }


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
    if trigger.get("deploy_command") not in ALLOWED_DEPLOY_COMMANDS:
        raise ValueError(f"{spec['name']}: unexpected deploy command; refusing to update")
    if not trigger.get("build_token_uuid"):
        raise ValueError(f"{spec['name']}: build token UUID missing; refusing to update")

    includes = trigger.get("branch_includes") or []
    excludes = trigger.get("branch_excludes") or []
    if spec["kind"] == "production":
        if spec["branch"] != "main" or "main" not in includes or "main" in excludes:
            raise ValueError(f"{spec['name']}: production branch validation failed; refusing to update")
    else:
        branch = spec["branch"]
        if not branch or branch == "main" or (branch not in includes and "*" not in includes):
            raise ValueError(f"{spec['name']}: preview branch mismatch; refusing to update")
        # A wildcard preview trigger must explicitly exclude main to avoid deploy overlap.
        if "*" in includes and "main" not in excludes:
            raise ValueError(f"{spec['name']}: preview wildcard does not exclude main; refusing to update")
        if "main" in includes:
            raise ValueError(f"{spec['name']}: preview trigger includes main; refusing to update")
    return trigger


def resolve_primary_build_token(primary_trigger, token_records):
    """Return only the known-good primary build token UUID after exact metadata checks."""
    token_uuid = (primary_trigger or {}).get("build_token_uuid")
    if not token_uuid:
        raise ValueError("Primary Worker trigger has no build token UUID")
    matches = [item for item in token_records if item.get("build_token_uuid") == token_uuid]
    if len(matches) != 1:
        raise ValueError(f"Primary Worker build token must have one current record; found {len(matches)}")
    if matches[0].get("build_token_name") != PRIMARY_BUILD_TOKEN_NAME:
        raise ValueError("Primary Worker build token name did not match the verified token; refusing reuse")
    return token_uuid


def changes_for(trigger, spec):
    desired = {
        "build_command": TARGET_BUILD_COMMAND,
        "deploy_command": spec["deploy_command"],
    }
    # Token changes are only allowed when explicitly attached to a preflighted preview spec.
    if spec.get("kind") == "preview" and spec.get("use_build_token_uuid"):
        desired["build_token_uuid"] = spec["use_build_token_uuid"]
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
    reuse_raw = os.environ.get("PREVIEW_REUSE_PRIMARY_BUILD_TOKEN", "false").strip().lower()
    if reuse_raw not in {"", "true", "false", "1", "0", "yes", "no"}:
        print("ERROR: preview_reuse_primary_build_token must be true or false.", file=sys.stderr)
        return 2
    reuse_primary_build_token = reuse_raw in {"true", "1", "yes"}
    preview_inputs = (preview_uuid, preview_tag, preview_branch)
    if any(preview_inputs) and not all(preview_inputs):
        print("ERROR: preview_trigger_uuid, preview_worker_tag and preview_branch must be supplied together.", file=sys.stderr)
        return 2
    if preview_sha and not all(preview_inputs):
        print("ERROR: preview_commit_sha requires all preview trigger inputs.", file=sys.stderr)
        return 2
    if reuse_primary_build_token and not all(preview_inputs):
        print("ERROR: reusing the primary build token requires an exact preview trigger UUID, Worker tag and branch.", file=sys.stderr)
        return 2
    if preview_sha and not re.fullmatch(r"[0-9a-fA-F]{40}", preview_sha):
        print("ERROR: preview_commit_sha must be a 40-character Git commit SHA.", file=sys.stderr)
        return 2

    specs = list(PRODUCTION_TRIGGERS)
    if all(preview_inputs):
        specs.append(preview_spec(preview_tag, preview_uuid, preview_branch))

    try:
        # Preflight every trigger before modifying any of them.
        current = {}
        for spec in specs:
            endpoint = f"/accounts/{ACCOUNT_ID}/builds/workers/{spec['tag']}/triggers"
            trigger = validate_trigger(api_request(endpoint, token) or [], spec)
            current[spec["trigger_uuid"]] = trigger

        # Optional, explicit recovery path: reuse the verified primary build token only on this preview trigger.
        # The primary production trigger and secondary production trigger are preflighted above and are never patched.
        if reuse_primary_build_token:
            preview = specs[-1]
            if preview.get("kind") != "preview":
                raise ValueError("Token reuse can only target a non-production preview trigger")
            token_records = api_request(f"/accounts/{ACCOUNT_ID}/builds/tokens", token) or []
            primary_trigger = current[PRODUCTION_TRIGGERS[0]["trigger_uuid"]]
            primary_token_uuid = resolve_primary_build_token(primary_trigger, token_records)
            preview["use_build_token_uuid"] = primary_token_uuid
            print("TOKEN VERIFIED: reusing the existing primary Worker build token for this preview trigger only.")

        # Apply only the explicitly expected fields; token changes are preview-only and opt-in.
        for spec in specs:
            trigger = current[spec["trigger_uuid"]]
            patch = changes_for(trigger, spec)
            if patch:
                api_request(
                    f"/accounts/{ACCOUNT_ID}/builds/triggers/{spec['trigger_uuid']}",
                    token, method="PATCH", payload=patch,
                )
                print(f"UPDATED: {spec['name']} fields: {', '.join(sorted(patch))}")
            else:
                print(f"NO CHANGE: {spec['name']} already matches its expected commands")

        # Read back all trigger settings before optionally enqueueing a preview build.
        verified = {}
        for spec in specs:
            endpoint = f"/accounts/{ACCOUNT_ID}/builds/workers/{spec['tag']}/triggers"
            trigger = validate_trigger(api_request(endpoint, token) or [], spec)
            if trigger.get("build_command") != TARGET_BUILD_COMMAND:
                raise RuntimeError(f"{spec['name']}: build command did not persist")
            if trigger.get("deploy_command") != spec["deploy_command"]:
                raise RuntimeError(f"{spec['name']}: deploy command did not persist")
            if spec.get("use_build_token_uuid") and trigger.get("build_token_uuid") != spec["use_build_token_uuid"]:
                raise RuntimeError(f"{spec['name']}: preview build token did not persist")
            verified[spec["trigger_uuid"]] = trigger
            extra = " + verified preview token" if spec.get("use_build_token_uuid") else ""
            print(f"PASS: {spec['name']} verified ({spec['branch']} -> {spec['deploy_command']}{extra})")

        if preview_sha:
            spec = specs[-1]
            # The branch was preflighted as non-production above, so this queues only a preview build.
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
    print("SUCCESS: verified trigger configuration complete; production deploys and non-production previews use distinct commands.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
