// Records the README demo GIF: the AI resolver working a ticket with real
// tools — running SQL against the ops database, pausing at a human-approval
// gate, resuming after the human approves, and passing QA.
//
// Frames are captured while the run is actually executing (the page is
// re-rendered as steps land in the database), so the GIF is a recording of a
// real agent run, not a mockup. Encoded with gifenc — no ffmpeg dependency.
//
// Usage: node scripts/record-demo-gif.mjs <ticketUrl> [outfile]
import { existsSync, writeFileSync } from "node:fs";
import puppeteer from "puppeteer-core";
import sharp from "sharp";
import gifenc from "gifenc"; // CJS module: named exports only via default
const { GIFEncoder, quantize, applyPalette } = gifenc;

const [ticketUrl, outfile = "docs/assets/demo-loop.gif"] = process.argv.slice(2);
if (!ticketUrl) {
  console.error("Usage: node scripts/record-demo-gif.mjs <ticketUrl> [outfile]");
  process.exit(1);
}
const origin = new URL(ticketUrl).origin;
const ticketId = ticketUrl.split("/tickets/")[1];

const CHROME_PATHS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];
const executablePath = CHROME_PATHS.find((p) => existsSync(p));
if (!executablePath) throw new Error("Chrome not found");

// Capture at 2x and downscale: supersampling is what makes the text crisp.
const VIEW = { width: 1180, height: 720 };
const GIF_WIDTH = 1100;
const FRAME_MS = 130;
const frames = [];

const browser = await puppeteer.launch({ executablePath, headless: "shell" });
const page = await browser.newPage();
await page.setViewport({ ...VIEW, deviceScaleFactor: 2 });

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function shoot(times = 1) {
  for (let i = 0; i < times; i++) frames.push(await page.screenshot({ type: "png" }));
}
async function clickText(text) {
  const handle = await page.evaluateHandle(
    (t) => [...document.querySelectorAll("button, a")].find((el) => el.textContent.trim() === t),
    text,
  );
  const el = handle.asElement();
  if (!el) throw new Error(`click target not found: ${text}`);
  await el.click();
}
/** Keep the newest timeline activity in frame as the run grows. */
async function followTimeline() {
  await page.evaluate(() => {
    const steps = document.querySelectorAll("[data-run-step], .font-mono, pre");
    const last = steps[steps.length - 1];
    if (last) last.scrollIntoView({ block: "center", behavior: "instant" });
    else window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" });
  });
}
async function runState() {
  const res = await fetch(`${origin}/api/tickets/${ticketId}`);
  const { ticket } = await res.json();
  const run = ticket?.runs?.filter((r) => r.kind === "RESOLVE").at(-1);
  return { status: run?.status ?? "none", steps: run?.steps?.length ?? 0, qa: run?.qaVerdict ?? null };
}

console.log("1/6 the request as it arrived…");
await page.goto(ticketUrl, { waitUntil: "networkidle0", timeout: 45000 });
await pause(1200);
await shoot(12);

console.log("2/6 handing it to the AI resolver…");
await clickText("Run AI resolver");
await pause(800);
await shoot(4);

console.log("3/6 recording the agent while it works…");
let guard = 0;
let state = await runState();
while (state.status !== "WAITING_APPROVAL" && state.status !== "COMPLETED" && guard++ < 40) {
  await pause(1800);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 45000 });
  await pause(500);
  await followTimeline();
  await shoot(2);
  state = await runState();
  process.stdout.write(`   ${state.status} · ${state.steps} steps\r`);
}
console.log(`\n   -> ${state.status} after ${state.steps} steps`);

if (state.status === "WAITING_APPROVAL") {
  console.log("4/6 the run paused for human approval…");
  await page.reload({ waitUntil: "networkidle0", timeout: 45000 });
  await pause(900);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await pause(300);
  await shoot(16); // hold: this is the whole point of the product

  console.log("5/6 human approves…");
  await clickText("Approve & resume");
  await pause(900);
  await shoot(4);

  guard = 0;
  while (state.status !== "COMPLETED" && guard++ < 40) {
    await pause(1800);
    await page.reload({ waitUntil: "domcontentloaded", timeout: 45000 });
    await pause(500);
    await followTimeline();
    await shoot(2);
    state = await runState();
    process.stdout.write(`   ${state.status} · ${state.steps} steps\r`);
  }
  console.log(`\n   -> ${state.status}${state.qa ? ` · QA ${state.qa}` : ""}`);
}

console.log("6/6 resolved, with the full trace…");
await page.reload({ waitUntil: "networkidle0", timeout: 45000 });
await pause(1000);
await followTimeline();
await shoot(14);
await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
await pause(400);
await shoot(12);

await browser.close();
console.log(`captured ${frames.length} frames — encoding…`);

// -- encode ------------------------------------------------------------------
// Held beats are captured as repeated frames; merging them into one frame with
// a longer delay keeps the pacing and cuts megabytes. The threshold is tight
// enough that real UI changes stay their own frames.
const SIMILAR = 0.0002;

const raws = [];
for (const png of frames) {
  raws.push(
    await sharp(png).resize({ width: GIF_WIDTH }).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  );
}
function nearlyEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  const budget = a.length * SIMILAR;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) {
      if ((diff += 4) > budget) return false;
    }
  }
  return true;
}
const merged = [];
for (const frame of raws) {
  const last = merged[merged.length - 1];
  if (last && nearlyEqual(last.data, frame.data)) last.delay += FRAME_MS;
  else merged.push({ data: frame.data, info: frame.info, delay: FRAME_MS });
}
console.log(`${frames.length} frames → ${merged.length} after merging holds`);

const gif = GIFEncoder();
for (const frame of merged) {
  const palette = quantize(frame.data, 256, { format: "rgb565" });
  const indexed = applyPalette(frame.data, palette, "rgb565");
  gif.writeFrame(indexed, frame.info.width, frame.info.height, { palette, delay: frame.delay });
}
gif.finish();
writeFileSync(outfile, Buffer.from(gif.bytes()));
console.log(`saved ${outfile}`);
