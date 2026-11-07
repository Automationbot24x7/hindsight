// Cinematic clips for the demo video: Kling image-to-video (through SandBase) from the Gemini key art.
// Progress is saved to video/clips/manifest.json, so a re-run never pays twice.
// Usage: SANDBASE_KEY_FILE=path/to/key.txt node tools/video/gen-clips.mjs [only-name...]
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";

const KEY = process.env.SANDBASE_API_KEY || readFileSync(process.env.SANDBASE_KEY_FILE, "utf8").trim();
const API = "https://api.sandbase.ai/v1";
const OUT = "video/clips", MANIFEST = `${OUT}/manifest.json`;
const CAP_USD = Number(process.env.CLIPS_CAP_USD || 6);
const MODEL = "kwaivgi/kling-video/3.0/omni/pro/image-to-video", PRICE = 0.56; // 5 s clip
mkdirSync(OUT, { recursive: true });
const man = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : { usd: 0, clips: {} };
const save = () => writeFileSync(MANIFEST, JSON.stringify(man, null, 1));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const only = process.argv.slice(2);

const CALM = "Smooth, slow cinematic camera, gentle motion, soft particles, no text, no letters, no logos, no people appearing.";
const CLIPS = {
  intro: { image: "video/art/hero.png", prompt: `Slow push-in toward the glowing open journal. Thin market price lines rise from its pages and turn into small luminous cubes that float up and settle into the lattice of memory blocks; a few cubes softly light up mint green and a few coral. ${CALM}` },
  voices: { image: "video/art/voices.png", prompt: `Slow lateral camera drift over the night city. The speech bubbles gently bob in the air; the balance scale tips a little further toward the small mint bubbles as the big coral bubble rises. City lights twinkle. ${CALM}` },
  rebuild: { image: "video/art/rebuild.png", prompt: `Streams of small glowing cubes flow from the distant lattice into the trust gauge, which assembles piece by piece; its needle swings and then settles firmly. Slow push-in. ${CALM}` },
  "hero-live-a": { loop: true, image: "video/art/hero.png", prompt: `Locked-off camera, no camera movement. A single page of the glowing open journal lifts and slowly turns from right to left, landing flat. As it turns, live electric current crackles up from the pages: thin bright blue-white electric arcs and glowing filaments race up the price lines into the lattice, and the cubes they touch light up mint or coral, pulse, then fade back. Subtle sparks and floating particles. The book ends open exactly as it started so the clip loops seamlessly. ${CALM}` },
  "hero-live-b": { loop: true, image: "video/art/hero.png", prompt: `Locked-off camera, no camera movement. Energy flows like electricity: pulses of bright cyan light travel along the thin price lines from the open journal into the lattice of memory blocks, small electric arcs flicker between neighbouring cubes, and cubes briefly glow mint or coral as each pulse arrives. Midway, one page of the journal turns gently from right to left and settles. The scene ends exactly as it began so the clip loops seamlessly. ${CALM}` },
  // Seamless loops for the website background (first frame = last frame, locked-off camera).
  "hero-loop": { loop: true, image: "video/art/hero.png", prompt: `Locked-off camera, no camera movement. Ambient living scene: thin glowing price lines drift up from the open journal's pages, cubes in the lattice gently pulse and shimmer, a few cubes softly glow mint and coral and fade back, tiny dust particles float. Everything returns to its starting state at the end so the clip loops seamlessly. ${CALM}` },
  "voices-loop": { loop: true, image: "video/art/voices.png", prompt: `Locked-off camera, no camera movement. The speech bubbles bob gently up and down, the light threads sway softly, the balance scale rocks very slightly and settles, city windows twinkle. Everything returns to its starting state at the end so the clip loops seamlessly. ${CALM}` },
  "rebuild-loop": { loop: true, image: "video/art/rebuild.png", prompt: `Locked-off camera, no camera movement. Small glowing cubes stream continuously along the curved path into the trust gauge, the gauge glows softly and its needle trembles slightly around its position, particles drift. Everything returns to its starting state at the end so the clip loops seamlessly. ${CALM}` },
};

async function api(method, path, body) {
  const r = await fetch(`${API}${path}`, { method, headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { ok: r.ok, status: r.status, j: await r.json().catch(() => ({})) };
}
async function run(body, label) {
  let sub;
  for (let i = 0; i < 120; i++) {
    sub = await api("POST", "/run", body);
    if (sub.ok && sub.j.id) break;
    if (/concurrency|rate limit/i.test(sub.j.error || "")) { await sleep(10000); continue; }
    throw new Error(`${label}: submit failed ${sub.status} ${JSON.stringify(sub.j).slice(0, 300)}`);
  }
  for (let i = 0; i < 200; i++) {
    await sleep(8000);
    const g = await api("GET", `/run/${sub.j.id}`);
    if (g.j.status === "completed") return { id: sub.j.id, url: g.j.outputs?.[0]?.url };
    if (g.j.status === "failed" || g.j.status === "timeout") throw new Error(`${label}: ${g.j.status} ${JSON.stringify(g.j.error || "").slice(0, 300)}`);
  }
  throw new Error(`${label}: still running after ~27 min`);
}

const imageSrc = (file) => process.env.IMAGE_BASE_URL
  ? `${process.env.IMAGE_BASE_URL}/${file.split("/").pop().replace(".png", ".jpg")}`
  : `data:image/jpeg;base64,${readFileSync(file.replace(".png", ".jpg")).toString("base64")}`;

const todo = Object.entries(CLIPS).filter(([k]) => !man.clips[k] && (!only.length || only.includes(k)));
await Promise.all(todo.map(async ([name, c], i) => {
  await sleep(i * 1500);
  if (man.usd + PRICE > CAP_USD) throw new Error(`budget stop at $${man.usd}`);
  try {
    const r = await run({ model: MODEL, prompt: c.prompt, image: imageSrc(c.image), duration: 5, ...(c.loop ? { end_image: imageSrc(c.image) } : {}) }, name);
    const res = await fetch(r.url);
    const file = `${OUT}/${name}.mp4`;
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    man.clips[name] = { ...r, file }; man.usd = +(man.usd + PRICE).toFixed(2); save();
    console.log(`clip ${name} ok · total $${man.usd}`);
  } catch (e) { console.log("FAIL", e.message); }
}));
console.log(`done · spent $${man.usd}`);
