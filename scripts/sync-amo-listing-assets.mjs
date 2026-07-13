import { createHmac, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

const apiBase = "https://addons.mozilla.org/api/v5/addons/addon";
const issuer = process.env.AMO_JWT_ISSUER;
const secret = process.env.AMO_JWT_SECRET;

if (!issuer || !secret) {
  throw new Error("AMO_JWT_ISSUER and AMO_JWT_SECRET are required.");
}

const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
const addonGuid = manifest.browser_specific_settings?.gecko?.id;
if (typeof addonGuid !== "string" || !addonGuid) {
  throw new Error("manifest.json must define browser_specific_settings.gecko.id.");
}

function createAuthorizationHeader() {
  const issuedAt = Math.floor(Date.now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const signingInput = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
    iss: issuer,
    jti: randomUUID(),
    iat: issuedAt,
    exp: issuedAt + 60,
  })}`;
  const signature = createHmac("sha256", secret).update(signingInput).digest("base64url");
  return `JWT ${signingInput}.${signature}`;
}

async function amoRequest(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      Authorization: createAuthorizationHeader(),
      ...options.headers,
    },
  });
  if (!response.ok) {
    throw new Error(`AMO listing asset request failed with HTTP ${response.status}.`);
  }
  return response;
}

const addonEndpoint = `${apiBase}/${encodeURIComponent(addonGuid)}`;
const icon = await readFile("icons/icon-128.png");
const iconForm = new FormData();
iconForm.append("icon", new Blob([icon], { type: "image/png" }), "gimme-sum-headers-icon.png");
await amoRequest(addonEndpoint, { method: "PATCH", body: iconForm });

const addon = await (await amoRequest(addonEndpoint)).json();
for (const preview of addon.previews ?? []) {
  if (!Number.isInteger(preview.id)) {
    throw new Error("AMO returned a preview without a numeric ID.");
  }
  await amoRequest(`${addonEndpoint}/previews/${preview.id}/`, { method: "DELETE" });
}

const screenshot = await readFile("store-assets/chrome/screenshot-1280x800.png");
const previewForm = new FormData();
previewForm.append("image", new Blob([screenshot], { type: "image/png" }), "gimme-sum-headers-settings.png");
previewForm.append("position", "0");
await amoRequest(`${addonEndpoint}/previews/`, { method: "POST", body: previewForm });

console.log("AMO listing icon and screenshot synchronized.");
