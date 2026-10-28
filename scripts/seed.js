// seed.js — fill the database with demo data so you can PRACTICE: see a populated
// dashboard, test the Fleet Command Center, and rehearse a demo without waiting for
// real visitors. Sample leads are built from the ACTIVE config's services, so they fit
// whatever sector the deployment is set to.   Run:  npm run seed
const db = require("../src/db");
const schedule = require("../src/schedule");
const config = require("../src/config"); // honours BUSINESS_CONFIG_JSON, unlike the raw file

const services = (config.services || []).map(s => s.name);
const svc = i => services[i % services.length] || "Consulta";
const vocab = config.vocabulary || {};
const appointment = vocab.appointment || "cita";

// Neutral people, interests taken from the real service list.
const people = [
  { name: "María González",  phone: "+34 600 111 222", score: "hot",  qualified: true,  notes: "Quiere empezar en menos de dos semanas." },
  { name: "Diego Ramírez",   phone: "+34 622 333 444", score: "hot",  qualified: true,  notes: "Está comparando dos sitios antes de decidir." },
  { name: "Lucía Fernández", email: "lucia@example.com", score: "warm", qualified: true,  notes: "Lo necesita para una fecha concreta el mes que viene." },
  { name: "Carlos Ruiz",     phone: "+34 655 777 888", score: "warm", qualified: false, notes: "Flexible con los horarios, sin prisa." },
  { name: "Ana Torres",      email: "ana.t@example.com", score: "cold", qualified: false, notes: "Preguntó precios, aún mirando opciones." },
  { name: "",                                          score: "cold", qualified: false, notes: "Visitante anónimo, se fue antes de dejar contacto." },
];

const leads = people.map((p, i) => ({ ...p, interest: svc(i) }));

const sampleChats = [
  [
    `Hola, quería información sobre ${svc(0).toLowerCase()}`,
    "¡Hola! Claro que sí. ¿Es la primera vez que nos escribes?",
    "Sí, primera vez",
    `Perfecto. ¿Te viene bien que te reserve una ${appointment} esta semana?`,
  ],
  [
    "¿Cuánto cuesta?",
    `El equipo te confirma el precio exacto en la ${appointment}, porque depende de cada caso. ¿Quiero reservarte una?`,
    "Sí, por favor",
    "¡Genial! ¿Me dices tu nombre y un teléfono para confirmarla?",
  ],
];

function nextOpenDays(n) {
  const out = [];
  const d = new Date();
  const dur = Math.min(...(config.services || [{ duration: 30 }]).map(s => s.duration || 30));
  for (let i = 1; out.length < n && i < 21; i++) {
    const day = new Date(d.getTime() + i * 86400000).toISOString().slice(0, 10);
    const slots = schedule.slotsForDate(day, [], dur).slots || [];
    if (slots.length) out.push(slots[2] || slots[0]);
  }
  return out;
}

console.log(`Seeding demo data for "${config.businessName}" into`, process.env.DB_PATH || "data.sqlite", "…");

let sessionN = 0;
for (const l of leads) {
  const sessionId = "seed_" + (++sessionN) + "_" + Math.random().toString(36).slice(2, 8);
  const chat = sampleChats[sessionN % sampleChats.length];
  chat.forEach((c, i) => db.addMessage(sessionId, i % 2 === 0 ? "user" : "assistant", c));
  db.upsertLead(sessionId, l);
  // a little fake usage so the cost panel and fleet "API this month" aren't zero
  db.logUsage({ sessionId, inputTokens: 1800, outputTokens: 320, cacheWriteTokens: 1200, cacheReadTokens: 4800, costUsd: 0.012 });
}

const slots = nextOpenDays(2);
const appts = [
  { name: leads[0].name, contact: leads[0].phone, service: svc(0), startsAt: slots[0] },
  { name: leads[1].name, contact: leads[1].phone, service: svc(1), startsAt: slots[1] },
].filter(a => a.startsAt);

for (const a of appts) {
  const dur = (config.services || []).find(s => s.name === a.service)?.duration || 30;
  const r = db.bookAppointment({ sessionId: "seed_appt_" + Math.random().toString(36).slice(2, 8),
    name: a.name, contact: a.contact, service: a.service, startsAt: a.startsAt, durationMin: dur });
  console.log(r.ok ? `  ✓ reservado ${a.name} → ${a.startsAt}` : `  ✗ ${a.name}: ${r.reason}`);
}

console.log(`Done. ${leads.length} leads + ${appts.length} reservas. Open /dashboard to see them.`);
