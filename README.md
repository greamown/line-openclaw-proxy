# line-openclaw-proxy

A lightweight proxy that receives LINE webhook events, forwards user text to OpenClaw, and replies via the LINE Reply API.

## Architecture Flow
`LINE message` ⇒ `LINE webhook` ⇒ `HTTPS (Tailscale)` ⇒ `proxy` ⇒ `OpenClaw` ⇒ `LINE reply`

## Features
- Verifies LINE webhook `X-Line-Signature`
- Processes events asynchronously to avoid blocking webhook responses
- Supports custom system prompt / model / temperature
- Optional LINE loading animation + push reply on timeout
- Exposes a health check endpoint

## Requirements
- Node.js 18+
- LINE Messaging API configured (Channel Secret / Access Token)
- Reachable OpenClaw chat/completions endpoint
- OpenClaw installed and running (this project does not include OpenClaw)

## Install & Run (Local)
```bash
npm install
npm run start
```

## OpenClaw Setup (Required)
This proxy does not bundle OpenClaw. You need to install and run OpenClaw yourself, then set:
`OPENCLAW_INGEST_URL=http://<openclaw-host>:<port>/v1/chat/completions`

OpenClaw repository:
```
https://github.com/openclaw/openclaw
```

## Run with Docker
```bash
docker compose up -d --build
```

## Environment Variables
Create a `.env` file (or export directly). You can start from `.env.example`:

```
PORT=8283
LINE_CHANNEL_SECRET=...
LINE_CHANNEL_ACCESS_TOKEN=...
OPENCLAW_INGEST_URL=http://127.0.0.1:9383/v1/chat/completions
OPENCLAW_API_KEY=...
OPENCLAW_MODEL=...
OPENCLAW_TEMPERATURE=0.7
OPENCLAW_SYSTEM_PROMPT=...
OPENCLAW_TIMEOUT_MS=15000
OPENCLAW_LONG_TIMEOUT_MS=60000
LINE_LOADING_SECONDS=20
USE_PUSH_ON_TIMEOUT=false
LINE_PENDING_TEXT=已收到，稍後以推播回覆。
LINE_FAIL_TEXT=System busy, please try again later.
```

### Required
- `LINE_CHANNEL_SECRET`
- `LINE_CHANNEL_ACCESS_TOKEN`
- `OPENCLAW_INGEST_URL`

### Optional
- `OPENCLAW_API_KEY`: Bearer token for OpenClaw (if required)
- `OPENCLAW_MODEL`: model name
- `OPENCLAW_TEMPERATURE`: default `0.7`
- `OPENCLAW_SYSTEM_PROMPT`: system role prompt
- `OPENCLAW_TIMEOUT_MS`: OpenClaw timeout in ms, default `15000`
- `OPENCLAW_LONG_TIMEOUT_MS`: long OpenClaw timeout for push flow, default `60000`
- `LINE_LOADING_SECONDS`: LINE loading animation seconds (5-60, step 5), default `20`
- `USE_PUSH_ON_TIMEOUT`: when `true`, reply a pending message then push final result
- `LINE_PENDING_TEXT`: reply text used when deferring to push
- `LINE_FAIL_TEXT`: fallback reply when OpenClaw fails

## Webhook & Endpoints
- Webhook: `/webhook/line`
- Health check: `/healthz`

Set your LINE webhook URL, for example:
`https://your-domain.com/webhook/line`

## Deployment Notes
- Flow (ASCII diagram):
```
LINE message
  |
  v
LINE webhook
  |
  v
HTTPS (Tailscale)
  |
  v
proxy
  |
  v
OpenClaw
  |
  v
LINE reply
```
- Ensure your service is reachable from LINE (public HTTPS URL is required by LINE).
- If you use Tailscale, expose the HTTPS endpoint via Tailscale (e.g., Funnel) and use that URL for the LINE webhook.
- If you run behind a reverse proxy, forward the raw request body so signature verification still works.
- Use environment variables to keep secrets out of source control.
- `docker-compose.yml` uses `network_mode: host`, so the container shares the host network.
- When OpenClaw runs on the host and `network_mode: host` is enabled, set `OPENCLAW_INGEST_URL` to `http://127.0.0.1:9383/v1/chat/completions`.
- `host.docker.internal` may not resolve on Linux; prefer `127.0.0.1` with `network_mode: host`.

## How to Test Locally
- Use a public tunnel (e.g., ngrok or Cloudflare Tunnel) to expose `http://localhost:8283`.
- Set the LINE webhook URL to the public HTTPS URL plus `/webhook/line`.
- Send a text message to your LINE bot and check logs for `[OK] replied`.
- Verify health endpoint: `GET http://localhost:8283/healthz`.

## Notes
- Only text messages are processed (`message.type === "text"`)
- Webhook responds `200 OK` immediately; event handling is fire-and-forget
- If `LINE_LOADING_SECONDS` > 0, the bot starts a loading animation for the user
- If `USE_PUSH_ON_TIMEOUT=true`, OpenClaw timeout triggers a pending reply + push

## Troubleshooting
- LINE replies with fallback text (`LINE_FAIL_TEXT`):
  - Check logs for `event processing failed` and confirm OpenClaw is reachable.
  - `fetch failed` usually means the proxy cannot reach `OPENCLAW_INGEST_URL`.
- Test OpenClaw locally (should return 405 for GET; POST required):
  - `curl -i http://127.0.0.1:9383/v1/chat/completions`
- If you see `invalid LINE signature` in logs:
  - Your webhook request is not from LINE or the raw body is being modified by a proxy.

## Common Errors → Likely Causes
- `invalid LINE signature` → wrong `LINE_CHANNEL_SECRET`, non-LINE test request, or proxy modifies raw body
- `fetch failed` → proxy cannot reach `OPENCLAW_INGEST_URL` (DNS/host/port/timeout)
- `OpenClaw ingest failed: 401/403` → missing or wrong `OPENCLAW_API_KEY`
- `OpenClaw ingest failed: 404` → wrong `OPENCLAW_INGEST_URL` path
- `OpenClaw timeout after ...ms` → OpenClaw slow or overloaded; increase `OPENCLAW_TIMEOUT_MS`
- `LINE push failed: 401/403` → plan does not allow push or wrong `LINE_CHANNEL_ACCESS_TOKEN`
- `LINE reply failed: 401/403` → wrong `LINE_CHANNEL_ACCESS_TOKEN`

## Checklist (Step-by-Step)
1) Confirm OpenClaw is reachable on the host:
   - `curl -i http://127.0.0.1:9383/v1/chat/completions` (expects `405` for GET)
2) Verify proxy is using the correct ingest URL:
   - `docker exec -it line-openclaw-proxy sh -c "env | grep OPENCLAW_INGEST_URL"`
3) Check proxy logs for errors:
   - `docker logs --tail=200 line-openclaw-proxy`
4) Confirm LINE webhook endpoint is reachable:
   - `GET https://<your-domain>/healthz` should return `{"ok":true}`
5) Verify LINE credentials:
   - `LINE_CHANNEL_SECRET` (signature check) and `LINE_CHANNEL_ACCESS_TOKEN` (reply API)
6) Re-test by sending a LINE message and watch for `[OK] replied` in logs.
