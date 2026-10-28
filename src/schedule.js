// schedule.js — single source of truth for availability and booking validation.
// Both the agent (when offering slots) and the database (when confirming a booking)
// use this, so the AI can never book something the business rules forbid.
const config = require("./config");

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const MIN_SERVICE = Math.min(...config.services.map(s => s.duration || 30), 30);

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function hoursFor(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  if (isNaN(d)) return null;
  const day = d.toLocaleDateString("en-US", { weekday: "long", timeZone: config.timezone }).toLowerCase();
  return config.businessHours[day] || null;
}

function nowInBizTz() {
  // "YYYY-MM-DDTHH:MM" in the business timezone, comparable as a string with slot ISO
  const s = new Date().toLocaleString("sv-SE", { timeZone: config.timezone });
  return s.slice(0, 16).replace(" ", "T");
}

function overlaps(startA, durA, startB, durB) {
  const a0 = Date.parse(startA), b0 = Date.parse(startB);
  const a1 = a0 + durA * 60_000, b1 = b0 + durB * 60_000;
  return a0 < b1 && b0 < a1;
}

/** Validate a requested booking against format, time, and business rules.
 *  Returns { ok: true } or { ok: false, reason } with an AI-readable reason. */
function validateSlot(startsAt, durationMin = 30) {
  if (typeof startsAt !== "string" || !ISO_RE.test(startsAt)) {
    return { ok: false, reason: "starts_at must be ISO format YYYY-MM-DDTHH:MM" };
  }
  if (startsAt <= nowInBizTz()) {
    return { ok: false, reason: "That time is in the past. Offer a future slot." };
  }
  const dateStr = startsAt.slice(0, 10);
  const hours = hoursFor(dateStr);
  if (!hours) return { ok: false, reason: "The business is closed that day." };

  const startMin = toMinutes(startsAt.slice(11, 16));
  const open = toMinutes(hours.open), close = toMinutes(hours.close);
  if (startMin < open || startMin + durationMin > close) {
    return { ok: false, reason: `Outside opening hours (${hours.open}-${hours.close}, and the ${durationMin} min service must finish before closing).` };
  }
  return { ok: true };
}

/** Free slots for a date, overlap-aware against existing appointments.
 *  `existing` = [{ starts_at, duration_min }], `durationMin` = service length to fit. */
function slotsForDate(dateStr, existing, durationMin = MIN_SERVICE) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr || "")) return { error: "date must be YYYY-MM-DD" };
  const hours = hoursFor(dateStr);
  if (!hours) return { date: dateStr, slots: [], note: "Closed this day" };

  const now = nowInBizTz();
  const open = toMinutes(hours.open), close = toMinutes(hours.close);
  const slots = [];
  for (let t = open; t + durationMin <= close; t += 30) {
    const iso = `${dateStr}T${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
    if (iso <= now) continue; // never offer the past
    const clash = existing.some(a => overlaps(iso, durationMin, a.starts_at, a.duration_min || 30));
    if (!clash) slots.push(iso);
  }
  return { date: dateStr, slots };
}

module.exports = { validateSlot, slotsForDate, overlaps, MIN_SERVICE };
