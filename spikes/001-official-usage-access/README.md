# Spike 001 — Official ChatGPT/Codex usage access

## Question
Can a local third-party Windows app obtain personal ChatGPT/Codex subscription usage, remaining limits, and reset timestamps for multiple accounts through an officially supported read-only data path, without passwords, cookies, or undocumented endpoints?

## Research performed
Reviewed current official OpenAI Help Center documentation for:
- Using Codex with a ChatGPT plan
- Managing Work/Codex usage and reset windows
- Banked Codex resets
- Account switching across ChatGPT accounts

## Findings
- OpenAI documents personal Codex usage and reset information in its own Usage/settings surfaces. The Help Center also documents `/status` inside an active Codex CLI session as a way to check allowance, credits, and reset time.
- The user has enabled the official device-code authentication option and completes authorization in a browser. Never ask them to share a device code; they must enter it only on the official OpenAI page.
- A stronger official candidate was found: the generated Codex App Server protocol schema contains `account/rateLimits/read`, `account/rateLimits/updated`, and `account/rateLimitResetCredit/consume`. The read response schema includes primary/secondary usage percentages, reset timestamps, and optional earned reset-credit details. The consume method is a real state change and must never run without an explicit in-app user confirmation.
- Codex CLI labels `app-server` as experimental. Use it only behind a version-pinned adapter; protocol stability is therefore a risk even though the methods are present in OpenAI's own generated schema.
- OpenAI's generic "Sign in with ChatGPT" Codex CLI flow may create/link an API key on eligible personal accounts. This project must use only the user's intended device-code route, and must stop if the authorization flow offers API key creation, paid API setup, or a billing change.
- Banked reset availability is account/offer dependent. It is displayed in official Usage settings and is applied only after the account holder confirms. It is non-purchased, but applying it changes eligible usage windows and may move the weekly reset date.
- Official account switching is available on ChatGPT web for at most two active accounts in one session; it is not supported in Codex desktop.
- This is not a general public REST API; it is the local Codex App Server protocol. It is preferable to reverse-engineering internal ChatGPT web endpoints, but its experimental status remains a maintenance risk.

## Local environment probe

- Before the probe, `codex` was not on PATH.
- Ran the official npm package temporarily via `npm exec --yes --package=@openai/codex -- codex --version`; result: `codex-cli 0.163.0`. No global install was made.
- CLI help confirms `codex app-server` is marked experimental, and `codex login --help` includes `--device-auth`.
- `codex login status` reported an authenticated local session. The account identifier was deliberately redacted and no auth files/tokens were inspected.
- Generated the official App Server JSON schema into Hermes scratch and verified all three methods above are present, including `account/rateLimits/read`.
- With an empty isolated `CODEX_HOME`, a JSON-RPC handshake succeeded and `account/rateLimits/read` returned the expected authentication-required error. This confirms the stdio transport, method routing, and that the isolated profile does not inherit the default account.
- Repeated the same read with the existing authenticated local Codex profile. It returned a usage snapshot with primary and secondary windows, reset timestamps, plan-type presence, and reset-credit summary/details. Output deliberately omitted usage percentages, reset counts, and account identifiers. This validates one-account read-only access through the official protocol.
- No login was started, no device code was generated or viewed, no reset credit was consumed, and no API key was created by this spike.

## Verdict: PARTIAL — one-account live read validated; multi-account remains unverified

### What worked
- Official user-facing usage and reset locations and the CLI `/status` route are documented.
- Multi-account boundary is documented: two accounts via ChatGPT web switching, not Codex desktop.
- The current official Codex App Server schema exposes a suitable usage read plus update notification and an earned-reset consume method.
- The current authenticated local profile returned the expected usage/reset fields through the official JSON-RPC method; the unauthenticated isolated profile was rejected as expected.

### What remains unverified
- The App Server is experimental.
- A second independently authenticated account/profile has not been tested.
- The device-code flow has not been run in this project. Whether the chosen flow avoids API-key creation/billing setup must be confirmed before proceeding.

### Recommendation for the real build
- Treat Codex App Server as the leading integration, not a generic public REST API. Continue by testing the device-code login and a second isolated account without exposing the code to the assistant.
- Do not invoke `account/rateLimitResetCredit/consume` during the read-path test. If eventually implemented, allow only an earned/free reset, show the exact credit and consequence, require a second confirmation, then re-read and verify.
- Do not promise live automatic multi-account sync until both-account isolation is tested; never scrape private endpoints or extract browser session credentials.
- Continue excluding plan changes, payments, credits purchases, and paid resets. Banked/free resets may be shown, but never applied automatically.
