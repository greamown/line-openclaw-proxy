# line-openclaw-proxy

A lightweight proxy that receives LINE webhook events, forwards user text to OpenClaw, and replies via the LINE Reply API.

## Features
- Verifies LINE webhook `X-Line-Signature`
- Processes events asynchronously to avoid blocking webhook responses
- Supports custom system prompt / model / temperature
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
- `LINE_FAIL_TEXT`: fallback reply when OpenClaw fails

## Webhook & Endpoints
- Webhook: `/webhook/line`
- Health check: `/healthz`

Set your LINE webhook URL, for example:
`https://your-domain.com/webhook/line`

## Deployment Notes
- Ensure your service is reachable from LINE (public HTTPS URL is required by LINE).
- If you use Tailscale, expose the HTTPS endpoint via Tailscale (e.g., Funnel) and use that URL for the LINE webhook.
- If you run behind a reverse proxy, forward the raw request body so signature verification still works.
- Use environment variables to keep secrets out of source control.
- `docker-compose.yml` exposes port `8283` on the host.
- When OpenClaw runs on the host, set `OPENCLAW_INGEST_URL` to `http://host.docker.internal:9383/v1/chat/completions`.

## How to Test Locally
- Use a public tunnel (e.g., ngrok or Cloudflare Tunnel) to expose `http://localhost:8283`.
- Set the LINE webhook URL to the public HTTPS URL plus `/webhook/line`.
- Send a text message to your LINE bot and check logs for `[OK] replied`.
- Verify health endpoint: `GET http://localhost:8283/healthz`.

## Notes
- Only text messages are processed (`message.type === "text"`)
- Webhook responds `200 OK` immediately; event handling is fire-and-forget
