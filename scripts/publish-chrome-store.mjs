import { readFile } from "node:fs/promises";

const [packagePath] = process.argv.slice(2);
const requiredNames = [
  "CWS_CLIENT_ID",
  "CWS_CLIENT_SECRET",
  "CWS_REFRESH_TOKEN",
  "CWS_PUBLISHER_ID",
  "CWS_ITEM_ID",
];
const missingNames = requiredNames.filter((name) => !process.env[name]);

if (!packagePath) {
  throw new Error("Usage: node scripts/publish-chrome-store.mjs <package.zip>");
}

if (missingNames.length > 0) {
  throw new Error(`Missing required Chrome Web Store configuration: ${missingNames.join(", ")}.`);
}

const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
  body: new URLSearchParams({
    client_id: process.env.CWS_CLIENT_ID,
    client_secret: process.env.CWS_CLIENT_SECRET,
    grant_type: "refresh_token",
    refresh_token: process.env.CWS_REFRESH_TOKEN,
  }),
  headers: { "content-type": "application/x-www-form-urlencoded" },
  method: "POST",
});

if (!tokenResponse.ok) {
  throw new Error(`Chrome Web Store OAuth refresh failed with HTTP ${tokenResponse.status}.`);
}

const { access_token: accessToken } = await tokenResponse.json();

if (typeof accessToken !== "string" || accessToken.length === 0) {
  throw new Error("Chrome Web Store OAuth refresh did not return an access token.");
}

const itemPath = `publishers/${encodeURIComponent(process.env.CWS_PUBLISHER_ID)}/items/${encodeURIComponent(process.env.CWS_ITEM_ID)}`;
const authorization = { authorization: `Bearer ${accessToken}` };
const uploadResponse = await fetch(`https://chromewebstore.googleapis.com/upload/v2/${itemPath}:upload`, {
  body: await readFile(packagePath),
  headers: { ...authorization, "content-type": "application/zip" },
  method: "POST",
});

if (!uploadResponse.ok) {
  throw new Error(`Chrome Web Store upload failed with HTTP ${uploadResponse.status}.`);
}

const upload = await uploadResponse.json();
let uploadState = upload.uploadState;

for (let attempt = 0; uploadState === "IN_PROGRESS" && attempt < 30; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 1000));

  const statusResponse = await fetch(`https://chromewebstore.googleapis.com/v2/${itemPath}:fetchStatus`, {
    headers: authorization,
  });

  if (!statusResponse.ok) {
    throw new Error(`Chrome Web Store upload-status request failed with HTTP ${statusResponse.status}.`);
  }

  const status = await statusResponse.json();
  uploadState = status.lastAsyncUploadState;
}

if (uploadState !== "SUCCEEDED") {
  throw new Error(`Chrome Web Store upload did not succeed; final state: ${uploadState ?? "unknown"}.`);
}

console.log("Chrome Web Store upload completed.");

const publishResponse = await fetch(`https://chromewebstore.googleapis.com/v2/${itemPath}:publish`, {
  headers: authorization,
  method: "POST",
});

if (!publishResponse.ok) {
  throw new Error(`Chrome Web Store publish submission failed with HTTP ${publishResponse.status}.`);
}

const publication = await publishResponse.json();
console.log(`Chrome Web Store publication state: ${publication.state ?? "unknown"}.`);
