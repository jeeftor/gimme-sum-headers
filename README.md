# CF Access Header Injector

A personal, Cloudflare-only Manifest V3 extension for Chrome and Firefox. It saves one Cloudflare Access service token per HTTPS site and never offers arbitrary request-header editing.

## What it does

For each matching request for an enabled site, the browser sets:

```http
CF-Access-Client-Id: <your-client-id>
CF-Access-Client-Secret: <your-client-secret>
```

Cloudflare Access service tokens must be allowed by a **Service Auth** policy on the protected Access application. If the application has an Allow policy, Access may exchange the pair for a `CF_Authorization` cookie. With only Service Auth policies, the two headers are required on every request.

## Site profiles

Each site profile has exactly four settings:

- An HTTPS domain scope, such as `*.vookie.net` or `app.vookie.net`.
- The corresponding Cloudflare Access Client ID.
- The corresponding Cloudflare Access Client Secret.
- Whether the profile is enabled.

The browser asks for host permission only when you enable a profile. It removes no-longer-used permissions when you change, disable, or forget a profile. The extension does not support arbitrary header names, HTTP scopes, request logging, telemetry, accounts, or cloud sync.

## Install for development

Chrome or Chromium:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked** and choose this directory.

Firefox:

1. Open `about:debugging#/runtime/this-firefox`.
2. Select **Load Temporary Add-on**.
3. Choose `manifest.json` from this directory.

The extension opens its settings after installation. Add one site at a time, enter its Client ID and Client Secret, and approve the browser's narrow host-permission prompt.

## Security model

The credentials are stored in `storage.local`, never `storage.sync`, and each request rule is limited to the scope you approve. However, browser extension storage and dynamic rules are stored in the local browser profile and are not a hardware-backed secret vault. Use a dedicated least-privilege token per site, do not reuse high-privilege tokens, and revoke affected tokens immediately if the machine or browser profile is compromised.

This extension injects headers only into HTTPS network requests that reach the browser network stack. It cannot add them to a response produced entirely from a page's Service Worker or CacheStorage.

## Verify and package

```sh
make check
make package
```

`make` alone only prints the available targets.
