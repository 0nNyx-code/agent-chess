# EPIC Chess — Vitrine Glass

A cinematic chess stage for Android. One board, one status line, one transport
pill. Everything else lives in a glass sheet that rises when you ask for it.

- Hand-written chess engine and search (no dependencies, no network).
- Single-file web bundle served inside a hardened WebView shell.
- Six modes planned: Adventure, Rank, Play with Bot, Puzzle, Atomic, Classic.
  Play with Bot and Classic are live; the rest are marked *Soon* in the UI.

## Build

```bash
node scripts/build.mjs                 # dist/agent-chess.html + android/assets/index.html
ANDROID_SDK=/path/to/sdk bash scripts/build-apk.sh
```

The APK pipeline is `aapt2 -> javac -> d8 -> zipalign -> apksigner`; no Gradle.
CI runs the same script on every push to `main` and publishes
`dist/agent-chess.apk` as a release (`apk-<run_number>`).

## Install

`versionCode 2` / `versionName 1.1`. If the previous build was signed with a
different key, uninstall it once before installing this APK.

## Layout

- `app/` — markup, Vitrine Glass CSS, engine, search, UI, stage shell.
- `android/` — manifest, resources and the defensive `MainActivity` WebView.
- `scripts/` — single-file bundler and the Gradle-free APK pipeline.
- `docs/DESIGN-DIRECTION.md` — the approved visual contract.
