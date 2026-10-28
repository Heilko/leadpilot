# LeadPilot — AI Lead Generation Widget + Appointment Setter

An embeddable chat widget powered by Claude that qualifies website visitors, captures their contact details, scores them (cold / warm / hot), and books appointments directly into a calendar — with an owner dashboard to see everything.

One script tag installs it on any website:

```html
<script src="https://YOUR-DOMAIN/widget.js" defer></script>
```

## Quickstart (local)

Requirements: **Node.js 24+** (uses the built-in SQLite — zero native dependencies; Node 24
is required so that module runs without a special flag, which matters on hosts).

```bash
npm install
cp .env.example .env        # then edit: add your ANTHROPIC_API_KEY and a DASHBOARD_PASSWORD
npm run seed                # optional: fills the dashboard with demo data to practice with
npm start
```

- Demo client site (fake business, rendered from the active config): http://localhost:3000/
- Owner dashboard: http://localhost:3000/dashboard

See **`DEPLOY.md`** for deploying, practising the deploy locally, and the Fleet
Command Center.

## Sectors

The product is sector-neutral. What kind of business it serves is data, not code:
`presets/` holds one file per sector (dental, estetica, moda, pilates, ingles,
extranjeria) carrying the services, the qualifying questions, the **vocabulary** it
speaks (`paciente` / `cliente` / `alumno`, `la clínica` / `la tienda` / `el estudio`)
and the **guardrails** injected into the system prompt — "never give medical advice"
for a clinic, "never give legal advice or predict an outcome" for a law firm, none for
a boutique. Rules that apply everywhere (AI disclosure, never inventing prices, only
booking real slots) stay in the code.

Make a config for a business:

```bash
npm run new-client -- --preset pilates --name "Estudio X" --timezone Europe/Madrid --agent "Lía"
```

It merges the preset with that business's details, validates the result (hours format,
service durations, timezone) and writes `clients/<slug>.config.json`. Paste that file's
contents into `BUSINESS_CONFIG_JSON` on the deployment, or copy it over
`business.config.json` to run it locally. `npm run new-client -- --help` lists every flag.

### Adding a new sector

1. Copy the closest preset: `cp presets/pilates.json presets/<new>.json`
2. Edit five fields: `industry`, `services`, `qualifyingQuestions`, `vocabulary`, `guardrails`
   (plus `greetingTemplate` if the wording should change — `{business}` and `{agent}` are substituted)
3. `npm run new-client -- --preset <new> --name "Test" --timezone Europe/Madrid`
4. `npm test` — the suite validates every preset in `presets/` automatically

Configs written before this layer existed keep working untouched: one with no
`vocabulary` or `guardrails` and a clinical `industry` still says "paciente" and still
carries the medical rule.

## Configure for a new client

Everything client-specific lives in **`business.config.json`**: business name, contact phone (used in customer confirmation emails so "cambiar o cancelar" is actually actionable), services and durations, opening hours, qualifying questions, what makes a lead "hot", the agent's name, greeting, and widget accent color. Edit that one file, restart, and the agent is re-trained for the new business. No code changes needed.

## Project structure

```
business.config.json   ← per-client config (the white-label layer)
src/server.js          ← Express API + static serving (scoped CORS, security headers)
src/agent.js           ← Claude agent: system prompt, tools, tool-use loop
src/db.js              ← SQLite: leads, appointments, conversations, fleet summary
src/sector.js          ← sector layer: vocabulary, guardrails, presets, config validation
src/schedule.js        ← availability + booking-rule engine
src/notify.js          ← booking / hot-lead alerts (email · Telegram · webhook)
src/whatsapp.js        ← WhatsApp channel: customers chat with the same agent (Meta Cloud API)
src/loadenv.js         ← tiny .env loader
public/widget.js       ← the embeddable widget (Shadow-DOM isolated, config-driven)
public/dashboard.html  ← owner dashboard (password protected)
public/demo.html       ← demo website for sales demos
fleet/index.html       ← Fleet Command Center: all client deployments in one view
presets/<sector>.json  ← one file per sector: services, vocabulary, guardrails, greeting
clients/<slug>.json    ← generated per client (git-ignored); paste into BUSINESS_CONFIG_JSON
scripts/new-client.js  ← preset + business details → a complete client config
scripts/seed.js        ← demo data for practice (npm run seed)
test/                  ← node:test suite (npm test), no dependencies
Dockerfile, docker-compose.yml, render.yaml ← deploy + practice infrastructure
DEPLOY.md, LEGAL-COMPLIANCE.md, PRIVACY-TEMPLATE.md ← guides
```

## WhatsApp channel (sell web, WhatsApp, or both)

The same agent can also answer the business's **WhatsApp** number via Meta's official
WhatsApp Business Cloud API — same booking tools, same dashboard, leads appear with a
`wa_` session id. It's off by default and turns on per client by setting the
`WHATSAPP_*` env vars (see `.env.example` for the exact setup steps). Webhook security:
Meta's HMAC signature is verified on every delivery, retried deliveries are deduped,
and per-sender rate limits + the daily budget cap apply just like on the web widget.

## Notifications

Get an alert (email, Telegram, or webhook) the instant a booking or hot lead comes in, with the customer's details attached. Turn channels on in `business.config.json` under `notifications` and add each channel's secret to `.env` (see `.env.example`). Use the dashboard's "Send test notification" button to confirm setup. Webhook → Make.com/Zapier is the easy path to WhatsApp/SMS.

## Deploy

Full step-by-step (including how to **practice** the deploy locally with Docker, and the
**Fleet Command Center**) is in **`DEPLOY.md`**. Short version: this repo ships a Render
blueprint (`render.yaml`) — Render → New → Blueprint → connect the repo → paste the two
secrets. Node 24 and a persistent disk are configured for you so client data survives
redeploys. A `Dockerfile` makes it run on Railway, Fly.io, or any VPS too.
