const extension = globalThis.browser ?? globalThis.chrome;

const hostLabel = document.querySelector("#host");
const effectiveLabel = document.querySelector("#effective");
const headerSetSelect = document.querySelector("#header-set");
const applyButton = document.querySelector("#apply");
const removeButton = document.querySelector("#remove");
const status = document.querySelector("#status");
const settingsLink = document.querySelector("#settings");

let activeHost = null;
let popupState = null;

void initializePopup();
applyButton.addEventListener("click", assignCurrentHost);
removeButton.addEventListener("click", removeExactOverride);
settingsLink.addEventListener("click", openSettings);

/**
 * Loads active-tab data and the effective assignment without reading header values.
 *
 * @returns {Promise<void>} A promise that resolves after the popup is rendered.
 */
async function initializePopup() {
  try {
    const [tab] = await extension.tabs.query({ active: true, currentWindow: true });
    const url = new URL(tab?.url ?? "");
    if (url.protocol !== "https:") {
      showUnavailable("Choose an HTTPS website to use a header set.");
      return;
    }

    activeHost = url.hostname.toLowerCase();
    hostLabel.textContent = activeHost;
    await refreshPopupState();
  } catch {
    showUnavailable("This browser page cannot receive request headers.");
  }
}

/**
 * Refreshes set choices and the host's direct or inherited assignment.
 *
 * @returns {Promise<void>} A promise that resolves after rendering.
 */
async function refreshPopupState() {
  popupState = await extension.runtime.sendMessage({ type: "get-popup-state", host: activeHost });
  const selectedId = headerSetSelect.value;

  headerSetSelect.replaceChildren(new Option("Choose a header set", ""));
  for (const headerSet of popupState.headerSets) {
    headerSetSelect.append(new Option(headerSet.name, headerSet.id));
  }

  const effective = popupState.effective;
  if (effective) {
    const headerSet = popupState.headerSets.find((item) => item.id === effective.assignment.headerSetId);
    const name = headerSet?.name ?? "a missing header set";
    if (effective.source === "exact") {
      effectiveLabel.textContent = effective.assignment.enabled
        ? `Exact mapping: ${name}`
        : "Exact mapping is disabled; no headers apply here.";
      removeButton.hidden = false;
    } else {
      effectiveLabel.textContent = effective.assignment.enabled
        ? `Wildcard default: ${name}`
        : "Wildcard default is disabled.";
      removeButton.hidden = true;
    }
    headerSetSelect.value = effective.assignment.headerSetId;
  } else {
    effectiveLabel.textContent = "No header set applies to this site.";
    removeButton.hidden = true;
    headerSetSelect.value = selectedId;
  }

  const hasSets = popupState.headerSets.length > 0;
  headerSetSelect.disabled = !hasSets;
  applyButton.disabled = !hasSets;
  if (!hasSets) {
    setStatus("Create a header set in settings first.");
  }
}

/**
 * Requests the active host permission and saves its exact set assignment.
 *
 * @returns {Promise<void>} A promise that resolves after feedback is displayed.
 */
async function assignCurrentHost() {
  const headerSetId = headerSetSelect.value;
  if (!activeHost || !headerSetId) {
    setStatus("Choose a header set first.", true);
    return;
  }

  const hostPermission = HeaderRules.normalizeScope(activeHost).hostPermission;
  const granted = await extension.permissions.request({ origins: [hostPermission] });
  if (!granted) {
    setStatus("Host permission was not granted; no mapping was saved.", true);
    return;
  }

  try {
    await extension.runtime.sendMessage({ type: "assign-exact-host", host: activeHost, headerSetId });
    setStatus(`Using this set on ${activeHost}.`);
    await refreshPopupState();
  } catch {
    setStatus("The browser could not install the request-header rule.", true);
  }
}

/**
 * Removes only the active host's exact mapping so a wildcard default can resume.
 *
 * @returns {Promise<void>} A promise that resolves after feedback is displayed.
 */
async function removeExactOverride() {
  if (!activeHost) {
    return;
  }

  try {
    await extension.runtime.sendMessage({ type: "remove-exact-host", host: activeHost });
    setStatus("Removed the exact mapping.");
    await refreshPopupState();
  } catch {
    setStatus("The exact mapping could not be removed.", true);
  }
}

/**
 * Opens the full configuration page without exposing data in the popup.
 *
 * @param {MouseEvent} event Link click event.
 * @returns {Promise<void>} A promise that resolves when the options page opens.
 */
async function openSettings(event) {
  event.preventDefault();
  await extension.runtime.openOptionsPage();
}

/**
 * Disables assignment controls for unsupported pages.
 *
 * @param {string} message User-facing explanation.
 * @returns {void}
 */
function showUnavailable(message) {
  hostLabel.textContent = message;
  effectiveLabel.textContent = "";
  headerSetSelect.disabled = true;
  applyButton.disabled = true;
  removeButton.hidden = true;
}

/**
 * Displays popup feedback without including header values.
 *
 * @param {string} message Feedback message.
 * @param {boolean} isError Whether feedback is an error.
 * @returns {void}
 */
function setStatus(message, isError = false) {
  status.textContent = message;
  status.dataset.error = String(isError);
}
