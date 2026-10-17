# Spike 003 — Two-account Codex profile isolation

## Goal
Validate the next project gate: two independent ChatGPT/Codex accounts must authenticate in separate Codex App Server processes and each read its own usage metadata. This spike prepares an interactive local harness; the real second-account check still requires the user to complete the official browser flow for both accounts.

## Safety
- Fixed Codex CLI version: `0.163.0` (invoked through `npm exec`; no global install).
- The server binds only to `127.0.0.1:8766`. It creates separate `CODEX_HOME` directories under `cache/scratch/codex-two-profile-test/account-a` and `account-b`.
- No App Server is started and no device code is generated until the user presses a login button.
- Each one-time code is returned only to its local page, never logged or written to disk. Enter it only on the OpenAI official HTTPS verification page. Do not send either code to Hermes.
- Each profile independently uses `account/read` and `account/rateLimits/read`. Email values are held in memory only for a single comparison, then discarded. The UI receives only each read-success boolean and `different` / `same` / `unavailable`; it never receives emails, account IDs, quota values, or raw RPC responses.
- No API key, plan-change, payment, or reset-consume method is called. If the official browser flow asks for a key, payment, or plan action, cancel and stop.
- Cleanup logs out/cancels both sessions, kills both process trees, and removes only the dedicated test root. Server shutdown also performs cleanup.

## Run

```bash
node two_profile_server.js
```

Open `http://127.0.0.1:8766` in the Hermes desktop preview. Log in account A and account B separately, using different OpenAI accounts. Wait until both cards say the read-only usage check succeeded. The comparison must report that they are different. Then click **登出並清除兩份暫存 profile**.

## Automated checks

```bash
node --test profile-isolation.test.js
node --check two_profile_server.js
```

## Interactive test result
- User completed both official device-code flows, using separate accounts.
- The local status endpoint returned both slots as `authenticated`, both `usageReadable=true`, and `identityComparison=different`. The comparison used the account email only in memory; no email or raw RPC data was returned to the UI or logged.
- Cleanup returned `state=cleaned` and `scratchProfilesRemoved=true`; follow-up status showed both slots cleaned. Both account directories and the dedicated scratch root were confirmed absent after shutdown.
- The local server was stopped. No reset-credit operation was called.

## Verdict: VALIDATED — two independent profiles authenticated and both read usage

### Still unverified
- Long-running refresh/update notifications and behavior across Codex App Server upgrades (the CLI app-server remains experimental).
- Packaging and persistence in the production Electron/SQLite application.
