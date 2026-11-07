// Hindsight server: tiny HTTP API + static UI. No framework.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createMemory } from "./memory.js";
import { createHindsight } from "./hindsight.js";
import { ASSETS, price, suiNetwork, suiBalance } from "./tatum.js";

// Load local keys file if present (never committed).
for (const f of ["Credentials/keys.env", ".env"]) {
  try {
    for (const line of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && m[2] && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
    }
  } catch {}
}

const PORT = Number(process.env.PORT || 8787);
const READONLY = process.env.PUBLIC_READONLY === "1";
const PUBLIC_DIR = path.resolve("public");

const logs = [];
const log = (...a) => {
  const line = new Date().toISOString().slice(11, 19) + " " + a.join(" ");
  logs.unshift(line);
  logs.length = Math.min(logs.length, 200);
  console.log(line);
};

const memory = createMemory(log);
const hs = createHindsight(memory, log);
log(`[boot] memory ${memory.live ? "LIVE on Walrus mainnet" : "MOCK (no keys yet)"}, namespace ${memory.namespace}`);

setInterval(() => hs.resolveDue(), 15_000);

const json = (res, code, body) => {
  res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};
const readBody = (req) =>
  new Promise((resolve, reject) => {
    let d = "";
    req.on("data", (c) => { d += c; if (d.length > 20_000) req.destroy(); });
    req.on("end", () => { try { resolve(d ? JSON.parse(d) : {}); } catch (e) { reject(e); } });
  });

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".webp": "image/webp" };

async function api(req, res, url) {
  const p = url.pathname;
  if (req.method === "GET" && p === "/api/state") {
    const st = hs.state();
    const consensus = ASSETS.map((a) => hs.consensus(a)).filter(Boolean);
    return json(res, 200, {
      readonly: READONLY,
      memory: await memory.stats(),
      receipts: memory.receipts.slice(0, 30),
      voices: hs.voicesView(),
      picks: st.picks.slice(0, 60),
      lessons: st.lessons.slice(0, 20),
      consensus,
    });
  }
  if (req.method === "GET" && p === "/api/prices") {
    const out = {};
    await Promise.all(ASSETS.map(async (a) => { try { out[a] = (await price(a)).value; } catch (e) { out[a] = null; } }));
    return json(res, 200, out);
  }
  if (req.method === "GET" && p === "/api/network") {
    try { return json(res, 200, await suiNetwork()); } catch (e) { return json(res, 502, { error: e.message }); }
  }
  if (req.method === "GET" && p === "/api/skin") {
    const addr = url.searchParams.get("address") || "";
    try { return json(res, 200, { address: addr, sui: await suiBalance(addr) }); } catch (e) { return json(res, 502, { error: e.message }); }
  }
  if (req.method === "GET" && p === "/api/briefing") {
    return json(res, 200, await hs.briefing(url.searchParams.get("voice") || "", (url.searchParams.get("asset") || "").toUpperCase()));
  }
  if (req.method === "POST" && p === "/api/ask") {
    const { q } = await readBody(req);
    return json(res, 200, { q, memories: await memory.recall(String(q || "").slice(0, 300), 8) });
  }
  if (req.method === "GET" && p === "/api/logs") return json(res, 200, logs.slice(0, 80));
  if (req.method === "GET" && p === "/healthz") return json(res, 200, { ok: true });

  if (READONLY && req.method === "POST") return json(res, 403, { error: "This public demo is read-only. Run it locally to log picks." });
  if (req.method === "POST" && p === "/api/voices") return json(res, 200, hs.addVoice(await readBody(req)));
  if (req.method === "POST" && p === "/api/picks") return json(res, 200, await hs.addPick(await readBody(req)));
  if (req.method === "POST" && p === "/api/rebuild") return json(res, 200, await hs.rebuildFromMemory());
  return json(res, 404, { error: "not found" });
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    try {
      if (url.pathname.startsWith("/api/") || url.pathname === "/healthz") return await api(req, res, url);
      let f = path.join(PUBLIC_DIR, decodeURIComponent(url.pathname));
      if (!f.startsWith(PUBLIC_DIR)) return json(res, 403, { error: "forbidden" });
      if (url.pathname === "/" || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(PUBLIC_DIR, "index.html");
      res.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream" });
      fs.createReadStream(f).pipe(res);
    } catch (e) {
      log(`[http] ${req.method} ${url.pathname} error: ${e.message}`);
      json(res, 400, { error: e.message });
    }
  })
  .listen(PORT, () => log(`[boot] Hindsight on http://localhost:${PORT}`));
