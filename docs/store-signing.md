# Browser-store signing and release guide

This repository intentionally keeps extension source public while using browser stores for browser-trusted
installation and updates. GitHub provenance proves how the ZIP was built; Chrome Web Store and Mozilla are the
authorities that sign extensions for their browsers.

## One-time Chrome Web Store setup

1. Register the Google account that will own the item in the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).
   Chrome requires two-step verification and may present a developer agreement or payment step. Review and
   accept those in your own account; they cannot be accepted by this repository or CI.
2. Upload `dist/gimme-sum-headers-chrome.zip` manually once. Complete the Store Listing and Privacy tabs, set
   the intended visibility, and publish it. The initial manual publish is required before CI can publish later
   updates through the API.
3. Create a Google Cloud OAuth web client with the Chrome Web Store scope. Store the three long-lived
   credentials below only in the GitHub environment, never in git:

   - `CWS_CLIENT_ID` (secret)
   - `CWS_CLIENT_SECRET` (secret)
   - `CWS_REFRESH_TOKEN` (secret)

4. Put the Store's publisher and item identifiers in the same environment:

   - `CWS_PUBLISHER_ID` (GitHub Actions variable)
   - `CWS_ITEM_ID` (GitHub Actions variable)

Chrome Web Store signs and delivers the resulting CRX. `codesign` and a macOS signing certificate do not apply
to this pure WebExtension. A separate CRX private key is not generated or stored by this project.

## One-time Firefox setup

1. Register the owning account in [AMO Developer Hub](https://addons.mozilla.org/developers/).
   Review the Firefox Add-on Distribution Agreement there.
2. Create AMO API credentials and save them as GitHub environment secrets:

   - `AMO_JWT_ISSUER`
   - `AMO_JWT_SECRET`

3. The workflow submits the staged Firefox package to a **public AMO listing** using the metadata in
   `amo-metadata.json`. The first successful submission creates the listing; subsequent tags submit updates for
   the same extension ID. Mozilla signs, reviews, hosts, and updates the add-on.
4. After the first submission appears in Developer Hub, add the public privacy-policy URL from this repository
   (`PRIVACY.md`) to the AMO listing and complete any listing fields Mozilla requests. Do not upload the XPI
   manually: GitHub Actions performs the version submission.

The release job uses `--approval-timeout=0`, meaning GitHub reports a successful **submission** without waiting
for AMO review. Firefox users can install only after AMO accepts and publishes that version.

## GitHub Actions configuration

Create a repository environment named `extension-signing`. Add the Store secrets and identifiers listed above to
that environment. The manual `Publish browser stores` workflow uses the environment. Leave its protection rules
empty when releases should publish automatically. Create the non-sensitive repository variables
`PUBLISH_CHROME` and `PUBLISH_FIREFOX` separately; leave each empty until its store setup is complete, then set
it to `true` to enable tag-triggered publication.

Once the corresponding repository variable is set to `true`, every tagged GitHub release
publishes the configured store automatically. The Chrome job submits the
package for Store review. The Firefox job submits the staged extension through AMO for public publication. The
GitHub Release contains a browser-specific upload ZIP and provenance attestation for each browser; AMO is the
Firefox installer and update source once it approves the submitted version.

The manual **Publish browser stores** workflow is reserved for the first publication and for backfilling an
existing release. Enter its tag and select only the store you intend to publish to.

## Chrome Web Store listing material

Use the following factual text when filling in the initial listing:

- **Single purpose:** Apply one user-created request-header set to each explicitly configured HTTPS site. Sets
  support Cloudflare Access headers, bearer tokens, or constrained custom request headers; an exact hostname
  replaces a wildcard default.
- **Permissions:** `storage` keeps user-created header sets and site mappings locally; `activeTab` identifies the
  HTTPS page shown in the toolbar popup; `declarativeNetRequest` adds the selected set; optional HTTPS host
  permissions are requested only for enabled scopes.
- **Data handling:** Header values, header-set names, site scopes, and local request rules remain in the browser
  profile so headers work after restart. This is not a password manager or hardware-backed secret vault. Values are
  sent only to requests matching the user-approved scope; wildcards include every matching subdomain. No telemetry,
  analytics, advertising, cloud sync, or developer-operated server exists.
- **Privacy policy URL:** `https://github.com/jeeftor/gimme-sum-headers/blob/master/PRIVACY.md`

Use the non-sensitive listing images in `store-assets/chrome/`. Do not upload screenshots containing a real
Client ID, Client Secret, Cloudflare account data, or protected hostname.

## Verify a release

Download either browser-specific ZIP and verify its provenance:

```sh
gh attestation verify gimme-sum-headers-chrome.zip --repo jeeftor/gimme-sum-headers
gh attestation verify gimme-sum-headers-firefox.zip --repo jeeftor/gimme-sum-headers
```

For a Firefox release, install from the public AMO listing and confirm future version updates arrive through AMO.
For Chrome, install through the Chrome Web Store listing and confirm future version updates arrive through the
Store.
