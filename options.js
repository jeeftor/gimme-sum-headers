const extension = globalThis.browser ?? globalThis.chrome;
const PROFILES_KEY = "profiles";

const form = document.querySelector("#configuration-form");
const profileList = document.querySelector("#profile-list");
const profileTemplate = document.querySelector("#profile-template");
const addSiteButton = document.querySelector("#add-site");
const forgetButton = document.querySelector("#forget");
const status = document.querySelector("#status");

void restoreProfiles();
form.addEventListener("submit", saveProfiles);
addSiteButton.addEventListener("click", () => appendProfile());
forgetButton.addEventListener("click", forgetProfiles);

/**
 * Restores saved Cloudflare Access site profiles into extension-controlled inputs.
 *
 * @returns {Promise<void>} A promise that resolves after the profile list is rendered.
 */
async function restoreProfiles() {
  const { profiles = [] } = await extension.storage.local.get(PROFILES_KEY);
  const profilesToRender = profiles.length > 0 ? profiles : [emptyProfile()];

  for (const profile of profilesToRender) {
    appendProfile(profile);
  }
}

/**
 * Adds one Cloudflare-only site profile to the form.
 *
 * @param {{scope?: string, clientId?: string, clientSecret?: string, enabled?: boolean}} profile A profile to render.
 * @returns {void}
 */
function appendProfile(profile = emptyProfile()) {
  const fragment = profileTemplate.content.cloneNode(true);
  const profileElement = fragment.querySelector("[data-profile]");

  profileElement.querySelector(".scope").value = profile.scope ?? "";
  profileElement.querySelector(".client-id").value = profile.clientId ?? "";
  profileElement.querySelector(".client-secret").value = profile.clientSecret ?? "";
  profileElement.querySelector(".enabled").checked = profile.enabled ?? true;
  profileElement.querySelector(".remove-site").addEventListener("click", () => {
    profileElement.remove();
    if (profileList.children.length === 0) {
      appendProfile();
    }
  });

  profileList.append(profileElement);
}

/**
 * Saves validated site profiles, prompts for narrow host access, and installs matching header rules.
 *
 * @param {SubmitEvent} event The configuration-form submission event.
 * @returns {Promise<void>} A promise that resolves after profiles are applied.
 */
async function saveProfiles(event) {
  event.preventDefault();
  setStatus("");

  let profiles;
  try {
    profiles = collectProfiles();
  } catch (error) {
    setStatus(error.message, true);
    return;
  }

  const enabledHostPermissions = hostPermissionsFor(profiles.filter((profile) => profile.enabled));
  if (enabledHostPermissions.length > 0) {
    const granted = await extension.permissions.request({ origins: enabledHostPermissions });
    if (!granted) {
      setStatus("Required host permission was not granted, so no changes were saved.", true);
      return;
    }
  }

  try {
    const { profiles: previousProfiles = [] } = await extension.storage.local.get(PROFILES_KEY);
    await extension.storage.local.set({ profiles });
    await installRules(profiles);
    await removeUnusedHostPermissions(previousProfiles, enabledHostPermissions);

    const enabledCount = profiles.filter((profile) => profile.enabled).length;
    setStatus(enabledCount === 0 ? "All Cloudflare Access profiles are disabled." : `Enabled ${enabledCount} Cloudflare Access ${pluralize("site", enabledCount)}.`);
  } catch {
    setStatus("The browser could not install the Cloudflare Access rules. Your credentials were not displayed.", true);
  }
}

/**
 * Collects complete, unique site profiles from the form.
 *
 * @returns {Array<{scope: string, clientId: string, clientSecret: string, enabled: boolean}>} Validated profiles.
 * @throws {Error} When a profile is incomplete, invalid, or duplicates a site scope.
 */
function collectProfiles() {
  const seenScopes = [];
  const profiles = [];

  for (const profileElement of profileList.querySelectorAll("[data-profile]")) {
    const profile = {
      scope: profileElement.querySelector(".scope").value.trim(),
      clientId: profileElement.querySelector(".client-id").value.trim(),
      clientSecret: profileElement.querySelector(".client-secret").value.trim(),
      enabled: profileElement.querySelector(".enabled").checked,
    };

    if (!profile.scope && !profile.clientId && !profile.clientSecret) {
      continue;
    }
    if (!profile.scope || !profile.clientId || !profile.clientSecret) {
      throw new Error("Every Cloudflare site needs a domain scope, Client ID, and Client Secret.");
    }

    const scope = CfAccessRules.normalizeScope(profile.scope);
    if (seenScopes.some((existingScope) => CfAccessRules.scopesOverlap(scope, existingScope))) {
      throw new Error(`The scope ${profile.scope} overlaps another Cloudflare Access profile.`);
    }

    seenScopes.push(scope);
    profiles.push(profile);
  }

  return profiles;
}

/**
 * Installs one dynamic rule per enabled Cloudflare Access profile.
 *
 * @param {Array<{enabled: boolean, scope: string, clientId: string, clientSecret: string}>} profiles Saved profiles.
 * @returns {Promise<void>} A promise that resolves after the dynamic rules are current.
 */
async function installRules(profiles) {
  const existingRules = await extension.declarativeNetRequest.getDynamicRules();
  const rules = profiles
    .filter((profile) => profile.enabled)
    .map((profile, index) => CfAccessRules.createHeaderRule(profile, index + 1));

  await extension.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existingRules.map((rule) => rule.id),
    addRules: rules,
  });
}

/**
 * Clears saved profiles, matching header rules, and their optional host permissions.
 *
 * @returns {Promise<void>} A promise that resolves after all profile data is removed.
 */
async function forgetProfiles() {
  const { profiles = [] } = await extension.storage.local.get(PROFILES_KEY);
  const existingRules = await extension.declarativeNetRequest.getDynamicRules();

  await extension.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existingRules.map((rule) => rule.id),
    addRules: [],
  });
  await extension.storage.local.remove(PROFILES_KEY);
  await removeHostPermissions(hostPermissionsFor(profiles));

  profileList.replaceChildren();
  appendProfile();
  setStatus("All Cloudflare Access credentials, rules, and site permissions were removed.");
}

/**
 * Removes permissions that were previously granted but are not needed by an enabled profile.
 *
 * @param {Array<object>} previousProfiles The prior saved profiles.
 * @param {Array<string>} retainedHostPermissions Permissions still needed by enabled profiles.
 * @returns {Promise<void>} A promise that resolves after stale permissions are removed.
 */
async function removeUnusedHostPermissions(previousProfiles, retainedHostPermissions) {
  const retained = new Set(retainedHostPermissions);
  const stalePermissions = hostPermissionsFor(previousProfiles).filter((origin) => !retained.has(origin));
  await removeHostPermissions(stalePermissions);
}

/**
 * Removes optional host permissions when there are any to release.
 *
 * @param {Array<string>} origins Host permissions to remove.
 * @returns {Promise<void>} A promise that resolves after the removal request.
 */
async function removeHostPermissions(origins) {
  if (origins.length > 0) {
    await extension.permissions.remove({ origins });
  }
}

/**
 * Converts valid profile scopes into unique optional host permissions.
 *
 * @param {Array<{scope?: string}>} profiles Profiles whose scopes should be converted.
 * @returns {Array<string>} Unique valid HTTPS host permission patterns.
 */
function hostPermissionsFor(profiles) {
  const permissions = new Set();

  for (const profile of profiles) {
    try {
      permissions.add(CfAccessRules.normalizeScope(profile.scope).hostPermission);
    } catch {
      // Invalid legacy data must not expand browser access.
    }
  }

  return [...permissions];
}

/**
 * Creates the default first profile without adding any credentials.
 *
 * @returns {{scope: string, clientId: string, clientSecret: string, enabled: boolean}} An empty profile.
 */
function emptyProfile() {
  return { scope: "*.vookie.net", clientId: "", clientSecret: "", enabled: true };
}

/**
 * Chooses the singular or plural noun for a count.
 *
 * @param {string} noun The singular noun.
 * @param {number} count The count to describe.
 * @returns {string} A singular or plural noun.
 */
function pluralize(noun, count) {
  return count === 1 ? noun : `${noun}s`;
}

/**
 * Displays an accessible success or error message.
 *
 * @param {string} message The message to display.
 * @param {boolean} isError Whether the message represents an error.
 * @returns {void}
 */
function setStatus(message, isError = false) {
  status.textContent = message;
  status.dataset.error = String(isError);
}
