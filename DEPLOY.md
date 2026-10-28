# Deploying LeadPilot

This guide covers three things, in order:

1. **Practice first** — run a production-like copy on your own machine, risk-free.
2. **Deploy for real** — put one client live on the internet.
3. **Onboard each new client** — the 5-minute repeat process.

The model is simple: **one client = one deployment.** Each client gets its own URL,
its own database, its own password. That keeps every client's data fully isolated and
lets you honestly say "this is *your* private assistant." You watch them all from one
place using the **Fleet Command Center** (see the bottom of this file).

---

## 0. What every deployment needs (only two secrets)

| Secret | Where to get it | Used for |
|---|---|---|
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys | the AI agent |
| `DASHBOARD_PASSWORD` | you invent it (one per client) | locking the owner dashboard |

That's it. Everything else has safe defaults.

---

## 1. Practice the deployment (do this first, today)

You have two ways to rehearse before touching a real host. Both are free.

### Option A — plain local (fastest)
```bash
npm install
cp .env.example .env          # then open .env and fill in the two secrets above
npm run seed                  # OPTIONAL: fills the dashboard with fake demo leads/appointments
npm start
```
Open:
- Demo client site (fake business, rendered from the active config): http://localhost:3000/
- Owner dashboard (use your DASHBOARD_PASSWORD): http://localhost:3000/dashboard

Talk to the widget as if you were a customer. Watch the lead and the booking appear in
the dashboard. This is exactly what a client will see in a sales demo.

### Option B — Docker (rehearses the *real* production setup)
This runs the app the same way a host does, including a **persistent disk**, so you can
prove to yourself that data survives a restart.
```bash
cp .env.example .env          # fill in the two secrets
docker compose up --build
```
Open the same URLs as above. Now stop it (`Ctrl-C`) and run `docker compose up` again —
your seeded leads are still there. That's the persistence behaviour you want in production.

> Practicing the deploy = doing Option B once. If the Docker version runs and keeps its
> data across a restart, the real host will too.

---

## 2. Deploy one client to the internet (Render)

Render is the easiest host and the blueprint is already in this repo (`render.yaml`).

1. Push this folder to a **GitHub repo** (private is fine).
2. Go to **render.com** → **New** → **Blueprint** → connect that repo.
   Render reads `render.yaml` and sets up the service (Node 24, health check, a 1 GB
   persistent disk so data survives redeploys).
3. When prompted, paste the two secrets: `ANTHROPIC_API_KEY` and `DASHBOARD_PASSWORD`.
4. Click deploy. In ~2 minutes you get a URL like `https://leadpilot-xxxx.onrender.com`.

Check it:
- `https://YOUR-URL/healthz` → should say `{"ok":true,...}`
- `https://YOUR-URL/` → the demo site with the widget
- `https://YOUR-URL/dashboard` → log in with your password

**Free demo instead of a paid client?** In `render.yaml`, set `plan: free`, delete the
`disk:` block and the `DB_PATH` env var. It's free but the database resets on each
redeploy — fine for demos, not for a paying client.

**The install snippet** you give a client is one line (point it at their deployment):
```html
<script src="https://YOUR-URL/widget.js" defer></script>
```
Because the widget renders inside a Shadow DOM, it won't clash with their site's styles,
and it works the same on WordPress, Wix, Squarespace, Shopify, or hand-coded HTML.

**Custom domain (optional, more credible):** buy e.g. `leadpilot.es`, add it in Render's
dashboard, and your snippet becomes `https://leadpilot.es/widget.js`.

### Other hosts
The `Dockerfile` makes this run on anything that takes a container (Railway, Fly.io,
a VPS). Railway also reads the repo directly like Render. The only hard requirement is
**Node 24+** (for the built-in SQLite) and a **persistent volume** mounted where `DB_PATH`
points.

---

## 3. Onboard a new client (≈10 minutes each)

⚠️ **Important: never edit the committed `business.config.json` for a real client.**
That file is the generic sales demo, and anyone who opens the demo deployment sees it.
Editing it for a real client would expose their real name, hours and calendar to every
stranger who visits. Instead, every real client gets their own Render service with their
config passed as an **environment variable**, which overrides the file automatically
(see `src/config.js`) — the committed file stays as the generic sales demo forever.

1. On **Render → New → Web Service**, connect the same GitHub repo, `main` branch.
   Build command `npm install`, start command `npm start`.
2. Add environment variables for this client only:
   - `ANTHROPIC_API_KEY`, `DASHBOARD_PASSWORD` (a fresh one per client)
   - `BUSINESS_CONFIG_JSON` — the client's full config as **one-line JSON** (business
     name, services + durations, hours, qualifying questions, hot-lead criteria, agent
     name, greeting, brand color, language). Easiest way to build this: take
     `business.config.json` from the repo, ask Claude to fill it in for the specific
     client, then minify it to one line before pasting into Render.
   - `DB_PATH=/var/data/data.sqlite` + attach a persistent disk (Settings → Disks),
     same as the main deployment — otherwise this client's leads/appointments reset
     on every redeploy.
3. Deploy. You get a new URL like `https://leadpilot-clienteX.onrender.com` — that URL
   (not the marketing site) is what you send/install for this one client.
4. Send them the one-line install snippet pointing at THEIR URL's `/widget.js`.
5. Add the deployment to your Fleet Command Center (below).

---

## 4. Watch every client in one place — Fleet Command Center

Open **`fleet/index.html`** in any browser (double-click the file is fine — it needs no
server). Click **+ Add deployment** and paste each client's **URL** and **dashboard
password**. You'll see, for all clients at once: who's online, total/hot leads, upcoming
appointments, and this month's API spend — with a one-click link into each dashboard.

- Your list is stored only in *your* browser (localStorage). Nothing is uploaded anywhere;
  the page talks directly to each deployment.
- It reads each deployment's `/api/fleet-summary`, which is password-protected, so only
  you (with the passwords) can see the data.
- Keep this file on your own laptop. Don't host it publicly with passwords saved in it.

---

## 5. WhatsApp channel (optional, per client — the Pro upsell)

The same agent can answer the client's WhatsApp number. Setup uses Meta's official
WhatsApp Business Cloud API (~30 min, once per client):

1. Go to **developers.facebook.com** → create an app (type "Business") → add the
   **WhatsApp** product.
2. In WhatsApp → API Setup, note the **Phone number ID** and create a **permanent
   access token** (via a System User in Business Settings). For a client, add THEIR
   client number; for testing, Meta gives you a free test number.
3. In WhatsApp → Configuration, set the **webhook**:
   - Callback URL: `https://YOUR-DEPLOYMENT/api/whatsapp/webhook`
   - Verify token: any string you invent
   - Subscribe to the **messages** field.
4. In the deployment's environment (Render → Environment) set:
   `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, and
   (recommended) `WHATSAPP_APP_SECRET` (app settings → Basic → App secret).
5. Redeploy. Message the number on WhatsApp — the agent answers, and the
   conversation + lead appear in the dashboard like any web chat.

Notes: customers messaging first opens a free 24-hour service window, so normal
booking conversations cost nothing extra on Meta's side. Replies outside that
window would need approved templates — not needed for this flow.

## 6. Notifications (optional, per client)

Turn on email / Telegram / webhook alerts in `business.config.json` under `notifications`
and add that channel's secret to `.env` (see `.env.example`). Use the dashboard's
"Send test notification" button to confirm it works. Webhook → Make.com → WhatsApp is the
easy path to WhatsApp alerts.
