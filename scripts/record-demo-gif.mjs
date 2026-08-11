// Records the README demo: one continuous read-through of a worked ticket —
// the request, the before/after the agent captured, the run it performed and
// the human approvals — as a single slow scroll rather than a series of cuts.
//
// Two things make it read as motion instead of a slideshow: the scroll advances
// a few pixels per captured frame (never jumps), and the before/after images
// are shown zoomed into the region that actually changed, so the difference is
// legible at README width.
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
const origin = new URL(ticketUrl).origin;

const CHROME_PATHS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];
const executablePath = CHROME_PATHS.find((p) => existsSync(p));
if (!executablePath) throw new Error("Chrome not found");

const VIEW = { width: 1240, height: 700 };
const SIDEBAR = 264; // cropped away: it never moves, and costs a fifth of every frame
const GIF_WIDTH = 760;
const FRAME_MS = 80;
const SCROLL_PX = 36; // per frame — a comfortable reading speed
const frames = []; // { png } | { composed: Buffer }

const browser = await puppeteer.launch({ executablePath, headless: "shell" });
const page = await browser.newPage();
await page.setViewport({ ...VIEW, deviceScaleFactor: 2 });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function shoot(times = 1) {
  for (let i = 0; i < times; i++) frames.push({ png: await page.screenshot({ type: "png" }) });
}
/** Scroll down `distance` px, photographing every small step. */
async function scrollBySmoothly(distance) {
  let moved = 0;
  while (moved < distance) {
    const step = Math.min(SCROLL_PX, distance - moved);
    await page.evaluate((s) => window.scrollBy(0, s), step);
    moved += step;
    await shoot(1);
  }
}
async function offsetOf(text) {
  return page.evaluate((t) => {
    const el = [...document.querySelectorAll("h1,h2,h3,summary,figcaption,p,span,code")].find((n) =>
      n.textContent?.trim().toLowerCase().includes(t.toLowerCase()),
    );
    return el ? window.scrollY + el.getBoundingClientRect().top - 110 : null;
  }, text);
}

/** A labelled, zoomed crop of one of the screenshots the agent attached. */
async function comparisonFrame(attachmentId, label, tone) {
  const res = await fetch(`${origin}/api/attachments/${attachmentId}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const meta = await sharp(buf).metadata();
  // The nav button sits in the upper-right of these captures.
  const crop = await sharp(buf)
    .extract({
      left: Math.round(meta.width * 0.54),
      top: 0,
      width: Math.round(meta.width * 0.44),
      height: Math.round(meta.height * 0.34),
    })
    .resize({ width: GIF_WIDTH })
    .toBuffer();
  const cropMeta = await sharp(crop).metadata();
  const barHeight = 64;
  const svg = Buffer.from(
    `<svg width="${GIF_WIDTH}" height="${barHeight}">
       <rect width="100%" height="100%" fill="#04170f"/>
       <text x="28" y="42" font-family="Helvetica,Arial" font-size="30" font-weight="bold" fill="${tone}">${label}</text>
     </svg>`,
  );
  return sharp({
    create: {
      width: GIF_WIDTH,
      height: cropMeta.height + barHeight,
      channels: 4,
      background: { r: 4, g: 23, b: 15, alpha: 1 },
    },
  })
    .composite([
      { input: svg, top: 0, left: 0 },
      { input: crop, top: barHeight, left: 0 },
    ])
    .png()
    .toBuffer();
}

console.log("1/4 the request, as it arrived by email…");
await page.goto(ticketUrl, { waitUntil: "networkidle0", timeout: 45000 });
await pause(1200);
await shoot(26); // ~2s to read who asked and what for

console.log("2/4 down to the screenshots the agent attached…");
const galleryY = await offsetOf("Screenshots");
if (galleryY !== null) {
  const from = await page.evaluate(() => window.scrollY);
  await scrollBySmoothly(Math.max(0, galleryY - from));
}
await shoot(20);

console.log("3/4 the before/after, zoomed to the button that changed…");
const shots = await (await fetch(`${origin}/api/tickets/${ticketUrl.split("/tickets/")[1]}`)).json();
const attachments = shots.ticket?.attachments ?? [];
const before = attachments.find((a) => /before/i.test(a.caption));
const after = attachments.find((a) => /after/i.test(a.caption));
if (before && after) {
  const beforeFrame = await comparisonFrame(before.id, "BEFORE — label unreadable", "#f3a4a4");
  const afterFrame = await comparisonFrame(after.id, "AFTER — fixed by the agent", "#25d97f");
  for (let i = 0; i < 22; i++) frames.push({ png: beforeFrame });
  for (let i = 0; i < 24; i++) frames.push({ png: afterFrame });
} else {
  console.warn("   (no before/after attachments found — skipping the zoom)");
}

console.log("4/4 one continuous read-through to the end of the ticket…");
const remaining = await page.evaluate(
  () => document.body.scrollHeight - window.scrollY - window.innerHeight,
);
await scrollBySmoothly(Math.max(0, remaining));
await shoot(22);

await browser.close();
console.log(`captured ${frames.length} frames — encoding…`);

// Identical frames (deliberate holds) collapse into one with a longer delay.
const SIMILAR = 0.0002;
const raws = [];
for (const frame of frames) {
  let img = sharp(frame.png);
  const meta = await img.metadata();
  // Crop the static sidebar off page captures; composed frames are already
  // the right shape.
  if (meta.width > GIF_WIDTH * 1.6) {
    img = sharp(frame.png).extract({
      left: SIDEBAR * 2,
      top: 0,
      width: meta.width - SIDEBAR * 2,
      height: meta.height,
    });
  }
  raws.push(await img.resize({ width: GIF_WIDTH }).ensureAlpha().raw().toBuffer({ resolveWithObject: true }));
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
  if (last && last.info.height === frame.info.height && nearlyEqual(last.data, frame.data)) {
    last.delay += FRAME_MS;
  } else {
    merged.push({ data: frame.data, info: frame.info, delay: FRAME_MS });
  }
}
console.log(`${frames.length} frames → ${merged.length} after merging holds`);

// A GIF has one canvas: pad every frame to the tallest so the zoomed
// comparison frames sit on the same stage as the page captures.
const canvasHeight = Math.max(...merged.map((f) => f.info.height));
const gif = GIFEncoder();
for (const frame of merged) {
  let data = frame.data;
  if (frame.info.height !== canvasHeight) {
    const padded = Buffer.alloc(GIF_WIDTH * canvasHeight * 4);
    for (let i = 0; i < padded.length; i += 4) {
      padded[i] = 4;
      padded[i + 1] = 23;
      padded[i + 2] = 15;
      padded[i + 3] = 255;
    }
    const offset = Math.floor((canvasHeight - frame.info.height) / 2) * GIF_WIDTH * 4;
    frame.data.copy(padded, offset);
    data = padded;
  }
  const palette = quantize(data, 64, { format: "rgb565" });
  const indexed = applyPalette(data, palette, "rgb565");
  gif.writeFrame(indexed, GIF_WIDTH, canvasHeight, { palette, delay: frame.delay });
}
gif.finish();
writeFileSync(outfile, Buffer.from(gif.bytes()));
console.log(`saved ${outfile}`);
