// Records the demo scenes from the running app with headless Chrome (DevTools protocol, no deps).
// Each scene saves timestamped JPEG frames to video/cap/<scene>/ plus a concat list for ffmpeg.
// Zoom-ins are done in the page (CSS transform), so text stays sharp.
// Usage: node tools/video/capture.mjs [baseUrl] [scene ...]
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const BASE = process.argv[2]?.startsWith("http") ? process.argv[2] : "http://localhost:8787";
const ONLY = process.argv.slice(2).filter((a) => !a.startsWith("http"));
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const OUT = path.resolve("video/cap");
const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const D = JSON.parse(fs.readFileSync("video/durations.json", "utf8"));
// Scenes s1, s11 and s12 are not screen captures; s10 starts with a 4.5 s cinematic clip.
const CAP = { ...D, s10: +(D.s10 - 4.5).toFixed(2) };

// Warm the analyst cache so answers appear at a natural pace on camera.
const post = (p, b) => fetch(BASE + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.json());
await fetch(`${BASE}/api/briefing?voice=${encodeURIComponent("@MoonBoyMax")}&asset=SUI`).then((r) => r.json());
await post("/api/ask", { q: "Who keeps getting SUI wrong?" });

const prof = path.resolve("video/chrome-profile");
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, "--window-size=1536,864", "--hide-scrollbars", "--force-color-profile=srgb", "about:blank"], { stdio: "ignore" });
process.on("exit", () => chrome.kill());

let target;
for (let i = 0; i < 50 && !target; i++) {
  try { target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" })).json(); } catch { await sleep(200); }
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let seq = 0;
const pending = new Map();
let onFrame = null;
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  else if (m.method === "Page.screencastFrame") { if (onFrame) onFrame(m.params); else ws.send(JSON.stringify({ id: ++seq, method: "Page.screencastFrameAck", params: { sessionId: m.params.sessionId } })); }
});
const cdp = (method, params = {}) => new Promise((res, rej) => {
  const id = ++seq;
  pending.set(id, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)));
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expr) => (await cdp("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result.value;

await cdp("Page.enable");
await cdp("Emulation.setDeviceMetricsOverride", { width: 1536, height: 864, deviceScaleFactor: 1.25, mobile: false });
await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
await cdp("Page.navigate", { url: BASE });
await sleep(4500);

// ---------- recording ----------
async function record(name, seconds, action) {
  if (ONLY.length && !ONLY.includes(name)) return;
  const dir = path.join(OUT, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const frames = [];
  // Screencast: Chrome pushes a frame whenever the page repaints (smooth zooms and typing).
  const first = await cdp("Page.captureScreenshot", { format: "jpeg", quality: 92 });
  const t0 = Date.now();
  const save = (data, t) => {
    const f = path.join(dir, `f${String(frames.length).padStart(4, "0")}.jpg`);
    fs.writeFileSync(f, Buffer.from(data, "base64"));
    frames.push({ f, t });
  };
  save(first.data, 0);
  onFrame = (p) => {
    const t = Date.now() - t0;
    if (t < seconds * 1000) save(p.data, t);
    cdp("Page.screencastFrameAck", { sessionId: p.sessionId }).catch(() => {});
  };
  await cdp("Page.startScreencast", { format: "jpeg", quality: 90, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
  const actionP = (async () => { try { await action(); } catch (e) { console.error(name, e.message); } })();
  while (Date.now() - t0 < seconds * 1000) await sleep(50);
  await cdp("Page.stopScreencast");
  onFrame = null;
  await actionP;
  await unzoom(0);
  const lines = ["ffconcat version 1.0"];
  frames.forEach((fr, i) => {
    const next = i + 1 < frames.length ? frames[i + 1].t : seconds * 1000;
    lines.push(`file '${path.basename(fr.f)}'`, `duration ${((next - fr.t) / 1000).toFixed(3)}`);
  });
  lines.push(`file '${path.basename(frames.at(-1).f)}'`);
  fs.writeFileSync(path.join(dir, "list.txt"), lines.join("\n") + "\n");
  console.log(`${name}: ${frames.length} frames over ${seconds}s`);
}

const J = JSON.stringify;
const scrollTo = (sel, block = "center") => evaluate(`document.querySelector(${J(sel)})?.scrollIntoView({behavior:"smooth",block:"${block}"})`);
const scrollTop = () => evaluate(`window.scrollTo({top:0,behavior:"smooth"})`);
const setVal = (sel, v) => evaluate(`(()=>{const e=document.querySelector(${J(sel)});e.value=${J(v)};e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new Event("change",{bubbles:true}))})()`);
async function typeInto(sel, text, cps = 14) {
  await evaluate(`(()=>{const e=document.querySelector(${J(sel)});e.focus();e.value="";})()`);
  for (let i = 1; i <= text.length; i++) { await setVal(sel, text.slice(0, i)); await sleep(1000 / cps); }
}
const highlight = (sel, on = true) => evaluate(`(()=>{const e=document.querySelector(${J(sel)}); if(e){e.style.transition="box-shadow .4s"; e.style.boxShadow=${on ? `"0 0 0 3px #7aa7ff, 0 0 40px rgba(122,167,255,.35)"` : `""`}}})()`);
// Smoothly zoom the page so the element fills most of the frame (above the caption bar).
const zoomTo = (sel, max = 1.9, ms = 1100) => evaluate(`(()=>{const e=document.querySelector(${J(sel)}); if(!e) return 0;
  const r=e.getBoundingClientRect(), vw=innerWidth, vh=innerHeight-80;
  const s=Math.max(1.05, Math.min(${max}, 0.92*vw/r.width, 0.88*vh/r.height));
  const cx=r.left+r.width/2+scrollX, cy=r.top+r.height/2+scrollY;
  const dx=vw/2-(r.left+r.width/2), dy=vh/2-(r.top+r.height/2);
  const b=document.body; b.style.transition="transform ${ms}ms cubic-bezier(.45,0,.2,1)"; b.style.transformOrigin=cx+"px "+cy+"px";
  b.style.transform="translate("+dx+"px,"+dy+"px) scale("+s+")"; const n=document.querySelector(".nav"); if(n){n.style.transition="opacity .3s"; n.style.opacity=0} return s})()`);
const unzoom = (ms = 900) => evaluate(`(()=>{const b=document.body; b.style.transition="transform ${ms}ms cubic-bezier(.45,0,.2,1)"; b.style.transform=""; const n=document.querySelector(".nav"); if(n) n.style.opacity=1;})()`);
const card = (title) => `[...document.querySelectorAll(".card")].find(c=>c.querySelector("h2")?.textContent.startsWith(${J(title)}))`;
const markCard = (title, id) => evaluate(`(()=>{const c=${card(title)}; if(c) c.id=${J(id)}; return !!c})()`);
const zoomExpr = (expr, max = 1.9, ms = 1100) => evaluate(`(()=>{const e=${expr}; if(!e) return 0; e.id=e.id||"z-"+Math.random().toString(36).slice(2); return e.id})()`).then((id) => (id ? zoomTo("#" + id, max, ms) : 0));
const mark = (expr, id) => evaluate(`(()=>{const e=${expr}; if(e) e.id=${J(id)}; return !!e})()`);
async function markAll() {
  for (const [t, id] of [["Who to trust", "c-trust"], ["Market consensus", "c-cons"], ["Calls", "c-calls"], ["Lessons", "c-lessons"], ["Ask", "c-ask"], ["Memory receipts", "c-receipts"], ["Log a call", "c-log"]]) await markCard(t, id);
}
await markAll();
const W = (s) => sleep(s * 1000);

// s2: what Hindsight is (hero, then a slow pass over the dashboard)
await record("s2", CAP.s2, async () => {
  await scrollTop(); await W(5.2);
  await scrollTo(".steps4", "center"); await W(4.4);
  await scrollTo(".feature", "center"); await W(3.6);
  await scrollTo("#journal-top", "start");
});
const toJournal = () => evaluate(`window.scrollTo({top:document.querySelector("#journal-top").getBoundingClientRect().top+scrollY-64,behavior:"instant"})`);

// s3: log a real call (priced by Tatum, written to Walrus)
await record("s3", CAP.s3, async () => {
  await toJournal(); await W(0.3);
  await zoomTo("#c-log", 1.45, 900); await W(0.9);
  await typeInto("#pickform [name=voice]", "Uncle Raj", 12);
  await setVal("#pickform [name=asset]", "ETH");
  await setVal("#pickform [name=direction]", "above");
  await setVal("#pickform [name=deadlineMinutes]", "10080");
  await setVal("#pickform [name=confidence]", "80");
  await typeInto("#pickform [name=note]", "The group chat says ETH is next.", 22);
  await W(0.4);
  await evaluate(`document.querySelector("#submitbtn").click()`);
  await W(2.6);
  await unzoom(); await W(1.0);
  await zoomTo("#memchip", 2.2); await W(2.2);
});

// s4: outcomes scored, memory receipts with blob IDs
await record("s4", CAP.s4, async () => {
  await evaluate(`document.querySelector('#picktabs [data-f="done"]').click()`);
  await scrollTo("#c-calls", "center"); await W(1.0);
  await zoomTo("#c-calls", 1.5); await W(4.2);
  await unzoom(); await W(0.6);
  await scrollTo("#c-receipts", "center"); await W(1.2);
  await zoomExpr(`document.querySelector("#receipts li")`, 2.2); await W(5.0);
});

// s5: who to trust
await record("s5", CAP.s5, async () => {
  await toJournal(); await W(0.8);
  await zoomTo("#c-trust", 1.55); await W(3.2);
  await zoomExpr(`[...document.querySelectorAll(".voice")].find(v=>v.textContent.includes("Priya"))`, 2.2); await W(3.4);
  await zoomExpr(`[...document.querySelectorAll(".voice")].find(v=>v.textContent.includes("@MoonBoyMax"))`, 2.2); await W(5.5);
});

// s6: pre-call briefing recalled from Walrus, with the analyst's verdict
await record("s6", CAP.s6, async () => {
  await toJournal(); await W(0.4);
  await setVal("#pickform [name=note]", "");
  await setVal("#pickform [name=asset]", "SUI");
  await zoomTo("#c-log", 1.3, 800);
  await typeInto("#pickform [name=voice]", "@MoonBoyMax", 11);
  await W(1.6);
  await unzoom(500); await W(0.5);
  await zoomTo("#brief", 2.0); await W(7);
});

// s7: trust-weighted consensus flips the crowd
await record("s7", CAP.s7, async () => {
  await scrollTo("#c-cons", "center"); await W(1.0);
  await zoomExpr(`[...document.querySelectorAll(".cons")].find(c=>c.querySelector(".ch b")?.textContent==="SUI")`, 2.0); await W(7.5);
});

// s8: lessons and reflections written back to Walrus
await record("s8", CAP.s8, async () => {
  await scrollTo("#c-lessons", "center"); await W(1.0);
  await zoomExpr(`[...document.querySelectorAll("#lessons li:not(.insight)")][0]`, 2.0); await W(4.2);
  await unzoom(700); await W(0.6);
  await highlight("#reflectbtn");
  await zoomExpr(`document.querySelector("#lessons li.insight")`, 2.0); await W(7.5);
});

// s9: ask in plain words, cited answer
await record("s9", CAP.s9, async () => {
  await evaluate(`document.querySelector("#answer").innerHTML=""; document.querySelector("#answers").innerHTML=""`);
  await scrollTo("#c-ask", "center"); await W(0.9);
  await zoomTo("#c-ask", 1.35, 800);
  await typeInto("#askform [name=q]", "Who keeps getting SUI wrong?", 16);
  await evaluate(`document.querySelector("#askform").requestSubmit()`);
  await W(1.4);
  await unzoom(500); await W(0.5);
  await zoomTo("#answer .answer", 1.9); await W(5);
});

// s10 (screen part): rebuild from Walrus + skin in the game
await record("s10", CAP.s10, async () => {
  await toJournal(); await W(0.3);
  await evaluate(`document.querySelector("#rebuildbtn").scrollIntoView({block:"center"})`);
  await evaluate(`document.querySelector("#rebuildbtn").click()`);
  await zoomTo("#c-trust", 1.5); await W(3.6);
  await zoomExpr(`[...document.querySelectorAll(".voice")].find(v=>v.textContent.includes("@OnchainOtter"))`, 2.2); await W(4);
});

ws.close();
chrome.kill();
process.exit(0);
