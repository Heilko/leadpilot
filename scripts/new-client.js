#!/usr/bin/env node
// new-client.js — build a complete client config from a sector preset.
//
//   npm run new-client -- --preset pilates --name "Estudio X" --timezone Europe/Madrid --agent "Lía"
//
// Writes clients/<slug>.config.json, ready to paste into BUSINESS_CONFIG_JSON on a
// deployment (or to copy over business.config.json for local work).
const fs = require("fs");
const path = require("path");
const sector = require("../src/sector");

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq > -1) { out[a.slice(2, eq)] = a.slice(eq + 1); continue; }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) { out[a.slice(2)] = true; continue; }
    out[a.slice(2)] = next; i++;
  }
  return out;
}

const HELP = `
Build a client config from a sector preset.

  npm run new-client -- --preset <sector> --name "<business>" [options]

Required
  --preset <sector>     one of: ${sector.listPresets().join(", ") || "(no presets found)"}
  --name "<business>"   the business's real name

Options
  --agent "<name>"      assistant name          (default: the preset's)
  --timezone <IANA>     e.g. Europe/Madrid      (default: Europe/Madrid)
  --phone "<number>"    shown in confirmations so customers can change/cancel
  --email <address>     owner address for booking + hot-lead alerts
  --dashboard <url>     deployment URL, used in alert links
  --accent "#RRGGBB"    widget colour           (default: the preset's)
  --description "..."   overrides the preset's generated description
  --greeting "..."      overrides the preset's generated greeting
  --privacy <url>       privacy notice link shown in the widget
  --slug <name>         output filename         (default: slugified business name)
  --print               also print the JSON (one line, for pasting into an env var)
`;

const args = parseArgs(process.argv.slice(2));

if (args.help || args.h) { console.log(HELP); process.exit(0); }

const missing = [];
if (!args.preset || args.preset === true) missing.push("--preset");
if (!args.name || args.name === true) missing.push('--name "Business name"');
if (missing.length) {
  console.error(`\n✗ Missing required argument(s): ${missing.join(", ")}`);
  console.error(HELP);
  process.exit(1);
}

let preset;
try {
  preset = sector.loadPreset(args.preset);
} catch (e) {
  console.error(`\n✗ ${e.message}\n`);
  process.exit(1);
}

const cfg = sector.buildClientConfig(preset, {
  name: args.name,
  agentName: args.agent && args.agent !== true ? args.agent : undefined,
  timezone: args.timezone && args.timezone !== true ? args.timezone : undefined,
  contactPhone: args.phone && args.phone !== true ? args.phone : undefined,
  ownerEmail: args.email && args.email !== true ? args.email : undefined,
  dashboardUrl: args.dashboard && args.dashboard !== true ? args.dashboard : undefined,
  accentColor: args.accent && args.accent !== true ? args.accent : undefined,
  description: args.description && args.description !== true ? args.description : undefined,
  greeting: args.greeting && args.greeting !== true ? args.greeting : undefined,
  privacyUrl: args.privacy && args.privacy !== true ? args.privacy : undefined,
});

const { ok, errors } = sector.validateConfig(cfg);
if (!ok) {
  console.error(`\n✗ The generated config is not valid:\n`);
  errors.forEach(e => console.error(`  • ${e}`));
  console.error("");
  process.exit(1);
}

const slug = (args.slug && args.slug !== true) ? sector.slugify(args.slug) : sector.slugify(args.name);
const dir = path.join(__dirname, "..", "clients");
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, `${slug}.config.json`);
fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n");

console.log(`\n✓ ${cfg.businessName} — preset "${args.preset}"`);
console.log(`  written to clients/${slug}.config.json`);
console.log(`  assistant: ${cfg.widget.agentName} · ${cfg.services.length} services · ${cfg.timezone}`);
console.log(`  says "${cfg.vocabulary.customer}" / "${cfg.vocabulary.business}" / "${cfg.vocabulary.appointment}"`);
if (!cfg.notifications.email.to) console.log(`  note: no --email given, so owner alerts are off`);
console.log(`\n  To use it: paste the file's contents into BUSINESS_CONFIG_JSON on the deployment,`);
console.log(`  or copy it over business.config.json to run it locally.\n`);

if (args.print) console.log(JSON.stringify(cfg) + "\n");
