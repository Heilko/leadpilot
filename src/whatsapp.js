// whatsapp.js — customer-facing WhatsApp channel.
// The SAME agent that powers the website widget answers the business's WhatsApp:
// same brain, same booking tools, same dashboard. Conversations show up as
// leads with a "wa_" session id.
//
// Uses Meta's official WhatsApp Business Cloud API (the ToS-safe route).
// The channel is OFF unless all three required env vars are set:
//   WHATSAPP_TOKEN            – permanent access token from the Meta app
//   WHATSAPP_PHONE_NUMBER_ID  – the number's ID (not the phone number itself)
//   WHATSAPP_VERIFY_TOKEN     – any string you invent; Meta echoes it back once
// Recommended:
//   WHATSAPP_APP_SECRET       – enables signature verification of every webhook
const crypto = require("crypto");
const db = require("./db");
const { chat } = require("./agent");

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || "v21.0";
const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
const APP_SECRET = process.env.WHATSAPP_APP_SECRET;

function enabled() {
  return Boolean(TOKEN && PHONE_ID && VERIFY_TOKEN);
}

// Per-sender rate limit (mirrors the widget's session limit) so one number
// can't spam the agent into burning API budget.
const rate = new Map();
const PER_MIN = Number(process.env.RATE_SESSION_PER_MIN || 15);
function limited(from) {
  const now = Date.now();
  const hits = (rate.get(from) || []).filter(t => now - t < 60_000);
  if (hits.length >= PER_MIN) return true;
  hits.push(now);
  rate.set(from, hits);
  return false;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rate) if (!v.length || now - v[v.length - 1] > 120_000) rate.delete(k);
}, 60_000).unref();

// ---- webhook verification (Meta calls this once when you save the webhook URL) ----
function verifyWebhook(req, res) {
  if (
    enabled() &&
    req.query["hub.mode"] === "subscribe" &&
    req.query["hub.verify_token"] === VERIFY_TOKEN
  ) {
    return res.send(req.query["hub.challenge"]);
  }
  res.sendStatus(403);
}

// Every production webhook should prove it really came from Meta.
function validSignature(req) {
  if (!APP_SECRET) return true; // optional, but strongly recommended in .env.example
  const sig = String(req.headers["x-hub-signature-256"] || "");
  const expected =
    "sha256=" + crypto.createHmac("sha256", APP_SECRET).update(req.rawBody || "").digest("hex");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function sendText(to, body) {
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: String(body).slice(0, 4000) },
    }),
  });
  if (!res.ok) {
    console.error("WhatsApp send failed:", res.status, (await res.text()).slice(0, 200));
  }
  return res.ok;
}

// ---- incoming messages ----
async function processMessage(msg) {
  const from = String(msg.from || "").replace(/\D/g, "");
  if (!from) return;

  // Exactly-once handling: Meta retries webhooks, so claim each message id
  // atomically (reuses the notification_log dedupe table).
  if (!db.claimNotification(`wa:${msg.id}`, "wa_msg", from)) return;

  if (limited(from)) return; // silently drop the excess of a flood

  if (msg.type !== "text" || !msg.text?.body) {
    await sendText(from, "🙏 Por ahora solo puedo leer mensajes de texto. ¿Me escribes tu consulta?");
    return;
  }

  const sessionId = ("wa_" + from).slice(0, 64); // same charset rules as widget sessions
  const reply = await chat(sessionId, msg.text.body.slice(0, 1000).trim());
  await sendText(from, reply);
}

function receive(req, res) {
  if (!enabled()) return res.sendStatus(503);
  if (!validSignature(req)) return res.sendStatus(403);

  // Ack immediately (Meta expects a fast 200; slow responses trigger retries),
  // then answer the customer asynchronously.
  res.sendStatus(200);

  const entries = req.body?.entry || [];
  for (const entry of entries) {
    for (const change of entry.changes || []) {
      for (const msg of change.value?.messages || []) {
        processMessage(msg).catch(e => console.error("WhatsApp handler error:", e));
      }
      // change.value.statuses (delivered/read receipts) are intentionally ignored
    }
  }
}

module.exports = { enabled, verifyWebhook, receive };
