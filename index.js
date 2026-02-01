import express from "express";
import crypto from "crypto";

const app = express();

/**
 * ENV
 * - PORT: proxy listen port
 * - LINE_CHANNEL_SECRET: for X-Line-Signature verification
 * - LINE_CHANNEL_ACCESS_TOKEN: for LINE Reply API
 * - OPENCLAW_INGEST_URL: OpenClaw chat endpoint (e.g. http://127.0.0.1:9383/v1/chat/completions)
 * - OPENCLAW_API_KEY: gateway password/token (Bearer)
 * - OPENCLAW_MODEL: optional model name
 * - OPENCLAW_TEMPERATURE: optional float (default 0.7)
 * - OPENCLAW_SYSTEM_PROMPT: optional system prompt
 * - OPENCLAW_TIMEOUT_MS: optional timeout in ms for OpenClaw request (default 15000)
 * - LINE_FAIL_TEXT: optional fallback reply when OpenClaw fails
 */
const PORT = parseInt(process.env.PORT || "3000", 10);
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET || "";
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || "";
const OPENCLAW_INGEST_URL = process.env.OPENCLAW_INGEST_URL || "";
const OPENCLAW_API_KEY = process.env.OPENCLAW_API_KEY || "";
const OPENCLAW_MODEL = process.env.OPENCLAW_MODEL || "";
const OPENCLAW_TEMPERATURE = parseFloat(process.env.OPENCLAW_TEMPERATURE || "0.7");
const OPENCLAW_SYSTEM_PROMPT = process.env.OPENCLAW_SYSTEM_PROMPT || "";
const OPENCLAW_TIMEOUT_MS = parseInt(process.env.OPENCLAW_TIMEOUT_MS || "15000", 10);
const LINE_FAIL_TEXT =
  process.env.LINE_FAIL_TEXT || "系統忙碌中，請稍後再試。";

const LINE_REPLY_ENDPOINT = "https://api.line.me/v2/bot/message/reply";

if (!LINE_CHANNEL_SECRET) {
  console.error("[FATAL] LINE_CHANNEL_SECRET is required");
  process.exit(1);
}
if (!OPENCLAW_INGEST_URL) {
  console.error("[FATAL] OPENCLAW_INGEST_URL is required");
  process.exit(1);
}
if (!LINE_CHANNEL_ACCESS_TOKEN) {
  console.error("[FATAL] LINE_CHANNEL_ACCESS_TOKEN is required");
  process.exit(1);
}

/**
 * Need RAW body to verify signature.
 */
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf; // Buffer
    },
    limit: "2mb",
  })
);

function verifySignature(rawBody, signature) {
  if (!signature) return false;
  const expected = crypto
    .createHmac("sha256", LINE_CHANNEL_SECRET)
    .update(rawBody)
    .digest("base64");
  const expectedBuf = Buffer.from(expected);
  const signatureBuf = Buffer.from(signature);
  // constant-time compare; timingSafeEqual throws if lengths differ
  if (expectedBuf.length !== signatureBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, signatureBuf);
}

async function postToOpenClaw(payload) {
  const headers = {
    "Content-Type": "application/json",
  };
  if (OPENCLAW_API_KEY) headers["Authorization"] = `Bearer ${OPENCLAW_API_KEY}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OPENCLAW_TIMEOUT_MS);
  let resp;
  try {
    resp = await fetch(OPENCLAW_INGEST_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (e) {
    if (e?.name === "AbortError") {
      throw new Error(`OpenClaw timeout after ${OPENCLAW_TIMEOUT_MS}ms`);
    }
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`OpenClaw ingest failed: ${resp.status} ${text}`);
  }

  const data = await resp.json().catch(() => ({}));
  const text =
    data?.choices?.[0]?.message?.content ??
    data?.choices?.[0]?.text ??
    "";
  return String(text).trim();
}

async function replyLine(replyToken, text) {
  if (!replyToken) return;
  const body = {
    replyToken,
    messages: [{ type: "text", text }],
  };

  const resp = await fetch(LINE_REPLY_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const msg = await resp.text().catch(() => "");
    throw new Error(`LINE reply failed: ${resp.status} ${msg}`);
  }
}

app.get("/healthz", (_req, res) => {
  res.status(200).json({ ok: true });
});

app.post("/webhook/line", (req, res) => {
  try {
    const signature = req.headers["x-line-signature"];
    const rawBody = req.rawBody;

    if (!rawBody || !verifySignature(rawBody, signature)) {
      console.warn("[WARN] invalid LINE signature");
      return res.status(403).send("invalid signature");
    }

    // IMPORTANT: reply immediately to LINE
    res.status(200).send("ok");

    // Process events async (don't block webhook response)
    const body = req.body || {};
    const events = Array.isArray(body.events) ? body.events : [];
    console.log(`[INFO] received events: ${events.length}`);

    // fire-and-forget
    setImmediate(async () => {
      for (const event of events) {
        let replyToken = "";
        try {
          // Only handle text messages (extend as needed)
          if (event?.type !== "message") continue;
          if (event?.message?.type !== "text") continue;

          const text = event.message.text ?? "";
          const source = event.source ?? {};
          const userId = source.userId ?? "";
          replyToken = event.replyToken ?? "";

          const messages = [];
          if (OPENCLAW_SYSTEM_PROMPT) {
            messages.push({
              role: "system",
              content: OPENCLAW_SYSTEM_PROMPT,
            });
          }
          messages.push({ role: "user", content: text });

          const openclawPayload = {
            model: OPENCLAW_MODEL || undefined,
            messages,
            temperature: Number.isFinite(OPENCLAW_TEMPERATURE)
              ? OPENCLAW_TEMPERATURE
              : 0.7,
            user: userId || undefined,
          };

          const aiText = await postToOpenClaw(openclawPayload);
          await replyLine(replyToken, aiText || "（沒有回覆內容）");
          console.log(`[OK] replied to user=${userId}`);
        } catch (e) {
          console.error("[ERR] event processing failed:", e?.message || e);
          try {
            await replyLine(replyToken, LINE_FAIL_TEXT);
          } catch (replyErr) {
            console.error(
              "[ERR] fallback reply failed:",
              replyErr?.message || replyErr
            );
          }
        }
      }
    });
  } catch (e) {
    console.error("[ERR] webhook handler crashed:", e?.message || e);
    // if something goes wrong before res sent
    if (!res.headersSent) res.status(500).send("server error");
  }
});

app.listen(PORT, () => {
  console.log(`[INFO] LINE->OpenClaw proxy listening on :${PORT}`);
  console.log("[INFO] Webhook path: /webhook/line");
  console.log(`[INFO] Forwarding to: ${OPENCLAW_INGEST_URL}`);
});
