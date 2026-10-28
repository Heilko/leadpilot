# How LeadPilot actually works for a client

*Internal reference — the honest mechanics, including the limitation you must know before
pitching. Read §5 before any sales conversation.*

LeadPilot is sector-neutral: the same product runs for a dental clinic, an aesthetic
clinic, a boutique, a pilates studio, a language academy or a law firm. What changes is a
config file — the services it books, the words it uses (`paciente` / `cliente` / `alumno`,
`la clínica` / `la tienda` / `el estudio`) and the guardrails it obeys. See `presets/`.

---

## 1. The 3-minute version (what you say)

> "Tu web y tu WhatsApp reciben gente que pregunta cosas. Hoy, si nadie contesta, esa
> persona se va. LeadPilot contesta al instante — sabe tus servicios, tus horarios, y le
> deja la reserva lista. Tú te enteras al momento y lo ves todo en un panel."

It is **not** a relay to your receptionist. It answers and books **by itself**. The business
finds out afterwards, via an instant alert.

---

## 2. How the AI knows what the business offers

Everything lives in **one configuration file per client**, filled in during a ~10-minute
onboarding conversation. Nothing technical for them.

| What's configured | Example | Where it's used |
|---|---|---|
| Business name & description | "Estudio Chamberí, pilates en…" | How the AI introduces itself |
| **Services + duration** | "Clase de prueba — 55 min" | What it can book + how long each slot must be |
| **Opening hours per day** | Mon–Fri 07:00–21:00, Sat 09:00–14:00, Sun closed | Which slots exist at all |
| Timezone | Europe/Madrid | So "hoy/mañana" is correct locally |
| Qualifying questions | "¿Ha hecho pilates antes?" | What it works into conversation |
| Hot-lead criteria | "Quiere reservar esta semana" | When you get an urgent alert |
| **Vocabulary** | alumno / el estudio / clase | Every word the assistant says |
| **Guardrails** | "Never give medical advice" | Sector rules injected into the prompt |
| Assistant name, greeting, brand colour | "Lía", sage green | Look & personality |

**To change anything** — new service, new hours, holiday closure — the client sends a
message, you update the config, live in minutes. They never touch a dashboard setting.

**Switching sector is one command**, not a code change:
`npm run new-client -- --preset pilates --name "Estudio X" --timezone Europe/Madrid`

---

## 3. Prices — it deliberately does NOT quote them

There is **no price field**. The AI is explicitly instructed to never invent or state prices,
and to say the team will confirm at the visit.

> *"El precio exacto te lo confirma el equipo, porque depende de cada caso."*

**Pitch this as a feature, because it is one:**
> "No inventa precios. Nunca. El precio depende del caso — si un bot suelta un número y
> después no coincide, te quedas con un cliente enfadado. El mío capta al cliente y deja
> que vosotros cerréis el precio, que es como debe ser."

If a client *wants* fixed prices quoted, that can be added to the service description in the
config — but the default is deliberately safe.

---

## 4. How it knows what times are available

The AI never guesses. Before offering any time, it calls a server function that computes real
slots from three inputs:

1. **Opening hours** for that weekday (closed days return "cerrado", never a slot)
2. **The service duration** — a 60-min service won't be offered at 18:30 if you close at 19:00
3. **Bookings already made** — checked for overlap, no double-booking

It also never offers a time in the past, and the server **rejects** any booking that breaks
these rules even if the AI tries — the rules are enforced in code, not just in the prompt.

---

## 5. ⚠️ THE IMPORTANT LIMITATION — read before pitching

**LeadPilot keeps its own calendar. It does NOT connect to the client's existing agenda.**

So it knows about bookings **it** made. It does **not** know about:
- bookings taken by phone
- bookings taken at the front desk
- bookings in their existing software or paper diary

**The risk:** the receptionist books someone Tuesday 10:00 by phone. LeadPilot doesn't know,
and could book a different person at Tuesday 10:00 too.

### Three ways to handle it with a real client

**Option A — Reserved block (recommended for pilots).**
They reserve a slice of the week that only LeadPilot fills — e.g. *"LeadPilot only books
17:00–19:00"* or *"only Tuesday and Thursday afternoons."* Configure hours to that window.
**Collision becomes impossible.** Zero extra work for them, honest, and it still proves the
value (those slots fill with after-hours traffic that was previously lost).

**Option B — Transcribe on arrival.**
Every booking alert arrives instantly with all details. Whoever handles the diary copies it
in — ~30 seconds per booking, and the alert is already on their phone. Fine at low volume;
annoying at high volume.

**Option C — Treat bookings as requests.**
Frame it as "reserva solicitada, te confirmamos" and they confirm each one. Softer promise,
no collision risk, but loses some of the "it books by itself" magic.

**Roadmap:** real Google Calendar sync is the top product priority after the first paying
clients. Say that honestly — *"la sincronización con Google Calendar es lo próximo que estoy
construyendo"* — don't pretend it exists.

### What to say when they ask "¿se conecta con mi agenda?"

> "Todavía no — LeadPilot lleva su propia agenda y te avisa al instante de cada reserva.
> Para la prueba, lo más limpio es que me reserves un bloque de horarios que solo gestione el
> asistente — por ejemplo las tardes de 17 a 19. Así no hay ningún cruce, y esos huecos se te
> llenan con gente que hoy se te está perdiendo. La sincronización con Google Calendar es
> justo lo próximo que estoy construyendo."

**Never claim it syncs. That's a promise you'd break in week one.**

---

## 6. How it's different from a bot that texts the receptionist

| | Relay bot | LeadPilot |
|---|---|---|
| Who answers | A human, eventually | The AI, instantly |
| Works at 2am / Sunday | Only if a human is awake | Yes |
| Who books | The human | The AI, into a real slot |
| Receptionist's role | In the loop, must respond | Informed after the fact |
| Wait time | Minutes to hours | Seconds |

LeadPilot **removes** the human from the response loop. That's the whole product. The
receptionist isn't replaced — they stop being the bottleneck for the after-hours messages
nobody was going to answer anyway.

---

## 7. What onboarding actually looks like

**Day 0 — the conversation (10 minutes).** Ask: services + how long each takes, opening
hours, what a "good" enquiry looks like, assistant name, and which slots LeadPilot may book
(see Option A above). That's it.

**Day 0/1 — setup (~30 min).** Pick the preset, run `npm run new-client`, deploy their own
private instance with its own database and dashboard password. Nothing shared between clients.

**Day 1 — install (2 minutes, their web person).** One line of code pasted into their site:
```html
<script src="https://SU-INSTANCIA.onrender.com/widget.js" defer></script>
```
Works on WordPress, Wix, Squarespace, anything. No redesign, no site changes. The chat bubble
appears in their brand colour.

**WhatsApp (Pro plan) — separate timeline.** Connecting their real WhatsApp number requires
Meta business verification: **days to weeks, outside anyone's control**. Promise web first,
WhatsApp when verified. *Never say "mañana."*

**Day 1 onward — what they do daily:**
- Get an instant alert (email / Telegram / WhatsApp) for every booking and every hot lead
- Open the dashboard when they want: every lead, every full conversation, upcoming bookings
- Copy bookings into their diary (unless using the reserved-block setup)
- Have a **pause button** — one click and the assistant stops answering, instantly

**Week 1 — check-in call.** Read the conversations together, tune the greeting or the
qualifying questions, add missing services. This is where the config gets sharpened with real data.

**Monthly — the results message.** Conversations handled, bookings made, and the number that
matters: **how many came in outside opening hours**. That's the invoice justifying itself.

---

## 8. What the client is responsible for

Short list — deliberately:
1. Give the correct services, durations, and hours (and say when they change)
2. Decide which slots LeadPilot may book
3. Put one line of code on their site (or give web access so you do it)
4. Actually look at the alerts and honour the bookings made
5. Say when the assistant gets something wrong — it gets fixed same day

They do **not** need to: train anything, learn a dashboard, change their software, or install an app.

---

## 9. The honest weak points (know them before a client finds them)

| Gap | Current answer |
|---|---|
| No calendar sync | Reserved-block workaround; sync is next on the roadmap |
| No reminders / no-show reduction | Roadmap item #2 — say it's coming, don't promise a date |
| No rescheduling flow by chat | They contact the business directly; it's in the confirmation email |
| Doesn't quote prices | Deliberate — pitch as protection, configurable if they insist |
| No Instagram DMs | Web + WhatsApp today; Instagram is roadmap #1 |
| WhatsApp needs Meta verification | Days–weeks; web can go live same day |
