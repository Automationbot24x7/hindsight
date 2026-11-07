// Export a static snapshot of the running journal into docs/ (served by GitHub Pages).
// It copies the UI and writes snapshot.json with state, prices, network, wallet balances,
// pre-call briefings and the recalled memory texts, all taken from the live server.
// Usage: node tools/export-snapshot.mjs [baseUrl]
import fs from "node:fs";
import path from "node:path";

const BASE = process.argv[2] || "http://localhost:8787";
const OUT = path.resolve("docs");
const get = async (p) => (await fetch(BASE + p)).json();
const post = async (p, body) => (await fetch(BASE + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json();

const state = await get("/api/state");
const prices = await get("/api/prices");
const network = await get("/api/network");

const skin = {};
for (const v of state.voices) if (v.suiAddress) skin[v.suiAddress] = (await get(`/api/skin?address=${v.suiAddress}`)).sui;

const briefings = {};
for (const v of state.voices) for (const a of Object.keys(prices)) {
  briefings[`${v.name}|${a}`] = await get(`/api/briefing?voice=${encodeURIComponent(v.name)}&asset=${a}`);
}

// Memory texts for the static "Ask Hindsight": recalled from Walrus, plus local receipts.
const seen = new Map();
for (const q of ["outcome RIGHT WRONG record trust", "lesson pattern streak overconfident", "voice called ABOVE BELOW confidence", "new voice tracked Sui address"]) {
  for (const m of (await post("/api/ask", { q })).memories) seen.set(m.blob_id, { text: m.text, blob_id: m.blob_id });
}
for (const r of state.receipts) if (!seen.has(r.blob_id)) seen.set(r.blob_id, { text: r.text, blob_id: r.blob_id });

// Recorded analyst answers for the suggested questions, so the static demo can show them.
const SUGGEST = ["Who keeps getting SUI wrong?", "Whose high-confidence calls can I trust?", "What did Hindsight learn about overconfidence?", "How has Priya done on BTC and ETH?"];
const answers = {};
for (const q of SUGGEST) {
  const r = await post("/api/ask", { q });
  if (r.answer) answers[q.toLowerCase()] = { answer: r.answer, memories: r.memories };
}

const receiptsAll = JSON.parse(fs.readFileSync("data/receipts.json", "utf8"));
state.receipts = receiptsAll.slice(0, 60);
state.memory.memory_count = Math.max(state.memory.memory_count, receiptsAll.length);
state.memory.pending = 0;

fs.mkdirSync(OUT, { recursive: true });
fs.cpSync("public", OUT, { recursive: true });
// Fill the blog's "how it learned" section with the real numbers from this run.
const HABITS = {
  "Priya (desk analyst)": "Careful analyst, modest targets, honest confidence",
  "@MoonBoyMax": "Loud and always bullish, always 90%+ sure",
  "@OnchainOtter": "Active Sui wallet, reads SUI flows",
  "Me": "Gut feelings",
  "Uncle Raj": "Group-chat tips",
};
const escH = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const rows = state.voices
  .filter((v) => v.n > 0)
  .map((v) => `<tr><td>${escH(v.name)}</td><td>${escH(HABITS[v.name] || "")}</td><td class="num">${v.hits}/${v.n} right</td><td class="num">${Math.round(v.trust * 100)}%</td></tr>`)
  .join("\n");
const quotes = state.lessons.slice().reverse().map((l) => `<blockquote>${escH(l.text)}</blockquote>`).join("\n");
const blog = fs.readFileSync(path.join(OUT, "blog.html"), "utf8").replace("<!--LEARNED_ROWS-->", rows).replace("<!--LESSON_QUOTES-->", quotes);
fs.writeFileSync(path.join(OUT, "blog.html"), blog);

fs.writeFileSync(path.join(OUT, "snapshot.json"), JSON.stringify({ takenAt: new Date().toISOString(), state, prices, network, skin, briefings, answers, memories: [...seen.values()] }));
fs.writeFileSync(path.join(OUT, "receipts.json"), JSON.stringify(receiptsAll, null, 1));
fs.writeFileSync(path.join(OUT, ".nojekyll"), "");
console.log(`snapshot: ${state.voices.length} voices, ${state.picks.length} calls, ${receiptsAll.length} receipts, ${seen.size} memory texts`);
