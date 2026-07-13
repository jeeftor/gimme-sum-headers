import { cp, mkdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";

const [browser, sourceDirectory, destinationDirectory] = process.argv.slice(2);
const supportedBrowsers = new Set(["chrome", "firefox"]);
const minimumZipTimestamp = 315532800;

if (!supportedBrowsers.has(browser) || !sourceDirectory || !destinationDirectory) {
  throw new Error("Usage: node scripts/prepare-browser-package.mjs <chrome|firefox> <source> <destination>");
}

const sourceDateEpoch = Number.parseInt(process.env.SOURCE_DATE_EPOCH ?? "", 10);

if (!Number.isInteger(sourceDateEpoch) || sourceDateEpoch < minimumZipTimestamp) {
  throw new Error("SOURCE_DATE_EPOCH must be an integer Unix timestamp on or after 1980-01-01.");
}

await rm(destinationDirectory, { force: true, recursive: true });
await mkdir(destinationDirectory, { recursive: true });
await cp(sourceDirectory, destinationDirectory, { recursive: true });

const manifestPath = join(destinationDirectory, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

if (browser === "chrome") {
  delete manifest.background.scripts;
} else {
  delete manifest.background.service_worker;
}

await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
await utimes(manifestPath, sourceDateEpoch, sourceDateEpoch);
