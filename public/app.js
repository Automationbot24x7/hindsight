const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const usd = (v) => (v == null ? "—" : "$" + (v >= 100 ? v.toLocaleString(undefined, { maximumFractionDigits: 0 }) : v >= 1 ? v.toFixed(3) : v.toPrecision(3)));
const ago = (iso) => {
  const d = (Date.parse(iso) - Date.now()) / 1000;
  const a = Math.abs(d), u = a < 90 ? [Math.round(a), "s"] : a < 5400 ? [Math.round(a / 60), "m"] : a < 129600 ? [Math.round(a / 3600), "h"] : [Math.round(a / 86400), "d"];
  return d > 0 ? `in ${u[0]}${u[1]}` : `${u[0]}${u[1]} ago`;
};
// Snapshot mode: when no server is behind the page (static hosting), the UI replays a
// snapshot of the live journal exported by tools/export-snapshot.mjs.
let SNAP = null;
async function detectSnapshot() {
  try {
    const r = await fetch("api/state");
    if (r.ok && (r.headers.get("content-type") || "").includes("json")) return;
  } catch {}
  SNAP = await (await fetch("snapshot.json")).json();
  SNAP.state.readonly = true;
}
function snapApi(path, body) {
  const [p, qs] = path.replace(/^\//, "").split("?");
  const q = new URLSearchParams(qs || "");
  if (p === "api/state") return SNAP.state;
  if (p === "api/prices") return SNAP.prices;
  if (p === "api/network") return SNAP.network;
  if (p === "api/skin") return { sui: SNAP.skin?.[q.get("address")] ?? null };
  if (p === "api/briefing") return SNAP.briefings?.[`${q.get("voice")}|${q.get("asset")}`] || { voice: q.get("voice"), asset: q.get("asset"), stats: null, memories: [] };
  if (p === "api/ask") {
    const words = String(body.q || "").toLowerCase().split(/\W+/).filter((w) => w.length > 2);
    const scored = SNAP.memories
      .map((m) => ({ ...m, s: words.filter((w) => m.text.toLowerCase().includes(w)).length }))
      .filter((m) => m.s)
      .sort((a, b) => b.s - a.s)
      .slice(0, 8)
      .map((m) => ({ ...m, distance: 1 - m.s / Math.max(words.length, 1) }));
    return { q: body.q, memories: scored };
  }
  throw new Error("Snapshot demo is read-only. Run the app locally for live mode.");
}
const api = async (path, body) => {
  if (SNAP) return snapApi(path, body);
  const r = await fetch(path.replace(/^\//, ""), body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {});
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || r.status);
  return j;
};

let prices = {};
let state = null;

// Skin in the game: SUI balance of a voice's linked wallet, read from Sui mainnet via Tatum.
const skin = new Map();
const skinText = (sui) => (sui == null ? "◎ wallet unreadable" : `◎ ${sui.toLocaleString(undefined, { maximumFractionDigits: 2 })} SUI on-chain`);
async function loadSkin(addresses) {
  for (const a of addresses) {
    if (skin.has(a)) continue;
    skin.set(a, null);
    try { skin.set(a, (await api(`/api/skin?address=${encodeURIComponent(a)}`)).sui); } catch {}
    document.querySelectorAll(`.skin[data-addr="${a}"]`).forEach((el) => (el.textContent = skinText(skin.get(a))));
  }
}

async function loadPrices() {
  try { prices = await api("/api/prices"); } catch {}
  const sel = $("#assetsel");
  if (!sel.options.length) for (const a of Object.keys(prices)) sel.add(new Option(a, a));
  $("#ticker").innerHTML = Object.entries(prices).map(([a, v]) => `<span class="tick"><b>${a}</b>${usd(v)}</span>`).join("");
  suggestTarget();
}

function suggestTarget() {
  const f = $("#pickform");
  const v = prices[f.asset.value];
  if (v && !f.target.dataset.touched) f.target.value = Number((v * (f.direction.value === "above" ? 1.002 : 0.998)).toPrecision(5));
}

async function loadState() {
  state = await api("/api/state");
  const m = state.memory;
  $("#memchip").classList.toggle("live", m.live);
  $("#memchip").classList.toggle("pulse", m.pending > 0);
  $("#memtext").textContent = `${m.memory_count} memories on ${m.live ? "Walrus mainnet" : "local mock"}${m.pending ? ` · ${m.pending} writing…` : ""}`;
  if (state.readonly) { $("#submitbtn").disabled = true; $("#rebuildbtn").disabled = true; $("#formhint").textContent = "Read-only public demo: run locally to log calls."; }
  if (SNAP) $("#memtext").textContent = `${m.memory_count} memories on Walrus mainnet`;

  $("#voicelist").innerHTML = state.voices.map((v) => `<option value="${esc(v.name)}">`).join("");
  $("#voices").innerHTML = state.voices.length
    ? state.voices.map((v) => `<div class="voice">
        <span class="name">${esc(v.name)}</span><span class="trust">${Math.round(v.trust * 100)}%</span>
        <div class="bar"><i style="width:${Math.round(v.trust * 100)}%"></i></div>
        <span class="meta">${v.suiAddress ? `<span class="skin" data-addr="${esc(v.suiAddress)}">${skin.has(v.suiAddress) ? skinText(skin.get(v.suiAddress)) : "◎ checking wallet…"}</span> · ` : ""}${v.hits}/${v.n} right · ${v.open} open${v.streak >= 2 ? ` · 🔥 ${v.streak} streak` : v.streak <= -2 ? ` · ❄ ${-v.streak} misses in a row` : ""}${v.learnedTrust != null ? ` · Walrus says ${Math.round(v.learnedTrust * 100)}%` : ""}</span>
      </div>`).join("")
    : `<p class="empty">No voices yet. Log a call to start tracking someone.</p>`;

  loadSkin(state.voices.filter((v) => v.suiAddress).map((v) => v.suiAddress));

  $("#consensus").innerHTML = state.consensus.length
    ? state.consensus.map((c) => {
        const raw = Math.round(c.rawBullish * 100), w = Math.round(c.weightedBullish * 100);
        const flip = (raw - 50) * (w - 50) < 0;
        return `<div class="cons"><b>${c.asset}</b> · ${c.picks} open call${c.picks > 1 ? "s" : ""}
          <div class="lbl"><span>Crowd</span><span>${raw}% bullish</span></div><div class="bar"><i style="width:${raw}%"></i></div>
          <div class="lbl"><span>Trust-weighted</span><span>${w}% bullish</span></div><div class="bar"><i style="width:${w}%"></i></div>
          ${flip ? `<div class="lbl" style="color:var(--warn)"><span>Memory flips the crowd's view</span></div>` : ""}</div>`;
      }).join("")
    : `<p class="empty">Open calls show up here, weighted by each voice's track record.</p>`;

  $("#picks").innerHTML = state.picks.length
    ? state.picks.map((p) => `<div class="pick">
        <span class="badge ${p.status}">${p.status === "open" ? "open" : p.status === "hit" ? "right" : "wrong"}</span>
        <span><b>${esc(p.voice)}</b>: ${p.asset} ${p.direction} ${usd(p.target)} · ${p.confidence}%${p.status !== "open" ? ` · closed ${usd(p.resolvedPrice)}` : ` · now ${usd(prices[p.asset])}`}</span>
        <span class="when">${p.status === "open" ? "resolves " + ago(p.deadline) : ago(p.resolvedAt)}</span></div>`).join("")
    : `<p class="empty">No calls yet.</p>`;

  $("#lessons").innerHTML = state.lessons.length
    ? state.lessons.map((l) => `<li>${esc(l.text)}</li>`).join("")
    : `<li class="empty" style="border:0;background:none">Lessons appear once patterns emerge (streaks, weak assets, overconfidence).</li>`;

  $("#receipts").innerHTML = state.receipts.length
    ? state.receipts.map((r) => `<li><span class="kind">${esc(r.kind)}</span><small>${ago(r.at)}</small><span style="grid-column:1/-1">${esc(r.text.replace(/^\[hindsight:\w+\]\s*/, ""))}</span><code style="grid-column:1/-1">blob ${esc(r.blob_id)}</code></li>`).join("")
    : `<li class="empty">Memory writes since this server started appear here with their Walrus blob IDs.</li>`;
}

async function loadNetwork() {
  try {
    const n = await api("/api/network");
    $("#netline").textContent = `Sui mainnet via Tatum RPC: epoch ${n.epoch} · checkpoint ${n.checkpoint.toLocaleString()} · reference gas ${n.referenceGasPrice} MIST`;
  } catch {}
}

let briefTimer;
function refreshBrief() {
  clearTimeout(briefTimer);
  briefTimer = setTimeout(async () => {
    const f = $("#pickform");
    const voice = f.voice.value.trim(), asset = f.asset.value;
    if (!voice || !asset) return ($("#brief").hidden = true);
    try {
      const b = await api(`/api/briefing?voice=${encodeURIComponent(voice)}&asset=${asset}`);
      renderBrief(b);
    } catch {}
  }, 400);
}

function renderBrief(b) {
  const el = $("#brief");
  const s = b.stats;
  let html = `<h3>Hindsight remembers ${esc(b.voice)}</h3>`;
  if (s && s.n) {
    const a = s.byAsset[b.asset];
    html += `<div>${s.hits}/${s.n} right overall · trust <b>${Math.round(s.trust * 100)}%</b>${a ? ` · on ${b.asset}: ${a.hits}/${a.n}` : ""}</div>`;
    if (s.trust < 0.4) html += `<div class="warn">⚠ Low trust: this voice has mostly been wrong.</div>`;
  } else html += `<div>No resolved calls yet for this voice.</div>`;
  if (b.memories.length) html += `<ul class="mems" style="margin-top:8px">${b.memories.slice(0, 3).map((m) => `<li>${esc(m.text.replace(/^\[hindsight:\w+\]\s*/, ""))}</li>`).join("")}</ul>`;
  el.innerHTML = html;
  el.hidden = false;
}

$("#pickform").addEventListener("input", (e) => {
  if (e.target.name === "confidence") $("#confval").textContent = e.target.value + "%";
  if (e.target.name === "target") e.target.dataset.touched = "1";
  if (e.target.name === "asset" || e.target.name === "direction") { delete $("#pickform").target.dataset.touched; suggestTarget(); }
  if (e.target.name === "voice" || e.target.name === "asset") refreshBrief();
});

$("#pickform").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target, btn = $("#submitbtn");
  btn.disabled = true;
  $("#formhint").textContent = "Logging and writing to Walrus…";
  try {
    const body = Object.fromEntries(new FormData(f));
    const r = await api("/api/picks", body);
    renderBrief(r.briefing);
    $("#formhint").textContent = `Logged. Resolves ${ago(r.pick.deadline)} against the live Tatum price.`;
    f.note.value = "";
    await loadState();
  } catch (err) {
    $("#formhint").textContent = "Error: " + err.message;
  } finally {
    btn.disabled = state?.readonly;
  }
});

$("#rebuildbtn").addEventListener("click", async () => {
  $("#rebuildhint").textContent = "Reading outcomes back from Walrus…";
  try {
    const r = await api("/api/rebuild", {});
    $("#rebuildhint").textContent = `Recovered ${r.outcomesFound} outcomes from ${r.memoriesScanned} memories → trust for ${r.voices.length} voices rebuilt from Walrus alone.`;
    await loadState();
  } catch (err) { $("#rebuildhint").textContent = "Error: " + err.message; }
});

$("#askform").addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = e.target.q.value.trim();
  if (!q) return;
  $("#answers").innerHTML = `<li class="empty">Recalling…</li>`;
  try {
    const r = await api("/api/ask", { q });
    $("#answers").innerHTML = r.memories.length
      ? r.memories.map((m) => `<li>${esc(m.text.replace(/^\[hindsight:\w+\]\s*/, ""))}<br><small>relevance ${(1 - m.distance).toFixed(2)} · blob ${esc(String(m.blob_id).slice(0, 14))}…</small></li>`).join("")
      : `<li class="empty">Nothing remembered about that yet.</li>`;
  } catch (err) { $("#answers").innerHTML = `<li class="empty">Error: ${esc(err.message)}</li>`; }
});

await detectSnapshot();
if (SNAP) {
  const banner = document.createElement("div");
  banner.className = "snapbar";
  banner.innerHTML = `Static snapshot of the live journal, taken ${esc(SNAP.takenAt.replace("T", " ").slice(0, 16))} UTC. Memories, blob IDs and outcomes are real; run it locally for live mode. <a href="blog.html">How it works</a>`;
  document.body.prepend(banner);
}
await loadPrices();
await loadState();
loadNetwork();
setInterval(loadState, 5000);
setInterval(loadPrices, 60000);
