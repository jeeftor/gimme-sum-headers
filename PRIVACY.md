# Privacy policy

Gimme Sum Headers! operates entirely in your browser profile. It has no account system, analytics, advertising, remote configuration, telemetry, or server operated by this project.

## Information you provide

You create named header sets and map them to HTTPS hostnames or wildcard hostnames. A header set may contain Cloudflare Access credentials, a bearer token, or custom request-header values. The extension stores those values, the header-set names, and site mappings only in your browser's local extension storage. It does not synchronize them through the browser's cloud-sync service.

## How the information is used

When you enable a site mapping and approve its narrow HTTPS host permission, the extension adds that mapping's selected header set only to requests matching the approved scope. An exact hostname mapping replaces a matching wildcard default; header sets never merge. Header values are sent directly to the site you selected as part of its request. The extension does not read request or response bodies, browser history, cookies, or page content.

## Sharing and retention

This project does not receive, retain, sell, share, or transfer your information. Your browser retains the local configuration until you remove a mapping or header set, or choose **Forget all configuration**. A selected site receives the mapped request headers as described above; that site's own privacy practices apply to its handling of those requests.

When you select **Check for update**, the extension asks permission to make a one-time request to GitHub's public releases API. The request contains no header-set values or account credentials, and the extension does not check automatically or send any information to the project.

## Security

The extension stores header values in local extension storage and installs local browser request rules containing those values so they continue working after a browser restart. This storage is not a password manager, encrypted secret vault, or hardware-backed credential store. Treat the browser profile and device as part of the credential's security boundary.

Use dedicated, least-privilege credentials, prefer exact hosts over wildcards, and enable full-disk encryption. A wildcard mapping sends its header set to every matching subdomain. If the browser profile or device is compromised, revoke affected credentials at their issuer. **Forget all configuration** removes local header values, request rules, mappings, and host permissions; it cannot revoke a credential remotely.

Last updated: 2026-07-14.
