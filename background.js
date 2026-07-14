importScripts("rules.js");

const extension = globalThis.browser ?? globalThis.chrome;
const HEADER_SETS_KEY = "headerSets";
const SITE_ASSIGNMENTS_KEY = "siteAssignments";
const LEGACY_PROFILES_KEY = "profiles";
const GITHUB_RELEASES_URL = "https://api.github.com/repos/jeeftor/gimme-sum-headers/releases/latest";

extension.runtime.onInstalled.addListener(() => {
  void initializeExtension();
});
extension.runtime.onStartup.addListener(() => {
  void initializeExtension();
});
extension.runtime.onMessage.addListener((message) => handleMessage(message));

/**
 * Applies browser-specific storage hardening before rebuilding local rules.
 *
 * @returns {Promise<void>} A promise that resolves once initialization is complete.
 */
async function initializeExtension() {
  await restrictStorageToTrustedContexts();
  await reconcileSavedConfiguration();
}

/**
 * Prevents future Chrome content scripts from reading local credentials by default.
 *
 * @returns {Promise<void>} A promise that resolves even when the browser does not support this hardening API.
 */
async function restrictStorageToTrustedContexts() {
  if (typeof extension.storage.local.setAccessLevel !== "function") {
    return;
  }

  try {
    await extension.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  } catch {
    // The extension has no content scripts; an unsupported hardening API must not disable header injection.
  }
}

/**
 * Handles state requests from the options page and toolbar popup.
 *
 * @param {{type?: string, configuration?: object, host?: string, headerSetId?: string}} message An extension message.
 * @returns {Promise<object>} The requested result.
 */
async function handleMessage(message) {
  switch (message?.type) {
    case "get-options-state":
      return loadConfiguration();
    case "get-popup-state":
      return getPopupState(message.host);
    case "save-configuration":
      return saveConfiguration(message.configuration);
    case "assign-exact-host":
      return assignExactHost(message.host, message.headerSetId);
    case "remove-exact-host":
      return removeExactHost(message.host);
    case "forget-configuration":
      return forgetConfiguration();
    case "check-update":
      return checkForUpdate();
    default:
      throw new Error("Unknown Gimme Sum Headers request.");
  }
}

/**
 * Compares the installed extension version with the latest public GitHub release.
 *
 * @returns {Promise<{currentVersion: string, latestVersion: string, updateAvailable: boolean, releaseUrl: string}>} Update details.
 */
async function checkForUpdate() {
  const response = await fetch(GITHUB_RELEASES_URL, {
    headers: { Accept: "application/vnd.github+json" },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`GitHub update check failed with HTTP ${response.status}.`);
  }

  const release = await response.json();
  const currentVersion = extension.runtime.getManifest().version;
  const latestVersion = normalizeReleaseVersion(release?.tag_name);

  if (!latestVersion || typeof release?.html_url !== "string") {
    throw new Error("GitHub did not return a usable latest release.");
  }

  return {
    currentVersion,
    latestVersion,
    updateAvailable: compareVersions(latestVersion, currentVersion) > 0,
    releaseUrl: release.html_url,
  };
}

/**
 * Removes a release tag prefix and accepts only three-part semantic versions.
 *
 * @param {unknown} value GitHub release tag value.
 * @returns {string|null} A normalized version, or null for an unsupported tag.
 */
function normalizeReleaseVersion(value) {
  const version = String(value ?? "").replace(/^v/, "");
  return /^\d+\.\d+\.\d+$/.test(version) ? version : null;
}

/**
 * Compares two normalized three-part semantic versions.
 *
 * @param {string} first First version.
 * @param {string} second Second version.
 * @returns {number} A positive value when first is newer.
 */
function compareVersions(first, second) {
  const firstParts = first.split(".").map(Number);
  const secondParts = second.split(".").map(Number);

  for (let index = 0; index < firstParts.length; index += 1) {
    const difference = firstParts[index] - secondParts[index];
    if (difference !== 0) {
      return difference;
    }
  }

  return 0;
}

/**
 * Returns the popup-safe view of a host and its effective assignment.
 *
 * @param {string} host An exact active-tab hostname.
 * @returns {Promise<{headerSets: Array<{id: string, name: string}>, effective: object|null}>} Popup data.
 */
async function getPopupState(host) {
  const configuration = await loadConfiguration();
  const effective = HeaderRules.findEffectiveAssignment(host, configuration.siteAssignments);

  return {
    headerSets: configuration.headerSets.map(({ id, name }) => ({ id, name })),
    effective,
  };
}

/**
 * Persists a validated configuration after an options-page permission request.
 *
 * @param {object} value A candidate configuration.
 * @returns {Promise<object>} The normalized saved configuration.
 */
async function saveConfiguration(value) {
  const configuration = HeaderRules.normalizeConfiguration(value);
  await applyConfiguration(configuration);
  return configuration;
}

/**
 * Adds or updates the exact active-host assignment selected in the popup.
 *
 * @param {string} host Active tab hostname.
 * @param {string} headerSetId Header set selected by the user.
 * @returns {Promise<object>} The normalized saved configuration.
 */
async function assignExactHost(host, headerSetId) {
  const scope = HeaderRules.normalizeScope(host);
  if (scope.wildcard) {
    throw new Error("Choose one exact hostname.");
  }

  const configuration = await loadConfiguration();
  const siteAssignments = configuration.siteAssignments.filter((assignment) => assignment.scope !== scope.canonical);
  siteAssignments.push({ scope: scope.canonical, headerSetId, enabled: true });

  return saveConfiguration({ headerSets: configuration.headerSets, siteAssignments });
}

/**
 * Removes only an exact active-host assignment, allowing a wildcard default to resume.
 *
 * @param {string} host Active tab hostname.
 * @returns {Promise<object>} The normalized saved configuration.
 */
async function removeExactHost(host) {
  const scope = HeaderRules.normalizeScope(host);
  if (scope.wildcard) {
    throw new Error("Choose one exact hostname.");
  }

  const configuration = await loadConfiguration();
  const siteAssignments = configuration.siteAssignments.filter((assignment) => assignment.scope !== scope.canonical);
  return saveConfiguration({ headerSets: configuration.headerSets, siteAssignments });
}

/**
 * Rebuilds rules from saved state after startup, installation, or browser updates.
 *
 * @returns {Promise<void>} A promise that resolves when rules match saved permissions.
 */
async function reconcileSavedConfiguration() {
  const configuration = await loadConfiguration();
  const existingRules = await extension.declarativeNetRequest.getDynamicRules();
  const permittedScopes = await permittedScopesFor(configuration.siteAssignments);
  const rules = HeaderRules.compileRules(configuration, permittedScopes);

  await replaceRules(existingRules, rules);
}

/**
 * Saves a configuration, replaces dynamic rules, and releases stale optional host permissions.
 *
 * @param {{headerSets: Array<object>, siteAssignments: Array<object>}} configuration A normalized configuration.
 * @returns {Promise<void>} A promise that resolves when state and rules are current.
 */
async function applyConfiguration(configuration) {
  const previousConfiguration = await loadConfiguration();
  const existingRules = await extension.declarativeNetRequest.getDynamicRules();
  const permittedScopes = await permittedScopesFor(configuration.siteAssignments);
  const rules = HeaderRules.compileRules(configuration, permittedScopes);

  await replaceRules(existingRules, rules);
  await extension.storage.local.set({
    [HEADER_SETS_KEY]: configuration.headerSets,
    [SITE_ASSIGNMENTS_KEY]: configuration.siteAssignments,
  });
  await extension.storage.local.remove(LEGACY_PROFILES_KEY);
  await removeUnusedHostPermissions(previousConfiguration.siteAssignments, configuration.siteAssignments);
}

/**
 * Reads current storage, transparently migrating legacy Cloudflare site profiles once.
 *
 * @returns {Promise<{headerSets: Array<object>, siteAssignments: Array<object>}>} A normalized configuration.
 */
async function loadConfiguration() {
  const stored = await extension.storage.local.get([
    HEADER_SETS_KEY,
    SITE_ASSIGNMENTS_KEY,
    LEGACY_PROFILES_KEY,
  ]);

  if (Array.isArray(stored[HEADER_SETS_KEY]) && Array.isArray(stored[SITE_ASSIGNMENTS_KEY])) {
    return HeaderRules.normalizeConfiguration({
      headerSets: stored[HEADER_SETS_KEY],
      siteAssignments: stored[SITE_ASSIGNMENTS_KEY],
    });
  }

  const configuration = HeaderRules.migrateLegacyProfiles(stored[LEGACY_PROFILES_KEY]);
  await extension.storage.local.set({
    [HEADER_SETS_KEY]: configuration.headerSets,
    [SITE_ASSIGNMENTS_KEY]: configuration.siteAssignments,
  });
  await extension.storage.local.remove(LEGACY_PROFILES_KEY);
  return configuration;
}

/**
 * Returns enabled assignment scopes that still have explicit browser host permission.
 *
 * @param {Array<{scope: string, enabled: boolean}>} siteAssignments Saved site assignments.
 * @returns {Promise<Array<string>>} Canonical permitted scopes.
 */
async function permittedScopesFor(siteAssignments) {
  const permittedScopes = [];

  for (const assignment of siteAssignments) {
    if (!assignment.enabled) {
      continue;
    }

    const scope = HeaderRules.normalizeScope(assignment.scope);
    const granted = await extension.permissions.contains({ origins: [scope.hostPermission] });
    if (granted) {
      permittedScopes.push(scope.canonical);
    }
  }

  return permittedScopes;
}

/**
 * Replaces all extension-owned dynamic rules atomically.
 *
 * @param {Array<{id: number}>} existingRules Current dynamic rules.
 * @param {Array<object>} newRules Desired dynamic rules.
 * @returns {Promise<void>} A promise that resolves after the browser accepts the rules.
 */
function replaceRules(existingRules, newRules) {
  return extension.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existingRules.map((rule) => rule.id),
    addRules: newRules,
  });
}

/**
 * Removes optional permissions no enabled assignment still needs.
 *
 * @param {Array<object>} previousAssignments Previous site assignments.
 * @param {Array<object>} nextAssignments Next site assignments.
 * @returns {Promise<void>} A promise that resolves after stale permissions are released.
 */
async function removeUnusedHostPermissions(previousAssignments, nextAssignments) {
  const retained = new Set(hostPermissionsFor(nextAssignments.filter((assignment) => assignment.enabled)));
  const stale = hostPermissionsFor(previousAssignments).filter((origin) => !retained.has(origin));

  if (stale.length > 0) {
    await extension.permissions.remove({ origins: stale });
  }
}

/**
 * Converts valid assignments into unique optional host permission patterns.
 *
 * @param {Array<{scope?: string}>} siteAssignments Site assignments.
 * @returns {Array<string>} Browser host permission patterns.
 */
function hostPermissionsFor(siteAssignments) {
  const origins = new Set();

  for (const assignment of siteAssignments) {
    try {
      origins.add(HeaderRules.normalizeScope(assignment.scope).hostPermission);
    } catch {
      // Malformed storage must never expand browser access.
    }
  }

  return [...origins];
}

/**
 * Clears all saved sets, assignments, rules, legacy storage, and granted site permissions.
 *
 * @returns {Promise<void>} A promise that resolves when all local configuration is removed.
 */
async function forgetConfiguration() {
  const configuration = await loadConfiguration();
  const existingRules = await extension.declarativeNetRequest.getDynamicRules();

  await replaceRules(existingRules, []);
  await extension.storage.local.remove([HEADER_SETS_KEY, SITE_ASSIGNMENTS_KEY, LEGACY_PROFILES_KEY]);

  const origins = hostPermissionsFor(configuration.siteAssignments);
  if (origins.length > 0) {
    await extension.permissions.remove({ origins });
  }
}
