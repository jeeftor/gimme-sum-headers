import { readFileSync } from "node:fs";

const metadata = JSON.parse(readFileSync("amo-metadata.json", "utf8"));

function requireValue(condition, message) {
  if (!condition) {
    throw new Error(`Invalid amo-metadata.json: ${message}`);
  }
}

requireValue(
  typeof metadata.summary?.["en-US"] === "string" && metadata.summary["en-US"].trim(),
  "summary.en-US is required",
);
requireValue(
  Array.isArray(metadata.categories) && metadata.categories.includes("privacy-security"),
  "categories must include privacy-security",
);
requireValue(metadata.version?.license === "MPL-2.0", "version.license must be MPL-2.0");
