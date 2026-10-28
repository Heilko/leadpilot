// server.js — LeadPilot entry point
require("./loadenv"); // loads .env without external dependencies
const crypto = require("crypto");
const express = require("express");
const path = require("path");
const db = require("./db");
const { chat } = require("./agent");
const notify = require("./notify");
const whatsapp = require("./whatsapp");
const config = require("./config");

const app = express();
// Chat messages are tiny; cap the body to blunt abuse. Keep the raw bytes around
// so the WhatsApp webhook can verify Meta's HMAC signature against them.
app.use(express.json({
  limit: "64kb",
  verify: (req, res, buf) => { req.rawBody = buf; },
}));

// Baseline security headers on every response. Note we deliberately do NOT send a
// restrictive frame policy or CORS here — the widget endpoints opt in below, and
// everything else is same-origin.
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  if (process.env.NODE_ENV === "production") {
    // Tell browsers to always use HTTPS for this host (Render/most hosts terminate TLS for us)
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  res.removeHeader("X-Powered-By");
  next();
});

// CORS only where it's actually needed: the two endpoints the embedded widget calls
// from arbitrary client websites, plus the fleet-summary endpoint (read by your
// Command Center page, which may run from a different origin / a local file).
// Every cross-origin endpoint is still password-gated where it returns private data.
function publicCors(req, res, next) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Vary", "Origin");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
}

app.use(express.static(path.join(__dirname, "..", "public")));

// ---- public endpoints ----
app.options("/api/widget-config", publicCors);
app.get("/api/widget-config", publicCors, (req, res) => {
  const w = config.widget || {};
  res.json({
    businessName: config.businessName,
    agentName: w.agentName,
    greeting: w.greeting,
    accentColor: w.accentColor,
    position: w.position || "right",
    privacyUrl: w.privacyUrl || "",
    ui: w.ui || {},
    vocabulary: config.vocabulary,
  });
});

// Everything the bundled demo page needs to render itself for the active sector,
// so switching preset switches the whole demo with no code edit. Same-origin only.
app.get("/api/demo-config", (req, res) => {
  res.json({
    businessName: config.businessName,
    industry: config.industry,
    description: config.description,
    services: config.services || [],
    contactPhone: config.contactPhone || "",
    accentColor: config.widget?.accentColor || "#0E5E59",
    greeting: config.widget?.greeting || "",
    vocabulary: config.vocabulary,
  });
});

app.set("trust proxy", 1); // correct client IP behind Render/Railway proxies
const rate = new Map(); // key -> timestamps within the last minute
function limited(key, max) {
  const now = Date.now();
  const hits = (rate.get(key) || []).filter(t => now - t < 60_000);
  if (hits.length >= max) return true;
  hits.push(now); rate.set(key, hits);
  return false;
}
setInterval(() => { // prune idle keys so the map can't grow forever
  const now = Date.now();
  for (const [k, v] of rate) if (!v.length || now - v[v.length - 1] > 120_000) rate.delete(k);
}, 60_000).unref();

app.options("/api/chat", publicCors);
app.post("/api/chat", publicCors, async (req, res) => {
  const { sessionId, message } = req.body || {};
  if (!sessionId || typeof sessionId !== "string" || sessionId.length > 64 ||
      !/^[A-Za-z0-9_-]+$/.test(sessionId) ||
      !message || typeof message !== "string" || message.length > 1000) {
    return res.status(400).json({ error: "sessionId and message (max 1000 chars) required" });
  }
  const SESSION_LIMIT = Number(process.env.RATE_SESSION_PER_MIN || 15);
  const IP_LIMIT = Number(process.env.RATE_IP_PER_MIN || 120); // generous: offices/universities share IPs
  if (limited("s:" + sessionId, SESSION_LIMIT) || limited("ip:" + req.ip, IP_LIMIT)) {
    return res.status(429).json({ error: "Too many messages, slow down." });
  }

  try {
    const reply = await chat(sessionId, message.trim());
    res.json({ reply });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "internal error" });
  }
});

// ---- dashboard (auth-protected) ----
// Brute-force protection: only FAILED password attempts count against the limit,
// so normal dashboard use (many authenticated calls per page load) is never blocked.
const AUTH_FAILS_PER_MIN = Number(process.env.RATE_AUTH_FAILS_PER_MIN || 10);
function auth(req, res, next) {
  const pw = process.env.DASHBOARD_PASSWORD;
  if (!pw) return res.status(500).json({ error: "DASHBOARD_PASSWORD not set" });

  const key = "authfail:" + req.ip;
  const now = Date.now();
  const fails = (rate.get(key) || []).filter(t => now - t < 60_000);
  if (fails.length >= AUTH_FAILS_PER_MIN) {
    return res.status(429).json({ error: "Too many failed attempts. Wait a minute and try again." });
  }

  const token = (req.headers.authorization || "").replace("Bearer ", "");
  const a = crypto.createHash("sha256").update(token).digest();
  const b = crypto.createHash("sha256").update(pw).digest();
  if (!crypto.timingSafeEqual(a, b)) {
    fails.push(now);
    rate.set(key, fails);
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}

app.get("/healthz", (req, res) => res.json({ ok: true, uptime: process.uptime() }));

// ---- WhatsApp channel (customers chatting with the agent on WhatsApp) ----
// Meta calls GET once to verify the webhook, then POSTs incoming messages.
// Dormant (503) until the WHATSAPP_* env vars are configured — see .env.example.
app.get("/api/whatsapp/webhook", whatsapp.verifyWebhook);
app.post("/api/whatsapp/webhook", whatsapp.receive);

// Compact, auth-protected summary for the Fleet Command Center, which aggregates
// many client deployments in one view. CORS-enabled so the Command Center page can
// read it from a different origin (or a local file). Still requires the password.
app.options("/api/fleet-summary", publicCors);
app.get("/api/fleet-summary", publicCors, auth, (req, res) => {
  res.json({
    business: config.businessName,
    industry: config.industry || "",
    accentColor: config.widget?.accentColor || "#0E5E59",
    uptimeSec: Math.round(process.uptime()),
    ...db.fleetSummary(),
  });
});

app.get("/api/leads", auth, (req, res) => res.json(db.listLeads()));
// Right-to-erasure: wipe one lead and every trace of their session.
app.delete("/api/leads/:id", auth, (req, res) => {
  const r = db.deleteLead(Number(req.params.id));
  if (!r.ok) return res.status(404).json({ error: r.reason });
  res.json({ deleted: true });
});
app.get("/api/leads.csv", auth, (req, res) => {
  const cols = ["created_at","score","qualified","name","email","phone","interest","notes"];
  const q = v => '"' + String(v ?? "").replace(/"/g, '""') + '"';
  const csv = [cols.join(",")]
    .concat(db.listLeads().map(l => cols.map(c => q(l[c])).join(",")))
    .join("\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=leads.csv");
  res.send(csv);
});
app.get("/api/appointments", auth, (req, res) => res.json(db.listAppointments()));
app.get("/api/usage", auth, (req, res) => {
  res.json({
    ...db.usageStats(),
    pricing: {
      inputPerM: Number(process.env.PRICE_INPUT_PER_M || 3.0),
      outputPerM: Number(process.env.PRICE_OUTPUT_PER_M || 15.0),
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
    },
    hostingUsdPerMonth: Number(process.env.HOSTING_USD_PER_MONTH || 7),
    today: new Date().getDate(),
    daysInMonth: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate(),
  });
});
app.get("/api/conversation/:sessionId", auth, (req, res) =>
  res.json(db.getHistory(req.params.sessionId, 200))
);

// The owner's kill-switch: pause/resume the assistant on both channels instantly.
app.get("/api/assistant-state", auth, (req, res) =>
  res.json({ paused: db.getSetting("assistant_paused") === "1" })
);
app.post("/api/assistant-state", auth, (req, res) => {
  const paused = Boolean((req.body || {}).paused);
  db.setSetting("assistant_paused", paused ? "1" : "0");
  res.json({ paused });
});

app.get("/api/notify-status", auth, (req, res) => res.json(notify.channelStatus()));
app.post("/api/notify-test", auth, async (req, res) => {
  try {
    const results = await notify.sendTest();
    res.json({ results });
  } catch (e) {
    res.status(500).json({ error: String(e).slice(0, 120) });
  }
});

app.get("/dashboard", (req, res) => res.sendFile(path.join(__dirname, "..", "public", "dashboard.html")));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "..", "public", "demo.html")));

// Storage limitation: purge personal data past the retention window, at boot and
// then daily. Default 365 days; set DATA_RETENTION_DAYS=0 to disable (not
// recommended — indefinite retention breaches GDPR/Ley 7593 storage limitation).
const RETENTION_DAYS = Number(process.env.DATA_RETENTION_DAYS ?? 365);
if (RETENTION_DAYS > 0) {
  const runPurge = () => {
    try {
      const r = db.purgeOldData(RETENTION_DAYS);
      const total = (r.messages | 0) + (r.leads | 0) + (r.appointments | 0);
      if (total > 0) console.log(`Retention purge (${RETENTION_DAYS}d):`, JSON.stringify(r));
    } catch (e) { console.error("Retention purge failed:", e); }
  };
  runPurge();
  setInterval(runPurge, 24 * 60 * 60 * 1000).unref();
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n  LeadPilot running → http://localhost:${PORT}`);
  console.log(`  Demo site:        http://localhost:${PORT}/`);
  console.log(`  Dashboard:        http://localhost:${PORT}/dashboard\n`);
});
