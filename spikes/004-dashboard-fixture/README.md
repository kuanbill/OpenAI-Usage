# Spike 004 — Dashboard fixture UI

## Goal
Shape the first dashboard screen after the one- and two-account read path passed. This is a local, offline visual prototype only; it must not be mistaken for live data or trigger account operations.

## Contents
- `index.html`: responsive dashboard with two sample accounts, primary/secondary windows, reset estimates, source/freshness labels, and a disabled reset button.
- `usage-model.js`: allow-listed mapper for official rate-limit responses. Missing values stay unavailable (not zero); account identifiers and raw provider fields are omitted.
- `usage-model.test.js`: unit tests for normal values, missing windows, real zero values, invalid percentages, and identity-field exclusion.
- `preview_server.js`: loopback-only static page server; no API routes or Codex subprocesses.

## Run

```bash
node preview_server.js
```

Open `http://127.0.0.1:8767` in the Hermes desktop preview. All visible numbers are fictional fixture values. No login or OpenAI request is made.

## Checks

```bash
node --test usage-model.test.js
node --check usage-model.js
node --check preview_server.js
```

## Verdict: PARTIAL — view-model and dashboard layout ready for feedback

### Not implemented yet
- React/Electron shell, SQLite history, real provider adapter, automatic refresh, notifications, and reset-credit confirmation flow.
- The mapper is tested against the locally generated Codex App Server schema; production integration must pin and revalidate the CLI/schema version.
