# OpenAI Usage Dashboard

Windows-first Electron + React + TypeScript desktop app for a local ChatGPT/Codex usage dashboard.

## Current build status

The desktop app now has a local account manager and a Codex App Server adapter for usage reading plus explicitly confirmed free reset credits. Each account gets a separate persistent `CODEX_HOME` below Electron's user-data directory; only the local alias, generated profile ID, and creation time are stored in `accounts.json`. Adding an account explicitly starts the official device-code flow; the code is returned to the UI only, never written to metadata or logs. Existing profiles are read on app startup and polled every five minutes while the app is running. Removing an account asks for confirmation, logs out an active session when possible, then deletes only that account's profile.

The adapter is pinned to Codex CLI `0.163.0` and reads `account/read` plus `account/rateLimits/read`. Users can explicitly load currently available `codexRateLimits` reset credits, review each credit's expiry and official description, select one, then confirm before it is consumed. The backend ID remains in the main process; the renderer receives only an opaque handle. After a consume response the app rereads usage and credit details; an uncertain response blocks another attempt until details are reloaded. No reset has been consumed in real use. The app itself does not read/copy tokens, account email, or raw RPC payloads. On 2026-10-17, the formal desktop app completed a real device-code login and read live usage. The App Server then reported `requiresOpenaiAuth: true` on startup even though the same ChatGPT profile's read-only rate-limit request succeeded; the adapter now treats the profile as usable only after that official usage read succeeds. The same profile reloaded live usage after two clean app restarts without another login. No reset credit was consumed. The App Server remains experimental and needs further real-world compatibility testing.

## Run

```bash
npm install
npm test
npm run build
npm start
```

For renderer development, use two terminals:

```bash
npm run dev:web
npm run dev:desktop
```

The desktop dev command expects the Vite server at `127.0.0.1:5173`. Production builds use relative asset paths for Electron's local `file://` page.

## Test

```bash
npm test
```

## Safety notes

- Electron renderer uses `contextIsolation`, `sandbox`, and `nodeIntegration: false`.
- Preload exposes only fixed account IPC methods; IPC is accepted only from the main window's top-level frame.
- Each profile is isolated by Codex CLI `CODEX_HOME`; app metadata excludes credentials and account identity.
- Reset consumption is limited to official `codexRateLimits` credits marked available; each item shows expiry and official description, and the user must confirm each reset. No payment or credit purchase path exists.
- Automatic polling runs only while the desktop app is open; it is not an OS background service.
- Codex App Server is experimental. Real device-code sign-in and read-only usage succeeded in the integrated desktop app on 2026-10-17. After the adapter was changed to require a successful official usage read before treating the stored ChatGPT profile as available, the app reloaded usage after two clean restarts without another login. Long-term polling and cross-version stability still need testing.
