# Spike 002 — Codex device-code authentication UI

## Goal
Test whether a Windows-local UI can start Codex's official device-code authentication in an isolated profile and detect success, then verify that the authenticated profile can read usage metadata.

## Safety boundary
- The test uses a dedicated temporary `CODEX_HOME` under Hermes scratch, separate from the user's existing Codex profile.
- Pressing **開始裝置代碼測試** will request an actual one-time code. The code is returned only to this loopback page, never printed to terminal/logs, saved to disk, or sent to Hermes chat. The user must enter it only on the official HTTPS OpenAI verification page shown by the UI.
- The server binds only to `127.0.0.1`, checks the request origin, uses `Cache-Control: no-store`, and does not return account IDs, raw RPC responses, or usage values.
- The test only reads `account/rateLimits/read`; it does not call any reset-consume method, use an API key, change a plan, or initiate payment.
- When finished, use **登出並清除暫存認證**. It calls `account/logout` (if authentication completed), stops the Codex process tree, and deletes only the dedicated scratch profile.

## Run
From this directory, start:

```bash
node auth_test_server.js
```

Then open `http://127.0.0.1:8765` in the Hermes desktop preview. No device code is generated until the user clicks the start button. The UI reports only `authenticated + usage read succeeded` or a safe error state.

## Verified before user-owned authentication
- JavaScript syntax check passes.
- UI and server start locally and return idle status without launching Codex or generating a device code.
- Generated Codex App Server schema confirms `account/login/start` supports `type: chatgptDeviceCode`; its response contains a `userCode` and `verificationUrl`.
- Auth completion notification is `account/login/completed`; successful completion triggers one read-only `account/rateLimits/read` and returns only a boolean result to the UI.

## Interactive test result
- User completed the device-code step in the OpenAI browser page; the user reported “測試通過”.
- The loopback status endpoint independently returned `state=authenticated` and `usageReadable=true` (only booleans were read; no usage percentages or account IDs).
- `/api/cleanup` returned `state=cleaned` and `scratchProfileRemoved=true`; a follow-up status read confirmed `state=cleaned`, and the dedicated scratch profile directory was absent.
- The local server was stopped. No reset-credit consume method was called, and the code was never inspected or logged by the assistant.

## Verdict: VALIDATED — one-account device-code UI auth and read-only usage check

### Still unverified
- A second independently authorized account/profile and automatic multi-account polling.
- Long-running refresh notifications and behavior across Codex App Server upgrades (the CLI app-server remains experimental).
