// db.js — storage layer using Node 22's built-in SQLite (zero native dependencies)
const { DatabaseSync } = require("node:sqlite");
const path = require("path");
const schedule = require("./schedule");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "data.sqlite");
const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL;"); // better read/write concurrency

db.exec(`
  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    name TEXT,
    email TEXT,
    phone TEXT,
    interest TEXT,
    notes TEXT,
    score TEXT DEFAULT 'cold',          -- cold | warm | hot
    qualified INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id INTEGER,
    session_id TEXT,
    name TEXT,
    contact TEXT,
    service TEXT,
    starts_at TEXT NOT NULL,            -- ISO datetime, business timezone
    duration_min INTEGER DEFAULT 30,
    status TEXT DEFAULT 'confirmed',    -- confirmed | cancelled
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,                 -- user | assistant
    content TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    input_tokens INTEGER DEFAULT 0,        -- fresh (uncached) input
    output_tokens INTEGER DEFAULT 0,
    cache_write_tokens INTEGER DEFAULT 0,  -- written to cache (billed 1.25x)
    cache_read_tokens INTEGER DEFAULT 0,   -- served from cache (billed 0.1x)
    cost_usd REAL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS notification_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dedupe_key TEXT UNIQUE,            -- e.g. "hot_lead:<session>" or "booking:<apptId>"
    kind TEXT,
    summary TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// ---- messages ----
function messageCount(sessionId) {
  return db.prepare("SELECT COUNT(*) AS n FROM messages WHERE session_id = ?").get(sessionId).n;
}

function getHistory(sessionId, limit = 30) {
  const rows = db
    .prepare("SELECT role, content FROM messages WHERE session_id = ? ORDER BY id ASC")
    .all(sessionId);
  return rows.slice(-limit);
}

function addMessage(sessionId, role, content) {
  db.prepare("INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)").run(
    sessionId, role, content
  );
}

// ---- leads ----
function upsertLead(sessionId, fields) {
  const existing = db
    .prepare("SELECT * FROM leads WHERE session_id = ? ORDER BY id DESC LIMIT 1")
    .get(sessionId);

  if (existing) {
    const merged = {
      name: fields.name ?? existing.name,
      email: fields.email ?? existing.email,
      phone: fields.phone ?? existing.phone,
      interest: fields.interest ?? existing.interest,
      notes: fields.notes ?? existing.notes,
      score: fields.score ?? existing.score,
      qualified: fields.qualified != null ? (fields.qualified ? 1 : 0) : existing.qualified,
    };
    db.prepare(
      `UPDATE leads SET name=?, email=?, phone=?, interest=?, notes=?, score=?, qualified=? WHERE id=?`
    ).run(merged.name, merged.email, merged.phone, merged.interest, merged.notes,
          merged.score, merged.qualified, existing.id);
    return existing.id;
  }

  const res = db.prepare(
    `INSERT INTO leads (session_id, name, email, phone, interest, notes, score, qualified)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    sessionId,
    fields.name ?? null, fields.email ?? null, fields.phone ?? null,
    fields.interest ?? null, fields.notes ?? null,
    fields.score ?? "cold", fields.qualified ? 1 : 0
  );
  return Number(res.lastInsertRowid);
}

function listLeads() {
  return db.prepare("SELECT * FROM leads ORDER BY id DESC").all();
}

// ---- appointments ----
function listAppointments() {
  return db.prepare("SELECT * FROM appointments WHERE status='confirmed' ORDER BY starts_at ASC").all();
}

function appointmentsOn(dateStr) {
  // dateStr: YYYY-MM-DD
  return db.prepare(
    "SELECT starts_at, duration_min FROM appointments WHERE status='confirmed' AND starts_at LIKE ?"
  ).all(dateStr + "%");
}

function bookAppointment({ leadId, sessionId, name, contact, service, startsAt, durationMin }) {
  durationMin = durationMin ?? 30;
  // 1. business rules: format, future, open day, within hours (incl. service duration)
  const valid = schedule.validateSlot(startsAt, durationMin);
  if (!valid.ok) return { ok: false, reason: valid.reason };
  // 2. overlap check against every confirmed appointment that day
  const sameDay = appointmentsOn(startsAt.slice(0, 10));
  const clash = sameDay.some(a =>
    schedule.overlaps(startsAt, durationMin, a.starts_at, a.duration_min || 30));
  if (clash) return { ok: false, reason: "That slot overlaps another appointment. Offer a different time." };

  const res = db.prepare(
    `INSERT INTO appointments (lead_id, session_id, name, contact, service, starts_at, duration_min)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(leadId ?? null, sessionId, name, contact, service, startsAt, durationMin ?? 30);
  return { ok: true, id: Number(res.lastInsertRowid) };
}

// ---- usage / cost tracking ----
function logUsage(u) {
  db.prepare(
    `INSERT INTO usage (session_id, input_tokens, output_tokens, cache_write_tokens, cache_read_tokens, cost_usd)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    u.sessionId ?? null,
    u.inputTokens | 0, u.outputTokens | 0,
    u.cacheWriteTokens | 0, u.cacheReadTokens | 0,
    u.costUsd || 0
  );
}

// Total API spend since midnight (server time). Used for the daily budget kill-switch.
function costToday() {
  return db.prepare(
    "SELECT COALESCE(SUM(cost_usd),0) AS c FROM usage WHERE date(created_at) = date('now')"
  ).get().c;
}

function usageStats() {
  const g = db.prepare(`
    SELECT
      COUNT(*) AS calls,
      COUNT(DISTINCT session_id) AS conversations,
      COALESCE(SUM(input_tokens),0)       AS input,
      COALESCE(SUM(output_tokens),0)      AS output,
      COALESCE(SUM(cache_write_tokens),0) AS cache_write,
      COALESCE(SUM(cache_read_tokens),0)  AS cache_read,
      COALESCE(SUM(cost_usd),0)           AS cost
    FROM usage
  `).get();

  const m = db.prepare(`
    SELECT
      COUNT(DISTINCT session_id) AS conversations,
      COALESCE(SUM(cost_usd),0)  AS cost,
      COUNT(*)                   AS calls
    FROM usage
    WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m','now')
  `).get();

  const cachedInput = g.cache_read;
  const allInput = g.input + g.cache_read + g.cache_write;
  return {
    totalCalls: g.calls,
    totalConversations: g.conversations,
    tokens: { input: g.input, output: g.output, cacheWrite: g.cache_write, cacheRead: g.cache_read },
    totalCostUsd: g.cost,
    avgCostPerConversationUsd: g.conversations ? g.cost / g.conversations : 0,
    cacheReadShare: allInput ? cachedInput / allInput : 0,
    month: { costUsd: m.cost, conversations: m.conversations, calls: m.calls },
  };
}

// ---- settings (small key-value store, e.g. the owner's pause switch) ----
function getSetting(key) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? row.value : null;
}
function setSetting(key, value) {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, String(value));
}

// ---- data protection: erasure + retention ----
// Right-to-erasure (GDPR art. 17 / Ley 7593 PY): delete one lead and every trace
// of their session — messages, appointments, usage rows.
function deleteLead(leadId) {
  const lead = db.prepare("SELECT id, session_id FROM leads WHERE id = ?").get(leadId);
  if (!lead) return { ok: false, reason: "not found" };
  const sid = lead.session_id;
  db.prepare("DELETE FROM messages WHERE session_id = ?").run(sid);
  db.prepare("DELETE FROM appointments WHERE session_id = ?").run(sid);
  db.prepare("DELETE FROM usage WHERE session_id = ?").run(sid);
  db.prepare("DELETE FROM leads WHERE session_id = ?").run(sid);
  return { ok: true };
}

// Storage limitation (GDPR art. 5.1.e / Ley 7593): purge personal data older than
// `days`. Leads are kept while they still have an upcoming appointment.
function purgeOldData(days) {
  if (!days || days <= 0) return { purged: false };
  const cutoff = `datetime('now', '-' || ? || ' days')`;
  const nowIso = new Date().toISOString().slice(0, 16);
  const r = {};
  r.messages = db.prepare(`DELETE FROM messages WHERE created_at < ${cutoff}`).run(days).changes;
  r.usage = db.prepare(`DELETE FROM usage WHERE created_at < ${cutoff}`).run(days).changes;
  r.appointments = db.prepare(
    `DELETE FROM appointments WHERE created_at < ${cutoff} AND starts_at < ?`
  ).run(days, nowIso).changes;
  r.leads = db.prepare(`
    DELETE FROM leads WHERE created_at < ${cutoff}
      AND session_id NOT IN (SELECT session_id FROM appointments WHERE starts_at >= ?)
  `).run(days, nowIso).changes;
  r.notification_log = db.prepare(`DELETE FROM notification_log WHERE created_at < ${cutoff}`).run(days).changes;
  return { purged: true, ...r };
}

// ---- fleet summary ----
// One compact row of stats for the multi-client Command Center.
function fleetSummary() {
  const leads = db.prepare(`
    SELECT COUNT(*) AS total,
           COALESCE(SUM(score='hot'),0)     AS hot,
           COALESCE(SUM(qualified=1),0)      AS qualified
    FROM leads
  `).get();

  const upcoming = db.prepare(
    "SELECT COUNT(*) AS n FROM appointments WHERE status='confirmed' AND starts_at >= ?"
  ).get(new Date().toISOString().slice(0, 16)).n;

  const month = db.prepare(`
    SELECT COALESCE(SUM(cost_usd),0) AS cost, COUNT(DISTINCT session_id) AS conversations
    FROM usage WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m','now')
  `).get();

  const lastMsg = db.prepare("SELECT MAX(created_at) AS t FROM messages").get().t;
  const lastLead = db.prepare("SELECT MAX(created_at) AS t FROM leads").get().t;
  const lastActivityAt = [lastMsg, lastLead].filter(Boolean).sort().pop() || null;

  return {
    leads: { total: leads.total, hot: leads.hot, qualified: leads.qualified },
    appointments: { upcoming },
    month: { costUsd: month.cost, conversations: month.conversations },
    lastActivityAt,
  };
}

// ---- notification dedupe ----
// Returns true exactly once per key (atomic INSERT OR IGNORE). Used so a hot-lead
// alert fires once per visitor, not on every progressive lead update.
function claimNotification(key, kind, summary) {
  const res = db.prepare(
    "INSERT OR IGNORE INTO notification_log (dedupe_key, kind, summary) VALUES (?, ?, ?)"
  ).run(key, kind ?? null, summary ?? null);
  return res.changes === 1;
}

module.exports = {
  getHistory, addMessage, messageCount, costToday,
  upsertLead, listLeads,
  listAppointments, appointmentsOn, bookAppointment,
  logUsage, usageStats,
  fleetSummary,
  deleteLead, purgeOldData,
  getSetting, setSetting,
  claimNotification,
};
