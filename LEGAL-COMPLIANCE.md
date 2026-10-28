# LeadPilot — Legal Compliance Audit

*Audited July 2026. This maps every law that plausibly applies to LeadPilot (an AI chat
agent handling patient contact/health-adjacent data for clinics in Paraguay and Spain),
what the code already handles, and what requires human action. It is a serious engineering
compliance pass — not a substitute for a lawyer when you sign your first big contract.*

## The laws that apply

### Paraguay (current market)
| Law | What it demands of LeadPilot | Status |
|---|---|---|
| **Ley 7593/2025** — Protección de Datos Personales (promulgated Nov 2025; fully enforceable **Nov 2027**, ANPDP authority forming during 2026) | GDPR-style duties: legal basis, transparency, data minimization, retention limits, subject rights (access/rectification/erasure), security, breach notification | ✅ Built in now (see below) — you're ahead of the deadline |
| **Ley 6534/2020** — datos crediticios | Only if you ever handle credit/financial data — LeadPilot doesn't | ✅ N/A by design |
| **Ley 1334/1998** — Defensa del Consumidor | Honest advertising, clear pricing to *your* clients (clinics) | ⚠️ Keep website claims accurate; quote prices in writing |
| **Ley 4868/2013** — Comercio Electrónico | Identify the provider on commercial sites; honor electronic contracting duties | ⚠️ Add your name + contact to the website footer when you formalize |
| **Tax (RUC / IVA / IRE)** | To legally invoice clinics you need a RUC and a tax regime | ❌ Human task — accountant, before first paid client |

### Spain / EU (phase 2 market)
| Law | What it demands | Status |
|---|---|---|
| **GDPR (2016/679)** + **LOPDGDD 3/2018** | Everything in Ley 7593 plus: **health data is a special category (art. 9)** — dental complaints count; DPA contracts with clients; documented sub-processors; international-transfer safeguards for Anthropic (US) | ✅ Code + templates ready; ❌ sign Anthropic's DPA (human task) |
| **EU AI Act (2024/1689) art. 50** — applies **2 Aug 2026** | Users must be told they're talking to AI **at first interaction**; up to €15M / 3% fines | ✅ Implemented: widget badge + header + agent self-identifies (incl. WhatsApp first reply) |
| **LSSI-CE (Ley 34/2002)** | Provider identification on the site; rules on commercial emails | ⚠️ Footer identity when selling in Spain; don't cold-email consumers (B2B outreach to clinic emails is OK) |
| **ePrivacy (cookies)** | Consent for non-essential cookies/storage | ✅ No consent banner needed: the widget stores only a functional session ID (strictly necessary), no ads/tracking — but it IS disclosed in the privacy notice |
| **GDPR art. 27** | Non-EU businesses serving EU users may need an EU representative | ⚠️ Revisit when entering Spain (or register as autónomo there, which resolves it) |
| **Autónomo / IVA registration** | Legal invoicing in Spain | ❌ Human task, blocking for the Spain market (see council verdict) |

### Platform terms (contractual, both markets)
| Terms | Demand | Status |
|---|---|---|
| **Anthropic Usage Policy + Commercial Terms** | No medical advice presented as professional judgment; execute the **Data Processing Addendum** for EU data | ✅ No-medical-advice rule in the system prompt; ❌ accept DPA in console (2 min, human) |
| **Meta WhatsApp Business terms** | Official API only (no unofficial bridges), business verification, respect 24h service window | ✅ Built on official Cloud API; replies happen inside the free service window |

## What the code now does for compliance

1. **AI transparency (AI Act art. 50, ready 30 days before the deadline):** the widget
   header says *"Asistente virtual (IA)"*, the footer carries an always-on "Asistente
   virtual con IA" badge, and the agent is instructed to identify itself as an AI in its
   first WhatsApp reply and to always confirm being an AI when asked — it can never claim
   to be human.
2. **No medical advice:** hard system-prompt rule — no diagnosis or treatment advice;
   emergencies are told to call the clinic/emergency services immediately.
3. **Data minimization:** the agent only collects what booking requires and doesn't probe
   for health details beyond what the visitor volunteers.
4. **Storage limitation:** automatic purge of conversations, leads, usage rows and past
   appointments after `DATA_RETENTION_DAYS` (default **365**), running at boot + daily.
5. **Right to erasure:** 🗑 button on every lead in the dashboard (and
   `DELETE /api/leads/:id`) wipes the person's lead, conversation, appointments and usage
   in one click — that's how a clinic honors a deletion request.
6. **Right to access/portability:** the dashboard's conversation view + CSV export.
7. **Security (art. 32-grade measures):** HTTPS+HSTS, constant-time auth with brute-force
   lockout, scoped CORS, webhook signature verification, per-client data isolation
   (one deployment per clinic), EU hosting (Render Frankfurt), input caps + rate limits.
8. **No tracking:** no analytics/ad cookies in the widget; one functional session ID.
9. **Documentation:** `PRIVACY-TEMPLATE.md` (v2) covers controller/processor roles, the
   sub-processor list (Anthropic/Render/Meta), health-data purpose limitation, retention,
   and subject rights — plus a data-processing clause for your client contracts.

## What only YOU can do (tracked in Todoist)

1. **Accept Anthropic's DPA** — console.anthropic.com → legal. 2 minutes, needed for EU
   data, good practice everywhere.
2. **RUC + tax regime with an accountant** before invoicing your first Paraguay client.
3. **Publish the privacy notice** (template v2) and put its URL in `widget.privacyUrl`.
4. **Client agreement**: one page + the data-processing clause from the template — have
   every clinic sign it.
5. **Spain entry checklist** (when the time comes): autónomo + IVA registration, EU
   representative question, AEPD-ready privacy notice — all flagged above.
6. **Watch the ANPDP** (Paraguay's new data authority) during 2026-2027 for implementing
   regulations, and re-check this document then.
