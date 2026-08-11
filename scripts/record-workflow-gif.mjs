// Records the "AI ships a code change, a human approves it" GIF: the ticket
// with the before/after screenshots the agent attached, the approval card
// showing the exact diff, the human approving, and the merged/deployed result.
//
// Usage: node scripts/record-workflow-gif.mjs <ticketUrl> [outfile]
import { existsSync, writeFileSync } from "node:fs";
import puppeteer from "puppeteer-core";
import sharp from "sharp";
import gifenc from "gifenc";
const { GIFEncoder, quantize, applyPalette } = gifenc;

const [ticketUrl, outfile = "docs/assets/demo-ship.gif"] = process.argv.slice(2);
if (!ticketUrl) {
  console.error("Usage: node scripts/record-workflow-gif.mjs <ticketUrl> [outfile]");
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
/** Scroll so an element containing `text` sits in view, then hold. */
async function focusOn(text, hold = 12) {
  await page.evaluate((t) => {
    const el = [...document.querySelectorAll("h1,h2,h3,figcaption,code,p,button,span")].find((n) =>
      n.textContent?.trim().toLowerCase().includes(t.toLowerCase()),
    );
    if (el) el.scrollIntoView({ block: "center", behavior: "instant" });
  }, text);
  await pause(500);
  await shoot(hold);
}

console.log("1/5 the ticket, as it arrived by email…");
await page.goto(ticketUrl, { waitUntil: "networkidle0", timeout: 45000 });
await pause(1400);
await shoot(12);

console.log("2/5 the screenshots the agent attached — before and after…");
await focusOn("Screenshots", 16);
await page.evaluate(() => window.scrollBy({ top: 320, behavior: "instant" }));
await pause(400);
await shoot(16);

console.log("3/5 what the agent did: read the file, diagnosed, branched, committed…");
await focusOn("github_read_file", 8);
await focusOn("github_create_branch", 8);
await focusOn("github_edit_file", 14);

console.log("4/5 the human decisions…");
await focusOn("github_merge_pr", 14);

console.log("5/5 resolved, QA passed, deployed…");
await focusOn("Resolved by", 14);
await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
await pause(500);
await shoot(12);

console.log("…and the live site with the fix");
await page.goto("https://servoai.org/", { waitUntil: "networkidle0", timeout: 45000 });
await pause(1600);
await shoot(18);

await browser.close();
console.log(`captured ${frames.length} frames — encoding…`);

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
