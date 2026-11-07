// Seed a demo journal: four voices with different habits make real calls against live
// Tatum prices. Short deadlines resolve within minutes, so outcomes, trust scores and
// lessons appear on Walrus during the demo. Usage: node tools/seed-demo.mjs [baseUrl]
const BASE = process.argv[2] || "http://localhost:8787";
const post = async (path, body) => {
  const r = await fetch(BASE + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error);
  return j;
};
const prices = await (await fetch(BASE + "/api/prices")).json();
const t = (asset, mult) => Number((prices[asset] * mult).toPrecision(6));

const OTTER = "0x4440be690d52c31e71dc38d7f5a4b7f8fe98187658098101fb238d39745482fe";

const calls = [
  // Priya: careful desk analyst, modest targets, honest confidence.
  { voice: "Priya (desk analyst)", asset: "BTC", direction: "above", target: t("BTC", 0.994), deadlineMinutes: 3, confidence: 75, note: "Bid wall holding, no reason to break down this hour." },
  { voice: "Priya (desk analyst)", asset: "ETH", direction: "below", target: t("ETH", 1.006), deadlineMinutes: 4, confidence: 70, note: "Range-bound, fading any spike." },
  { voice: "Priya (desk analyst)", asset: "SOL", direction: "above", target: t("SOL", 1.012), deadlineMinutes: 4, confidence: 60, note: "Speculative breakout, small size." },
  { voice: "Priya (desk analyst)", asset: "SUI", direction: "below", target: t("SUI", 1.01), deadlineMinutes: 5, confidence: 72, note: "Resistance overhead." },
  // MoonBoyMax: loud, always bullish, always 90%+.
  { voice: "@MoonBoyMax", asset: "SUI", direction: "above", target: t("SUI", 1.05), deadlineMinutes: 3, confidence: 95, note: "SUI to the moon, send it!!" },
  { voice: "@MoonBoyMax", asset: "SOL", direction: "above", target: t("SOL", 1.04), deadlineMinutes: 3, confidence: 92, note: "Breakout confirmed, trust me." },
  { voice: "@MoonBoyMax", asset: "SUI", direction: "above", target: t("SUI", 1.06), deadlineMinutes: 4, confidence: 97, note: "Whales loading up." },
  { voice: "@MoonBoyMax", asset: "BTC", direction: "above", target: t("BTC", 1.025), deadlineMinutes: 5, confidence: 90, note: "Supercycle." },
  { voice: "@MoonBoyMax", asset: "SUI", direction: "above", target: t("SUI", 1.07), deadlineMinutes: 6, confidence: 99, note: "Last chance to buy under a dollar." },
  // OnchainOtter: an active Sui wallet, reads SUI well.
  { voice: "@OnchainOtter", suiAddress: OTTER, asset: "SUI", direction: "below", target: t("SUI", 1.015), deadlineMinutes: 3, confidence: 80, note: "On-chain flows look flat." },
  { voice: "@OnchainOtter", suiAddress: OTTER, asset: "SUI", direction: "above", target: t("SUI", 0.985), deadlineMinutes: 4, confidence: 78, note: "Support at the epoch open." },
  { voice: "@OnchainOtter", suiAddress: OTTER, asset: "SUI", direction: "below", target: t("SUI", 1.02), deadlineMinutes: 6, confidence: 82, note: "No new liquidity this checkpoint range." },
  // Me: a coin-flipper learning the ropes.
  { voice: "Me", asset: "ETH", direction: "above", target: t("ETH", 1.001), deadlineMinutes: 3, confidence: 65, note: "Gut feeling." },
  { voice: "Me", asset: "BTC", direction: "below", target: t("BTC", 0.999), deadlineMinutes: 5, confidence: 60, note: "Feels toppy." },
  // Longer calls that stay open, so the consensus panel has something to weigh.
  { voice: "@MoonBoyMax", asset: "SUI", direction: "above", target: t("SUI", 1.15), deadlineMinutes: 1440, confidence: 98, note: "Tomorrow we fly." },
  { voice: "Me", asset: "SUI", direction: "above", target: t("SUI", 1.03), deadlineMinutes: 1440, confidence: 60, note: "Following the hype." },
  { voice: "Priya (desk analyst)", asset: "SUI", direction: "below", target: t("SUI", 1.03), deadlineMinutes: 1440, confidence: 70, note: "No catalyst this week." },
  { voice: "@OnchainOtter", suiAddress: OTTER, asset: "SUI", direction: "below", target: t("SUI", 1.03), deadlineMinutes: 1440, confidence: 80, note: "Flows still flat." },
  { voice: "@MoonBoyMax", asset: "BTC", direction: "above", target: t("BTC", 1.08), deadlineMinutes: 1440, confidence: 95, note: "Number go up." },
  { voice: "Priya (desk analyst)", asset: "BTC", direction: "above", target: t("BTC", 0.97), deadlineMinutes: 1440, confidence: 70, note: "Trend intact." },
];

for (const c of calls) {
  const r = await post("/api/picks", c);
  console.log(`logged ${r.pick.id} ${c.voice} ${c.asset} ${c.direction} ${c.target} (${c.deadlineMinutes}m)`);
  await new Promise((res) => setTimeout(res, 4000));
}
console.log("done; memory writes continue in the background (paced for the relayer rate limit)");
