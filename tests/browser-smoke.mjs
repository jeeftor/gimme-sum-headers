import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

const { createHeaderRule } = createRequire(import.meta.url)("../rules.js");

const extensionPath = resolve(process.env.EXTENSION_PATH ?? "dist/chrome-package");
const echoUrl = process.env.HEADER_ECHO_URL ?? "https://httpbingo.org/headers";
const echoHost = new URL(echoUrl).hostname;
const testHeaderName = "X-Gimme-Sum-Headers-Test";
const testHeaderValue = "gimme-sum-headers-browser-smoke";
const userDataDir = await mkdtemp(resolve(tmpdir(), "gimme-sum-headers-"));
const rule = createHeaderRule({
  scope: echoHost,
  headers: [{ name: testHeaderName, value: testHeaderValue }],
}, 1);

const manifestPath = join(extensionPath, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
manifest.host_permissions = [...new Set([...(manifest.host_permissions ?? []), `https://${echoHost}/*`])];
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

try {
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
    const extensionId = new URL(worker.url()).host;
    const ruleCount = await worker.evaluate(async (value) => {
      const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: existingRules.map((item) => item.id),
        addRules: [value],
      });
      return (await chrome.declarativeNetRequest.getDynamicRules()).length;
    }, rule);
    assert.equal(ruleCount, 1);

    const page = await context.newPage();
    await page.goto(echoUrl, { waitUntil: "domcontentloaded" });
    const response = JSON.parse(await page.locator("body").innerText());

    assert.deepEqual(response.headers[testHeaderName], [testHeaderValue]);
    console.log(`Verified ${testHeaderName} through extension ${extensionId}.`);
  } finally {
    await context.close();
  }
} finally {
  await rm(userDataDir, { force: true, recursive: true });
}
