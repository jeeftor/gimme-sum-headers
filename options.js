const extension = globalThis.browser ?? globalThis.chrome;

const form = document.querySelector("#configuration-form");
const headerSetList = document.querySelector("#header-set-list");
const headerSetEditor = document.querySelector("#header-set-editor");
const assignmentList = document.querySelector("#site-assignment-list");
const headerSetListItemTemplate = document.querySelector("#header-set-list-item-template");
const headerSetEditorTemplate = document.querySelector("#header-set-editor-template");
const assignmentTemplate = document.querySelector("#site-assignment-template");
const selectedHeaderSetTitle = document.querySelector("#selected-header-set-title");
const selectedHeaderSetDescription = document.querySelector("#selected-header-set-description");
const addHeaderSetButton = document.querySelector("#add-header-set");
const addAssignmentButton = document.querySelector("#add-assignment");
const forgetButton = document.querySelector("#forget");
const status = document.querySelector("#status");
const checkUpdateButton = document.querySelector("#check-update");
const updateStatus = document.querySelector("#update-status");
const updateLink = document.querySelector("#update-link");

let headerSets = [];
let selectedHeaderSetId = null;

void restoreConfiguration();
form.addEventListener("submit", saveConfiguration);
addHeaderSetButton.addEventListener("click", appendHeaderSet);
addAssignmentButton.addEventListener("click", () => appendAssignment());
forgetButton.addEventListener("click", forgetConfiguration);
checkUpdateButton.addEventListener("click", checkForUpdate);

/**
 * Restores saved reusable header sets and site assignments.
 *
 * @returns {Promise<void>} A promise that resolves when the editor is rendered.
 */
async function restoreConfiguration() {
  const configuration = await sendMessage({ type: "get-options-state" });
  renderConfiguration(configuration);
}

/**
 * Checks the latest GitHub Release only after an explicit user action.
 *
 * @returns {Promise<void>} A promise that resolves after update feedback is shown.
 */
async function checkForUpdate() {
  const githubPermission = "https://api.github.com/*";
  updateLink.hidden = true;
  updateStatus.textContent = "Checking GitHub for the latest release…";

  const granted = await extension.permissions.request({ origins: [githubPermission] });
  if (!granted) {
    updateStatus.textContent = "GitHub access was not granted; no update check was made.";
    return;
  }

  try {
    const update = await sendMessage({ type: "check-update" });
    if (update.updateAvailable) {
      updateStatus.textContent = `Update available: v${update.latestVersion} (installed: v${update.currentVersion}).`;
      updateLink.href = update.releaseUrl;
      updateLink.hidden = false;
    } else if (update.latestVersion === update.currentVersion) {
      updateStatus.textContent = `You are on the latest GitHub release (v${update.currentVersion}).`;
    } else {
      updateStatus.textContent = `Installed v${update.currentVersion} is newer than the latest GitHub release (v${update.latestVersion}).`;
    }
  } catch {
    updateStatus.textContent = "GitHub could not check for an update. Try again later.";
  }
}

/**
 * Renders the full options form from normalized configuration data.
 *
 * @param {{headerSets?: Array<object>, siteAssignments?: Array<object>}} configuration Saved configuration.
 * @returns {void}
 */
function renderConfiguration(configuration) {
  headerSets = (configuration.headerSets ?? []).map(copyHeaderSet);
  if (headerSets.length === 0) {
    headerSets.push(emptyHeaderSet());
  }
  selectedHeaderSetId = headerSets[0].id;

  assignmentList.replaceChildren();
  for (const assignment of configuration.siteAssignments ?? []) {
    appendAssignment(assignment);
  }
  if (assignmentList.children.length === 0) {
    appendAssignment();
  }

  renderHeaderSetWorkspace();
}

/**
 * Renders the selectable header-set rail and the currently selected editor.
 *
 * @returns {void}
 */
function renderHeaderSetWorkspace() {
  renderHeaderSetList();
  renderHeaderSetEditor();
  refreshAssignmentSetChoices();
}

/**
 * Renders lightweight set names and preset metadata without exposing header values.
 *
 * @returns {void}
 */
function renderHeaderSetList() {
  headerSetList.replaceChildren();

  for (const headerSet of headerSets) {
    const fragment = headerSetListItemTemplate.content.cloneNode(true);
    const item = fragment.querySelector(".header-set-list-item");
    const assignmentCount = assignmentCountFor(headerSet.id);

    item.dataset.selected = String(headerSet.id === selectedHeaderSetId);
    item.setAttribute("aria-pressed", String(headerSet.id === selectedHeaderSetId));
    item.querySelector(".header-set-list-item-name").textContent = headerSet.name || "Untitled header set";
    item.querySelector(".header-set-list-item-meta").textContent = `${presetLabel(headerSet.kind)} · ${assignmentCount} ${pluralize("site", assignmentCount)}`;
    item.addEventListener("click", () => selectHeaderSet(headerSet.id));
    headerSetList.append(item);
  }
}

/**
 * Renders the editable details for the selected reusable header set.
 *
 * @returns {void}
 */
function renderHeaderSetEditor() {
  headerSetEditor.replaceChildren();
  const headerSet = selectedHeaderSet();
  if (!headerSet) {
    return;
  }

  const fragment = headerSetEditorTemplate.content.cloneNode(true);
  const element = fragment.querySelector("[data-header-set]");
  const nameInput = element.querySelector(".header-set-name");
  const kindSelect = element.querySelector(".header-set-kind");
  const presetFields = element.querySelector(".preset-fields");

  element.dataset.id = headerSet.id;
  nameInput.value = headerSet.name;
  kindSelect.value = headerSet.kind;
  renderPresetFields(presetFields, headerSet.kind, headerSet.headers);
  element.querySelector(".header-set-usage").textContent = usageLabel(headerSet.id);
  kindSelect.addEventListener("change", () => {
    renderPresetFields(presetFields, kindSelect.value, []);
    syncHeaderSetPreview();
  });
  element.addEventListener("input", syncHeaderSetPreview);
  element.querySelector(".remove-header-set").addEventListener("click", removeSelectedHeaderSet);

  headerSetEditor.append(element);
  updateSelectedHeaderSetHeading(headerSet);
}

/**
 * Selects one header set after preserving unsaved edits to the current set.
 *
 * @param {string} headerSetId Header-set identifier to select.
 * @returns {void}
 */
function selectHeaderSet(headerSetId) {
  captureSelectedHeaderSet();
  selectedHeaderSetId = headerSetId;
  renderHeaderSetWorkspace();
}

/**
 * Adds a blank header set and displays its details.
 *
 * @returns {void}
 */
function appendHeaderSet() {
  captureSelectedHeaderSet();
  const headerSet = emptyHeaderSet();
  headerSets.push(headerSet);
  selectedHeaderSetId = headerSet.id;
  renderHeaderSetWorkspace();
}

/**
 * Removes the selected header set only when no site assignment refers to it.
 *
 * @returns {void}
 */
function removeSelectedHeaderSet() {
  captureSelectedHeaderSet();
  const headerSet = selectedHeaderSet();
  if (!headerSet) {
    return;
  }
  if (isHeaderSetReferenced(headerSet.id)) {
    setStatus("Reassign or remove every site that uses this header set first.", true);
    return;
  }

  headerSets = headerSets.filter((item) => item.id !== headerSet.id);
  if (headerSets.length === 0) {
    headerSets.push(emptyHeaderSet());
  }
  selectedHeaderSetId = headerSets[0].id;
  renderHeaderSetWorkspace();
}

/**
 * Copies the selected editor's current values to the in-memory draft without validation.
 *
 * @returns {void}
 */
function captureSelectedHeaderSet() {
  const element = headerSetEditor.querySelector("[data-header-set]");
  if (!element) {
    return;
  }

  const index = headerSets.findIndex((headerSet) => headerSet.id === element.dataset.id);
  if (index !== -1) {
    headerSets[index] = readHeaderSetEditor(element);
  }
}

/**
 * Updates sidebar and assignment labels while preserving focus in the editor.
 *
 * @returns {void}
 */
function syncHeaderSetPreview() {
  captureSelectedHeaderSet();
  const headerSet = selectedHeaderSet();
  if (headerSet) {
    updateSelectedHeaderSetHeading(headerSet);
  }
  const usage = headerSetEditor.querySelector(".header-set-usage");
  if (usage && headerSet) {
    usage.textContent = usageLabel(headerSet.id);
  }
  renderHeaderSetList();
  refreshAssignmentSetChoices();
}

/**
 * Adds one hostname-to-header-set assignment editor.
 *
 * @param {{scope?: string, headerSetId?: string, enabled?: boolean}} assignment Assignment data.
 * @returns {void}
 */
function appendAssignment(assignment = {}) {
  const fragment = assignmentTemplate.content.cloneNode(true);
  const element = fragment.querySelector("[data-site-assignment]");

  element.querySelector(".assignment-scope").value = assignment.scope ?? "";
  element.querySelector(".assignment-header-set").dataset.selectedId = assignment.headerSetId ?? "";
  element.querySelector(".assignment-enabled").checked = assignment.enabled ?? true;
  element.querySelector(".assignment-header-set").addEventListener("change", syncHeaderSetPreview);
  element.querySelector(".assignment-scope").addEventListener("input", () => updateAssignmentScopeHelp(element));
  element.querySelector(".remove-assignment").addEventListener("click", () => {
    element.remove();
    if (assignmentList.children.length === 0) {
      appendAssignment();
    }
    syncHeaderSetPreview();
  });

  assignmentList.append(element);
  updateAssignmentScopeHelp(element);
  refreshAssignmentSetChoices();
}

/**
 * Explains whether a mapping is an exact hostname or a wildcard default.
 *
 * @param {HTMLElement} element One site-assignment editor.
 * @returns {void}
 */
function updateAssignmentScopeHelp(element) {
  const scope = element.querySelector(".assignment-scope").value.trim();
  const help = element.querySelector(".assignment-scope-help");

  help.textContent = scope.startsWith("*.")
    ? "Wildcard default: applies to matching subdomains; exact hostnames win."
    : "Exact hostname: takes precedence over any wildcard default.";
}

/**
 * Renders the fields appropriate for a selected header-set preset.
 *
 * @param {HTMLElement} container Preset field container.
 * @param {string} kind Header-set preset kind.
 * @param {Array<object>} headers Existing header values.
 * @returns {void}
 */
function renderPresetFields(container, kind, headers) {
  container.replaceChildren();

  if (kind === "cloudflare-access") {
    const headerMap = headersByName(headers);
    container.append(
      createInputLabel("CF Access Client ID", "preset-client-id", "text", headerMap.get("cf-access-client-id") ?? ""),
      createInputLabel("CF Access Client Secret", "preset-client-secret", "password", headerMap.get("cf-access-client-secret") ?? ""),
    );
    return;
  }

  if (kind === "bearer-token") {
    const authorization = headersByName(headers).get("authorization") ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
    container.append(createInputLabel("Bearer token", "preset-bearer-token", "password", token));
    return;
  }

  const customHeaderList = document.createElement("div");
  customHeaderList.className = "custom-header-list";
  customHeaderList.dataset.customHeaderList = "true";
  for (const header of headers.length > 0 ? headers : [{ name: "", value: "" }]) {
    appendCustomHeader(customHeaderList, header);
  }
  const addHeaderButton = document.createElement("button");
  addHeaderButton.className = "secondary";
  addHeaderButton.type = "button";
  addHeaderButton.textContent = "Add custom header";
  addHeaderButton.addEventListener("click", () => {
    appendCustomHeader(customHeaderList);
    syncHeaderSetPreview();
  });

  container.append(customHeaderList, addHeaderButton);
}

/**
 * Adds one custom header row to a header-set editor.
 *
 * @param {HTMLElement} list Custom-header row container.
 * @param {{name?: string, value?: string}} header Header data.
 * @returns {void}
 */
function appendCustomHeader(list, header = {}) {
  const row = document.createElement("div");
  row.className = "custom-header-row";
  row.dataset.customHeader = "true";
  const name = document.createElement("input");
  name.className = "custom-header-name";
  name.type = "text";
  name.autocomplete = "off";
  name.placeholder = "Header name";
  name.value = header.name ?? "";
  const value = document.createElement("input");
  value.className = "custom-header-value";
  value.type = "password";
  value.autocomplete = "new-password";
  value.placeholder = "Header value";
  value.value = header.value ?? "";
  const remove = document.createElement("button");
  remove.className = "secondary";
  remove.type = "button";
  remove.textContent = "Remove";
  remove.addEventListener("click", () => {
    row.remove();
    if (list.children.length === 0) {
      appendCustomHeader(list);
    }
    syncHeaderSetPreview();
  });

  row.append(name, value, remove);
  list.append(row);
}

/**
 * Rebuilds every assignment's set selector after set additions, removals, or renames.
 *
 * @returns {void}
 */
function refreshAssignmentSetChoices() {
  const choices = readHeaderSetChoices();

  for (const select of assignmentList.querySelectorAll(".assignment-header-set")) {
    const selectedId = select.value || select.dataset.selectedId || "";
    select.replaceChildren(new Option("Choose a header set", ""));
    for (const headerSet of choices) {
      select.append(new Option(headerSet.name || "Unnamed header set", headerSet.id));
    }
    select.value = choices.some((headerSet) => headerSet.id === selectedId) ? selectedId : "";
    select.dataset.selectedId = "";
  }
}

/**
 * Saves configuration after requesting only the required enabled host permissions.
 *
 * @param {SubmitEvent} event Form submission event.
 * @returns {Promise<void>} A promise that resolves after save feedback is shown.
 */
async function saveConfiguration(event) {
  event.preventDefault();
  setStatus("");

  let configuration;
  try {
    configuration = collectConfiguration();
  } catch (error) {
    setStatus(error.message, true);
    return;
  }

  const origins = hostPermissionsFor(configuration.siteAssignments.filter((assignment) => assignment.enabled));
  if (origins.length > 0) {
    const granted = await extension.permissions.request({ origins });
    if (!granted) {
      setStatus("Required host permission was not granted, so no changes were saved.", true);
      return;
    }
  }

  try {
    const savedConfiguration = await sendMessage({ type: "save-configuration", configuration });
    renderConfiguration(savedConfiguration);
    const enabledCount = savedConfiguration.siteAssignments.filter((assignment) => assignment.enabled).length;
    setStatus(enabledCount === 0
      ? "All site assignments are disabled."
      : `Enabled ${enabledCount} ${pluralize("site", enabledCount)} with reusable header sets.`);
  } catch {
    setStatus("The browser could not install the request-header rules. Header values were not displayed.", true);
  }
}

/**
 * Collects and validates header sets and site assignments from the form.
 *
 * @returns {{headerSets: Array<object>, siteAssignments: Array<object>}} A normalized configuration.
 */
function collectConfiguration() {
  captureSelectedHeaderSet();
  const savedHeaderSets = headerSets.filter((headerSet) => !isBlankHeaderSet(headerSet));
  const siteAssignments = [];

  for (const element of assignmentList.querySelectorAll("[data-site-assignment]")) {
    const scope = element.querySelector(".assignment-scope").value.trim();
    const headerSetId = element.querySelector(".assignment-header-set").value;
    if (!scope && !headerSetId) {
      continue;
    }

    siteAssignments.push({
      scope,
      headerSetId,
      enabled: element.querySelector(".assignment-enabled").checked,
    });
  }

  return HeaderRules.normalizeConfiguration({ headerSets: savedHeaderSets, siteAssignments });
}

/**
 * Reads one selected editor as a raw draft so incomplete input can stay visible until Save.
 *
 * @param {HTMLElement} element Header-set editor element.
 * @returns {{id: string, name: string, kind: string, headers: Array<{name: string, value: string}>}} Header-set draft.
 */
function readHeaderSetEditor(element) {
  const kind = element.querySelector(".header-set-kind").value;
  return {
    id: element.dataset.id,
    name: element.querySelector(".header-set-name").value.trim(),
    kind,
    headers: readPresetHeaders(element, kind),
  };
}

/**
 * Reads concrete preset header pairs without validating partially completed fields.
 *
 * @param {HTMLElement} element Header-set editor element.
 * @param {string} kind Header-set preset kind.
 * @returns {Array<{name: string, value: string}>} Header pairs.
 */
function readPresetHeaders(element, kind) {
  if (kind === "cloudflare-access") {
    return [
      { name: HeaderRules.CLOUD_FLARE_CLIENT_ID, value: element.querySelector(".preset-client-id").value },
      { name: HeaderRules.CLOUD_FLARE_CLIENT_SECRET, value: element.querySelector(".preset-client-secret").value },
    ];
  }
  if (kind === "bearer-token") {
    return [{ name: "Authorization", value: `Bearer ${element.querySelector(".preset-bearer-token").value}` }];
  }

  return [...element.querySelectorAll("[data-custom-header]")].map((row) => ({
    name: row.querySelector(".custom-header-name").value,
    value: row.querySelector(".custom-header-value").value,
  }));
}

/**
 * Clears saved configuration after explicit confirmation.
 *
 * @returns {Promise<void>} A promise that resolves after the blank editor is rendered.
 */
async function forgetConfiguration() {
  await sendMessage({ type: "forget-configuration" });
  renderConfiguration({ headerSets: [], siteAssignments: [] });
  setStatus("All header sets, site assignments, rules, and site permissions were removed.");
}

/**
 * Converts assignments to unique host permission patterns.
 *
 * @param {Array<{scope: string}>} assignments Site assignments.
 * @returns {Array<string>} Optional host permission origins.
 */
function hostPermissionsFor(assignments) {
  return [...new Set(assignments.map((assignment) => HeaderRules.normalizeScope(assignment.scope).hostPermission))];
}

/**
 * Returns lightweight header-set choices without header values.
 *
 * @returns {Array<{id: string, name: string}>} Header-set choices.
 */
function readHeaderSetChoices() {
  return headerSets.map(({ id, name }) => ({ id, name }));
}

/**
 * Determines whether deleting a header set would orphan a site assignment.
 *
 * @param {string} headerSetId Header-set identifier.
 * @returns {boolean} Whether the set is selected by an assignment.
 */
function isHeaderSetReferenced(headerSetId) {
  return [...assignmentList.querySelectorAll(".assignment-header-set")].some((select) => select.value === headerSetId);
}

/**
 * Counts rendered site assignments that use a header set.
 *
 * @param {string} headerSetId Header-set identifier.
 * @returns {number} Number of assignments using the set.
 */
function assignmentCountFor(headerSetId) {
  return [...assignmentList.querySelectorAll(".assignment-header-set")]
    .filter((select) => select.value === headerSetId).length;
}

/**
 * Updates the selected-set heading without showing header values.
 *
 * @param {{id: string, name: string, kind: string}} headerSet Selected header set.
 * @returns {void}
 */
function updateSelectedHeaderSetHeading(headerSet) {
  const assignmentCount = assignmentCountFor(headerSet.id);
  selectedHeaderSetTitle.textContent = headerSet.name || "Untitled header set";
  selectedHeaderSetDescription.textContent = `${presetLabel(headerSet.kind)} · ${assignmentCount} ${pluralize("site", assignmentCount)} assigned`;
}

/**
 * Returns a non-sensitive usage label for a selected header set.
 *
 * @param {string} headerSetId Header-set identifier.
 * @returns {string} Human-readable usage label.
 */
function usageLabel(headerSetId) {
  const assignmentCount = assignmentCountFor(headerSetId);
  return assignmentCount === 0
    ? "This set is not assigned to a site yet."
    : `Used by ${assignmentCount} ${pluralize("site assignment", assignmentCount)}.`;
}

/**
 * Finds the currently selected header-set draft.
 *
 * @returns {{id: string, name: string, kind: string, headers: Array<object>}|undefined} Selected draft.
 */
function selectedHeaderSet() {
  return headerSets.find((headerSet) => headerSet.id === selectedHeaderSetId);
}

/**
 * Returns the visible label for a header-set preset.
 *
 * @param {string} kind Header-set preset kind.
 * @returns {string} Preset label.
 */
function presetLabel(kind) {
  return ({
    "cloudflare-access": "Cloudflare Access",
    "bearer-token": "Bearer token",
    custom: "Custom headers",
  })[kind] ?? "Custom headers";
}

/**
 * Determines whether an untouched header-set draft can be omitted on save.
 *
 * @param {{name?: string, kind?: string, headers?: Array<object>}} headerSet Header-set draft.
 * @returns {boolean} Whether it contains no user-entered data.
 */
function isBlankHeaderSet(headerSet) {
  if (headerSet.name.trim()) {
    return false;
  }
  if (headerSet.kind === "custom") {
    return headerSet.headers.every((header) => !String(header.name ?? "").trim() && !String(header.value ?? "").trim());
  }
  return headerSet.headers.every((header) => !String(header.value ?? "").trim());
}

/**
 * Creates a visible label and form input for a preset field.
 *
 * @param {string} text Label text.
 * @param {string} className Input class name.
 * @param {string} type Input type.
 * @param {string} value Input value.
 * @returns {HTMLLabelElement} A populated label.
 */
function createInputLabel(text, className, type, value) {
  const label = document.createElement("label");
  const title = document.createElement("span");
  title.textContent = text;
  const input = document.createElement("input");
  input.className = className;
  input.type = type;
  input.autocomplete = type === "password" ? "new-password" : "off";
  input.value = value;
  label.append(title, input);
  return label;
}

/**
 * Indexes header values case-insensitively for preset rendering.
 *
 * @param {Array<object>} headers Header pairs.
 * @returns {Map<string, string>} Header values keyed by lowercase name.
 */
function headersByName(headers) {
  return new Map(headers.map((header) => [header.name.toLowerCase(), header.value]));
}

/**
 * Copies a header set so the draft never mutates browser storage data in place.
 *
 * @param {{id: string, name: string, kind: string, headers: Array<object>}} headerSet Saved header set.
 * @returns {{id: string, name: string, kind: string, headers: Array<object>}} Independent draft.
 */
function copyHeaderSet(headerSet) {
  return {
    id: headerSet.id,
    name: headerSet.name,
    kind: headerSet.kind,
    headers: headerSet.headers.map((header) => ({ name: header.name, value: header.value })),
  };
}

/**
 * Creates an empty reusable header set.
 *
 * @returns {{id: string, name: string, kind: string, headers: Array<object>}} Empty header-set data.
 */
function emptyHeaderSet() {
  return { id: createIdentifier(), name: "", kind: "cloudflare-access", headers: [] };
}

/**
 * Creates a stable browser-local identifier for a new header set.
 *
 * @returns {string} A new identifier.
 */
function createIdentifier() {
  return globalThis.crypto?.randomUUID?.() ?? `set-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * Sends a message to the background configuration owner.
 *
 * @param {object} message Extension message.
 * @returns {Promise<object>} Message response.
 */
function sendMessage(message) {
  return extension.runtime.sendMessage(message);
}

/**
 * Chooses the singular or plural form of a noun.
 *
 * @param {string} noun Singular noun.
 * @param {number} count Count to describe.
 * @returns {string} Singular or plural noun.
 */
function pluralize(noun, count) {
  return count === 1 ? noun : `${noun}s`;
}

/**
 * Displays accessible success or error feedback without exposing header values.
 *
 * @param {string} message Feedback text.
 * @param {boolean} isError Whether feedback is an error.
 * @returns {void}
 */
function setStatus(message, isError = false) {
  status.textContent = message;
  status.dataset.error = String(isError);
}
