import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { chromium } from "playwright";

const { createHeaderRule } = createRequire(import.meta.url)("../rules.js");

const extensionPath = resolve(process.env.EXTENSION_PATH ?? "dist/chrome-package");
const browserExecutablePath = process.env.BROWSER_EXECUTABLE_PATH;
const testHeaderName = "X-Gimme-Sum-Headers-Test";
const testHeaderValue = "gimme-sum-headers-browser-smoke";
const userDataDir = await mkdtemp(resolve(tmpdir(), "gimme-sum-headers-"));
const rule = createHeaderRule({
  scope: "httpbingo.org",
  headers: [{ name: testHeaderName, value: testHeaderValue }],
}, 1);
try {
  const context = await chromium.launchPersistentContext(userDataDir, {
    ...(browserExecutablePath ? { executablePath: browserExecutablePath } : { channel: "chromium" }),
    ignoreDefaultArgs: ["--disable-extensions"],
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

    console.log(`Registered ${testHeaderName} through extension ${extensionId}.`);

    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: "domcontentloaded" });
    await optionsPage.getByRole("button", { name: "Try safe test site" }).click();
    await assert.doesNotReject(() => optionsPage.locator(".save-bar[data-unsaved='true']").waitFor());

    await optionsPage.getByRole("button", { name: "Header check" }).click();
    await optionsPage.getByRole("button", { name: "Done" }).click();
    await optionsPage.getByRole("button", { name: "Remove site" }).click();
    const deleteHeaderSet = optionsPage.locator(".header-set-list-delete");
    await assert.doesNotReject(() => deleteHeaderSet.waitFor());
    optionsPage.once("dialog", (dialog) => dialog.accept());
    await deleteHeaderSet.click();
    assert.equal(await optionsPage.locator("#header-set-dialog").evaluate((dialog) => dialog.open), false);
    await assert.doesNotReject(() => optionsPage.getByText("No header sets yet. Create one to begin assigning headers to sites.").waitFor());
    console.log("Verified the options page shows unsaved state and handles removal clearly.");
  } finally {
    await context.close();
  }
} finally {
  await rm(userDataDir, { force: true, recursive: true });
}
