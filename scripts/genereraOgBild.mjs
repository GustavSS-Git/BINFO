/**
 * Renders public/og.png (1200x630): the "Binfo" wordmark and the landing
 * tagline on the site's background colour, set in the site's own fonts
 * (public/fonts). Colours are the tokens from src/styles.css (:root).
 *
 * Playwright is not a project dependency. Point PLAYWRIGHT_DIR at any folder
 * that has `playwright` in its node_modules (and, if the cached Chromium build
 * differs from the one that version expects, CHROMIUM_PATH at the executable):
 *
 *   PLAYWRIGHT_DIR=/tmp/pw node scripts/genereraOgBild.mjs
 *
 * Re-running overwrites public/og.png. Dynamic per-page OG images are a
 * follow-up (docs/PLAN-v3.md §6).
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const rot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(process.env.PLAYWRIGHT_DIR ?? rot, "noop.js"));
const { chromium } = require("playwright");

const fonter = pathToFileURL(path.join(rot, "public", "fonts")).href;
const html = `<!doctype html>
<html lang="sv"><head><meta charset="utf-8"><style>
  @font-face { font-family: "Libre Baskerville"; src: url("${fonter}/LibreBaskerville-Regular.ttf"); }
  @font-face { font-family: "IBM Plex Sans"; src: url("${fonter}/IBMPlexSans-Regular.ttf"); }
  html, body { margin: 0; width: 1200px; height: 630px; }
  body {
    background: oklch(0.982 0.004 85);
    color: oklch(0.205 0.006 80);
    display: flex; flex-direction: column; justify-content: center; padding: 0 120px;
    box-sizing: border-box;
  }
  .ord { font-family: "Libre Baskerville", Georgia, serif; font-size: 200px; letter-spacing: -0.02em; line-height: 1; }
  .rad { margin-top: 28px; width: 96px; height: 6px; background: oklch(0.53 0.075 125); border-radius: 3px; }
  .tag { margin-top: 28px; font-family: "IBM Plex Sans", system-ui, sans-serif; font-size: 44px; color: oklch(0.535 0.012 80); }
</style></head><body>
  <div class="ord">Binfo</div>
  <div class="rad"></div>
  <div class="tag">Vet vad du budar på.</div>
</body></html>`;

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const sida = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await sida.setContent(html);
await sida.evaluate(() => document.fonts.ready);
await sida.screenshot({ path: path.join(rot, "public", "og.png") });
await browser.close();
console.log("Skrev public/og.png");
