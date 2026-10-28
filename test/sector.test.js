// Tests for the sector-neutral layer. Node's built-in runner — no dependencies.
//   npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");

// agent.js pulls in db.js, which opens a SQLite file on require. Point it at a
// throwaway path so running tests never touches the real data.sqlite.
process.env.DB_PATH = path.join(os.tmpdir(), `leadpilot-test-${process.pid}.sqlite`);

const sector = require("../src/sector");
const { buildSystemPrompt } = require("../src/agent");
const { wantsCustomerConfirmation } = require("../src/notify");

const PRESETS = ["dental", "estetica", "moda", "pilates", "ingles", "extranjeria"];

const baseConfig = (over = {}) => ({
  businessName: "Negocio Demo",
  industry: "boutique de moda femenina",
  description: "Una tienda de ejemplo.",
  services: [{ name: "Cita de asesoramiento", duration: 60 }],
  qualifyingQuestions: ["¿Para qué ocasión?"],
  hotLeadCriteria: "Tiene una fecha concreta.",
  businessHours: {
    monday: { open: "10:00", close: "20:00" }, tuesday: null, wednesday: null,
    thursday: null, friday: null, saturday: null, sunday: null,
  },
  timezone: "Europe/Madrid",
  language: "Match the visitor's language (Spanish or English).",
  widget: { agentName: "Alma", greeting: "Hola", accentColor: "#111111", ui: {} },
  ...over,
});

// ---------------------------------------------------------------- vocabulary
test("config with no vocabulary block falls back to neutral words", () => {
  const v = sector.resolveVocabulary(baseConfig());
  assert.equal(v.customer, "cliente");
  assert.equal(v.customerPlural, "clientes");
  assert.equal(v.business, "el negocio");
  assert.equal(v.appointment, "cita");
});

test("a legacy clinic config with no vocabulary block keeps the old clinic words", () => {
  const v = sector.resolveVocabulary(baseConfig({ industry: "dental clinic" }));
  assert.equal(v.customer, "paciente");
  assert.equal(v.business, "la clínica");
});

test("a partial vocabulary block fills its gaps from the neutral defaults", () => {
  const v = sector.resolveVocabulary(baseConfig({ vocabulary: { business: "el estudio" } }));
  assert.equal(v.business, "el estudio");
  assert.equal(v.customer, "cliente"); // not inherited from the clinic set
});

test("a legacy clinic config with no guardrails keeps the medical rule", () => {
  const g = sector.resolveGuardrails(baseConfig({ industry: "clínica dental" }));
  assert.equal(g.length, 1);
  assert.match(g[0], /NO MEDICAL ADVICE/);
});

test("a non-clinic config with no guardrails gets none", () => {
  assert.deepEqual(sector.resolveGuardrails(baseConfig()), []);
});

test("an explicit empty guardrails array wins over the clinic fallback", () => {
  assert.deepEqual(sector.resolveGuardrails(baseConfig({ industry: "dental clinic", guardrails: [] })), []);
});

// ------------------------------------------------------------------- presets
test("every preset builds a valid config", () => {
  for (const name of PRESETS) {
    const preset = sector.loadPreset(name);
    const cfg = sector.buildClientConfig(preset, {
      name: `Negocio ${name}`, timezone: "Europe/Madrid", agentName: "Aria",
    });
    const { ok, errors } = sector.validateConfig(cfg);
    assert.ok(ok, `${name} produced an invalid config: ${errors.join(" | ")}`);
    assert.ok(cfg.services.length > 0, `${name} has no services`);
    assert.ok(cfg.widget.greeting.includes(`Negocio ${name}`), `${name} greeting not personalised`);
    assert.ok(cfg.vocabulary.customer && cfg.vocabulary.business, `${name} missing vocabulary`);
  }
});

test("validateConfig catches malformed hours, durations and timezones", () => {
  const bad = baseConfig({
    timezone: "Mars/Olympus",
    services: [{ name: "X", duration: 0 }],
    businessHours: { ...baseConfig().businessHours, monday: { open: "25:00", close: "09:00" } },
  });
  const { ok, errors } = sector.validateConfig(bad);
  assert.equal(ok, false);
  assert.ok(errors.some(e => /timezone/i.test(e)));
  assert.ok(errors.some(e => /duration/i.test(e)));
  assert.ok(errors.some(e => /HH:MM/.test(e)));
});

test("validateConfig reports a missing business name", () => {
  const { ok, errors } = sector.validateConfig(baseConfig({ businessName: "" }));
  assert.equal(ok, false);
  assert.ok(errors.some(e => /businessName/.test(e)));
});

// --------------------------------------------------- confirmPatient back-compat
test("confirmPatient still works as an alias of confirmCustomer", () => {
  assert.equal(wantsCustomerConfirmation({ enabled: true, confirmPatient: true }), true);
  assert.equal(wantsCustomerConfirmation({ enabled: true, confirmPatient: false }), false);
  assert.equal(wantsCustomerConfirmation({ enabled: true, confirmCustomer: false }), false);
  assert.equal(wantsCustomerConfirmation({ enabled: true }), true, "defaults to on");
  assert.equal(wantsCustomerConfirmation({ enabled: false, confirmPatient: true }), false);
  // the new key wins when both are present
  assert.equal(wantsCustomerConfirmation({ enabled: true, confirmCustomer: true, confirmPatient: false }), true);
});

// ------------------------------------------------------------- system prompt
function promptFor(presetName) {
  const preset = sector.loadPreset(presetName);
  return buildSystemPrompt(sector.buildClientConfig(preset, {
    name: "Negocio Demo", timezone: "Europe/Madrid", agentName: "Aria",
  }));
}

test("the prompt carries the preset's guardrails and none from another sector", () => {
  const pilates = promptFor("pilates");
  assert.match(pilates, /physiotherapy/, "pilates guardrail missing");
  assert.doesNotMatch(pilates, /NO LEGAL ADVICE/, "leaked the lawyers' guardrail");

  const extranjeria = promptFor("extranjeria");
  assert.match(extranjeria, /NO LEGAL ADVICE/, "extranjería guardrail missing");
  assert.doesNotMatch(extranjeria, /physiotherapy/, "leaked the pilates guardrail");

  const moda = promptFor("moda");
  assert.doesNotMatch(moda, /NO LEGAL ADVICE|physiotherapy|NO MEDICAL ADVICE/,
    "a boutique should carry no sector guardrail");
});

test("the prompt speaks each sector's vocabulary", () => {
  assert.match(promptFor("pilates"), /alumno/);
  assert.match(promptFor("pilates"), /el estudio/);
  assert.match(promptFor("extranjeria"), /el despacho/);
  assert.match(promptFor("moda"), /la tienda/);
});

test("non-clinic prompts contain no clinic words at all", () => {
  for (const name of ["moda", "pilates", "ingles", "extranjeria"]) {
    const p = promptFor(name);
    assert.doesNotMatch(p, /\bpaciente|\bclínica|\bclinica|\bdental\b|\bdentist/i,
      `${name} prompt still contains clinic vocabulary`);
  }
});

test("universal rules survive in every sector", () => {
  for (const name of PRESETS) {
    const p = promptFor(name);
    assert.match(p, /TRANSPARENCY/, `${name} lost the AI-disclosure rule`);
    assert.match(p, /Never invent availability/, `${name} lost the real-slots rule`);
    assert.match(p, /never discuss prices you are not sure of/, `${name} lost the pricing rule`);
  }
});
