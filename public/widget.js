/* widget.js — LeadPilot embeddable chat widget.
   Install on any website with one line:
   <script src="https://YOUR-DOMAIN/widget.js" defer></script>

   Compatibility notes:
   - Renders entirely inside a Shadow DOM, so the host site's CSS can never
     break the widget and the widget's CSS never leaks onto the host site.
   - All visible text comes from the server config, so it adapts per client/language.
   - Guards against being loaded twice and against blocked localStorage (private mode).
*/
(function () {
  // Don't initialise twice if the snippet is accidentally included more than once.
  if (window.__leadpilotLoaded) return;
  window.__leadpilotLoaded = true;

  const SCRIPT = document.currentScript;
  const BASE = SCRIPT && SCRIPT.src ? new URL(SCRIPT.src).origin : "";
  const SID_KEY = "lp_session";

  // localStorage can throw (Safari private mode, embedded contexts). Fall back to memory.
  let memSid = null;
  function sid() {
    try {
      let s = localStorage.getItem(SID_KEY);
      if (!s) {
        s = newSid();
        localStorage.setItem(SID_KEY, s);
      }
      return s;
    } catch {
      return (memSid = memSid || newSid());
    }
  }
  function newSid() {
    return "s_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  async function init() {
    let cfg;
    try {
      cfg = await (await fetch(BASE + "/api/widget-config")).json();
    } catch {
      return; // server unreachable → fail silently, never break the host page
    }

    const accent = cfg.accentColor || "#0E5E59";
    const ui = cfg.ui || {};
    const side = cfg.position === "left" ? "left" : "right";
    const statusText = ui.statusText || "Online";
    const placeholder = ui.placeholder || "Type your message…";
    const sendLabel = ui.sendLabel || "Send";
    const footer = ui.footer || "⚡ Powered by LeadPilot";
    // AI-transparency disclosure (EU AI Act art. 50: users must know they're talking
    // to an AI from the first interaction). Shown unless explicitly overridden.
    const aiLabel = ui.aiLabel !== undefined ? ui.aiLabel : "Asistente virtual con IA";
    const privacyUrl = cfg.privacyUrl || "";
    const privacyText = ui.privacyText || "Privacy";

    // ---- isolated render target: a host element + shadow root ----
    const host = document.createElement("div");
    host.id = "leadpilot-widget";
    host.style.all = "initial"; // protect the host node itself from inherited styles
    const root = host.attachShadow({ mode: "open" });
    document.body.appendChild(host);

    const style = document.createElement("style");
    style.textContent = `
      :host{ all: initial; }
      *{ box-sizing:border-box; }
      .lp-bubble{position:fixed;bottom:24px;${side}:24px;width:60px;height:60px;border-radius:50%;
        background:${accent};color:#fff;border:none;cursor:pointer;z-index:2147483000;
        box-shadow:0 8px 24px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;
        transition:transform .15s ease}
      .lp-bubble:hover{transform:scale(1.06)}
      .lp-bubble svg{width:28px;height:28px}
      .lp-panel{position:fixed;bottom:96px;${side}:24px;width:360px;max-width:calc(100vw - 32px);
        height:520px;max-height:calc(100vh - 130px);background:#fff;border-radius:16px;z-index:2147483000;
        box-shadow:0 16px 48px rgba(0,0,0,.28);display:none;flex-direction:column;overflow:hidden;
        font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
      .lp-panel.open{display:flex}
      .lp-head{background:${accent};color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px}
      .lp-head .lp-dot{width:9px;height:9px;border-radius:50%;background:#6BF09C;flex:none}
      .lp-head b{font-size:15px}
      .lp-head small{display:block;opacity:.85;font-size:11.5px;font-weight:400}
      .lp-msgs{flex:1;overflow-y:auto;padding:14px;background:#F4F6F7;display:flex;flex-direction:column;gap:8px}
      .lp-m{max-width:82%;padding:9px 13px;border-radius:14px;font-size:13.5px;line-height:1.45;
        white-space:pre-wrap;word-wrap:break-word}
      .lp-m.bot{background:#fff;color:#1c1c1c;border-bottom-left-radius:4px;align-self:flex-start;
        box-shadow:0 1px 2px rgba(0,0,0,.07)}
      .lp-m.me{background:${accent};color:#fff;border-bottom-right-radius:4px;align-self:flex-end}
      .lp-typing{align-self:flex-start;background:#fff;border-radius:14px;padding:11px 14px;
        box-shadow:0 1px 2px rgba(0,0,0,.07)}
      .lp-typing i{display:inline-block;width:6px;height:6px;border-radius:50%;background:#9aa5ad;
        margin:0 1.5px;animation:lpB 1.2s infinite}
      .lp-typing i:nth-child(2){animation-delay:.15s}.lp-typing i:nth-child(3){animation-delay:.3s}
      @keyframes lpB{0%,60%,100%{transform:translateY(0)}30%{transform:translateY(-4px)}}
      .lp-input{display:flex;border-top:1px solid #e7eaec;background:#fff}
      .lp-input input{flex:1;border:none;outline:none;padding:14px;font-size:13.5px;color:#1c1c1c;background:#fff}
      .lp-input button{border:none;background:none;color:${accent};font-weight:700;cursor:pointer;
        padding:0 16px;font-size:13.5px}
      .lp-foot{text-align:center;font-size:10px;color:#9aa5ad;padding:4px 8px 7px;background:#fff}
      .lp-foot a{color:#9aa5ad;text-decoration:underline}
      @media (prefers-reduced-motion: reduce){.lp-typing i{animation:none}.lp-bubble{transition:none}}
    `;
    root.appendChild(style);

    const bubble = document.createElement("button");
    bubble.className = "lp-bubble";
    bubble.setAttribute("aria-label", "Open chat");
    // LeadPilot brand mark (bubble + check), inverted for the accent background.
    bubble.innerHTML = `<svg viewBox="0 0 64 64" fill="none"><path d="M32 9C18.7 9 8 17.9 8 28.9c0 6.6 3.9 12.4 9.9 16L14.5 56 27 48.4c1.6.3 3.3.4 5 .4 13.3 0 24-8.9 24-19.9S45.3 9 32 9z" fill="#fff"/><path d="M22.5 30.5l7 7L42 25" stroke="${accent}" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

    const panel = document.createElement("div");
    panel.className = "lp-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", (cfg.agentName || "Chat") + " · " + (cfg.businessName || ""));
    const footParts = [aiLabel && escapeHtml(aiLabel), escapeHtml(footer)].filter(Boolean).join(" · ");
    const footHtml = privacyUrl
      ? `${footParts} · <a href="${encodeURI(privacyUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(privacyText)}</a>`
      : footParts;
    panel.innerHTML = `
      <div class="lp-head"><span class="lp-dot"></span>
        <div><b></b><small></small></div>
      </div>
      <div class="lp-msgs"></div>
      <div class="lp-input">
        <input type="text" aria-label="Message"/>
        <button type="button"></button>
      </div>
      <div class="lp-foot">${footHtml}</div>`;

    // Set text via textContent (never innerHTML) so client config can't inject markup.
    panel.querySelector(".lp-head b").textContent = `${cfg.agentName || ""}${cfg.businessName ? " · " + cfg.businessName : ""}`;
    panel.querySelector(".lp-head small").textContent = statusText;
    const input = panel.querySelector("input");
    input.setAttribute("placeholder", placeholder);
    const send = panel.querySelector(".lp-input button");
    send.textContent = sendLabel;

    root.appendChild(bubble);
    root.appendChild(panel);

    const msgs = panel.querySelector(".lp-msgs");

    function add(role, text) {
      const d = document.createElement("div");
      d.className = "lp-m " + (role === "me" ? "me" : "bot");
      d.textContent = text;
      msgs.appendChild(d);
      msgs.scrollTop = msgs.scrollHeight;
    }

    let greeted = false;
    bubble.addEventListener("click", () => {
      panel.classList.toggle("open");
      if (panel.classList.contains("open")) {
        if (!greeted) { if (cfg.greeting) add("bot", cfg.greeting); greeted = true; }
        input.focus();
      }
    });

    let busy = false;
    async function submit() {
      const text = input.value.trim();
      if (!text || busy) return;
      busy = true;
      input.value = "";
      add("me", text);

      const t = document.createElement("div");
      t.className = "lp-typing";
      t.innerHTML = "<i></i><i></i><i></i>";
      msgs.appendChild(t);
      msgs.scrollTop = msgs.scrollHeight;

      try {
        const r = await fetch(BASE + "/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: sid(), message: text }),
        });
        const data = await r.json();
        t.remove();
        add("bot", data.reply || data.error || "…");
      } catch {
        t.remove();
        add("bot", ui.errorText || "Connection error. Please try again.");
      }
      busy = false;
      input.focus();
    }

    send.addEventListener("click", submit);
    input.addEventListener("keydown", e => { if (e.key === "Enter") submit(); });
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else init();
})();
