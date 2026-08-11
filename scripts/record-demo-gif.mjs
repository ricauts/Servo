// Records the README demo: a support request arrives by email, the AI agent
// works it with real tools, a human approves the risky steps, and the change
// ships to the live site.
//
// Motion is captured, not implied: scrolling happens in small steps that are
// each photographed, so playback glides instead of cutting between stills.
// Encoded with gifenc — no ffmpeg dependency.
//
// Usage: node scripts/record-demo-gif.mjs <ticketUrl> [outfile]
import { existsSync, writeFileSync } from "node:fs";
import puppeteer from "puppeteer-core";
import sharp from "sharp";
import gifenc from "gifenc"; // CJS module: named exports only via default
const { GIFEncoder, quantize, applyPalette } = gifenc;

const [ticketUrl, outfile = "docs/assets/demo.gif"] = process.argv.slice(2);
if (!ticketUrl) {
  console.error("Usage: node scripts/record-demo-gif.mjs <ticketUrl> [outfile]");
  process.exit(1);
}

const CHROME_PATHS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];
const executablePath = CHROME_PATHS.find((p) => existsSync(p));
if (!executablePath) throw new Error("Chrome not found");

const VIEW = { width: 1220, height: 700 };
const GIF_WIDTH = 880;
const FRAME_MS = 90; // ~11fps: smooth enough to read as motion, cheap in bytes
const frames = [];

const browser = await puppeteer.launch({ executablePath, headless: "shell" });
const page = await browser.newPage();
await page.setViewport({ ...VIEW, deviceScaleFactor: 2 });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function shoot(times = 1) {
  for (let i = 0; i < times; i++) frames.push(await page.screenshot({ type: "png" }));
}
/** Scroll to an absolute offset in steps, photographing the movement. */
async function glideTo(targetY, steps = 9) {
  const from = await page.evaluate(() => window.scrollY);
  for (let i = 1; i <= steps; i++) {
    // ease-in-out so the motion starts and stops softly
    const t = i / steps;
    const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    const y = Math.round(from + (targetY - from) * eased);
    await page.evaluate((to) => window.scrollTo(0, to), y);
    await shoot(1);
  }
}
async function offsetOf(text) {
  return page.evaluate((t) => {
    const el = [...document.querySelectorAll("h1,h2,h3,summary,figcaption,p,span,code")].find((n) =>
      n.textContent?.trim().toLowerCase().includes(t.toLowerCase()),
    );
    if (!el) return null;
    return window.scrollY + el.getBoundingClientRect().top - 120;
  }, text);
}
async function glideToText(text, steps = 9) {
  const y = await offsetOf(text);
  if (y !== null) await glideTo(y, steps);
}

console.log("1/6 the request, as it arrived by email…");
await page.goto(ticketUrl, { waitUntil: "networkidle0", timeout: 45000 });
await pause(1200);
await shoot(14);

console.log("2/6 what the agent saw — before and after…");
await glideToText("Screenshots", 9);
await shoot(20);

console.log("3/6 the run, summarised…");
await glideToText("github_read_file", 10);
await shoot(18);

console.log("4/6 unfolding the full trace…");
await page.evaluate(() => {
  const run = [...document.querySelectorAll("details")].find((d) =>
    d.innerText.includes("github_edit_file"),
  );
  if (run) run.open = true;
});
await pause(500);
await shoot(10);
await glideToText("github_create_branch", 7);
await shoot(8);

console.log("5/6 the human decision…");
await glideToText("Approval requested", 9);
await shoot(22);

console.log("6/6 shipped — the live site…");
await page.goto("https://servoai.org/", { waitUntil: "networkidle0", timeout: 45000 });
await pause(1500);
await shoot(20);

await browser.close();
console.log(`captured ${frames.length} frames — encoding…`);

// Identical frames (deliberate holds) collapse into one frame with a longer
// delay: same pacing, several megabytes cheaper.
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
  const palette = quantize(frame.data, 128, { format: "rgb565" });
  const indexed = applyPalette(frame.data, palette, "rgb565");
  gif.writeFrame(indexed, frame.info.width, frame.info.height, { palette, delay: frame.delay });
}
gif.finish();
writeFileSync(outfile, Buffer.from(gif.bytes()));
console.log(`saved ${outfile}`);
