// sector.js — everything that makes LeadPilot sector-neutral.
//
// Pure functions only (no I/O beyond reading a preset file), so tests can call them
// with arbitrary config objects. src/config.js resolves the live config through these
// and every other module reads `config.vocabulary` / `config.guardrails`.
const fs = require("fs");
const path = require("path");

// Neutral defaults: what a business that isn't a clinic should sound like.
const DEFAULT_VOCABULARY = Object.freeze({
  customer: "cliente",
  customerPlural: "clientes",
  business: "el negocio",
  appointment: "cita",
});

// Backwards compatibility: configs written before the `vocabulary` block existed were
// all dental, and their wording is baked into a live deployment. If such a config has
// no vocabulary of its own AND its industry is clinical, it keeps the old words.
const LEGACY_CLINIC_VOCABULARY = Object.freeze({
  customer: "paciente",
  customerPlural: "pacientes",
  business: "la clínica",
  appointment: "cita",
});

const LEGACY_CLINIC_GUARDRAILS = Object.freeze([
  "NO MEDICAL ADVICE: Never diagnose, recommend treatments, or give medical advice. If asked, explain the professionals will assess them at the visit, and offer to book. If someone describes severe pain, bleeding, trauma or an emergency, tell them to contact the business directly or emergency services right away — and still offer the soonest appointment.",
]);

const CLINIC_INDUSTRY_RE = /clinic|clínica|clinica|dental|dentist|odont|medic|médic|salud|health/i;

function isClinicIndustry(industry) {
  return CLINIC_INDUSTRY_RE.test(String(industry || ""));
}

/** Merge a config's `vocabulary` over the right defaults. Always returns all four keys. */
function resolveVocabulary(cfg = {}) {
  const provided = cfg.vocabulary && typeof cfg.vocabulary === "object" ? cfg.vocabulary : null;
  // Only a legacy config — no vocabulary block at all, clinical industry — inherits the
  // old clinic wording. Anything that supplies a block falls back to neutral for gaps.
  const base = (!provided && isClinicIndustry(cfg.industry))
    ? LEGACY_CLINIC_VOCABULARY
    : DEFAULT_VOCABULARY;
  return { ...base, ...(provided || {}) };
}

/** The sector-specific rules injected into the system prompt. Universal rules stay in agent.js. */
function resolveGuardrails(cfg = {}) {
  if (Array.isArray(cfg.guardrails)) return cfg.guardrails.filter(g => typeof g === "string" && g.trim());
  // No guardrails key at all + clinical industry → keep the old hardcoded medical rule.
  return isClinicIndustry(cfg.industry) ? [...LEGACY_CLINIC_GUARDRAILS] : [];
}

// ---- presets ----
const PRESETS_DIR = path.join(__dirname, "..", "presets");

function listPresets() {
  if (!fs.existsSync(PRESETS_DIR)) return [];
  return fs.readdirSync(PRESETS_DIR).filter(f => f.endsWith(".json")).map(f => f.replace(/\.json$/, "")).sort();
}

function loadPreset(name) {
  const file = path.join(PRESETS_DIR, `${String(name).replace(/[^a-z0-9_-]/gi, "")}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(`Unknown preset "${name}". Available: ${listPresets().join(", ") || "(none)"}`);
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function slugify(s) {
  return String(s).normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function fillTemplate(tpl, vars) {
  return String(tpl || "").replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
}

/**
 * Merge a sector preset with one business's own details into a complete config,
 * shaped exactly like business.config.json so it is a drop-in replacement.
 */
function buildClientConfig(preset, details = {}) {
  const businessName = details.name || "";
  const agentName = details.agentName || preset.defaultAgentName || "Aria";
  const vars = { business: businessName, agent: agentName };

  return {
    businessName,
    contactPhone: details.contactPhone || "",
    industry: preset.industry,
    description: details.description || fillTemplate(preset.descriptionTemplate, vars),
    services: preset.services,
    qualifyingQuestions: preset.qualifyingQuestions,
    hotLeadCriteria: preset.hotLeadCriteria,
    businessHours: details.businessHours || preset.defaultBusinessHours,
    timezone: details.timezone || "Europe/Madrid",
    language: preset.language || "Match the visitor's language (Spanish or English).",
    vocabulary: preset.vocabulary,
    guardrails: preset.guardrails || [],
    widget: {
      accentColor: details.accentColor || preset.accentColor || "#0E5E59",
      agentName,
      greeting: details.greeting || fillTemplate(preset.greetingTemplate, vars),
      position: "right",
      privacyUrl: details.privacyUrl || "",
      ui: preset.widgetUi,
    },
    notifications: {
      dashboardUrl: details.dashboardUrl || "",
      notifyOnBooking: true,
      notifyOnHotLead: true,
      email: {
        enabled: !!details.ownerEmail,
        to: details.ownerEmail || "",
        from: `${businessName} <onboarding@resend.dev>`,
        confirmCustomer: true,
      },
      telegram: { enabled: false, chatId: "" },
      webhook: { enabled: false },
    },
  };
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

/** Returns { ok, errors[] }. Errors are plain sentences meant to be printed to a human. */
function validateConfig(cfg) {
  const e = [];
  if (!cfg || typeof cfg !== "object") return { ok: false, errors: ["Config is not an object."] };

  if (!cfg.businessName) e.push("businessName is missing (pass --name).");
  if (!cfg.industry) e.push("industry is missing (the preset should supply it).");
  if (!cfg.description) e.push("description is missing.");

  if (!Array.isArray(cfg.services) || !cfg.services.length) {
    e.push("services must be a non-empty array.");
  } else {
    cfg.services.forEach((s, i) => {
      if (!s || !s.name) e.push(`services[${i}] has no name.`);
      if (!Number.isInteger(s?.duration) || s.duration <= 0) {
        e.push(`services[${i}] ("${s?.name || "?"}") needs a positive whole-minute duration.`);
      }
    });
  }

  if (!cfg.businessHours || typeof cfg.businessHours !== "object") {
    e.push("businessHours is missing.");
  } else {
    for (const d of DAYS) {
      if (!(d in cfg.businessHours)) { e.push(`businessHours.${d} is missing (use null for closed).`); continue; }
      const h = cfg.businessHours[d];
      if (h === null) continue;
      if (!h.open || !h.close) { e.push(`businessHours.${d} needs both open and close (or null).`); continue; }
      if (!HHMM.test(h.open)) e.push(`businessHours.${d}.open "${h.open}" must be HH:MM (24h).`);
      if (!HHMM.test(h.close)) e.push(`businessHours.${d}.close "${h.close}" must be HH:MM (24h).`);
      if (HHMM.test(h.open) && HHMM.test(h.close) && h.close <= h.open) {
        e.push(`businessHours.${d}: close (${h.close}) must be after open (${h.open}).`);
      }
    }
  }

  if (!cfg.timezone) {
    e.push("timezone is missing (e.g. Europe/Madrid).");
  } else {
    try { new Intl.DateTimeFormat("en", { timeZone: cfg.timezone }); }
    catch { e.push(`timezone "${cfg.timezone}" is not a valid IANA zone (e.g. Europe/Madrid).`); }
  }

  if (!cfg.widget?.agentName) e.push("widget.agentName is missing (pass --agent).");
  if (!cfg.widget?.greeting) e.push("widget.greeting is missing.");

  const v = cfg.vocabulary;
  if (v !== undefined) {
    if (typeof v !== "object" || v === null) e.push("vocabulary must be an object if present.");
    else for (const k of ["customer", "customerPlural", "business", "appointment"]) {
      if (k in v && typeof v[k] !== "string") e.push(`vocabulary.${k} must be a string.`);
    }
  }
  if (cfg.guardrails !== undefined && !Array.isArray(cfg.guardrails)) {
    e.push("guardrails must be an array of plain-language strings if present.");
  }

  return { ok: e.length === 0, errors: e };
}

module.exports = {
  DEFAULT_VOCABULARY, LEGACY_CLINIC_VOCABULARY, LEGACY_CLINIC_GUARDRAILS,
  isClinicIndustry, resolveVocabulary, resolveGuardrails,
  listPresets, loadPreset, slugify, fillTemplate, buildClientConfig, validateConfig,
};
