(function exposeHeaderRules(root, factory) {
  const rules = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = rules;
  }

  root.HeaderRules = rules;
})(globalThis, function createHeaderRules() {
  const CLOUD_FLARE_CLIENT_ID = "CF-Access-Client-Id";
  const CLOUD_FLARE_CLIENT_SECRET = "CF-Access-Client-Secret";
  const FORBIDDEN_HEADERS = new Set([
    "connection",
    "content-length",
    "cookie",
    "host",
    "keep-alive",
    "origin",
    "referer",
    "set-cookie",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "user-agent",
  ]);
  const HEADER_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

  /**
   * Normalizes an HTTPS hostname or wildcard suffix for browser rule generation.
   *
   * @param {string} value A hostname such as "app.example.com" or "*.example.com".
   * @returns {{canonical: string, domain: string, wildcard: boolean, hostPermission: string, regexFilter: string}}
   * @throws {Error} When the hostname is unsafe to turn into a request rule.
   */
  function normalizeScope(value) {
    const scope = String(value ?? "").trim().toLowerCase();
    const wildcard = scope.startsWith("*.");
    const domain = wildcard ? scope.slice(2) : scope;

    if (!domain || domain.length > 253 || !isValidDomain(domain)) {
      throw new Error("Enter an HTTPS hostname such as app.example.com or *.example.com.");
    }

    return {
      canonical: wildcard ? `*.${domain}` : domain,
      domain,
      wildcard,
      hostPermission: wildcard ? `https://*.${domain}/*` : `https://${domain}/*`,
      regexFilter: createRegexFilter(domain, wildcard),
    };
  }

  /**
   * Produces the two fixed Cloudflare Access service-token headers.
   *
   * @param {string} clientId Cloudflare Access service-token client ID.
   * @param {string} clientSecret Cloudflare Access service-token client secret.
   * @returns {Array<{name: string, value: string}>} Normalized header pairs.
   */
  function createCloudflareHeaders(clientId, clientSecret) {
    return normalizeHeaders([
      { name: CLOUD_FLARE_CLIENT_ID, value: clientId },
      { name: CLOUD_FLARE_CLIENT_SECRET, value: clientSecret },
    ]);
  }

  /**
   * Produces an Authorization header from a bearer token.
   *
   * @param {string} token Bearer token without its scheme prefix.
   * @returns {Array<{name: string, value: string}>} A normalized Authorization header.
   */
  function createBearerHeaders(token) {
    const normalizedToken = String(token ?? "").trim();
    if (!normalizedToken) {
      throw new Error("Enter a bearer token.");
    }

    return normalizeHeaders([{ name: "Authorization", value: `Bearer ${normalizedToken}` }]);
  }

  /**
   * Validates one reusable header set.
   *
   * @param {{id?: string, name?: string, kind?: string, headers?: Array<object>}} value A header set.
   * @returns {{id: string, name: string, kind: string, headers: Array<{name: string, value: string}>}} A normalized set.
   */
  function normalizeHeaderSet(value) {
    const id = String(value?.id ?? "").trim();
    const name = String(value?.name ?? "").trim();
    const kind = String(value?.kind ?? "custom");

    if (!id) {
      throw new Error("Every header set needs an identifier.");
    }
    if (!name) {
      throw new Error("Every header set needs a name.");
    }
    if (!new Set(["cloudflare-access", "bearer-token", "custom"]).has(kind)) {
      throw new Error("Unknown header-set type.");
    }

    const headers = normalizeHeaders(value?.headers);
    validatePresetHeaders(kind, headers);

    return { id, name, kind, headers };
  }

  /**
   * Validates and normalizes user-entered request headers.
   *
   * @param {Array<object>} value Header name/value pairs.
   * @returns {Array<{name: string, value: string}>} Normalized header pairs.
   */
  function normalizeHeaders(value) {
    if (!Array.isArray(value) || value.length === 0) {
      throw new Error("Every header set needs at least one header.");
    }

    const seen = new Set();
    return value.map((header) => {
      const name = String(header?.name ?? "").trim();
      const headerValue = String(header?.value ?? "").trim();
      const loweredName = name.toLowerCase();

      if (!HEADER_TOKEN.test(name)) {
        throw new Error(`Header name ${name || "(blank)"} is not valid.`);
      }
      if (isForbiddenHeader(loweredName)) {
        throw new Error(`The ${name} header is not allowed for safety.`);
      }
      if (!headerValue || /[\r\n]/.test(headerValue)) {
        throw new Error(`Header ${name} needs a non-empty single-line value.`);
      }
      if (seen.has(loweredName)) {
        throw new Error(`Header ${name} is listed more than once in this set.`);
      }

      seen.add(loweredName);
      return { name, value: headerValue };
    });
  }

  /**
   * Validates all header sets and site assignments as one configuration.
   *
   * @param {{headerSets?: Array<object>, siteAssignments?: Array<object>}} value A configuration state.
   * @returns {{headerSets: Array<object>, siteAssignments: Array<object>}} A normalized state.
   */
  function normalizeConfiguration(value) {
    const headerSets = Array.isArray(value?.headerSets) ? value.headerSets.map(normalizeHeaderSet) : [];
    const siteAssignments = Array.isArray(value?.siteAssignments)
      ? value.siteAssignments.map(normalizeSiteAssignment)
      : [];
    const setIds = new Set();
    const scopes = new Set();
    const wildcardScopes = [];

    for (const headerSet of headerSets) {
      if (setIds.has(headerSet.id)) {
        throw new Error(`Header set ${headerSet.name} is listed more than once.`);
      }
      setIds.add(headerSet.id);
    }

    for (const assignment of siteAssignments) {
      if (!setIds.has(assignment.headerSetId)) {
        throw new Error(`The site ${assignment.scope} refers to a missing header set.`);
      }
      if (scopes.has(assignment.scope)) {
        throw new Error(`The site ${assignment.scope} is listed more than once.`);
      }

      scopes.add(assignment.scope);
      const scope = normalizeScope(assignment.scope);
      if (scope.wildcard) {
        if (wildcardScopes.some((existingScope) => scopesOverlap(scope, existingScope))) {
          throw new Error(`Wildcard site ${assignment.scope} overlaps another wildcard default.`);
        }
        wildcardScopes.push(scope);
      }
    }

    return { headerSets, siteAssignments };
  }

  /**
   * Compiles active assignments to dynamic request-header rules.
   *
   * @param {{headerSets: Array<object>, siteAssignments: Array<object>}} value A normalized configuration.
   * @param {Iterable<string>} permittedScopes Canonical scopes with browser host permission.
   * @returns {Array<object>} Browser dynamic rules.
   */
  function compileRules(value, permittedScopes) {
    const configuration = normalizeConfiguration(value);
    const permitted = new Set(permittedScopes);
    const headerSetsById = new Map(configuration.headerSets.map((headerSet) => [headerSet.id, headerSet]));
    const exactDomains = configuration.siteAssignments
      .map((assignment) => normalizeScope(assignment.scope))
      .filter((scope) => !scope.wildcard)
      .map((scope) => scope.domain);
    const rules = [];

    for (const assignment of configuration.siteAssignments) {
      const scope = normalizeScope(assignment.scope);
      if (!assignment.enabled || !permitted.has(scope.canonical)) {
        continue;
      }

      const excludedRequestDomains = scope.wildcard
        ? exactDomains.filter((domain) => domain.endsWith(`.${scope.domain}`))
        : undefined;
      const headerSet = headerSetsById.get(assignment.headerSetId);

      rules.push(createHeaderRule({
        scope: assignment.scope,
        headers: headerSet.headers,
        excludedRequestDomains,
      }, rules.length + 1));
    }

    return rules;
  }

  /**
   * Finds the exact or wildcard assignment that controls a hostname.
   *
   * @param {string} host An exact hostname.
   * @param {Array<object>} siteAssignments Saved site assignments.
   * @returns {{assignment: object, source: "exact"|"wildcard"}|null} The effective assignment.
   */
  function findEffectiveAssignment(host, siteAssignments) {
    const normalizedHost = normalizeScope(host);
    if (normalizedHost.wildcard) {
      throw new Error("Choose one exact hostname.");
    }

    const assignments = Array.isArray(siteAssignments) ? siteAssignments.map(normalizeSiteAssignment) : [];
    const exact = assignments.find((assignment) => assignment.scope === normalizedHost.canonical);
    if (exact) {
      return { assignment: exact, source: "exact" };
    }

    const wildcard = assignments.find((assignment) => {
      const scope = normalizeScope(assignment.scope);
      return scope.wildcard && normalizedHost.domain.endsWith(`.${scope.domain}`);
    });

    return wildcard ? { assignment: wildcard, source: "wildcard" } : null;
  }

  /**
   * Migrates the original Cloudflare-only profiles without exposing or discarding credentials.
   *
   * @param {Array<object>} profiles Legacy profiles.
   * @returns {{headerSets: Array<object>, siteAssignments: Array<object>}} Migrated configuration.
   */
  function migrateLegacyProfiles(profiles) {
    const headerSets = [];
    const siteAssignments = [];
    const setIdByCredentialPair = new Map();

    for (const profile of Array.isArray(profiles) ? profiles : []) {
      if (!profile?.scope || !profile?.clientId || !profile?.clientSecret) {
        continue;
      }

      const scope = normalizeScope(profile.scope);
      const clientId = String(profile.clientId).trim();
      const clientSecret = String(profile.clientSecret).trim();
      const credentialPair = `${clientId}\u0000${clientSecret}`;
      let headerSetId = setIdByCredentialPair.get(credentialPair);

      if (!headerSetId) {
        headerSetId = `migrated-${headerSets.length + 1}`;
        headerSets.push({
          id: headerSetId,
          name: `Cloudflare Access ${headerSets.length + 1}`,
          kind: "cloudflare-access",
          headers: createCloudflareHeaders(clientId, clientSecret),
        });
        setIdByCredentialPair.set(credentialPair, headerSetId);
      }

      siteAssignments.push({
        scope: scope.canonical,
        headerSetId,
        enabled: profile.enabled ?? true,
      });
    }

    return normalizeConfiguration({ headerSets, siteAssignments });
  }

  /**
   * Creates one declarative rule that sets all headers for a site assignment.
   *
   * @param {{scope: string, headers: Array<object>, excludedRequestDomains?: Array<string>}} configuration A site rule.
   * @param {number} id The positive declarative rule ID.
   * @returns {object} A declarativeNetRequest rule.
   */
  function createHeaderRule(configuration, id) {
    if (!Number.isInteger(id) || id < 1) {
      throw new Error("A header rule ID must be a positive integer.");
    }

    const scope = normalizeScope(configuration.scope);
    const headers = normalizeHeaders(configuration.headers);
    const excludedRequestDomains = normalizeExcludedDomains(configuration.excludedRequestDomains, scope);
    const condition = { regexFilter: scope.regexFilter };

    if (excludedRequestDomains.length > 0) {
      condition.excludedRequestDomains = excludedRequestDomains;
    }

    return {
      id,
      priority: 1,
      action: {
        type: "modifyHeaders",
        requestHeaders: headers.map((header) => ({
          header: header.name,
          operation: "set",
          value: header.value,
        })),
      },
      condition,
    };
  }

  /**
   * Determines whether two normalized scopes can match the same HTTPS request.
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
   * Normalizes one set-to-site assignment.
   *
   * @param {{scope?: string, headerSetId?: string, enabled?: boolean}} value A site assignment.
   * @returns {{scope: string, headerSetId: string, enabled: boolean}} A normalized assignment.
   */
  function normalizeSiteAssignment(value) {
    const scope = normalizeScope(value?.scope);
    const headerSetId = String(value?.headerSetId ?? "").trim();

    if (!headerSetId) {
      throw new Error(`Choose a header set for ${scope.canonical}.`);
    }

    return {
      scope: scope.canonical,
      headerSetId,
      enabled: value?.enabled ?? true,
    };
  }

  /**
   * Checks whether a custom header would alter browser or HTTP connection control.
   *
   * @param {string} loweredName A lowercase header name.
   * @returns {boolean} Whether the header is disallowed.
   */
  function isForbiddenHeader(loweredName) {
    return FORBIDDEN_HEADERS.has(loweredName)
      || loweredName.startsWith("proxy-")
      || loweredName.startsWith("sec-");
  }

  /**
   * Ensures preset-backed sets retain the header shape their UI promises.
   *
   * @param {string} kind Header-set kind.
   * @param {Array<{name: string, value: string}>} headers Normalized headers.
   * @returns {void}
   */
  function validatePresetHeaders(kind, headers) {
    const loweredNames = headers.map((header) => header.name.toLowerCase());

    if (kind === "cloudflare-access") {
      const expected = [CLOUD_FLARE_CLIENT_ID.toLowerCase(), CLOUD_FLARE_CLIENT_SECRET.toLowerCase()];
      if (headers.length !== 2 || expected.some((headerName) => !loweredNames.includes(headerName))) {
        throw new Error("A Cloudflare Access set needs its Client ID and Client Secret headers.");
      }
    }

    if (kind === "bearer-token" && (headers.length !== 1
      || loweredNames[0] !== "authorization"
      || !headers[0].value.startsWith("Bearer "))) {
      throw new Error("A bearer-token set needs one Authorization: Bearer header.");
    }
  }

  /**
   * Validates domains excluded from a wildcard rule.
   *
   * @param {Array<string>|undefined} values Candidate exact domains.
   * @param {{domain: string, wildcard: boolean}} scope Rule scope.
   * @returns {Array<string>} Normalized exact domains.
   */
  function normalizeExcludedDomains(values, scope) {
    if (!values) {
      return [];
    }
    if (!scope.wildcard || !Array.isArray(values)) {
      throw new Error("Only wildcard rules may exclude exact host overrides.");
    }

    return [...new Set(values.map((value) => {
      const excluded = normalizeScope(value);
      if (excluded.wildcard || !excluded.domain.endsWith(`.${scope.domain}`)) {
        throw new Error("A wildcard default may exclude only one of its exact subdomains.");
      }
      return excluded.domain;
    }))];
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
   * @returns {string} A declarative rule regex filter.
   */
  function createRegexFilter(domain, wildcard) {
    const host = escapeRegex(domain);
    const prefix = wildcard ? "(?:[a-z0-9-]+\\.)+" : "";
    return `^https://${prefix}${host}(?::[0-9]+)?(?:/|$)`;
  }

  return {
    CLOUD_FLARE_CLIENT_ID,
    CLOUD_FLARE_CLIENT_SECRET,
    compileRules,
    createBearerHeaders,
    createCloudflareHeaders,
    createHeaderRule,
    findEffectiveAssignment,
    migrateLegacyProfiles,
    normalizeConfiguration,
    normalizeHeaderSet,
    normalizeHeaders,
    normalizeScope,
    scopesOverlap,
  };
});
