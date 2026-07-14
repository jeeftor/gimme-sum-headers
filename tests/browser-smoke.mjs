import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

const { createHeaderRule } = createRequire(import.meta.url)("../rules.js");

const extensionPath = resolve(process.env.EXTENSION_PATH ?? "dist/chrome-package");
const testEchoUrl = "https://httpbingo.org/headers";
const browserExecutablePath = process.env.BROWSER_EXECUTABLE_PATH;
const testHeaderName = "X-Gimme-Sum-Headers-Test";
const testHeaderValue = "gimme-sum-headers-browser-smoke";
const userDataDir = await mkdtemp(resolve(tmpdir(), "gimme-sum-headers-"));
const echoServer = createServer((request, response) => {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ headers: request.headers }));
});
await new Promise((resolve, reject) => {
  echoServer.once("error", reject);
  echoServer.listen(0, "127.0.0.1", resolve);
});
const echoAddress = echoServer.address();
assert.ok(echoAddress && typeof echoAddress !== "string");
const echoUrl = `http://127.0.0.1:${echoAddress.port}/headers`;
const rule = createHeaderRule({
  scope: "127.0.0.1",
  headers: [{ name: testHeaderName, value: testHeaderValue }],
}, 1);
rule.condition.regexFilter = `^http://127\\.0\\.0\\.1:${echoAddress.port}(?:/|$)`;

const manifestPath = join(extensionPath, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
manifest.host_permissions = [...new Set([...(manifest.host_permissions ?? []), "http://127.0.0.1/*"])];
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

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

    const page = await context.newPage();
    await page.goto(echoUrl, { waitUntil: "domcontentloaded" });
    const response = JSON.parse(await page.locator("body").innerText());
    assert.equal(response.headers[testHeaderName.toLowerCase()], testHeaderValue);
    console.log(`Verified ${testHeaderName} through extension ${extensionId}.`);

    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: "domcontentloaded" });
    await optionsPage.getByRole("button", { name: "Add test site" }).click();
    await assert.doesNotReject(() => optionsPage.locator(".save-bar[data-unsaved='true']").waitFor());
    await optionsPage.getByRole("button", { name: "Save & test headers" }).click();
    await assert.doesNotReject(() => optionsPage.getByText("Saved. Choose Test headers to open the header echo.").waitFor());

    const testPagePromise = context.waitForEvent("page");
    await optionsPage.getByRole("button", { name: "Test headers" }).click();
    const testPage = await testPagePromise;
    await testPage.waitForURL(testEchoUrl);

    await optionsPage.getByRole("button", { name: "Header check" }).click();
    await optionsPage.getByRole("button", { name: "Remove site" }).click();
    await optionsPage.getByRole("button", { name: "Done" }).click();
    const deleteHeaderSet = optionsPage.locator(".header-set-list-delete");
    await assert.doesNotReject(() => deleteHeaderSet.waitFor());
    optionsPage.once("dialog", (dialog) => dialog.accept());
    await deleteHeaderSet.click();
    assert.equal(await optionsPage.locator("#header-set-dialog").evaluate((dialog) => dialog.open), false);
    await assert.doesNotReject(() => optionsPage.getByText("No header sets yet. Create one, then select it for a site.").waitFor());
    console.log("Verified the options page shows unsaved state and handles removal clearly.");
  } finally {
    await context.close();
  }
} finally {
  await new Promise((resolve, reject) => {
    echoServer.close((error) => error ? reject(error) : resolve());
  });
  await rm(userDataDir, { force: true, recursive: true });
}
