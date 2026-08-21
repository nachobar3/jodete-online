import { chromium } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const url = pathToFileURL(resolve("design-loop/button-preview.html")).href;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 460, height: 900 }, deviceScaleFactor: 2 });
await page.goto(url, { waitUntil: "networkidle" });
// Give webfonts a beat to settle
await page.waitForTimeout(1200);
await page.screenshot({ path: "design-loop/button-alternatives.png", fullPage: true });
await browser.close();
console.log("ok");
