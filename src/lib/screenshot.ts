// Server-side page rendering for the screenshot tool.
//
// Uses puppeteer-core against a Chrome/Chromium already on the host, so the
// image stays lean: set PUPPETEER_EXECUTABLE_PATH (or install Chrome in a
// standard location) to enable it. Without a browser the tool degrades the
// same way the GitHub tools do without a token — it says so instead of
// pretending.

import { existsSync } from "fs";

const CANDIDATE_PATHS = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  process.env.CHROME_PATH,
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
].filter(Boolean) as string[];

export function browserExecutable(): string | null {
  return CANDIDATE_PATHS.find((p) => existsSync(p)) ?? null;
}

export interface CaptureOptions {
  url: string;
  width?: number;
  height?: number;
  fullPage?: boolean;
  /** CSS selector to wait for before shooting (page-specific readiness). */
  waitFor?: string;
}

/**
 * Render a URL and return a PNG. Throws with a readable message — callers are
 * tools, which turn it into a tool_result the model can react to.
 */
export async function capture(options: CaptureOptions): Promise<Buffer> {
  const executablePath = browserExecutable();
  if (!executablePath) {
    throw new Error(
      "No browser available on the server. Set PUPPETEER_EXECUTABLE_PATH to a Chrome/Chromium binary to enable screenshots.",
    );
  }
  let url: URL;
  try {
    url = new URL(options.url);
  } catch {
    throw new Error("Invalid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http and https URLs can be captured.");
  }

  const puppeteer = (await import("puppeteer-core")).default;
  const browser = await puppeteer.launch({
    executablePath,
    headless: "shell",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({
      width: Math.min(Math.max(options.width ?? 1280, 320), 2000),
      height: Math.min(Math.max(options.height ?? 800, 320), 2000),
      deviceScaleFactor: 2, // supersampled: small UI text stays legible
    });
    const response = await page.goto(url.toString(), {
      waitUntil: "networkidle0",
      timeout: 25_000,
    });
    // Raw file hosts (raw.githubusercontent.com and friends) serve HTML as
    // text/plain, so the browser shows source instead of the page. Re-render
    // the body as a document — this is what makes "screenshot the result of
    // my branch" work before anything is deployed.
    const contentType = String(response?.headers()["content-type"] ?? "");
    if (contentType.includes("text/plain")) {
      const text = await page.evaluate(() => document.body.innerText);
      if (/^\s*<(!doctype|html)/i.test(text)) {
        // "load" rather than networkidle0: setContent can sit forever waiting
        // for network events that never come once the document is injected.
        await page.setContent(text, { waitUntil: "load", timeout: 20_000 });
        await new Promise((r) => setTimeout(r, 1200)); // webfonts
      }
    }
    if (options.waitFor) {
      await page.waitForSelector(options.waitFor, { timeout: 8_000 }).catch(() => {});
    }
    await new Promise((r) => setTimeout(r, 600)); // let fonts/animations settle
    const shot = await page.screenshot({ type: "png", fullPage: options.fullPage ?? false });
    return Buffer.from(shot);
  } finally {
    await browser.close();
  }
}
