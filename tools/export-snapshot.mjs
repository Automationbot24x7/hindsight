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

const receiptsAll = JSON.parse(fs.readFileSync("data/receipts.json", "utf8"));
state.receipts = receiptsAll.slice(0, 60);
state.memory.memory_count = Math.max(state.memory.memory_count, receiptsAll.length);
state.memory.pending = 0;

fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync("public")) fs.copyFileSync(path.join("public", f), path.join(OUT, f));
fs.writeFileSync(path.join(OUT, "snapshot.json"), JSON.stringify({ takenAt: new Date().toISOString(), state, prices, network, skin, briefings, memories: [...seen.values()] }));
fs.writeFileSync(path.join(OUT, "receipts.json"), JSON.stringify(receiptsAll, null, 1));
fs.writeFileSync(path.join(OUT, ".nojekyll"), "");
console.log(`snapshot: ${state.voices.length} voices, ${state.picks.length} calls, ${receiptsAll.length} receipts, ${seen.size} memory texts`);
