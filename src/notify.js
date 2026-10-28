// notify.js — when something important happens (a booking, or a lead turning hot),
// tell the business owner through whichever channels they've turned on.
// Every channel is independent and self-contained: one failing or being unconfigured
// never blocks the others, and never blocks the booking itself.
const config = require("./config");

const N = config.notifications || {};
// Sector wording (paciente/cliente/alumno, la clínica/la tienda/el estudio…).
const vocab = config.vocabulary || require("./sector").resolveVocabulary(config);

function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function fmtWhen(startsAt) {
  try {
    return new Date(startsAt + ":00").toLocaleString("es-ES", {
      weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
    });
  } catch { return startsAt; }
}

// Which channels are switched on AND have their secret present.
function channelStatus() {
  return {
    email: {
      enabled: !!N.email?.enabled,
      configured: !!N.email?.enabled && !!process.env.RESEND_API_KEY && !!N.email?.to,
    },
    telegram: {
      enabled: !!N.telegram?.enabled,
      configured: !!N.telegram?.enabled && !!process.env.TELEGRAM_BOT_TOKEN && !!N.telegram?.chatId,
    },
    webhook: {
      enabled: !!N.webhook?.enabled,
      configured: !!N.webhook?.enabled && !!process.env.NOTIFY_WEBHOOK_URL,
    },
    events: { booking: N.notifyOnBooking !== false, hotLead: N.notifyOnHotLead !== false },
  };
}

// ---- content builders ----
function buildContent(p) {
  const dash = (N.dashboardUrl || "").replace(/\/$/, "");
  const convLink = dash ? `${dash}/dashboard?lead=${encodeURIComponent(p.sessionId || "")}` : "";
  const isBooking = p.kind === "booking";

  if (p.kind === "budget") {
    const reached = p.level === "reached";
    const title = reached
      ? `⏸️ AI daily budget reached ($${p.budget}) — assistant quiet until midnight`
      : `⚠️ AI budget at 80% — $${p.spent.toFixed(2)} of $${p.budget} today`;
    const text = reached
      ? `Today's AI budget ($${p.budget}) is spent. The assistant now asks visitors to contact ${vocab.business} directly until midnight. If this is a busy day (good problem!), raise DAILY_BUDGET_USD in the environment and redeploy.`
      : `Today's AI spend is $${p.spent.toFixed(2)} of the $${p.budget} daily budget. If it reaches 100%, the assistant stops answering until midnight. Raise DAILY_BUDGET_USD if today's traffic is real demand.`;
    return { title, text, html: `
      <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:auto;border:1px solid #e2e9e7;border-radius:14px;overflow:hidden">
        <div style="background:${reached ? "#C84B2F" : "#D99A2B"};color:#fff;padding:16px 20px;font-size:17px;font-weight:600">${esc(title)}</div>
        <div style="padding:18px 20px;color:#1E2826;font-size:14px;line-height:1.6">${esc(text)}</div>
        <div style="padding:10px 20px;background:#F4F6F7;color:#9aa5ad;font-size:11px">Sent automatically by LeadPilot</div>
      </div>` };
  }

  const title = isBooking
    ? `📅 New booking · ${p.name || "Customer"} · ${p.service || ""}`.trim()
    : `🔥 Hot lead · ${p.name || "Anonymous visitor"}`;

  const rows = [];
  if (isBooking) rows.push(["When", fmtWhen(p.startsAt)]);
  if (p.name) rows.push(["Name", p.name]);
  if (p.contact) rows.push(["Contact", p.contact]);
  if (p.service && isBooking) rows.push(["Service", p.service]);
  if (p.interest) rows.push(["Interest", p.interest]);
  if (p.score) rows.push(["Lead score", p.score.toUpperCase()]);
  if (p.notes) rows.push(["Notes", p.notes]);

  const textLines = [
    isBooking ? "New appointment booked through your website:" : "A visitor just qualified as a hot lead:",
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
  ];
  if (convLink) { textLines.push("", `Read the full conversation: ${convLink}`); }
  const text = textLines.join("\n");

  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:auto;border:1px solid #e2e9e7;border-radius:14px;overflow:hidden">
      <div style="background:${isBooking ? "#0E5E59" : "#C84B2F"};color:#fff;padding:16px 20px;font-size:17px;font-weight:600">${esc(title)}</div>
      <div style="padding:18px 20px">
        <p style="margin:0 0 14px;color:#4A5755">${isBooking ? "New appointment booked through your website." : "A visitor just qualified as a hot lead — follow up while they're warm."}</p>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          ${rows.map(([k, v]) => `<tr>
            <td style="padding:7px 0;color:#7A8C99;width:110px;vertical-align:top">${esc(k)}</td>
            <td style="padding:7px 0;color:#1E2826"><b>${esc(v)}</b></td></tr>`).join("")}
        </table>
        ${convLink ? `<a href="${esc(convLink)}" style="display:inline-block;margin-top:18px;background:#0E5E59;color:#fff;text-decoration:none;padding:10px 18px;border-radius:9px;font-size:14px;font-weight:600">Open conversation</a>` : ""}
      </div>
      <div style="padding:10px 20px;background:#F4F6F7;color:#9aa5ad;font-size:11px">Sent automatically by LeadPilot</div>
    </div>`;

  return { title, text, html };
}

// A standard .ics calendar event so the owner can add the booking to any calendar
// with one tap. Uses floating local time (no timezone marker), which calendars
// interpret in the viewer's own timezone — correct for an owner in the business's city.
function buildIcs(p) {
  const stamp = s => s.replace(/[-:]/g, "").padEnd(15, "0").slice(0, 15); // YYYYMMDDTHHMMSS
  const start = stamp(p.startsAt);
  const endDate = new Date(p.startsAt + ":00");
  endDate.setMinutes(endDate.getMinutes() + (p.durationMin || 30));
  const pad = n => String(n).padStart(2, "0");
  const end = `${endDate.getFullYear()}${pad(endDate.getMonth() + 1)}${pad(endDate.getDate())}T${pad(endDate.getHours())}${pad(endDate.getMinutes())}00`;
  const uid = `${Date.now()}-${Math.random().toString(36).slice(2)}@leadpilot`;
  const desc = [`Customer: ${p.name || ""}`, `Contact: ${p.contact || ""}`, `Interest: ${p.interest || ""}`, p.notes ? `Notes: ${p.notes}` : ""]
    .filter(Boolean).join("\\n");
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//LeadPilot//EN", "BEGIN:VEVENT",
    `UID:${uid}`, `DTSTART:${start}`, `DTEND:${end}`,
    `SUMMARY:${(p.service || "Appointment")} — ${p.name || "Customer"}`,
    `DESCRIPTION:${desc}`, "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
}

// ---- channel senders (each returns {channel, ok, detail}) ----
async function sendEmail(p, c) {
  const subject = c.title;
  const attachments = [];
  if (p.kind === "booking" && p.startsAt) {
    attachments.push({
      filename: "appointment.ics",
      content: Buffer.from(buildIcs(p)).toString("base64"),
    });
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: N.email.from || "LeadPilot <onboarding@resend.dev>",
      to: [N.email.to], subject, html: c.html,
      ...(attachments.length ? { attachments } : {}),
    }),
  });
  if (!res.ok) return { channel: "email", ok: false, detail: `HTTP ${res.status}` };
  return { channel: "email", ok: true };
}

// ---- customer-facing booking confirmation (separate from the owner-alert path above:
// different recipient, different tone/template, no dashboard link or lead details) ----
function buildCustomerContent(p) {
  const title = `✅ Reserva confirmada · ${config.businessName}`;
  const rows = [
    ["Cuándo", fmtWhen(p.startsAt)],
    ["Servicio", p.service || ""],
  ].filter(([, v]) => v);
  const phone = config.contactPhone || "";
  const changeLine = phone
    ? `Si necesitas cambiar o cancelar, escríbenos al ${phone}.`
    : "Si necesitas cambiar o cancelar, contáctanos directamente.";
  const text = [
    `Hola ${p.name || ""}, ya tienes tu ${vocab.appointment} en ${config.businessName}.`,
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    "",
    changeLine,
  ].join("\n");
  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:auto;border:1px solid #e2e9e7;border-radius:14px;overflow:hidden">
      <div style="background:${config.widget?.accentColor || "#0E5E59"};color:#fff;padding:16px 20px;font-size:17px;font-weight:600">${esc(title)}</div>
      <div style="padding:18px 20px">
        <p style="margin:0 0 14px;color:#4A5755">Hola ${esc(p.name || "")}, ya tienes tu ${esc(vocab.appointment)} en <b>${esc(config.businessName)}</b>.</p>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          ${rows.map(([k, v]) => `<tr>
            <td style="padding:7px 0;color:#7A8C99;width:110px;vertical-align:top">${esc(k)}</td>
            <td style="padding:7px 0;color:#1E2826"><b>${esc(v)}</b></td></tr>`).join("")}
        </table>
        <p style="margin:16px 0 0;color:#7A8C99;font-size:12.5px">${phone ? `Si necesitás cambiar o cancelar, escríbenos al <a href="tel:${esc(phone.replace(/\s+/g, ""))}" style="color:#0E5E59">${esc(phone)}</a>.` : esc(changeLine)}</p>
      </div>
    </div>`;
  return { title, text, html };
}

async function sendCustomerEmail(p) {
  const c = buildCustomerContent(p);
  const attachments = p.startsAt
    ? [{ filename: "reserva.ics", content: Buffer.from(buildIcs(p)).toString("base64") }]
    : [];
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: N.email?.from || "LeadPilot <onboarding@resend.dev>",
      to: [p.contact], subject: c.title, html: c.html,
      ...(attachments.length ? { attachments } : {}),
    }),
  });
  if (!res.ok) return { channel: "customer_email", ok: false, detail: `HTTP ${res.status}` };
  return { channel: "customer_email", ok: true };
}

// Fire-and-forget, mirrors notifyBooking/notifyHotLead: never blocks the visitor's reply,
// never throws. Only fires when there's a real email to send it to, Resend is configured,
// and the client hasn't opted out. The opt-out key is notifications.email.confirmCustomer;
// the original name (confirmPatient) still works so configs already deployed keep behaving
// exactly as before.
function wantsCustomerConfirmation(emailCfg) {
  const e = emailCfg || {};
  const optIn = e.confirmCustomer ?? e.confirmPatient; // new key wins, old key still honoured
  return !!e.enabled && optIn !== false;
}

function notifyCustomerConfirmation(p) {
  if (!wantsCustomerConfirmation(N.email) || !process.env.RESEND_API_KEY) return;
  if (!p.contact || !EMAIL_RE.test(p.contact)) return; // phone numbers: no SMS provider wired up
  sendCustomerEmail(p).catch(() => {});
}

async function sendTelegram(p, c) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: N.telegram.chatId,
      text: `<b>${esc(c.title)}</b>\n\n${esc(c.text)}`,
      parse_mode: "HTML", disable_web_page_preview: true,
    }),
  });
  if (!res.ok) return { channel: "telegram", ok: false, detail: `HTTP ${res.status}` };
  return { channel: "telegram", ok: true };
}

async function sendWebhook(p, c) {
  const res = await fetch(process.env.NOTIFY_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      event: p.kind, title: c.title, text: c.text,
      customer: {
        name: p.name || null, contact: p.contact || null, interest: p.interest || null,
        score: p.score || null, notes: p.notes || null,
      },
      appointment: p.kind === "booking"
        ? { service: p.service || null, startsAt: p.startsAt || null, durationMin: p.durationMin || null }
        : null,
      sessionId: p.sessionId || null,
      at: new Date().toISOString(),
    }),
  });
  if (!res.ok) return { channel: "webhook", ok: false, detail: `HTTP ${res.status}` };
  return { channel: "webhook", ok: true };
}

// ---- main dispatcher ----
async function dispatch(p) {
  const status = channelStatus();
  const content = buildContent(p);
  const jobs = [];
  if (status.email.configured) jobs.push(sendEmail(p, content).catch(e => ({ channel: "email", ok: false, detail: String(e).slice(0, 80) })));
  if (status.telegram.configured) jobs.push(sendTelegram(p, content).catch(e => ({ channel: "telegram", ok: false, detail: String(e).slice(0, 80) })));
  if (status.webhook.configured) jobs.push(sendWebhook(p, content).catch(e => ({ channel: "webhook", ok: false, detail: String(e).slice(0, 80) })));
  if (!jobs.length) return [{ channel: "none", ok: false, detail: "no channels configured" }];
  return Promise.all(jobs);
}

// Public API. notifyBooking/notifyHotLead are fire-and-forget from the request path;
// sendTest is awaited by the dashboard's test button.
function notifyBooking(p) {
  if (channelStatus().events.booking) dispatch({ ...p, kind: "booking" }).catch(() => {});
}
function notifyHotLead(p) {
  if (channelStatus().events.hotLead) dispatch({ ...p, kind: "hot_lead" }).catch(() => {});
}
// Ops alert to the owner about the AI budget — always on (not gated by event toggles).
function notifyBudget(p) {
  dispatch({ ...p, kind: "budget" }).catch(() => {});
}
function sendTest() {
  return dispatch({
    kind: "booking", sessionId: "test", name: "Test Customer", contact: "+34 600 000 000",
    service: "Free first consultation", startsAt: new Date(Date.now() + 86400000).toISOString().slice(0, 16),
    durationMin: 30, interest: "Checking notifications work", score: "hot",
    notes: "This is a test notification from your LeadPilot dashboard.",
  });
}

module.exports = {
  notifyBooking, notifyHotLead, notifyBudget, notifyCustomerConfirmation, sendTest, channelStatus,
  wantsCustomerConfirmation, buildCustomerContent,
  // Kept so anything still calling the old name keeps working.
  notifyPatientConfirmation: notifyCustomerConfirmation,
};
