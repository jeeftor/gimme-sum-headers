const assert = require("node:assert/strict");
const test = require("node:test");

const {
  compileRules,
  createBearerHeaders,
  createCloudflareHeaders,
  createHeaderRule,
  findEffectiveAssignment,
  migrateLegacyProfiles,
  normalizeConfiguration,
  normalizeHeaders,
  normalizeScope,
  scopesOverlap,
} = require("../rules.js");

function customSet(id, name, headers) {
  return { id, name, kind: "custom", headers };
}

test("a wildcard scope matches subdomains but not the apex", () => {
  const scope = normalizeScope("*.my.domain.test");
  const matcher = new RegExp(scope.regexFilter);

  assert.equal(scope.hostPermission, "https://*.my.domain.test/*");
  assert.equal(matcher.test("https://app.my.domain.test/"), true);
  assert.equal(matcher.test("https://api.app.my.domain.test/path"), true);
  assert.equal(matcher.test("https://my.domain.test/"), false);
  assert.equal(matcher.test("https://notmy.domain.test/"), false);
  assert.equal(matcher.test("http://app.my.domain.test/"), false);
});

test("an exact scope excludes sibling subdomains", () => {
  const scope = normalizeScope("app.my.domain.test");
  const matcher = new RegExp(scope.regexFilter);

  assert.equal(matcher.test("https://app.my.domain.test/"), true);
  assert.equal(matcher.test("https://other.my.domain.test/"), false);
});

test("Cloudflare and Bearer presets produce safe concrete headers", () => {
  assert.deepEqual(createCloudflareHeaders("client-id.access", "secret"), [
    { name: "CF-Access-Client-Id", value: "client-id.access" },
    { name: "CF-Access-Client-Secret", value: "secret" },
  ]);
  assert.deepEqual(createBearerHeaders("abc.def.ghi"), [
    { name: "Authorization", value: "Bearer abc.def.ghi" },
  ]);
});

test("a header rule sets every configured custom header", () => {
  const rule = createHeaderRule({
    scope: "kb.my.domain.test",
    headers: [
      { name: "X-API-Key", value: "example-key" },
      { name: "Authorization", value: "Bearer example" },
    ],
  }, 17);

  assert.equal(rule.id, 17);
  assert.deepEqual(rule.action.requestHeaders, [
    { header: "X-API-Key", operation: "set", value: "example-key" },
    { header: "Authorization", operation: "set", value: "Bearer example" },
  ]);
  assert.equal(rule.condition.resourceTypes.includes("main_frame"), true);
  assert.equal(rule.condition.resourceTypes.includes("xmlhttprequest"), true);
});

test("unsafe, duplicate, and folded custom headers are rejected", () => {
  assert.throws(() => normalizeHeaders([{ name: "Cookie", value: "session=secret" }]));
  assert.throws(() => normalizeHeaders([{ name: "Origin", value: "https://example.com" }]));
  assert.throws(() => normalizeHeaders([{ name: "Sec-Fetch-Site", value: "same-origin" }]));
  assert.throws(() => normalizeHeaders([{ name: "X-Test", value: "first" }, { name: "x-test", value: "second" }]));
  assert.throws(() => normalizeHeaders([{ name: "X-Test", value: "one\ntwo" }]));
});

test("an exact site excludes its wildcard default instead of merging headers", () => {
  const configuration = normalizeConfiguration({
    headerSets: [
      customSet("default", "Default headers", [{ name: "X-Default", value: "default" }]),
      { id: "media", name: "Media token", kind: "bearer-token", headers: createBearerHeaders("media-token") },
    ],
    siteAssignments: [
      { scope: "*.my.domain.test", headerSetId: "default", enabled: true },
      { scope: "dvr.my.domain.test", headerSetId: "media", enabled: true },
    ],
  });
  const rules = compileRules(configuration, ["*.my.domain.test", "dvr.my.domain.test"]);
  const wildcardRule = rules.find((rule) => Array.isArray(rule.condition.excludedRequestDomains));
  const exactRule = rules.find((rule) => rule.condition.regexFilter.includes("dvr\\.my\\.domain\\.test"));

  assert.deepEqual(wildcardRule.condition.excludedRequestDomains, ["dvr.my.domain.test"]);
  assert.deepEqual(exactRule.action.requestHeaders, [
    { header: "Authorization", operation: "set", value: "Bearer media-token" },
  ]);
});

test("a disabled exact assignment still blocks its wildcard default", () => {
  const configuration = normalizeConfiguration({
    headerSets: [
      customSet("default", "Default headers", [{ name: "X-Default", value: "default" }]),
      customSet("disabled", "Disabled override", [{ name: "X-Disabled", value: "disabled" }]),
    ],
    siteAssignments: [
      { scope: "*.my.domain.test", headerSetId: "default", enabled: true },
      { scope: "dvr.my.domain.test", headerSetId: "disabled", enabled: false },
    ],
  });
  const rules = compileRules(configuration, ["*.my.domain.test"]);

  assert.equal(rules.length, 1);
  assert.deepEqual(rules[0].condition.excludedRequestDomains, ["dvr.my.domain.test"]);
});

test("exact host assignments win over wildcard defaults in the popup model", () => {
  const assignments = [
    { scope: "*.my.domain.test", headerSetId: "default", enabled: true },
    { scope: "kb.my.domain.test", headerSetId: "knowledge", enabled: true },
  ];

  assert.deepEqual(findEffectiveAssignment("kb.my.domain.test", assignments), {
    assignment: assignments[1],
    source: "exact",
  });
  assert.deepEqual(findEffectiveAssignment("paste.my.domain.test", assignments), {
    assignment: assignments[0],
    source: "wildcard",
  });
});

test("only overlapping wildcard defaults are rejected", () => {
  const headerSets = [customSet("one", "One", [{ name: "X-One", value: "one" }])];

  assert.doesNotThrow(() => normalizeConfiguration({
    headerSets,
    siteAssignments: [
      { scope: "*.my.domain.test", headerSetId: "one", enabled: true },
      { scope: "app.my.domain.test", headerSetId: "one", enabled: true },
    ],
  }));
  assert.throws(() => normalizeConfiguration({
    headerSets,
    siteAssignments: [
      { scope: "*.my.domain.test", headerSetId: "one", enabled: true },
      { scope: "*.app.my.domain.test", headerSetId: "one", enabled: true },
    ],
  }));
});

test("legacy Cloudflare profiles migrate to reusable sets without duplicating credentials", () => {
  const migrated = migrateLegacyProfiles([
    { scope: "kb.my.domain.test", clientId: "shared", clientSecret: "secret", enabled: true },
    { scope: "dvr.my.domain.test", clientId: "shared", clientSecret: "secret", enabled: true },
    { scope: "paste.my.domain.test", clientId: "other", clientSecret: "secret", enabled: false },
  ]);

  assert.equal(migrated.headerSets.length, 2);
  assert.equal(migrated.siteAssignments.length, 3);
  assert.equal(migrated.siteAssignments[0].headerSetId, migrated.siteAssignments[1].headerSetId);
  assert.equal(migrated.siteAssignments[2].enabled, false);
});

test("a rule ID must be a positive integer", () => {
  const configuration = { scope: "app.my.domain.test", headers: [{ name: "X-Test", value: "value" }] };

  assert.throws(() => createHeaderRule(configuration, 0));
  assert.throws(() => createHeaderRule(configuration, 1.5));
});

test("scope overlap detection remains precise for exact and wildcard hosts", () => {
  assert.equal(scopesOverlap(normalizeScope("*.my.domain.test"), normalizeScope("app.my.domain.test")), true);
  assert.equal(scopesOverlap(normalizeScope("*.my.domain.test"), normalizeScope("*.app.my.domain.test")), true);
  assert.equal(scopesOverlap(normalizeScope("*.app.my.domain.test"), normalizeScope("app.my.domain.test")), false);
  assert.equal(scopesOverlap(normalizeScope("app.my.domain.test"), normalizeScope("api.my.domain.test")), false);
});

test("invalid scopes fail before permissions or rules can be created", () => {
  assert.throws(() => normalizeScope("https://my.domain.test"));
  assert.throws(() => normalizeScope("*.my.domain.test/path"));
  assert.throws(() => normalizeScope("*."));
});
