import { readFile } from "node:fs/promises";

const [tag] = process.argv.slice(2);

if (!tag) {
  throw new Error("Usage: node scripts/check-release-version.mjs <tag>");
}

const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
const expectedTag = `v${manifest.version}`;

if (tag !== expectedTag) {
  throw new Error(`Release tag ${tag} must match manifest version ${expectedTag}.`);
}
