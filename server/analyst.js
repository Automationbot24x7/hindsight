// Memory analyst: turns what Walrus Memory recalls into plain-language answers, pre-call
// verdicts and reflections. It only ever reasons over recalled memories (each one carries
// its Walrus blob ID), so every claim can be traced back to a blob on mainnet.
// Optional: without an API key Hindsight still works, Ask just lists the raw memories.
import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";

const MODEL = process.env.ANALYST_MODEL || "claude-opus-5-5";
const DAILY_CAP_USD = Number(process.env.ANALYST_DAILY_CAP_USD || 5);
const PRICE = { in: 4 / 1e6, out: 20 / 1e6 }; // $/token for the default model

function loadKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  try { return fs.readFileSync(process.env.ANTHROPIC_KEY_FILE, "utf8").trim(); } catch { return null; }
}

const SYSTEM = `You are the analyst inside Hindsight, a journal that scores market calls ("SUI closes above $0.93 within an hour, 90% sure") and remembers every call, outcome and lesson on Walrus Memory.
You only know what the numbered memories in each request say. Never invent calls, prices, records or people. If the memories do not answer the question, say so plainly.
In outcome memories, "Record now X/Y right" is the voice's overall record across all assets, not their record on the asset of that call; count per-asset results yourself from the individual outcomes.
Cite memories inline with their numbers in square brackets, like [2] or [1][4]. Be concrete: names, records, confidence levels, prices.
Write for a non-expert: short sentences, no hype, no financial advice. Describing who has been right or wrong in the past is fine; telling someone to buy or sell is not.`;

export function createAnalyst(log = console.log) {
  const key = loadKey();
  const client = key ? new Anthropic({ apiKey: key }) : null;
  let day = "", spent = 0;
  const cache = new Map();

  async function call(user, schema, effort = "low") {
    if (!client) throw new Error("analyst offline");
    const today = new Date().toISOString().slice(0, 10);
    if (today !== day) { day = today; spent = 0; }
    if (spent >= DAILY_CAP_USD) throw new Error("analyst daily budget reached");
    const t0 = Date.now();
    const r = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      output_config: { effort, format: { type: "json_schema", schema } },
      messages: [{ role: "user", content: user }],
    });
    const usd = (r.usage?.input_tokens || 0) * PRICE.in + (r.usage?.output_tokens || 0) * PRICE.out;
    spent += usd;
    log(`[analyst] ${Date.now() - t0} ms, ~$${usd.toFixed(4)} (today $${spent.toFixed(3)})`);
    if (r.stop_reason === "refusal") throw new Error("analyst declined");
    const text = r.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    return JSON.parse(text);
  }

  const numbered = (memories) =>
    memories.map((m, i) => `[${i + 1}] ${m.text.replace(/\s+id=\S+$/, "").replace(/\s*\[\d+\]/g, "")}`).join("\n");

  // Ask Hindsight: answer a free-text question from recalled memories.
  async function answer(q, memories) {
    const k = "ask|" + q.toLowerCase().trim() + "|" + memories.map((m) => m.blob_id).join(",");
    if (cache.has(k)) return cache.get(k);
    const out = await call(
      `Question: ${q}\n\nMemories recalled from Walrus for this question:\n${numbered(memories)}\n\nAnswer in at most 70 words.`,
      { type: "object", additionalProperties: false, required: ["answer", "cited"],
        properties: { answer: { type: "string" }, cited: { type: "array", items: { type: "integer" } } } },
    );
    const res = { answer: out.answer, cited: (out.cited || []).filter((n) => n >= 1 && n <= memories.length) };
    cache.set(k, res);
    return res;
  }

  // Pre-call verdict: one line on how much weight this voice's next call deserves.
  async function verdict(voice, asset, stats, memories) {
    const k = `brief|${voice}|${asset}|${stats?.n || 0}|${memories.length}`;
    if (cache.has(k)) return cache.get(k);
    const record = stats && stats.n
      ? `${stats.hits}/${stats.n} right overall, trust ${Math.round(stats.trust * 100)}%, calibration ${Math.round(stats.calib * 100)}%` + (stats.byAsset?.[asset] ? `, on ${asset} ${stats.byAsset[asset].hits}/${stats.byAsset[asset].n}` : "")
      : "no resolved calls yet";
    const out = await call(
      `The user is about to log a new ${asset} call from "${voice}". Their scored record: ${record}.\n\nMemories recalled from Walrus:\n${numbered(memories)}\n\nGive a one-sentence verdict (at most 30 words) on how much weight this voice's next ${asset} call deserves, and a tone: "trust", "caution" or "unknown".`,
      { type: "object", additionalProperties: false, required: ["verdict", "tone"],
        properties: { verdict: { type: "string" }, tone: { type: "string", enum: ["trust", "caution", "unknown"] } } },
    );
    cache.set(k, out);
    return out;
  }

  // Reflection: read outcomes and lessons back from Walrus and distil new insights
  // that the rule-based lessons cannot see (cross-voice and cross-asset patterns).
  async function reflect(memories, known) {
    return call(
      `Here are outcome and lesson memories recalled from Walrus:\n${numbered(memories)}\n\nInsights already stored (do not repeat these):\n${known.map((t) => "- " + t).join("\n") || "- none"}\n\nWrite up to 3 new insights about patterns across voices, assets, confidence levels and timing. Each insight is one sentence (at most 35 words), names the voices involved, and lists the memory numbers it rests on in \"cited\" (not inside the text). Skip anything the memories do not clearly support; return fewer insights if needed.`,
      { type: "object", additionalProperties: false, required: ["insights"],
        properties: { insights: { type: "array", items: { type: "object", additionalProperties: false, required: ["text", "cited"],
          properties: { text: { type: "string" }, cited: { type: "array", items: { type: "integer" } } } } } } },
      "medium",
    );
  }

  return { live: Boolean(client), model: MODEL, answer, verdict, reflect };
}
