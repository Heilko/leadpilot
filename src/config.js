// config.js — single source of truth for the per-client business config.
//
// Why this exists: the whole product is designed as "one deployment per client,"
// each with its own data and its own settings. But business.config.json is a file
// baked into the repo, so every deployment of the same codebase would otherwise
// serve the SAME config — which breaks isolation the moment you have two clients
// (e.g. the public marketing demo and a real client would show identical data).
//
// Fix: if BUSINESS_CONFIG_JSON is set (the full config as a JSON string, pasted
// into that deployment's environment variables), it overrides the committed file.
// Every other module should require THIS file, never business.config.json directly.
//
// The config is also passed through src/sector.js so that `vocabulary` and
// `guardrails` are always present and fully populated, whatever the sector — and
// whether or not the config predates those keys existing.
const fs = require("fs");
const path = require("path");
const sector = require("./sector");

let config;
if (process.env.BUSINESS_CONFIG_JSON) {
  try {
    config = JSON.parse(process.env.BUSINESS_CONFIG_JSON);
  } catch (e) {
    throw new Error("BUSINESS_CONFIG_JSON is set but is not valid JSON: " + e.message);
  }
} else {
  config = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "business.config.json"), "utf8"));
}

// Resolved in place so every consumer can rely on them without re-deriving.
config.vocabulary = sector.resolveVocabulary(config);
config.guardrails = sector.resolveGuardrails(config);

module.exports = config;
