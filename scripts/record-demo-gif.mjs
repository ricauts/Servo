// Records the README demo GIF: an email becomes a ticket, the AI drafts the
// reply, a human approves it, and the answer goes out. Drives the real app in
// Chrome, captures frames, and encodes them with gifenc (no ffmpeg needed).
//
// Usage: node scripts/record-demo-gif.mjs [ticketUrl] [outfile]
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

const CHROME_PATHS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];
const executablePath = CHROME_PATHS.find((p) => existsSync(p));
if (!executablePath) throw new Error("Chrome not found");

// Capture at 2x for crisp text, downscale to GIF width.
const VIEW = { width: 1280, height: 760 };
const GIF_WIDTH = 820;
const frames = [];

const browser = await puppeteer.launch({ executablePath, headless: "shell" });
const page = await browser.newPage();
await page.setViewport({ ...VIEW, deviceScaleFactor: 1 });

/** Grab one frame (optionally several, to hold a beat). */
async function shoot(times = 1) {
  for (let i = 0; i < times; i++) {
    frames.push(await page.screenshot({ type: "png" }));
  }
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/** Click the first element whose trimmed text matches. */
async function clickText(text) {
  const handle = await page.evaluateHandle(
    (t) =>
      [...document.querySelectorAll("button, a, [role='tab']")].find(
        (el) => el.textContent.trim() === t,
      ),
    text,
  );
  const el = handle.asElement();
  if (!el) throw new Error(`click target not found: ${text}`);
  await el.click();
}

console.log("1/5 tickets queue…");
await page.goto(ticketUrl.replace(/\/tickets\/.*/, "/tickets"), {
  waitUntil: "networkidle0",
  timeout: 45000,
});
await pause(900);
await shoot(10); // hold on the queue

console.log("2/5 opening the ticket that just arrived by email…");
await page.goto(ticketUrl, { waitUntil: "networkidle0", timeout: 45000 });
await pause(1400);
await shoot(14); // hold on the AI draft

console.log("3/5 human edits the draft…");
// Type into the draft textarea to show it is editable before sending.
await page.click("textarea");
await page.keyboard.down("Control");
await page.keyboard.press("End");
await page.keyboard.up("Control");
for (const chunk of ["\n\nP.S. I've also", " raised your account", " priority for today."]) {
  await page.type("textarea", chunk, { delay: 22 });
  await shoot(2);
}
await pause(500);
await shoot(8);

console.log("4/5 approve & send…");
await clickText("Approve & send");
await pause(700);
await shoot(6); // sending state / toast
await pause(2200);
await shoot(6);

console.log("5/5 the reply is on the timeline…");
await page.reload({ waitUntil: "networkidle0", timeout: 45000 });
await pause(1000);
await page.evaluate(() => window.scrollBy({ top: 260, behavior: "instant" }));
await pause(400);
await shoot(16); // hold on the sent reply

await browser.close();
console.log(`captured ${frames.length} frames — encoding…`);

// -- encode ------------------------------------------------------------------
// Held beats are captured as repeated identical frames; collapsing them into a
// single frame with a longer delay keeps the pacing while cutting file size by
// several MB. Near-identical is enough (a blinking caret must not defeat it).
const FRAME_MS = 120;
// Tight enough that typed characters stay their own frames, loose enough that
// a blinking caret does not defeat the merge.
const SIMILAR = 0.0002;

console.log("downscaling…");
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
let index = 0;
for (const frame of merged) {
  const palette = quantize(frame.data, 128, { format: "rgb565" });
  const indexed = applyPalette(frame.data, palette, "rgb565");
  gif.writeFrame(indexed, frame.info.width, frame.info.height, {
    palette,
    delay: frame.delay,
  });
  if (++index % 10 === 0) console.log(`  ${index}/${merged.length}`);
}
gif.finish();
writeFileSync(outfile, Buffer.from(gif.bytes()));
console.log(`saved ${outfile}`);
