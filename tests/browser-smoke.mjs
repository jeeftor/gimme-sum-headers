import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { chromium } from "playwright";

const extensionPath = resolve(process.env.EXTENSION_PATH ?? "dist/chrome-package");
const echoUrl = process.env.HEADER_ECHO_URL ?? "https://httpbingo.org/headers";
const echoHost = new URL(echoUrl).hostname;
const testHeaderName = "X-Gimme-Sum-Headers-Test";
const testHeaderValue = "gimme-sum-headers-browser-smoke";
const userDataDir = await mkdtemp(resolve(tmpdir(), "gimme-sum-headers-"));

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
    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/options.html`);
    await optionsPage.locator(".header-set-name").fill("Browser smoke test");
    await optionsPage.locator(".header-set-kind").selectOption("custom");
    await optionsPage.locator(".custom-header-name").fill(testHeaderName);
    await optionsPage.locator(".custom-header-value").fill(testHeaderValue);
    await optionsPage.locator("#add-assignment").click();
    await optionsPage.locator(".assignment-scope").fill(echoHost);
    await optionsPage.locator(".assignment-header-set").selectOption({ label: "Browser smoke test" });
    await optionsPage.getByRole("button", { name: "Save configuration" }).click();
    await optionsPage.getByText("Enabled 1 site with reusable header sets.").waitFor();

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
