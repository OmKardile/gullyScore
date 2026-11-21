#!/usr/bin/env python3
"""Create the v0.2.0-rust GitHub release (prerelease) with the Rust APK.

Run AFTER: gs-main is pushed (the release tags remote main, which contains
rust-anything-lab/ + apk/GullyScore-rust-0.2.0.apk) and the APK is at
download/GullyScore-rust-0.2.0.apk (git show gs-main:apk/… can restore it).
Requires a fresh GitHub PAT at /tmp/.ghpat (repo scope) — delete it after.
If /tmp/.ghpat is missing, writes the release notes to
download/GullyScore-rust-0.2.0-release-notes.md instead (no upload).
"""
import hashlib
import json
import os
import sys
import urllib.error
import urllib.request

REPO = "OmKardile/gullyScore"
APK = "/home/z/my-project/download/GullyScore-rust-0.2.0.apk"
NOTES = "/home/z/my-project/download/GullyScore-rust-0.2.0-release-notes.md"

TAG = "v0.2.0-rust"
NAME = "GullyScore Rust 0.2.0 — full engine port in pure Rust, NativeActivity APK"
TOKEN = None


def body_text(sha: str) -> str:
    return f"""Parallel **Rust implementation** of GullyScore (tag `{TAG}`) — the
React Native app remains the primary shipped app; this is the whole project
re-created in Rust per the rust-anything approach, in the new
`rust-anything-lab/` folder at the repo root.

**Prerelease** — the stable Latest release remains [v1.4.6](https://github.com/OmKardile/gullyScore/releases/tag/v1.4.6).

## What this build is
- **gullyscore_engine** — a full port of the RN scoring engine (Tidy,
  judge, interlude, recorder shells), proved against **1124 recorded
  JS-vs-Rust cases, 1124/1124 exact matches** (exact float round-tripping
  via serde_json `float_roundtrip`; recorded from the live TS engine with
  `rust-anything-lab/record/record.mjs`).
- **gullyscore_app** — egui/glow UI on eframe 0.33
  `android-native-activity`: pure Rust, `hasCode=false`, no Java/Kotlin
  glue — the APK is a NativeActivity host that loads
  `libgullyscore_app.so`.
- Built with the lab's own self-contained toolchain
  (`rust-anything-lab/scripts/setup-android-sdk.sh` + `build-apk.sh`);
  the debug keystore is committed, so the build is reproducible.

## Install
`GullyScore-rust-0.2.0.apk` — arm64-v8a, versionCode 1, minSdk 24,
targetSdk 34, debug-signed. Package `dev.omkardile.gullyscore.rust`
installs **alongside** the RN app (`dev.omkardile.gullyscore`), so both
can be compared on the same phone.

## Verification
- Engine: 1124/1124 recorded cases (`rust-anything-lab/check.sh`).
- APK: apksigner verify (v2 + v3) passes, signer cert
  `b45a73e0…` (the committed debug.keystore),
  `ANativeActivity_onCreate` exported from the packed `.so`,
  aapt badging `dev.omkardile.gullyscore.rust` 0.2.0.
- SHA-256 `{sha}`.
"""


def api(method, url, payload=None, raw=None, ctype="application/json"):
    data = raw if raw is not None else (json.dumps(payload).encode() if payload is not None else None)
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {TOKEN}")
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("User-Agent", "gullyscore-release")
    if ctype:
        req.add_header("Content-Type", ctype)
    with urllib.request.urlopen(req) as r:
        body = r.read()
        if ctype == "application/json" or url.startswith("https://uploads.github.com"):
            return r.status, json.loads(body) if body else None
        return r.status, body


def upload(rid, path, name, mime):
    with open(path, "rb") as f:
        blob = f.read()
    url = f"https://uploads.github.com/repos/{REPO}/releases/{rid}/assets?name={name}"
    try:
        _, up = api("POST", url, raw=blob, ctype=mime)
    except urllib.error.HTTPError as e:
        print("ASSET UPLOAD FAILED", name, e.code, e.read().decode()[:400])
        sys.exit(1)
    print(f"asset uploaded: {up['name']} | {up['size']} bytes | {up['browser_download_url']}")


def main():
    if not os.path.isfile(APK):
        print("APK not present:", APK)
        print("restore with: git show gs-main:apk/GullyScore-rust-0.2.0.apk >", APK)
        sys.exit(1)
    sha = hashlib.sha256(open(APK, "rb").read()).hexdigest()
    notes = body_text(sha)
    with open(NOTES, "w") as f:
        f.write(f"# {NAME}\n\n" + notes)
    print("release notes written:", NOTES)

    if not os.path.isfile("/tmp/.ghpat"):
        print("no /tmp/.ghpat — skipping GitHub upload (notes are in download/)")
        return
    global TOKEN
    TOKEN = open("/tmp/.ghpat").read().strip()

    status, rels = api("GET", f"https://api.github.com/repos/{REPO}/releases?per_page=30")
    rel = next((r for r in rels if r["tag_name"] == TAG), None)
    if rel is None:
        payload = {
            "tag_name": TAG,
            "target_commitish": "main",
            "name": NAME,
            "body": notes,
            "draft": False,
            "prerelease": True,
            "make_latest": "false",
        }
        try:
            _, rel = api("POST", f"https://api.github.com/repos/{REPO}/releases", payload)
        except urllib.error.HTTPError as e:
            print("RELEASE CREATE FAILED", e.code, e.read().decode()[:400])
            sys.exit(1)
        print(f"release created: {rel['id']} | {rel['html_url']}")
    else:
        print(f"release exists: {rel['id']} | {rel['html_url']}")
    rid = rel["id"]

    have = {a["name"] for a in rel["assets"]}
    if "GullyScore-rust-0.2.0.apk" not in have:
        upload(rid, APK, "GullyScore-rust-0.2.0.apk", "application/vnd.android.package-archive")
    else:
        print("apk already attached")
    print("DONE — delete /tmp/.ghpat now.")


if __name__ == "__main__":
    main()
