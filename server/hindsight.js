// Hindsight core: picks, outcomes, credibility, and the memory loop.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { price } from "./tatum.js";

const DATA_DIR = process.env.DATA_DIR || path.resolve("data");
const STATE_FILE = path.join(DATA_DIR, "state.json");

const fmtUsd = (v) => (v >= 100 ? v.toFixed(0) : v >= 1 ? v.toFixed(3) : v.toPrecision(3));
const fmtTime = (iso) => iso.replace("T", " ").slice(0, 16) + " UTC";
const pct = (x) => Math.round(x * 100);

export function createHindsight(memory, log = console.log, analyst = null) {
  let state = { voices: {}, picks: [], lessons: [] };
  try {
    state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {}
  const save = () => {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 1));
  };

  // ---------- credibility ----------
  // Trust = Bayesian hit rate (Laplace prior), then nudged by calibration:
  // confident misses hurt more than hesitant ones.
  function voiceStats(name) {
    const done = state.picks.filter((p) => p.voice === name && p.status !== "open");
    const hits = done.filter((p) => p.status === "hit").length;
    let brier = 0;
    for (const p of done) {
      const c = p.confidence / 100;
      brier += (c - (p.status === "hit" ? 1 : 0)) ** 2;
    }
    const n = done.length;
    const hitRate = (hits + 1) / (n + 2);
    const calib = n ? 1 - brier / n : 0.75; // 1 = perfect, 0.75 = coin-flip at 50%
    const trust = Math.max(0.02, Math.min(0.98, hitRate * 0.7 + (calib - 0.25) * 0.4));
    const byAsset = {};
    for (const p of done) {
      byAsset[p.asset] ??= { hits: 0, n: 0 };
      byAsset[p.asset].n++;
      if (p.status === "hit") byAsset[p.asset].hits++;
    }
    let streak = 0;
    for (const p of [...done].sort((a, b) => b.resolvedAt.localeCompare(a.resolvedAt))) {
      const s = p.status === "hit" ? 1 : -1;
      if (streak === 0 || Math.sign(streak) === s) streak += s;
      else break;
    }
    return { hits, n, open: state.picks.filter((p) => p.voice === name && p.status === "open").length, trust, calib, byAsset, streak };
  }

  function voicesView() {
    return Object.values(state.voices)
      .map((v) => ({ ...v, ...voiceStats(v.name), learnedTrust: v.learnedTrust ?? null }))
      .sort((a, b) => b.trust - a.trust);
  }

  // Consensus on an asset from open picks: one vote per voice (their latest open call).
  // The crowd view counts every voice equally; the weighted view multiplies each vote by
  // trust, by the stated confidence, and by how much evidence backs that trust, so a voice
  // with no scored calls cannot outweigh one with a proven record.
  function consensus(asset) {
    const latest = new Map();
    for (const p of state.picks) if (p.asset === asset && p.status === "open" && !latest.has(p.voice)) latest.set(p.voice, p);
    const open = [...latest.values()];
    if (!open.length) return null;
    let up = 0, down = 0, rawUp = 0;
    for (const p of open) {
      const s = voiceStats(p.voice);
      const evidence = (s.n + 1) / (s.n + 3); // 1/3 with no record, approaching 1 with more scored calls
      const w = s.trust * (p.confidence / 100) * evidence;
      if (p.direction === "above") { up += w; rawUp++; } else down += w;
    }
    return { asset, voices: open.length, picks: state.picks.filter((p) => p.asset === asset && p.status === "open").length, rawBullish: rawUp / open.length, weightedBullish: up / (up + down || 1) };
  }

  // ---------- memory text ----------
  const pickLine = (p) =>
    `[hindsight:pick] Voice "${p.voice}" called ${p.asset} ${p.direction.toUpperCase()} $${fmtUsd(p.target)} by ${fmtTime(p.deadline)} with ${p.confidence}% confidence (price when called: $${fmtUsd(p.entryPrice)}).${p.note ? ` Reasoning: ${p.note}` : ""} id=${p.id}`;

  const outcomeLine = (p, s) =>
    `[hindsight:outcome] Voice "${p.voice}" was ${p.status === "hit" ? "RIGHT" : "WRONG"} on ${p.asset} ${p.direction.toUpperCase()} $${fmtUsd(p.target)} at ${p.confidence}% confidence (closed at $${fmtUsd(p.resolvedPrice)}). Record now ${s.hits}/${s.n} right, trust ${pct(s.trust)}%. id=${p.id}`;

  // ---------- lessons: patterns worth remembering ----------
  function deriveLessons(p, s) {
    // Each lesson is keyed (voice + pattern [+ asset]) so it is learned and remembered once.
    const out = [];
    const v = p.voice, a = s.byAsset[p.asset];
    const boldMisses = state.picks.filter((x) => x.voice === v && x.status === "miss" && x.confidence >= 85).length;
    if (s.streak <= -3) out.push([`cold:${v}`, `Voice "${v}" has been wrong ${-s.streak} times in a row. Fade or ignore their next call until they recover.`]);
    if (s.streak >= 3) out.push([`hot:${v}`, `Voice "${v}" is on a ${s.streak}-call hot streak. Their next call deserves extra weight.`]);
    if (a && a.n >= 3 && a.hits / a.n <= 0.34) out.push([`weak:${v}:${p.asset}`, `Voice "${v}" is weak on ${p.asset}: only ${a.hits}/${a.n} right. Discount their ${p.asset} calls.`]);
    if (a && a.n >= 3 && a.hits / a.n >= 0.75) out.push([`strong:${v}:${p.asset}`, `Voice "${v}" reads ${p.asset} well: ${a.hits}/${a.n} right. Trust their ${p.asset} calls.`]);
    if (p.status === "miss" && boldMisses >= 2) out.push([`bold:${v}`, `Voice "${v}" has missed ${boldMisses} calls made at 85%+ confidence. Their high-conviction calls are overconfident; discount their confidence.`]);
    if (s.n >= 4 && s.calib < 0.6) out.push([`calib:${v}`, `Voice "${v}" is poorly calibrated: confidence does not match results. Treat their confidence numbers with caution.`]);
    return out.filter(([key]) => !state.lessons.some((l) => l.key === key));
  }

  // ---------- actions ----------
  function addVoice({ name, suiAddress }) {
    name = String(name || "").trim().slice(0, 40);
    if (!name) throw new Error("name required");
    if (suiAddress && !/^0x[0-9a-fA-F]{1,64}$/.test(suiAddress)) throw new Error("invalid Sui address");
    const existing = state.voices[name];
    state.voices[name] = { name, suiAddress: suiAddress || existing?.suiAddress || null, createdAt: existing?.createdAt || new Date().toISOString() };
    save();
    if (!existing) memory.remember("voice", `[hindsight:voice] New voice "${name}" is being tracked${suiAddress ? `, Sui address ${suiAddress}` : ""}. Starting trust 50%.`);
    return state.voices[name];
  }

  async function briefing(voice, asset) {
    const q = `What happened before when voice "${voice}" called ${asset}? track record, lessons`;
    const memories = (await memory.recall(q, 6)).filter((m) => m.text.includes(`"${voice}"`) || m.text.includes(asset));
    const s = state.voices[voice] ? voiceStats(voice) : null;
    let verdict = null;
    if (analyst?.live && (memories.length || s?.n)) {
      try { verdict = await analyst.verdict(voice, asset, s, memories); } catch (e) { log(`[analyst] verdict failed: ${e.message}`); }
    }
    return { voice, asset, stats: s, memories, verdict };
  }

  async function addPick(input) {
    const voice = String(input.voice || "").trim().slice(0, 40);
    if (!voice) throw new Error("voice required");
    const sui = String(input.suiAddress || "").trim();
    if (!state.voices[voice] || (sui && state.voices[voice].suiAddress !== sui)) addVoice({ name: voice, suiAddress: sui || undefined });
    const asset = String(input.asset || "").toUpperCase();
    const direction = input.direction === "below" ? "below" : "above";
    const target = Number(input.target);
    const confidence = Math.max(50, Math.min(99, Math.round(Number(input.confidence) || 70)));
    const minutes = Math.max(1, Math.min(60 * 24 * 90, Number(input.deadlineMinutes) || 60));
    if (!asset || !(target > 0)) throw new Error("asset and positive target required");
    const entry = await price(asset);
    const p = {
      id: "p_" + crypto.randomBytes(4).toString("hex"),
      voice, asset, direction, target, confidence,
      note: String(input.note || "").slice(0, 200),
      entryPrice: entry.value,
      createdAt: new Date().toISOString(),
      deadline: new Date(Date.now() + minutes * 60_000).toISOString(),
      status: "open",
    };
    const brief = await briefing(voice, asset);
    state.picks.unshift(p);
    save();
    memory.remember("pick", pickLine(p));
    return { pick: p, briefing: brief };
  }

  async function resolveDue() {
    const due = state.picks.filter((p) => p.status === "open" && Date.parse(p.deadline) <= Date.now());
    for (const p of due) {
      try {
        const px = await price(p.asset);
        p.resolvedPrice = px.value;
        p.resolvedAt = new Date().toISOString();
        p.status = (p.direction === "above" ? px.value > p.target : px.value < p.target) ? "hit" : "miss";
        const s = voiceStats(p.voice);
        save();
        memory.remember("outcome", outcomeLine(p, s));
        for (const [key, text] of deriveLessons(p, s)) {
          state.lessons.unshift({ key, text, at: new Date().toISOString(), voice: p.voice, asset: p.asset });
          memory.remember("lesson", `[hindsight:lesson] ${text}`);
        }
        save();
        log(`[hindsight] resolved ${p.id} ${p.voice} ${p.asset} -> ${p.status}`);
        sinceReflect++;
      } catch (err) {
        log(`[hindsight] resolve ${p.id} failed: ${err.message}`);
      }
    }
    // Every few outcomes, the analyst reads the memory back and writes new insights to it.
    if (sinceReflect >= 4 && analyst?.live && !reflecting) reflect().catch((e) => log(`[analyst] reflect failed: ${e.message}`));
  }

  // ---------- reflection: memory reads itself and writes insights back ----------
  let sinceReflect = 0, reflecting = false;
  async function reflect() {
    if (!analyst?.live) throw new Error("Reflection needs the analyst (set an API key).");
    if (reflecting) throw new Error("A reflection is already running.");
    reflecting = true;
    try {
      const seen = new Map();
      for (const q of ["outcome RIGHT WRONG record trust confidence", "lesson pattern streak overconfident weak strong"]) {
        for (const m of await memory.recall(q, 40)) if (/\[hindsight:(outcome|lesson)\]/.test(m.text)) seen.set(m.blob_id, m);
      }
      const mems = [...seen.values()].slice(0, 60);
      if (mems.length < 4) throw new Error("Not enough outcomes in memory to reflect on yet.");
      const known = state.lessons.filter((l) => l.kind === "insight").map((l) => l.text);
      const { insights } = await analyst.reflect(mems, known);
      const added = [];
      for (const ins of (insights || []).slice(0, 3)) {
        const text = String(ins.text || "").replace(/\s*\[\d+\]/g, "").trim();
        if (!text) continue;
        const key = "insight:" + crypto.createHash("sha1").update(text.toLowerCase()).digest("hex").slice(0, 10);
        if (state.lessons.some((l) => l.key === key)) continue;
        const cites = (ins.cited || []).map((n) => mems[n - 1]?.blob_id).filter(Boolean);
        const l = { key, kind: "insight", text, cites, at: new Date().toISOString() };
        state.lessons.unshift(l);
        added.push(l);
        memory.remember("insight", `[hindsight:insight] ${text}`);
      }
      sinceReflect = 0;
      save();
      log(`[analyst] reflection read ${mems.length} memories, wrote ${added.length} insights`);
      return { memoriesRead: mems.length, insights: added };
    } finally {
      reflecting = false;
    }
  }

  // Rebuild credibility purely from what Walrus remembers: proves the memory is portable.
  async function rebuildFromMemory() {
    const mems = await memory.recall("hindsight outcome voice was RIGHT WRONG record trust", 100);
    const re = /\[hindsight:outcome\] Voice "([^"]+)" was (RIGHT|WRONG) on (\w+) (ABOVE|BELOW) \$([\d.]+) at (\d+)% confidence .*?id=(p_[0-9a-f]+)/;
    const seen = new Map();
    for (const m of mems) {
      const r = re.exec(m.text);
      if (r) seen.set(r[7], { voice: r[1], hit: r[2] === "RIGHT", asset: r[3], conf: Number(r[6]), blob_id: m.blob_id });
    }
    const agg = {};
    for (const o of seen.values()) {
      agg[o.voice] ??= { hits: 0, n: 0, brier: 0 };
      agg[o.voice].n++;
      if (o.hit) agg[o.voice].hits++;
      agg[o.voice].brier += (o.conf / 100 - (o.hit ? 1 : 0)) ** 2;
    }
    const result = [];
    for (const [voice, a] of Object.entries(agg)) {
      const hitRate = (a.hits + 1) / (a.n + 2);
      const calib = 1 - a.brier / a.n;
      const trust = Math.max(0.02, Math.min(0.98, hitRate * 0.7 + (calib - 0.25) * 0.4));
      if (!state.voices[voice]) state.voices[voice] = { name: voice, suiAddress: null, createdAt: new Date().toISOString() };
      state.voices[voice].learnedTrust = trust;
      result.push({ voice, hits: a.hits, n: a.n, trust });
    }
    save();
    return { outcomesFound: seen.size, memoriesScanned: mems.length, voices: result };
  }

  return {
    state: () => state,
    voicesView, consensus, addVoice, addPick, briefing, resolveDue, rebuildFromMemory, voiceStats, reflect,
  };
}
