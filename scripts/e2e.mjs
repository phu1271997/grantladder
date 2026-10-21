// Drive the production build in real Chrome, read-path only (no wallet), against live StudioNet state.
import { chromium } from "playwright-core";
const BASE = process.env.BASE || "http://localhost:4179";
const results = [];
const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext();
const page = await ctx.newPage();
const consoleErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", (e) => consoleErrors.push("pageerror: " + e.message));

async function check(name, fn) {
  try { await fn(); results.push([true, name]); console.log("  ok  ", name); }
  catch (e) { results.push([false, name]); console.log(" FAIL ", name, "—", e.message || e); }
}
const vis = async (sel, timeout = 30000) => page.waitForSelector(sel, { state: "visible", timeout });
const txt = async (sel) => (await page.textContent(sel))?.trim();

await check("home renders hero + nav", async () => {
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await vis("header nav");
  await vis(".hero h1");
  if (!(await page.$$("nav a")).length) throw new Error("no nav links");
});

await check("explorer lists grant with released rungs", async () => {
  await page.goto(BASE + "/explorer", { waitUntil: "networkidle" });
  await vis(".xtable .xrow", 30000);
  if ((await page.$$(".xtable .xrow")).length < 1) throw new Error("no grant rows");
  if (!/rungs/.test(await txt("main"))) throw new Error("no rung summary");
});

await check("grant #0 shows two released rungs + verdicts", async () => {
  await page.goto(BASE + "/grants/0", { waitUntil: "networkidle" });
  await vis(".rungs .rung", 30000);
  const t = await txt("main");
  if ((await page.$$(".rungs .rung")).length < 2) throw new Error("expected >=2 rungs");
  if (!/RELEASED|CLAIMED/.test(t)) throw new Error("no released/claimed rung");
  if (!/RELEASE/.test(t)) throw new Error("no RELEASE verdict");
});

await check("non-existent grant shows clean not-found (no crash)", async () => {
  await page.goto(BASE + "/grants/999", { waitUntil: "networkidle" });
  await vis(".empty", 30000);
  if (!/No grant #999/.test(await txt("main"))) throw new Error("no not-found message");
});

await check("create page renders with disabled submit when no wallet", async () => {
  await page.goto(BASE + "/create", { waitUntil: "networkidle" });
  await vis(".form");
  const btn = await page.$(".form button.primary");
  if (!btn || !(await btn.isDisabled())) throw new Error("submit should be disabled without a wallet");
});

await check("deep route served (SPA) + no console errors", async () => {
  if (consoleErrors.length) throw new Error(consoleErrors.slice(0, 3).join(" | "));
});

await browser.close();
const failed = results.filter((r) => !r[0]);
console.log(`\nE2E: ${results.length - failed.length}/${results.length} passed`);
if (consoleErrors.length) console.log("console errors:", consoleErrors.slice(0, 5));
process.exit(failed.length ? 1 : 0);
