importScripts("rules.js");

const extension = globalThis.browser ?? globalThis.chrome;
const PROFILES_KEY = "profiles";

extension.action.onClicked.addListener(() => extension.runtime.openOptionsPage());
extension.runtime.onInstalled.addListener(async ({ reason }) => {
  await applySavedProfiles();

  if (reason === "install") {
    await extension.runtime.openOptionsPage();
  }
});
extension.runtime.onStartup.addListener(applySavedProfiles);

/**
 * Reinstalls all permitted Cloudflare Access header rules after browser startup or extension update.
 *
 * @returns {Promise<void>} A promise that resolves when the browser rule is current.
 */
async function applySavedProfiles() {
  const { profiles = [] } = await extension.storage.local.get(PROFILES_KEY);
  const existingRules = await extension.declarativeNetRequest.getDynamicRules();
  const activeProfiles = await profilesWithHostPermission(profiles);
  const rules = activeProfiles.map((profile, index) => CfAccessRules.createHeaderRule(profile, index + 1));

  await replaceRules(existingRules, rules);
}

/**
 * Replaces all extension-owned dynamic rules atomically.
 *
 * @param {Array<{id: number}>} existingRules The currently installed dynamic rules.
 * @param {Array<object>} newRules The desired dynamic rules.
 * @returns {Promise<void>} A promise that resolves after the replacement succeeds.
 */
function replaceRules(existingRules, newRules) {
  return extension.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existingRules.map((rule) => rule.id),
    addRules: newRules,
  });
}

/**
 * Returns enabled, valid profiles whose configured host permission is still granted.
 *
 * @param {Array<{enabled?: boolean, scope?: string, clientId?: string, clientSecret?: string}>} profiles Saved profiles.
 * @returns {Promise<Array<object>>} Profiles that can safely receive header rules.
 */
async function profilesWithHostPermission(profiles) {
  const activeProfiles = [];

  for (const profile of profiles) {
    if (!profile?.enabled || !profile.clientId?.trim() || !profile.clientSecret?.trim()) {
      continue;
    }

    try {
      const scope = CfAccessRules.normalizeScope(profile.scope);
      const granted = await extension.permissions.contains({ origins: [scope.hostPermission] });
      if (granted) {
        activeProfiles.push(profile);
      }
    } catch {
      // Malformed stored profiles must never install a broad request rule.
    }
  }

  return activeProfiles;
}
