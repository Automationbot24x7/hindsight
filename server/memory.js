// Walrus Memory wrapper: the long-term brain of Hindsight.
// Every pick, outcome and credibility change is written as a memory on Walrus mainnet
// through the managed relayer. Writes are queued and paced to stay under the
// per-delegate-key rate limit (6 remembers / minute).
import fs from "node:fs";
import path from "node:path";
import { MemWal, MemWalMock } from "@mysten-incubation/memwal";

const NAMESPACE = process.env.MEMWAL_NAMESPACE || "hindsight";
const WRITE_GAP_MS = 13_000;

export function createMemory(log = console.log) {
  const live = Boolean(process.env.MEMWAL_KEY && process.env.MEMWAL_ACCOUNT_ID);
  const client = live
    ? MemWal.create({
        key: process.env.MEMWAL_KEY,
        accountId: process.env.MEMWAL_ACCOUNT_ID,
        serverUrl: process.env.MEMWAL_SERVER_URL || "https://relayer.memory.walrus.xyz",
        namespace: NAMESPACE,
      })
    : MemWalMock.create({ namespace: NAMESPACE });

  const queue = [];
  let lastWrite = 0;
  let pumping = false;
  // Receipts of every successful write: { kind, text, blob_id, at }. Kept on disk as evidence.
  const RECEIPTS = path.join(process.env.DATA_DIR || path.resolve("data"), "receipts.json");
  let receipts = [];
  try { receipts = JSON.parse(fs.readFileSync(RECEIPTS, "utf8")); } catch {}
  const saveReceipts = () => {
    fs.mkdirSync(path.dirname(RECEIPTS), { recursive: true });
    fs.writeFileSync(RECEIPTS, JSON.stringify(receipts, null, 1));
  };

  async function pump() {
    if (pumping) return;
    pumping = true;
    try {
      while (queue.length) {
        const wait = lastWrite + WRITE_GAP_MS - Date.now();
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        const job = queue.shift();
        lastWrite = Date.now();
        try {
          const res = await client.rememberAndWait(job.text, NAMESPACE);
          const receipt = { kind: job.kind, text: job.text, blob_id: res.blob_id, at: new Date().toISOString() };
          receipts.unshift(receipt);
          if (live) saveReceipts();
          job.resolve(receipt);
          log(`[memory] stored ${job.kind} -> blob ${res.blob_id}`);
        } catch (err) {
          log(`[memory] write failed (${job.kind}): ${err.message}`);
          if (job.tries < 3 && /rate|429|503|timeout/i.test(String(err.message))) {
            job.tries++;
            queue.unshift(job);
            lastWrite = Date.now() + 20_000;
          } else job.resolve(null);
        }
      }
    } finally {
      pumping = false;
    }
  }

  /** Queue a memory write. Resolves with a receipt (or null on failure). */
  function remember(kind, text) {
    return new Promise((resolve) => {
      queue.push({ kind, text, resolve, tries: 0 });
      pump();
    });
  }

  /** Semantic recall over everything Hindsight has learned. */
  async function recall(query, limit = 8) {
    try {
      const r = await client.recall({ query, limit, namespace: NAMESPACE });
      return (r.results || []).map((m) => ({ text: m.text, blob_id: m.blob_id, distance: m.distance, created_at: m.created_at }));
    } catch (err) {
      log(`[memory] recall failed: ${err.message}`);
      return [];
    }
  }

  async function stats() {
    try {
      const ns = await client.listNamespaces();
      const mine = (ns.namespaces || []).find((n) => n.name === NAMESPACE);
      return { live, namespace: NAMESPACE, memory_count: Math.max(mine ? mine.memory_count : 0, receipts.length), pending: queue.length };
    } catch {
      return { live, namespace: NAMESPACE, memory_count: receipts.length, pending: queue.length };
    }
  }

  return { live, remember, recall, stats, receipts, namespace: NAMESPACE };
}
