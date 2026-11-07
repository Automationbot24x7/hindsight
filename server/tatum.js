// Tatum: live prices (Data API) and Sui mainnet reads (RPC gateway).
const KEY = () => process.env.TATUM_API_KEY || "";
const SUI_GRAPHQL = "https://sui-mainnet.gateway.tatum.io/graphql";
const RATE_URL = "https://api.tatum.io/v4/data/rate/symbol";

const priceCache = new Map(); // symbol -> { value, at }
const PRICE_TTL_MS = 60_000;

export const ASSETS = ["SUI", "BTC", "ETH", "SOL"];

export async function price(symbol) {
  symbol = symbol.toUpperCase();
  const hit = priceCache.get(symbol);
  if (hit && Date.now() - hit.at < PRICE_TTL_MS) return hit;
  const url = `${RATE_URL}?symbol=${encodeURIComponent(symbol)}&basePair=USD`;
  const res = await fetch(url, { headers: { "x-api-key": KEY() } });
  if (!res.ok) throw new Error(`Tatum rate ${symbol}: HTTP ${res.status}`);
  const j = await res.json();
  const value = Number(j.value);
  if (!Number.isFinite(value)) throw new Error(`Tatum rate ${symbol}: no value`);
  const out = { symbol, value, at: Date.now(), source: j.source || "tatum" };
  priceCache.set(symbol, out);
  return out;
}

// Tatum's Sui mainnet gateway serves the Sui GraphQL RPC (Sui deprecated JSON-RPC).
export async function suiQuery(query, variables = {}) {
  const res = await fetch(SUI_GRAPHQL, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": KEY() },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Tatum Sui GraphQL: HTTP ${res.status}`);
  const j = await res.json();
  if (j.errors?.length) throw new Error(`Tatum Sui GraphQL: ${j.errors[0].message}`);
  return j.data;
}

const MIST = 1e9;

/** "Skin in the game": a voice can link a Sui address; we read its SUI balance on mainnet. */
export async function suiBalance(address) {
  const d = await suiQuery(
    `query($a: SuiAddress!) { address(address: $a) { balance(coinType: "0x2::sui::SUI") { totalBalance } } }`,
    { a: address },
  );
  return Number(d.address?.balance?.totalBalance || 0) / MIST;
}

let netCache = null;
export async function suiNetwork() {
  if (netCache && Date.now() - netCache.at < 120_000) return netCache;
  const d = await suiQuery(`{ checkpoint { sequenceNumber timestamp } epoch { epochId referenceGasPrice } }`);
  netCache = {
    at: Date.now(),
    epoch: Number(d.epoch.epochId),
    referenceGasPrice: Number(d.epoch.referenceGasPrice),
    checkpoint: Number(d.checkpoint.sequenceNumber),
    checkpointTime: d.checkpoint.timestamp,
  };
  return netCache;
}
