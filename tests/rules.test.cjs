const assert = require("node:assert/strict");
const test = require("node:test");

const { createHeaderRule, normalizeScope, scopesOverlap } = require("../rules.js");

test("a wildcard scope matches subdomains but not the apex", () => {
  const scope = normalizeScope("*.vookie.net");
  const matcher = new RegExp(scope.regexFilter);

  assert.equal(scope.hostPermission, "https://*.vookie.net/*");
  assert.equal(matcher.test("https://app.vookie.net/"), true);
  assert.equal(matcher.test("https://api.app.vookie.net/path"), true);
  assert.equal(matcher.test("https://vookie.net/"), false);
  assert.equal(matcher.test("https://notvookie.net/"), false);
  assert.equal(matcher.test("http://app.vookie.net/"), false);
});

test("an exact scope excludes sibling subdomains", () => {
  const scope = normalizeScope("app.vookie.net");
  const matcher = new RegExp(scope.regexFilter);

  assert.equal(matcher.test("https://app.vookie.net/"), true);
  assert.equal(matcher.test("https://other.vookie.net/"), false);
});

test("a header rule sends both Cloudflare Access service-token headers", () => {
  const rule = createHeaderRule({
    scope: "*.vookie.net",
    clientId: "client-id.access",
    clientSecret: "secret",
  }, 17);

  assert.equal(rule.id, 17);
  assert.deepEqual(rule.action.requestHeaders, [
    { header: "CF-Access-Client-Id", operation: "set", value: "client-id.access" },
    { header: "CF-Access-Client-Secret", operation: "set", value: "secret" },
  ]);
});

test("each site profile receives its own rule ID and domain matcher", () => {
  const vookieRule = createHeaderRule({
    scope: "*.vookie.net",
    clientId: "vookie.access",
    clientSecret: "vookie-secret",
  }, 1);
  const exampleRule = createHeaderRule({
    scope: "admin.example.com",
    clientId: "example.access",
    clientSecret: "example-secret",
  }, 2);

  assert.equal(vookieRule.id, 1);
  assert.equal(exampleRule.id, 2);
  assert.equal(new RegExp(vookieRule.condition.regexFilter).test("https://admin.example.com/"), false);
  assert.equal(new RegExp(exampleRule.condition.regexFilter).test("https://admin.example.com/"), true);
});

test("a rule ID must be a positive integer", () => {
  const profile = { scope: "app.vookie.net", clientId: "client-id", clientSecret: "secret" };

  assert.throws(() => createHeaderRule(profile, 0));
  assert.throws(() => createHeaderRule(profile, 1.5));
});

test("overlapping site profiles are detectable before either can inject conflicting headers", () => {
  assert.equal(scopesOverlap(normalizeScope("*.vookie.net"), normalizeScope("app.vookie.net")), true);
  assert.equal(scopesOverlap(normalizeScope("*.vookie.net"), normalizeScope("*.app.vookie.net")), true);
  assert.equal(scopesOverlap(normalizeScope("*.app.vookie.net"), normalizeScope("app.vookie.net")), false);
  assert.equal(scopesOverlap(normalizeScope("app.vookie.net"), normalizeScope("api.vookie.net")), false);
});

test("invalid scopes fail before permissions or rules can be created", () => {
  assert.throws(() => normalizeScope("https://vookie.net"));
  assert.throws(() => normalizeScope("*.vookie.net/path"));
  assert.throws(() => normalizeScope("*."));
});
