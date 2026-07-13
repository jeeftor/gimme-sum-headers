(function exposeCfAccessRules(root, factory) {
  const rules = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = rules;
  }

  root.CfAccessRules = rules;
})(globalThis, function createCfAccessRules() {
  /**
   * Normalizes an HTTPS hostname or wildcard suffix for use in extension rules.
   *
   * @param {string} value A hostname such as "app.example.com" or "*.example.com".
   * @returns {{domain: string, wildcard: boolean, hostPermission: string, regexFilter: string}}
   * @throws {Error} When the supplied hostname is not safe to turn into a request rule.
   */
  function normalizeScope(value) {
    const scope = value.trim().toLowerCase();
    const wildcard = scope.startsWith("*.");
    const domain = wildcard ? scope.slice(2) : scope;

    if (!domain || domain.length > 253 || !isValidDomain(domain)) {
      throw new Error("Enter a hostname such as app.example.com or *.example.com.");
    }

    return {
      domain,
      wildcard,
      hostPermission: wildcard ? `https://*.${domain}/*` : `https://${domain}/*`,
      regexFilter: createRegexFilter(domain, wildcard),
    };
  }

  /**
   * Creates one declarative rule that sets both Cloudflare service-token headers.
   *
   * @param {{scope: string, clientId: string, clientSecret: string}} configuration A Cloudflare Access site profile.
   * @param {number} id The positive declarative rule ID for this profile.
   * @returns {object} A declarativeNetRequest rule.
   */
  function createHeaderRule(configuration, id) {
    if (!Number.isInteger(id) || id < 1) {
      throw new Error("A Cloudflare profile rule ID must be a positive integer.");
    }

    const scope = normalizeScope(configuration.scope);

    return {
      id,
      priority: 1,
      action: {
        type: "modifyHeaders",
        requestHeaders: [
          {
            header: "CF-Access-Client-Id",
            operation: "set",
            value: configuration.clientId,
          },
          {
            header: "CF-Access-Client-Secret",
            operation: "set",
            value: configuration.clientSecret,
          },
        ],
      },
      condition: {
        regexFilter: scope.regexFilter,
      },
    };
  }

  /**
   * Determines whether two normalized domain scopes can match the same HTTPS request.
   *
   * @param {{domain: string, wildcard: boolean}} first The first normalized scope.
   * @param {{domain: string, wildcard: boolean}} second The second normalized scope.
   * @returns {boolean} Whether the scopes overlap.
   */
  function scopesOverlap(first, second) {
    if (!first.wildcard && !second.wildcard) {
      return first.domain === second.domain;
    }

    if (first.wildcard && second.wildcard) {
      return first.domain === second.domain
        || first.domain.endsWith(`.${second.domain}`)
        || second.domain.endsWith(`.${first.domain}`);
    }

    const wildcardScope = first.wildcard ? first : second;
    const exactScope = first.wildcard ? second : first;
    return exactScope.domain.endsWith(`.${wildcardScope.domain}`);
  }

  /**
   * Checks that a hostname is made of valid DNS labels.
   *
   * @param {string} domain A hostname without a wildcard prefix.
   * @returns {boolean} Whether the hostname is valid.
   */
  function isValidDomain(domain) {
    return domain.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
  }

  /**
   * Escapes a literal hostname for the RE2-compatible declarative rule format.
   *
   * @param {string} value A hostname.
   * @returns {string} The escaped hostname.
   */
  function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /**
   * Restricts matching to HTTPS and either one host or one-or-more subdomains.
   *
   * @param {string} domain A validated hostname.
   * @param {boolean} wildcard Whether subdomains, but not the apex, should match.
   * @returns {string} A declarativeNetRequest regex filter.
   */
  function createRegexFilter(domain, wildcard) {
    const host = escapeRegex(domain);
    const prefix = wildcard ? "(?:[a-z0-9-]+\\.)+" : "";
    return `^https://${prefix}${host}(?::[0-9]+)?(?:/|$)`;
  }

  return {
    createHeaderRule,
    normalizeScope,
    scopesOverlap,
  };
});
