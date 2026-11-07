// Generates Hindsight's illustrations with Gemini image generation (voice avatars + key art).
// Originals go to video/art (not committed); web-sized copies are made by tools/web-art.sh.
// Usage: GEMINI_KEY_FILE=path/to/key.txt node tools/gen-art.mjs [only-name]
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";

const key = process.env.GEMINI_API_KEY || readFileSync(process.env.GEMINI_KEY_FILE, "utf8").trim();
const MODEL = process.env.IMAGE_MODEL || "gemini-3-pro-image";
const OUT = "video/art";
const LEDGER = process.env.MEDIA_LEDGER || "C:/Hackathon/near-hackathon-bazaar/art-src/audio-spend.json"; // shared media budget
const BUDGET = Number(process.env.MEDIA_BUDGET_USD || 9.5);
const PRICE = 0.134; // per 1K/2K image
mkdirSync(OUT, { recursive: true });

const STYLE = "Modern editorial illustration, clean geometric shapes with soft gradients and a fine grain texture, deep midnight-navy background (#0d1117), mint green (#6ee7c7) and soft electric blue (#7aa7ff) as accent colors with small warm coral highlights, gentle rim light, calm and premium fintech mood. No text, no letters, no numbers, no logos, no watermark, no border.";
const AVATAR = "Square character avatar, head and shoulders, centered, facing the viewer slightly turned, plain deep navy background with a soft circular glow behind the head, fictional person, friendly app-avatar style, consistent series.";

const JOBS = [
  { name: "priya", ratio: "1:1", prompt: `${AVATAR} A composed South Asian woman in her thirties, a sharp market analyst in a dark blazer, neat hair bun, thin-rimmed glasses, a tablet with a small line chart held at her side, calm confident expression. ${STYLE}` },
  { name: "moonboy", ratio: "1:1", prompt: `${AVATAR} A loud, overexcited young man with spiky bleached hair and mirrored sunglasses pushed up, wearing a hoodie with a little rocket pattern, mouth open mid-shout, finger pointing up at the sky, tiny rocket and crescent moon floating behind him. Comic, slightly over the top. ${STYLE}` },
  { name: "otter", ratio: "1:1", prompt: `${AVATAR} A clever anthropomorphic sea otter wearing a small navy scarf and a tiny headlamp, holding a glowing water droplet like a crystal, attentive thoughtful eyes, playful but smart. ${STYLE}` },
  { name: "me", ratio: "1:1", prompt: `${AVATAR} A thoughtful person of ambiguous gender in a simple grey sweater, short hair, holding a coffee mug, looking at a phone with a hopeful but unsure smile, everyday relatable look. ${STYLE}` },
  { name: "raj", ratio: "1:1", prompt: `${AVATAR} A cheerful Indian uncle in his late fifties with a grey mustache and a checked shirt with a sweater vest, holding up a smartphone showing a chat, eyebrows raised as if sharing a hot tip. ${STYLE}` },
  { name: "hero", ratio: "16:9", prompt: `Wide key art: an open, glowing journal floating in a dark space; from its pages, thin lines of market price charts lift off and turn into small luminous cubes that stack into an orderly lattice of memory blocks stretching into the distance, like a decentralized vault. A few cubes glow mint (right calls) and a few glow coral (wrong calls). Cinematic depth of field, slow and calm, space on the left third for a title overlay. ${STYLE}` },
  { name: "voices", ratio: "16:9", prompt: `Wide scene: five softly glowing speech bubbles of different sizes float above a dark city skyline at night, each connected by a thin light thread down to a single calm balance scale made of light; the loudest, biggest bubble is coral and outweighed by small mint bubbles. Metaphor for weighing loud opinions by track record. Cinematic, wide, calm. ${STYLE}` },
  { name: "rebuild", ratio: "16:9", prompt: `Wide scene: a trust meter gauge made of light being reassembled from hundreds of small luminous cubes streaming in from a distant lattice of memory blocks, the needle settling into place; sense of recovery and certainty, mint and blue light, deep navy space. Cinematic, wide. ${STYLE}` },
];

const ledger = existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, "utf8")) : { usd: 0, calls: [] };
async function gen(job) {
  const file = `${OUT}/${job.name}.png`;
  if (existsSync(file) && !process.argv[2]) return `skip ${job.name}`;
  if (ledger.usd + PRICE > BUDGET) throw new Error(`budget stop at $${ledger.usd}`);
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: job.prompt }] }],
      generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: job.ratio, imageSize: job.ratio === "16:9" ? "2K" : "1K" } },
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`${job.name}: ${j.error?.message || r.status}`);
  const part = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
  if (!part) throw new Error(`${job.name}: no image returned`);
  writeFileSync(file, Buffer.from(part.inlineData.data, "base64"));
  ledger.usd = +(ledger.usd + PRICE).toFixed(4);
  ledger.calls.push({ what: `hindsight image ${job.name}`, usd: PRICE, at: new Date().toISOString() });
  writeFileSync(LEDGER, JSON.stringify(ledger, null, 1));
  return `ok ${job.name}`;
}

const only = process.argv[2];
const jobs = JOBS.filter((j) => !only || j.name === only);
for (let i = 0; i < jobs.length; i += 4) {
  const res = await Promise.allSettled(jobs.slice(i, i + 4).map(gen));
  for (const r of res) console.log(r.status === "fulfilled" ? r.value : `FAIL ${r.reason.message}`);
}
console.log(`media ledger: $${ledger.usd}`);
