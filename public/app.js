const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const usd = (v) => (v == null ? "—" : "$" + (v >= 100 ? v.toLocaleString(undefined, { maximumFractionDigits: 0 }) : v >= 1 ? v.toFixed(3) : v.toPrecision(3)));
const pct = (x) => Math.round(x * 100) + "%";
const ago = (iso) => {
  const d = (Date.parse(iso) - Date.now()) / 1000;
  const a = Math.abs(d), u = a < 90 ? [Math.round(a), "s"] : a < 5400 ? [Math.round(a / 60), "m"] : a < 129600 ? [Math.round(a / 3600), "h"] : [Math.round(a / 86400), "d"];
  return d > 0 ? `in ${u[0]}${u[1]}` : `${u[0]}${u[1]} ago`;
};

// Small line icons (16px grid).
const ICONS = {
  check: '<path d="M3.5 8.5l3 3 6-7"/>',
  x: '<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>',
  clock: '<circle cx="8" cy="8" r="6"/><path d="M8 4.8V8l2.2 1.6"/>',
  alert: '<path d="M8 2.2l6 10.8H2z"/><path d="M8 6.5v3M8 11.2v.1"/>',
  spark: '<path d="M8 1.8l1.5 4.7 4.7 1.5-4.7 1.5L8 14.2l-1.5-4.7L1.8 8l4.7-1.5z"/>',
  shield: '<path d="M8 1.8l5 2v4c0 3-2.2 5.2-5 6.4-2.8-1.2-5-3.4-5-6.4v-4z"/><path d="M5.8 8.2l1.6 1.6 3-3.2"/>',
  info: '<circle cx="8" cy="8" r="6"/><path d="M8 7.2V11M8 5v.1"/>',
  ext: '<path d="M6.5 3.5h-3v9h9v-3M9 3.5h3.5V7M12.3 3.7L7.5 8.5"/>',
  db: '<ellipse cx="8" cy="4" rx="5" ry="2"/><path d="M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4M3 8c0 1.1 2.2 2 5 2s5-.9 5-2"/>',
};
const icon = (n, cls = "ic") => `<svg class="${cls}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`;
const coin = (a, cls = "coin") => (["BTC", "ETH", "SOL", "SUI"].includes(a) ? `<img class="${cls}" src="img/coins/${a}.svg" alt="">` : "");

// Illustrated avatars for the demo voices; anyone else gets an initials badge.
const AVATARS = { "Priya (desk analyst)": "priya", "@MoonBoyMax": "moonboy", "@OnchainOtter": "otter", "Me": "me", "Uncle Raj": "raj" };
const avatar = (name, size = 36) => {
  const a = AVATARS[name];
  if (a) return `<img class="av" src="img/${a}.webp" alt="" width="${size}" height="${size}" loading="lazy">`;
  const ini = String(name).replace(/^@/, "").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  return `<span class="av ini" style="width:${size}px;height:${size}px">${esc(ini)}</span>`;
};
// Memory text for display: drop the type tag, internal id and any stray citation numbers.
const memText = (t) => String(t).replace(/^\[hindsight:\w+\]\s*/, "").replace(/\s*id=\S+$/, "").replace(/\s*\[\d+\]/g, "");
const tier = (v) => (!v.n ? "new" : v.trust >= 0.7 ? "good" : v.trust < 0.4 ? "bad" : "mid");
const walruscan = (id) => `https://walruscan.com/mainnet/blob/${encodeURIComponent(id)}`;
const SUGGEST = ["Who keeps getting SUI wrong?", "Whose high-confidence calls can I trust?", "What did Hindsight learn about overconfidence?", "How has Priya done on BTC and ETH?"];

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
    const pre = SNAP.answers?.[String(body.q || "").trim().toLowerCase()];
    if (pre) return { q: body.q, memories: pre.memories, answer: pre.answer, recorded: true };
    const words = String(body.q || "").toLowerCase().split(/\W+/).filter((w) => w.length > 2);
    const scored = SNAP.memories
      .map((m) => ({ ...m, s: words.filter((w) => m.text.toLowerCase().includes(w)).length }))
      .filter((m) => m.s).sort((a, b) => b.s - a.s).slice(0, 8)
      .map((m) => ({ ...m, distance: 1 - m.s / Math.max(words.length, 1) }));
    return { q: body.q, memories: scored, answer: null, snapshotNote: true };
  }
  throw new Error("This hosted copy is read-only. Run the app locally for live mode.");
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
let pickFilter = "all", pickAll = false;

// Skin in the game: SUI balance of a voice's linked wallet, read from Sui mainnet via Tatum.
const skin = new Map();
const skinText = (sui) => (sui == null ? "wallet unreadable" : `${sui.toLocaleString(undefined, { maximumFractionDigits: 2 })} SUI on-chain`);
async function loadSkin(addresses) {
  for (const a of addresses) {
    if (skin.has(a)) continue;
    skin.set(a, null);
    try { skin.set(a, (await api(`/api/skin?address=${encodeURIComponent(a)}`)).sui); } catch {}
    document.querySelectorAll(`.wal[data-addr="${a}"]`).forEach((el) => (el.innerHTML = `${coin("SUI", "coin sm")} ${skinText(skin.get(a))}`));
  }
}

async function loadPrices() {
  try { prices = await api("/api/prices"); } catch {}
  const sel = $("#assetsel");
  if (!sel.options.length) for (const a of Object.keys(prices)) sel.add(new Option(a, a));
  $("#ticker").innerHTML = Object.entries(prices).map(([a, v]) => `<span class="tick">${coin(a)}<span class="sym">${a}</span><span class="price">${usd(v)}</span></span>`).join("");
  suggestTarget();
}

function suggestTarget() {
  const f = $("#pickform");
  const v = prices[f.asset.value];
  if (v && !f.target.dataset.touched) f.target.value = Number((v * (f.direction.value === "above" ? 1.002 : 0.998)).toPrecision(5));
}

function renderVoices() {
  $("#voicelist").innerHTML = state.voices.map((v) => `<option value="${esc(v.name)}">`).join("");
  $("#voices").innerHTML = state.voices.length
    ? state.voices.map((v) => {
        const tags = v.streak >= 2 ? `<span class="tag hot">${v.streak} right in a row</span> ` : v.streak <= -2 ? `<span class="tag cold">${-v.streak} wrong in a row</span> ` : "";
        const meta = [
          v.suiAddress ? `<span class="wal" data-addr="${esc(v.suiAddress)}">${coin("SUI", "coin sm")} ${skin.has(v.suiAddress) ? skinText(skin.get(v.suiAddress)) : "checking wallet…"}</span>` : "",
          v.learnedTrust != null ? `rebuilt from Walrus: ${pct(v.learnedTrust)}` : "",
          v.open ? `${v.open} open` : "",
        ].filter(Boolean).join(" · ");
        return `<div class="voice ${tier(v)}">
          <div class="who">${avatar(v.name, 38)}<div style="min-width:0"><span class="nm">${esc(v.name)}</span><span class="meta">${tags}${meta || (tags ? "" : "no linked wallet")}</span></div></div>
          <div class="rec">${v.n ? `<b>${v.hits}/${v.n}</b> right` : "no record"}</div>
          <div class="cal">${v.n ? pct(v.calib) : "—"}</div>
          <div class="trust"><div class="meter"><i style="width:${Math.round(v.trust * 100)}%"></i></div><b>${pct(v.trust)}</b></div>
        </div>`;
      }).join("")
    : `<p class="empty">No voices yet. Log a call to start tracking someone.</p>`;
  loadSkin(state.voices.filter((v) => v.suiAddress).map((v) => v.suiAddress));
}

function renderConsensus() {
  $("#consensus").innerHTML = state.consensus.length
    ? state.consensus.map((c) => {
        const raw = Math.round(c.rawBullish * 100), w = Math.round(c.weightedBullish * 100);
        const flip = (raw - 50) * (w - 50) < 0;
        const lean = (x) => (x > 50 ? "bullish" : x < 50 ? "bearish" : "split");
        return `<div class="cons${flip ? " flipped" : ""}">
          <div class="ch">${coin(c.asset, "coin lg")}<b>${c.asset}</b><span>${c.voices} voice${c.voices > 1 ? "s" : ""} with open calls</span></div>
          <div class="cbar"><div class="lb"><span>Crowd (one vote each)</span><b>${raw}% bullish</b></div><div class="split"><i style="width:${raw}%"></i></div></div>
          <div class="cbar"><div class="lb"><span>Weighted by track record</span><b>${w}% bullish</b></div><div class="split"><i style="width:${w}%"></i></div></div>
          <div class="legend"><span><i style="background:var(--good)"></i>bullish</span><span><i style="background:var(--bad)"></i>bearish</span></div>
          ${flip ? `<div class="flip">${icon("alert")}<span><b>Memory flips the crowd's view.</b> The crowd leans ${lean(raw)}; the voices with a proven record lean ${lean(w)}.</span></div>` : ""}
        </div>`;
      }).join("")
    : `<p class="empty">Open calls show up here, weighted by each voice's track record.</p>`;
}

function renderPicks() {
  const list = state.picks.filter((p) => pickFilter === "all" || (pickFilter === "open" ? p.status === "open" : p.status !== "open"));
  const shown = pickAll ? list : list.slice(0, 8);
  const label = { open: "Open", hit: "Right", miss: "Wrong" }, ic = { open: "clock", hit: "check", miss: "x" };
  $("#picks").innerHTML = shown.length
    ? shown.map((p) => `<div class="pick">
        <span class="pill ${p.status}">${icon(ic[p.status])}${label[p.status]}</span>
        <div class="what">${avatar(p.voice, 30)}<div class="t"><b>${esc(p.voice)}</b><span class="d">${coin(p.asset)} ${p.asset} closes ${p.direction} ${usd(p.target)} · ${p.confidence}% sure</span></div></div>
        <div class="when"><b>${p.status === "open" ? `now ${usd(prices[p.asset])}` : `closed ${usd(p.resolvedPrice)}`}</b>${p.status === "open" ? "resolves " + ago(p.deadline) : "scored " + ago(p.resolvedAt)}</div>
      </div>`).join("")
    : `<p class="empty">No calls here yet.</p>`;
  const more = $("#picksmore");
  more.hidden = list.length <= 8;
  more.textContent = pickAll ? "Show fewer" : `Show all ${list.length} calls`;
}

function renderLessons() {
  $("#lessons").innerHTML = state.lessons.length
    ? state.lessons.map((l) => l.kind === "insight"
        ? `<li class="insight"><div class="lh"><span class="pill insight">${icon("spark")}Insight</span><small>reflection over ${l.cites?.length || 0} memories</small></div>${esc(l.text)}</li>`
        : `<li><div class="lh"><span class="pill lesson">${icon("alert")}Lesson</span><small>${l.at ? ago(l.at) : ""}</small></div>${esc(l.text)}</li>`).join("")
    : `<li class="empty">Lessons appear once patterns emerge: streaks, weak assets, overconfidence.</li>`;
}

function renderReceipts() {
  $("#receipts").innerHTML = state.receipts.length
    ? state.receipts.map((r) => `<li>
        <div class="rh"><span class="pill kind">${esc(r.kind)}</span><small>${ago(r.at)}</small></div>
        <div class="tx">${esc(memText(r.text))}</div>
        <div class="bl">${icon("db")}<code title="${esc(r.blob_id)}">${esc(r.blob_id)}</code><a href="${walruscan(r.blob_id)}" target="_blank" rel="noopener">Verify ${icon("ext")}</a></div>
      </li>`).join("")
    : `<li class="empty">Memory writes appear here with their Walrus blob IDs.</li>`;
}

// Live numbers for the story section, from the same state the journal uses.
function renderStory() {
  const c = state.consensus.find((x) => (x.rawBullish - 0.5) * (x.weightedBullish - 0.5) < 0) || state.consensus[0];
  if (c) {
    const raw = Math.round(c.rawBullish * 100), w = Math.round(c.weightedBullish * 100);
    $("#story-cons").innerHTML = `<div><b class="${raw >= 50 ? "up" : "down"}">${raw}%</b><span>${coin(c.asset)} ${c.asset} crowd, bullish</span></div><div><b class="${w >= 50 ? "up" : "down"}">${w}%</b><span>weighted by track record</span></div>`;
  }
  const top = state.voices.filter((v) => v.n).sort((a, b) => b.trust - a.trust);
  const best = top[0], worst = top[top.length - 1];
  if (best && worst && best !== worst) $("#story-cons").innerHTML += `<div><b class="up">${pct(best.trust)}</b><span>trust: ${esc(best.name)}</span></div><div><b class="down">${pct(worst.trust)}</b><span>trust: ${esc(worst.name)}</span></div>`;
  const scored = state.picks.filter((p) => p.status !== "open").length;
  $("#story-mem").innerHTML = `<div><b>${state.memory.memory_count}</b><span>memories on Walrus mainnet</span></div><div><b>${scored}</b><span>outcomes rebuildable from Walrus</span></div><div><b>${state.lessons.filter((l) => l.kind === "insight").length}</b><span>insights from reflection</span></div>`;
}

function renderKpis() {
  const scored = state.picks.filter((p) => p.status !== "open");
  const insights = state.lessons.filter((l) => l.kind === "insight").length;
  const k = [
    [state.memory.memory_count, "memories on Walrus mainnet"],
    [scored.length, `calls scored by Tatum prices`],
    [state.voices.length, "voices tracked"],
    [state.lessons.length, `lessons and insights${insights ? ` (${insights} from reflection)` : ""}`],
  ];
  $("#kpis").innerHTML = k.map(([n, t]) => `<div class="kpi"><b>${n}</b><span>${t}</span></div>`).join("");
}

async function loadState() {
  try { state = await api("/api/state"); } catch { return; }
  const m = state.memory;
  $("#memchip").classList.toggle("live", m.live);
  $("#memchip").classList.toggle("pulse", m.pending > 0);
  $("#memtext").textContent = SNAP ? `${m.memory_count} memories on Walrus` : `${m.memory_count} memories on ${m.live ? "Walrus" : "local mock"}${m.pending ? ` · ${m.pending} writing…` : ""}`;
  $("#reflectbtn").hidden = !state.analyst && !SNAP;
  if (state.readonly) {
    for (const id of ["#submitbtn", "#rebuildbtn", "#reflectbtn"]) $(id).disabled = true;
    $("#formhint").textContent = "This hosted copy is read-only. Run it locally to log calls.";
  }
  renderKpis(); renderStory(); renderVoices(); renderConsensus(); renderPicks(); renderLessons(); renderReceipts();
}

async function loadNetwork() {
  try {
    const n = await api("/api/network");
    if (!SNAP) $("#tatumchip").classList.add("live");
    $("#netline").innerHTML = `${coin("SUI", "coin sm")} Sui mainnet via Tatum RPC · epoch <b>${n.epoch}</b> · checkpoint <b>${n.checkpoint.toLocaleString()}</b> · gas <b>${n.referenceGasPrice} MIST</b>`;
  } catch {}
}

let briefTimer;
function refreshBrief() {
  clearTimeout(briefTimer);
  briefTimer = setTimeout(async () => {
    const f = $("#pickform");
    const voice = f.voice.value.trim(), asset = f.asset.value;
    if (!voice || !asset) return ($("#brief").hidden = true);
    try { renderBrief(await api(`/api/briefing?voice=${encodeURIComponent(voice)}&asset=${asset}`)); } catch {}
  }, 400);
}

function renderBrief(b) {
  const el = $("#brief");
  const s = b.stats;
  let html = `<div class="bh">${avatar(b.voice, 34)}<div><b>What Hindsight remembers about ${esc(b.voice)}</b><span>recalled from Walrus Memory before you log</span></div></div>`;
  if (b.verdict) {
    const ic = { caution: "alert", trust: "shield", unknown: "info" }[b.verdict.tone] || "info";
    html += `<div class="verdict ${esc(b.verdict.tone)}">${icon(ic)}<div><small>Memory analyst</small>${esc(b.verdict.verdict.replace(/\s*\[\d+\]/g, ""))}</div></div>`;
  }
  if (s && s.n) {
    const a = s.byAsset[b.asset];
    html += `<div class="stats"><span><b>${s.hits}/${s.n}</b> right overall</span>${a ? `<span>${coin(b.asset)} <b>${a.hits}/${a.n}</b> on ${b.asset}</span>` : ""}<span>trust <b>${pct(s.trust)}</b></span></div>`;
  } else html += `<div class="stats"><span>No scored calls yet for this voice.</span></div>`;
  if (b.memories.length) html += `<ul class="recalled">${b.memories.slice(0, 3).map((m) => `<li>${esc(memText(m.text))}</li>`).join("")}</ul>`;
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
    const r = await api("/api/picks", Object.fromEntries(new FormData(f)));
    renderBrief(r.briefing);
    $("#formhint").textContent = `Logged at ${usd(r.pick.entryPrice)}. Scored ${ago(r.pick.deadline)} against the live Tatum price.`;
    f.note.value = "";
    await loadState();
  } catch (err) {
    $("#formhint").textContent = "Error: " + err.message;
  } finally {
    btn.disabled = state?.readonly;
  }
});

$("#picktabs").addEventListener("click", (e) => {
  const f = e.target.dataset?.f;
  if (!f) return;
  pickFilter = f; pickAll = false;
  document.querySelectorAll("#picktabs button").forEach((b) => b.classList.toggle("on", b.dataset.f === f));
  renderPicks();
});
$("#picksmore").addEventListener("click", () => { pickAll = !pickAll; renderPicks(); });

$("#rebuildbtn").addEventListener("click", async () => {
  $("#rebuildhint").textContent = "Reading outcomes back from Walrus…";
  try {
    const r = await api("/api/rebuild", {});
    $("#rebuildhint").textContent = `Recovered ${r.outcomesFound} outcomes from ${r.memoriesScanned} memories. Trust for ${r.voices.length} voices rebuilt from Walrus alone.`;
    await loadState();
  } catch (err) { $("#rebuildhint").textContent = "Error: " + err.message; }
});

$("#askform").addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = e.target.q.value.trim();
  if (!q) return;
  $("#answer").innerHTML = `<div class="answer muted">Recalling from Walrus…</div>`;
  $("#answers").innerHTML = "";
  try {
    const r = await api("/api/ask", { q });
    const cited = new Set(r.answer?.cited || []);
    $("#answer").innerHTML = r.answer
      ? `<div class="answer"><div class="al">${icon("spark")}Memory analyst${r.recorded ? " · recorded from the live app" : ""}</div>${esc(r.answer.answer).replace(/\[(\d+)\]/g, (m, n) => `<a class="cite" href="#mem${n}">${n}</a>`)}<span class="foot2">Answered only from the ${r.memories.length} memories recalled from Walrus below.</span></div>`
      : r.snapshotNote ? `<div class="answer muted">Plain-language answers run in the live app. Pick a suggested question for a recorded answer; below is a keyword match over the stored memories.</div>` : "";
    // Cited memories first; the rest stay one click away.
    const rows = r.memories.map((m, i) => ({ m, n: i + 1, c: cited.has(i + 1) }));
    const order = r.answer ? [...rows.filter((x) => x.c), ...rows.filter((x) => !x.c)] : rows;
    const keep = r.answer ? Math.max(rows.filter((x) => x.c).length, 3) : order.length;
    $("#answers").innerHTML = order.length
      ? order.map(({ m, n, c }, k) => `<li id="mem${n}" class="${c ? "cited" : ""}"${k >= keep ? " hidden" : ""}><span class="n">${n}</span><div>${esc(memText(m.text))}<small>${c ? "cited · " : ""}relevance ${(1 - m.distance).toFixed(2)} · blob <a href="${walruscan(m.blob_id)}" target="_blank" rel="noopener">${esc(String(m.blob_id).slice(0, 12))}…</a></small></div></li>`).join("")
        + (order.length > keep ? `<li class="moreli"><button type="button" class="more" id="srcmore">Show all ${order.length} recalled memories</button></li>` : "")
      : `<li class="empty">Nothing remembered about that yet.</li>`;
    $("#srcmore")?.addEventListener("click", (ev) => { document.querySelectorAll("#answers li[hidden]").forEach((li) => (li.hidden = false)); ev.target.closest("li").remove(); });
  } catch (err) { $("#answer").innerHTML = `<div class="answer muted">Error: ${esc(err.message)}</div>`; }
});

$("#suggest").innerHTML = SUGGEST.map((q) => `<button type="button" class="chip">${esc(q)}</button>`).join("");
$("#suggest").addEventListener("click", (e) => {
  if (!e.target.classList.contains("chip")) return;
  $("#askform").q.value = e.target.textContent;
  $("#askform").requestSubmit();
});

$("#reflectbtn").addEventListener("click", async () => {
  const btn = $("#reflectbtn");
  btn.disabled = true;
  $("#reflecthint").textContent = "Reading outcomes back from Walrus and looking for patterns…";
  try {
    const r = await api("/api/reflect", {});
    $("#reflecthint").textContent = r.insights.length
      ? `Read ${r.memoriesRead} memories and wrote ${r.insights.length} new insight${r.insights.length > 1 ? "s" : ""} back to Walrus.`
      : `Read ${r.memoriesRead} memories: nothing new to add yet.`;
    await loadState();
  } catch (err) { $("#reflecthint").textContent = "Error: " + err.message; }
  finally { btn.disabled = !!state?.readonly; }
});

await detectSnapshot();
if (SNAP) {
  const banner = document.createElement("div");
  banner.className = "snapbar";
  banner.innerHTML = `Hosted snapshot of the live journal, taken ${esc(SNAP.takenAt.replace("T", " ").slice(0, 16))} UTC. Calls, outcomes and Walrus blob IDs are real; run it locally to log calls. <a href="blog.html">How it works</a>`;
  document.body.prepend(banner);
}
await loadPrices();
await loadState();
loadNetwork();
// Open with an answer, so the memory analyst is visible without typing.
$("#askform").q.value = SUGGEST[0];
$("#askform").requestSubmit();
if (!SNAP) {
  // Poll gently, and not at all while the tab is hidden (saves API credits).
  setInterval(() => { if (!document.hidden) loadState(); }, 5000);
  setInterval(() => { if (!document.hidden) loadPrices(); }, 60000);
}
