import {
  DEFAULT_DAILY_STARTUP_IDLE_MINUTES,
  DEFAULT_FAILED_OPEN_BEHAVIOR,
  DEFAULT_RULES_PER_PAGE,
  applySettingsImportPayload,
  createSettingsExportPayload,
  isHttpUrl,
  createDefaultRuleTitle,
  loadSettings,
  normalizeTargetUrl,
  parseSettingsImportPayload,
  renameRuleTargetUrl,
  saveSettings,
  saveSettingsAndRules,
  saveRules,
  upsertRule,
} from "../src/storage.js";
import { createIntervalAlarmName } from "../src/alarm-names.js";
import { applyMessages, message, setLanguage } from "./i18n.js";
import {
  createFieldValidationState,
  createPopupViewState,
  createDailyTimeRowState,
  createDailyTimesPatch,
  createPersistenceQueue,
  createRulesPersistenceQueue,
  getAddRuleNavigationTarget,
  getPopupFocusTarget,
  getPopupStatusMessage,
  normalizePopupViewStateForRender,
} from "./popup-view.js";
import { getExtensionApi } from "../src/extension-api.js";
import { createPopupControls } from "./render/controls.js";
import { createDetailRenderer } from "./render/detail.js";
import { createHomeRenderer } from "./render/home.js";
import { createSettingsRenderer } from "./render/settings.js";
import {
  captureStableFocusTarget,
  createDraftRule,
  createInlineConfirmation,
  createLatestContentDraftForRule,
  getCurrentTab,
  getRuleTargetUrl,
  getRuleTitle,
  requestLatestContentPermission,
  getHostPermissionOrigin,
  validateLatestContentDraft,
} from "./popup-helpers.js";

const addCurrentButton = document.querySelector("#add-current");
const rulesPanel = document.querySelector(".rules-panel");
const globalAdvancedPanel = document.querySelector("#global-advanced-panel");
const settingsView = document.querySelector("#settings-view");
const settingsImportFileInput = document.querySelector("#settings-import-file");
const languageSwitchButton = document.querySelector("#language-switch");
const openSettingsButton = document.querySelector("#open-settings");
const backFromSettingsButton = document.querySelector("#back-from-settings");
const rulesList = document.querySelector("#rules-list");
const detailView = document.querySelector("#detail-view");
const detailNav = detailView.querySelector(".detail-nav");
const detailNavTitle = detailView.querySelector(".detail-nav-title");
const detailOrigin = document.querySelector("#detail-origin");
const detailStatus = document.querySelector("#detail-status");
const detailContent = document.querySelector("#detail-content");
const backToRulesButton = document.querySelector("#back-to-rules");
const rulesToolbar = document.querySelector("#rules-toolbar");
const statusNode = document.querySelector("#status");
const ruleRowTemplate = document.querySelector("#rule-row-template");
const ruleDetailTemplate = document.querySelector("#rule-detail-template");
const logicCardTemplate = document.querySelector("#logic-card-template");
const timeTemplate = document.querySelector("#time-template");

let rules = [];
const DEFAULT_POPUP_SETTINGS = {
  dailyStartupIdleMinutes: DEFAULT_DAILY_STARTUP_IDLE_MINUTES,
  focusScopeMode: "rule",
  language: "zh",
  rulesPerPage: DEFAULT_RULES_PER_PAGE,
  failedOpenBehavior: DEFAULT_FAILED_OPEN_BEHAVIOR,
};

let settings = { ...DEFAULT_POPUP_SETTINGS };
let currentTargetUrl = "";
let currentPageTitle = "";
let currentPageSupported = true;
let intervalAlarmSchedules = {};
let view = "home";
let currentPage = 1;
let ruleFilter = "all";
let ruleSort = "added";
let selectedTargetUrl = "";
let previousFocusTargetUrl = "";
let pendingFocusTarget = null;
let latestContentDraft = null;
let draftRule = null;
let pendingDiscardDraftConfirmation = false;
let pendingRemoveRuleTargetUrl = "";
let settingsImportPreview = null;
let settingsImportErrorKey = "";
let settingsImportApplying = false;
let latestPersistenceVersion = 0;
let latestRulesPersistenceVersion = 0;
let latestSettingsPersistenceVersion = 0;
let lastPersistedRules = [];
let lastPersistedSettings = { ...DEFAULT_POPUP_SETTINGS };
const enqueuePersistence = createPersistenceQueue();
const enqueueRulePersistence = createRulesPersistenceQueue({
  enqueue: enqueuePersistence,
  saveRules: async (nextRules) => {
    const savedRules = await saveRules(nextRules);

    lastPersistedRules = savedRules;
    return savedRules;
  },
  synchronizeRules: async (savedRules) => {
    const scheduleSynced = await notifyRulesUpdated();

    await refreshIntervalAlarmSchedules(savedRules);
    return scheduleSynced;
  },
});

function pruneRuleEditDrafts(currentRules, resetTargets = []) {
  try {
    const targets = new Set(currentRules.map(getRuleTargetUrl));
    const reset = new Set(resetTargets);
    for (const key of Object.keys(localStorage)) {
      const target = /^tabwake-edit:(?:title|url):(.*)$/.exec(key)?.[1];
      if (target && (!targets.has(target) || reset.has(target))) localStorage.removeItem(key);
    }
  } catch { showStatus("saveFailed", { error: true }); }
}

function getRulesForView() {
  return view === "detail" && draftRule ? [...rules, draftRule] : rules;
}

function getLatestRuleForTarget(ruleTargetUrl, fallbackRule) {
  return (
    getRulesForView().find((rule) => getRuleTargetUrl(rule) === ruleTargetUrl) ||
    fallbackRule
  );
}

function saveLatestDailyTimesPatch(ruleTargetUrl, fallbackRule, updateDailyTimes) {
  return saveRulePatch(
    ruleTargetUrl,
    createDailyTimesPatch(
      getLatestRuleForTarget(ruleTargetUrl, fallbackRule),
      updateDailyTimes
    )
  );
}

const {
  closeHelpPopover,
  createHelpTrigger,
  createLabelWithHelp,
  createTimeRow,
  nextFieldControlId,
} = createPopupControls({
  applyMessages,
  createDailyTimeRowState,
  createFieldValidationState,
  getLatestRuleForTarget,
  getRuleTargetUrl,
  message,
  saveLatestDailyTimesPatch,
  showStatus,
  timeTemplate,
});

const {
  createPaginationControls,
  createRuleRow,
  renderRulesToolbar,
} = createHomeRenderer({
  applyMessages,
  getCurrentPage: () => currentPage,
  getPopupFocusTarget,
  getRules: () => rules,
  message,
  openDetail,
  persistRules,
  render,
  ruleRowTemplate,
  rulesToolbar,
  setCurrentPage: (nextPage) => {
    currentPage = nextPage;
  },
  setPendingFocusTarget: (nextFocusTarget) => {
    pendingFocusTarget = nextFocusTarget;
  },
  setRuleFilter: (nextRuleFilter) => {
    ruleFilter = nextRuleFilter;
  },
  setRuleSort: (nextRuleSort) => {
    ruleSort = nextRuleSort;
  },
});

const {
  createGlobalAdvancedPanel,
  renderLanguageSwitch,
} = createSettingsRenderer({
  applySettingsImport,
  cancelSettingsImportPreview,
  createLabelWithHelp,
  exportSettingsFile,
  languageSwitchButton,
  openSettingsImportFilePicker: () => {
    settingsImportFileInput?.click();
  },
  persistSettings,
  setCurrentPage: (nextPage) => {
    currentPage = nextPage;
  },
});

const { createRuleDetail } = createDetailRenderer({
  readRuleEditDraft: (key, fallback) => {
    try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
  },
  saveRuleEditDraft: (key, value) => {
    try { localStorage.setItem(key, value); } catch { showStatus("saveFailed", { error: true }); }
  },
  clearRuleEditDraft: (key, value) => {
    if (localStorage.getItem(key) === value) localStorage.removeItem(key);
  },
  checkLatestContentPermission: async targetUrl => {
    const permissions = getExtensionApi()?.permissions;
    return permissions?.contains ? permissions.contains({ origins: [getHostPermissionOrigin(targetUrl)] }) : true;
  },
  restoreLatestContentPermission: requestLatestContentPermission,
  applyMessages,
  blockLatestConfigNavigationIfNeeded,
  cancelPendingInlineConfirmation,
  clearLatestDraftForTarget,
  confirmLatestContentConfig,
  createHelpTrigger,
  createInlineConfirmation,
  createLabelWithHelp,
  createTimeRow,
  ensureLatestContentDraft,
  isDraftRuleTarget,
  isRuleRemovalPending: (targetUrl) => pendingRemoveRuleTargetUrl === targetUrl,
  logicCardTemplate,
  message,
  nextFieldControlId,
  onConfirmRuleRemoval: confirmRuleRemoval,
  onRequestRuleRemoval: requestRuleRemoval,
  renameRuleInState,
  render,
  ruleDetailTemplate,
  runRuleNow,
  saveLatestDailyTimesPatch,
  saveRulePatch,
  setPendingFocusTarget: (nextFocusTarget) => {
    pendingFocusTarget = nextFocusTarget;
  },
  showStatus,
  startLatestContentDraft,
});

function isDraftRuleTarget(targetUrl) {
  return Boolean(draftRule && getRuleTargetUrl(draftRule) === targetUrl);
}

function showStatus(key, { error = false } = {}) {
  const status = getPopupStatusMessage({ key, view, error, message });

  statusNode.textContent = status.homeText;
  statusNode.classList.toggle("error", status.error);

  detailStatus.textContent = status.detailText;
  detailStatus.classList.toggle("error", status.error);
}

function restoreStableFocusTarget(focusTarget) {
  if (!focusTarget) {
    return false;
  }

  const target =
    detailContent.querySelector(focusTarget.selector) ||
    rulesList.querySelector(focusTarget.selector) ||
    globalAdvancedPanel.querySelector(focusTarget.selector) ||
    (focusTarget.fallbackClass
      ? document.querySelector(`.${CSS.escape(focusTarget.fallbackClass)}`)
      : null);

  if (!target || typeof target.focus !== "function") {
    return false;
  }

  target.focus();
  return true;
}

function getSelectedRule() {
  return selectedTargetUrl
    ? getRulesForView().find((rule) => getRuleTargetUrl(rule) === selectedTargetUrl)
    : null;
}

function isLatestContentDraftForSelected() {
  return Boolean(
    latestContentDraft &&
      selectedTargetUrl &&
      latestContentDraft.targetUrl === selectedTargetUrl
  );
}

async function notifyRulesUpdated() {
  try {
    const response = await Promise.resolve(
      getExtensionApi().runtime.sendMessage({ type: "rules-updated" })
    );

    return response?.ok !== false;
  } catch {
    return false;
  }
}

function isSelectedLatestConfigIncomplete() {
  const selectedRule = getSelectedRule();

  return Boolean(
    selectedRule?.openTarget === "latestContent" &&
      (!selectedRule.latestExampleUrl || !selectedRule.updatePartRange)
  );
}

function blockLatestConfigNavigationIfNeeded() {
  if (view !== "detail") {
    return false;
  }

  if (!isLatestContentDraftForSelected() && !isSelectedLatestConfigIncomplete()) {
    return false;
  }

  ensureLatestContentDraft(getSelectedRule());
  latestContentDraft = {
    ...latestContentDraft,
    errorKey: "latestConfigRequired",
  };
  showStatus("latestConfigRequired", { error: true });
  pendingFocusTarget = {
    type: "latest-update-part-input",
  };
  render();
  return true;
}

function clearLatestDraftForTarget(targetUrl) {
  if (latestContentDraft?.targetUrl === targetUrl) {
    latestContentDraft = null;
  }
}

function startLatestContentDraft(rule) {
  latestContentDraft = createLatestContentDraftForRule(rule);
  pendingFocusTarget = {
    type: "latest-update-part-input",
  };
  render();
}

function ensureLatestContentDraft(rule) {
  const ruleTargetUrl = getRuleTargetUrl(rule);

  if (latestContentDraft?.targetUrl !== ruleTargetUrl) {
    latestContentDraft = createLatestContentDraftForRule(rule);
  }

  return latestContentDraft;
}

function setLatestDraftError(errorKey) {
  if (latestContentDraft) {
    latestContentDraft = {
      ...latestContentDraft,
      errorKey,
    };
  }
  showStatus(errorKey, { error: true });
  render();
}

async function confirmLatestContentConfig(rule) {
  const ruleTargetUrl = getRuleTargetUrl(rule);
  const draft = ensureLatestContentDraft(rule);
  const validation = validateLatestContentDraft(draft);

  if (!validation.ok) {
    if (
      validation.errorKey === "latestExpectedNextRequired" ||
      validation.errorKey === "latestExpectedNextMismatch"
    ) {
      pendingFocusTarget = { type: "latest-expected-next-input" };
    } else {
      pendingFocusTarget = { type: "latest-update-part-input" };
    }
    setLatestDraftError(validation.errorKey);
    return;
  }

  // 触发时才会联网；这里只为后续触发申请 host 权限，获权后不立即探测。
  // Firefox 要求 request() 在点击处理的同步阶段调用，不能先 await 权限状态查询。
  const permissionRequest = requestLatestContentPermission(validation.latestExampleUrl);
  let hasPermission;

  try {
    hasPermission = await permissionRequest;
  } catch {
    setLatestDraftError("latestPermissionRequired");
    return;
  }

  if (!hasPermission) {
    setLatestDraftError("latestPermissionRequired");
    return;
  }

  try {
    const patch = {
      openTarget: "latestContent",
      latestExampleUrl: validation.latestExampleUrl,
      updatePartRange: validation.updatePartRange,
      expectedNextExampleUrl: validation.expectedNextExampleUrl,
    };

    clearLatestDraftForTarget(ruleTargetUrl);
    const saved = await saveRulePatch(ruleTargetUrl, patch, "latestConfigSaved");

    if (!saved) {
      latestContentDraft = { ...draft };
    }
  } catch (error) {
    latestContentDraft = {
      ...draft,
      errorKey: /already exists/i.test(error?.message || "")
        ? "duplicateTargetUrl"
        : "invalidLatestConfigUrl",
    };
    showStatus(latestContentDraft.errorKey, { error: true });
    render();
  }
}

async function persistRules(nextRules, statusKey = "saved", stableFocusTarget = null) {
  if (settingsImportApplying) {
    showStatus("settingsImportInProgress", { error: true });
    return false;
  }

  const persistenceVersion = ++latestPersistenceVersion;
  const rulesPersistenceVersion = ++latestRulesPersistenceVersion;
  rules = nextRules;

  try {
    const { rules: savedRules, scheduleSynced } = await enqueueRulePersistence(nextRules);
    if (rulesPersistenceVersion !== latestRulesPersistenceVersion) {
      return true;
    }

    rules = savedRules;
    pruneRuleEditDrafts(savedRules);
    reconcileSelectedRuleAfterRulesChange();
    if (persistenceVersion !== latestPersistenceVersion) {
      return true;
    }

    render();
    restoreStableFocusTarget(stableFocusTarget);
    showStatus(scheduleSynced ? statusKey : "rulesUpdateFailed", {
      error: !scheduleSynced,
    });
    return true;
  } catch {
    if (rulesPersistenceVersion === latestRulesPersistenceVersion) {
      rules = lastPersistedRules;
      reconcileSelectedRuleAfterRulesChange();
      if (persistenceVersion === latestPersistenceVersion) {
        render();
        restoreStableFocusTarget(stableFocusTarget);
        showStatus("saveFailed", { error: true });
      }
    }
    return false;
  }
}

function reconcileSelectedRuleAfterRulesChange() {
  if (
    selectedTargetUrl &&
    !rules.some((rule) => getRuleTargetUrl(rule) === selectedTargetUrl)
  ) {
    view = "home";
    selectedTargetUrl = "";
    latestContentDraft = null;
  }
}

function saveRulePatch(ruleTargetUrl, patch, statusKey = "saved") {
  const stableFocusTarget = captureStableFocusTarget();
  if (isDraftRuleTarget(ruleTargetUrl)) {
    const [nextDraftRule] = upsertRule([draftRule], ruleTargetUrl, patch);
    draftRule = nextDraftRule || draftRule;
    selectedTargetUrl = getRuleTargetUrl(draftRule);
    previousFocusTargetUrl = selectedTargetUrl;
    render();
    restoreStableFocusTarget(stableFocusTarget);
    return true;
  }

  return persistRules(upsertRule(rules, ruleTargetUrl, patch), statusKey, stableFocusTarget);
}

function renameRuleInState(ruleTargetUrl, nextTargetUrl, patch = {}, statusKey = "saved") {
  const stableFocusTarget = captureStableFocusTarget();

  if (isDraftRuleTarget(ruleTargetUrl)) {
    if (rules.some((rule) => getRuleTargetUrl(rule) === nextTargetUrl)) {
      throw new Error("Rule already exists");
    }

    const [nextDraftRule] = renameRuleTargetUrl(
      [draftRule],
      ruleTargetUrl,
      nextTargetUrl,
      patch
    );
    draftRule = nextDraftRule || draftRule;
    selectedTargetUrl = getRuleTargetUrl(draftRule);
    previousFocusTargetUrl = selectedTargetUrl;
    render();
    restoreStableFocusTarget(stableFocusTarget);
    return true;
  }

  selectedTargetUrl = nextTargetUrl;
  previousFocusTargetUrl = nextTargetUrl;
  return persistRules(
    renameRuleTargetUrl(rules, ruleTargetUrl, nextTargetUrl, patch),
    statusKey,
    stableFocusTarget
  );
}

async function persistSettings(nextSettings, statusKey = "saved") {
  if (settingsImportApplying) {
    showStatus("settingsImportInProgress", { error: true });
    return false;
  }

  const persistenceVersion = ++latestPersistenceVersion;
  const settingsPersistenceVersion = ++latestSettingsPersistenceVersion;
  const stableFocusTarget = captureStableFocusTarget();

  try {
    const { savedSettings, scheduleSynced } = await enqueuePersistence(async () => {
      const resolvedSettings =
        typeof nextSettings === "function"
          ? nextSettings(lastPersistedSettings)
          : nextSettings;
      const savedSettings = await saveSettings(resolvedSettings);
      const scheduleSynced = await notifyRulesUpdated();

      lastPersistedSettings = savedSettings;
      return { savedSettings, scheduleSynced };
    });
    if (settingsPersistenceVersion !== latestSettingsPersistenceVersion) {
      return true;
    }

    settings = savedSettings;
    setLanguage(settings.language);
    applyMessages(document);
    if (persistenceVersion !== latestPersistenceVersion) {
      return true;
    }

    render();
    restoreStableFocusTarget(stableFocusTarget);
    showStatus(scheduleSynced ? statusKey : "rulesUpdateFailed", {
      error: !scheduleSynced,
    });
    return true;
  } catch {
    if (settingsPersistenceVersion === latestSettingsPersistenceVersion) {
      settings = lastPersistedSettings;
      setLanguage(settings.language);
      applyMessages(document);
      if (persistenceVersion === latestPersistenceVersion) {
        render();
        restoreStableFocusTarget(stableFocusTarget);
        showStatus("saveFailed", { error: true });
      }
    }
    return false;
  }
}

function getSettingsImportErrorKey(error) {
  const messageText = String(error?.message || "");

  if (messageText.includes("Invalid JSON")) {
    return "settingsImportInvalidJson";
  }

  if (messageText.includes("Unsupported settings file")) {
    return "settingsImportUnsupported";
  }

  if (messageText.includes("No valid settings or rules")) {
    return "settingsImportEmpty";
  }

  return "settingsImportFailed";
}

function getSettingsExportFileName(date = new Date()) {
  return `tabwake-settings-${date.toISOString().slice(0, 10)}.json`;
}

function exportSettingsFile() {
  const payload = createSettingsExportPayload({ rules, settings });
  const text = JSON.stringify(payload, null, 2);
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = getSettingsExportFileName();
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  showStatus("settingsExported");
}

async function loadSettingsImportFile(file) {
  if (!file) {
    return;
  }

  try {
    settingsImportPreview = parseSettingsImportPayload(await file.text());
    settingsImportErrorKey = "";
    render();
  } catch (error) {
    settingsImportPreview = null;
    settingsImportErrorKey = getSettingsImportErrorKey(error);
    render();
    showStatus(settingsImportErrorKey, { error: true });
  } finally {
    if (settingsImportFileInput) {
      settingsImportFileInput.value = "";
    }
  }
}

async function applySettingsImport(mode) {
  if (!settingsImportPreview || settingsImportApplying) {
    return false;
  }

  try { editPort?.postMessage(null); } catch { editPort = null; }
  const importedTargets = settingsImportPreview.rules.map(getRuleTargetUrl);
  const result = applySettingsImportPayload(settingsImportPreview, {
    currentRules: rules,
    mode,
  });
  const persistenceVersion = ++latestPersistenceVersion;
  latestRulesPersistenceVersion += 1;
  latestSettingsPersistenceVersion += 1;
  settingsImportApplying = true;
  render();

  try {
    const { saved, scheduleSynced } = await enqueuePersistence(async () => {
      const saved = await saveSettingsAndRules(result.settings, result.rules, undefined, { resetTargets: mode === "merge" ? importedTargets : null });
      lastPersistedRules = saved.rules;
      lastPersistedSettings = saved.settings;
      const scheduleSynced = await notifyRulesUpdated();

      await refreshIntervalAlarmSchedules(saved.rules);
      return { saved, scheduleSynced };
    });
    if (persistenceVersion !== latestPersistenceVersion) {
      settingsImportApplying = false;
      return true;
    }

    settings = saved.settings;
    rules = saved.rules;
    pruneRuleEditDrafts(saved.rules, importedTargets);
    lastPersistedSettings = saved.settings;
    settingsImportPreview = null;
    settingsImportErrorKey = "";
    setLanguage(settings.language);
    applyMessages(document);
    settingsImportApplying = false;
    pendingFocusTarget = { type: "settings-import-button" };
    render();
    showStatus(scheduleSynced ? "settingsImported" : "rulesUpdateFailed", {
      error: !scheduleSynced,
    });
    return true;
  } catch {
    rules = lastPersistedRules;
    settings = lastPersistedSettings;
    reconcileSelectedRuleAfterRulesChange();
    setLanguage(settings.language);
    applyMessages(document);
    settingsImportApplying = false;
    settingsImportErrorKey = "settingsImportFailed";
    pendingFocusTarget = { type: "settings-import-button" };
    render();
    showStatus("settingsImportFailed", { error: true });
    return false;
  }
}

function cancelSettingsImportPreview() {
  settingsImportPreview = null;
  settingsImportErrorKey = "";
  pendingFocusTarget = { type: "settings-import-button" };
  render();
}

function runRuleNow(rule) {
  return getExtensionApi().runtime.sendMessage({
    type: "run-rule-now",
    targetUrl: getRuleTargetUrl(rule),
    rule,
  });
}

function openDetail(targetUrl) {
  if (blockLatestConfigNavigationIfNeeded()) {
    return;
  }

  pendingDiscardDraftConfirmation = false;
  pendingRemoveRuleTargetUrl = "";
  previousFocusTargetUrl = targetUrl;
  selectedTargetUrl = targetUrl;
  view = "detail";
  pendingFocusTarget = getPopupFocusTarget({ view });
  render();
}

function showHome() {
  const returnFromSettings = view === "settings";

  if (draftRule) {
    pendingDiscardDraftConfirmation = true;
    pendingRemoveRuleTargetUrl = "";
    pendingFocusTarget = { type: "inline-confirmation", target: "discard-draft-confirm" };
    render();
    return;
  }

  if (blockLatestConfigNavigationIfNeeded()) {
    return;
  }

  pendingRemoveRuleTargetUrl = "";
  pendingDiscardDraftConfirmation = false;

  view = "home";
  selectedTargetUrl = "";
  pendingFocusTarget = getPopupFocusTarget({
    view,
    previousOrigin: returnFromSettings ? "" : previousFocusTargetUrl,
    returnFromSettings,
  });
  render();
}

function discardDraftAndShowHome() {
  draftRule = null;
  latestContentDraft = null;
  pendingDiscardDraftConfirmation = false;
  pendingRemoveRuleTargetUrl = "";
  view = "home";
  selectedTargetUrl = "";
  pendingFocusTarget = getPopupFocusTarget({
    view,
    previousOrigin: previousFocusTargetUrl,
  });
  render();
}

function cancelPendingInlineConfirmation() {
  const wasRemovingRule = Boolean(pendingRemoveRuleTargetUrl);
  pendingDiscardDraftConfirmation = false;
  pendingRemoveRuleTargetUrl = "";
  pendingFocusTarget = wasRemovingRule
    ? { type: "inline-confirmation-action", target: "remove-rule-button" }
    : { type: "back-button" };
  render();
}

function requestRuleRemoval(targetUrl) {
  pendingRemoveRuleTargetUrl = targetUrl;
  pendingDiscardDraftConfirmation = false;
  pendingFocusTarget = {
    type: "inline-confirmation",
    target: "remove-rule-confirm",
  };
  render();
}

function confirmRuleRemoval(targetUrl) {
  pendingRemoveRuleTargetUrl = "";
  pendingFocusTarget = { type: "add-current-button" };
  persistRules(rules.filter((rule) => getRuleTargetUrl(rule) !== targetUrl));
}

function showSettings() {
  if (blockLatestConfigNavigationIfNeeded()) {
    return;
  }

  view = "settings";
  selectedTargetUrl = "";
  pendingFocusTarget = getPopupFocusTarget({ view });
  render();
}

async function confirmDraftRule() {
  if (!draftRule) {
    return;
  }

  if (rules.some((rule) => getRuleTargetUrl(rule) === draftRule.targetUrl)) {
    showStatus("duplicateTargetUrl", { error: true });
    return;
  }

  const confirmedTargetUrl = draftRule.targetUrl;
  const saved = await persistRules(upsertRule(rules, draftRule.targetUrl, draftRule));

  if (!saved) {
    return;
  }

  draftRule = null;
  selectedTargetUrl = confirmedTargetUrl;
  previousFocusTargetUrl = confirmedTargetUrl;
  view = "detail";
  render();
}

function createDraftDetailActions() {
  const actions = document.createElement("div");
  actions.className = "detail-draft-actions";
  actions.insertAdjacentHTML(
    "beforeend",
    '<button class="primary-button draft-confirm-button" type="button" data-i18n="confirmDraftRule"></button>'
  );
  applyMessages(actions);
  actions
    .querySelector(".draft-confirm-button")
    ?.addEventListener("click", confirmDraftRule);

  return actions;
}

function createDiscardDraftConfirmation() {
  return createInlineConfirmation({
    messageText: message("confirmDiscardDraft"),
    confirmLabel: message("confirmDiscardDraftAction"),
    cancelLabel: message("keepEditing"),
    onConfirm: discardDraftAndShowHome,
    onCancel: cancelPendingInlineConfirmation,
    focusTarget: "discard-draft-confirm",
  });
}

function createViewContext() {
  const stateRules = getRulesForView();

  return {
    view,
    rules: stateRules,
    settings,
    currentTargetUrl,
    currentPageSupported,
    page: currentPage,
    ruleFilter,
    ruleSort,
    selectedTargetUrl,
    latestContentDraft,
    settingsImportPreview,
    settingsImportErrorKey,
    settingsImportApplying,
    draftTargetUrl: draftRule ? getRuleTargetUrl(draftRule) : "",
    intervalAlarmSchedules,
    message,
  };
}

async function refreshIntervalAlarmSchedules(rulesToSchedule = rules) {
  const alarmsApi = getExtensionApi()?.alarms;

  if (!alarmsApi?.get) {
    intervalAlarmSchedules = {};
    return;
  }

  const schedules = {};
  await Promise.all(
    rulesToSchedule.map(async (rule) => {
      if (rule.enabled === false || !rule.strategies?.intervalMinutes) {
        return;
      }

      const targetUrl = getRuleTargetUrl(rule);
      let alarm = null;

      try {
        alarm = await alarmsApi.get(createIntervalAlarmName(targetUrl));
      } catch {
        return;
      }

      if (Number.isFinite(alarm?.scheduledTime)) {
        schedules[targetUrl] = alarm.scheduledTime;
      }
    })
  );
  intervalAlarmSchedules = schedules;
}

function render() {
  const viewContext = createViewContext();
  const state = normalizePopupViewStateForRender(
    createPopupViewState(viewContext),
    viewContext
  );
  currentPage = state.pagination?.page || currentPage;

  renderLanguageSwitch(state.languageSwitch);
  rulesPanel.classList.toggle("detail-mode", state.view === "detail");
  rulesPanel.classList.toggle("settings-mode", state.view === "settings");
  addCurrentButton.hidden = state.currentAction.type === "none";
  addCurrentButton.disabled = state.currentAction.type === "disabled";
  addCurrentButton.textContent = state.currentAction.label || message("addCurrentOrigin");
  addCurrentButton.title = state.currentAction.title || state.currentAction.label || "";
  rulesList.hidden = state.view !== "home";
  detailView.hidden = state.view !== "detail";
  settingsView.hidden = state.view !== "settings";
  rulesList.replaceChildren();
  rulesToolbar.replaceChildren();
  detailContent.replaceChildren();
  detailNav?.querySelector(".detail-draft-actions")?.remove();
  if (state.view === "detail" && selectedTargetUrl && isDraftRuleTarget(selectedTargetUrl)) {
    detailNav?.append(createDraftDetailActions());
  }
  if (detailNavTitle) {
    detailNavTitle.textContent =
      state.detailStructure?.detailTitle || message("detailTitle");
  }
  globalAdvancedPanel.replaceChildren();
  globalAdvancedPanel.hidden = state.view !== "settings";

  openSettingsButton.hidden = state.view !== "home";
  renderRulesToolbar(state);

  if (state.view === "detail") {
    detailOrigin.textContent = getRuleTitle(state.selectedRule);
    detailOrigin.dataset.draft = String(Boolean(state.detailStructure?.isDraft));
    if (state.detailStructure?.draftBadge) {
      const badge = document.createElement("span");
      badge.className = "draft-badge";
      badge.textContent = state.detailStructure.draftBadge;
      detailOrigin.append(" ", badge);
    }
    if (pendingDiscardDraftConfirmation) {
      detailContent.append(createDiscardDraftConfirmation());
    }
    detailContent.append(createRuleDetail(state.selectedRule, state));
    applyPendingFocus();
    return;
  }

  if (state.view === "settings") {
    globalAdvancedPanel.append(createGlobalAdvancedPanel(state));
    applyPendingFocus();
    return;
  }

  if (!state.rows.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = state.emptyRulesMessage || message("emptyRules");
    rulesList.append(empty);
    if (state.emptyRulesGuidance) {
      const guidance = document.createElement("p");
      guidance.className = "empty-state-guidance";
      guidance.textContent = state.emptyRulesGuidance;
      rulesList.append(guidance);
    }
    applyPendingFocus();
    return;
  }

  for (const row of state.rows) {
    rulesList.append(createRuleRow(row));
  }

  if (state.pagination) {
    rulesList.append(createPaginationControls(state.pagination));
  }

  applyPendingFocus();
}

backToRulesButton.addEventListener("click", showHome);
backFromSettingsButton.addEventListener("click", showHome);
languageSwitchButton.addEventListener("click", () => {
  persistSettings((currentSettings) => ({
    ...currentSettings,
    language: currentSettings.language === "en" ? "zh" : "en",
  }));
});
settingsImportFileInput?.addEventListener("change", () => {
  loadSettingsImportFile(settingsImportFileInput.files?.[0]);
});
openSettingsButton.addEventListener("click", showSettings);
document.addEventListener("click", (event) => {
  if (
    !event.target.closest?.(".help-trigger") &&
    !event.target.closest?.(".help-popover")
  ) {
    closeHelpPopover();
  }
});

function applyPendingFocus() {
  const focusTarget = pendingFocusTarget;

  if (!focusTarget) {
    return;
  }

  pendingFocusTarget = null;

  if (focusTarget.type === "back-button") {
    backToRulesButton.focus();
    return;
  }

  if (focusTarget.type === "back-settings-button") {
    backFromSettingsButton.focus();
    return;
  }

  if (focusTarget.type === "rule-row") {
    rulesList
      .querySelector(`.rule-body[data-origin="${CSS.escape(focusTarget.origin)}"]`)
      ?.focus();
    return;
  }

  if (focusTarget.type === "rules-toolbar-control") {
    rulesToolbar
      .querySelector(`[data-focus-control="${focusTarget.control}"]`)
      ?.focus();
    return;
  }

  if (focusTarget.type === "pagination-button") {
    const requested = rulesList.querySelector(
      `[data-pagination-action="${focusTarget.action}"]`
    );
    const fallbackAction = focusTarget.action === "next" ? "previous" : "next";
    const fallback = rulesList.querySelector(
      `[data-pagination-action="${fallbackAction}"]`
    );

    (requested?.disabled ? fallback : requested)?.focus();
    return;
  }

  if (focusTarget.type === "settings-button") {
    openSettingsButton.focus();
    return;
  }

  if (focusTarget.type === "settings-import-button") {
    globalAdvancedPanel
      .querySelector('[data-focus-target="settings-import-button"]')
      ?.focus();
    return;
  }

  if (focusTarget.type === "inline-confirmation") {
    detailContent
      .querySelector(`[data-focus-target="${CSS.escape(focusTarget.target)}"]`)
      ?.focus();
    return;
  }

  if (focusTarget.type === "inline-confirmation-action") {
    detailContent
      .querySelector(`[data-focus-target="${CSS.escape(focusTarget.target)}"]`)
      ?.focus();
    return;
  }

  if (focusTarget.type === "add-current-button") {
    addCurrentButton.focus();
    return;
  }

  if (focusTarget.type === "latest-update-part-input") {
    const input = detailContent.querySelector(".latest-update-part-input");

    input?.focus();
    if (input) {
      input.setSelectionRange(input.value.length, input.value.length);
      input.scrollLeft = input.scrollWidth;
    }
    return;
  }

  if (focusTarget.type === "latest-expected-next-input") {
    detailContent.querySelector(".latest-expected-next-input")?.focus();
  }
}

addCurrentButton.addEventListener("click", () => {
  if (currentTargetUrl && rules.some((rule) => getRuleTargetUrl(rule) === currentTargetUrl)) {
    openDetail(currentTargetUrl);
    return;
  }

  if (!currentTargetUrl || !isHttpUrl(currentTargetUrl)) {
    showStatus("invalidTargetUrl", { error: true });
    return;
  }

  const normalizedTargetUrl = normalizeTargetUrl(currentTargetUrl);
  currentTargetUrl = normalizedTargetUrl;

  draftRule = createDraftRule({
    targetUrl: normalizedTargetUrl,
    title: createDefaultRuleTitle({
      pageTitle: currentPageTitle,
      targetUrl: normalizedTargetUrl,
    }),
  });
  const target = getAddRuleNavigationTarget(normalizedTargetUrl);

  selectedTargetUrl = draftRule.targetUrl;
  previousFocusTargetUrl = draftRule.targetUrl;
  view = target.view;
  currentPage = 1;
  pendingFocusTarget = getPopupFocusTarget({ view });
  render();
});

// A port disconnect is observed by the worker even when popup unload handlers do not run.
let editPort = null;
detailContent.addEventListener("input", event => {
  if (draftRule || !event.target.matches(".rule-title-input, .rule-url-input")) return;
  const title = detailContent.querySelector(".rule-title-input");
  const url = detailContent.querySelector(".rule-url-input");
  if (!title || !url) return;
  try {
    if (!editPort) {
      editPort = getExtensionApi().runtime.connect({ name: "tabwake-edit" });
      editPort.onDisconnect.addListener(() => { editPort = null; });
    }
    editPort.postMessage({ targetUrl: title.dataset.targetUrl, fields: { title: title.value, targetUrl: url.value } });
  } catch { showStatus("saveFailed", { error: true }); }
});

for (const event of [getExtensionApi()?.permissions?.onAdded, getExtensionApi()?.permissions?.onRemoved]) {
  event?.addListener(() => render());
}

async function boot() {
  const [tab, loadedSettings] = await Promise.all([getCurrentTab(), loadSettings()]);
  rules = loadedSettings.rules;
  lastPersistedRules = rules;
  pruneRuleEditDrafts(rules);
  settings = loadedSettings.settings;
  lastPersistedSettings = settings;
  setLanguage(settings.language);
  applyMessages(document);

  if (tab?.url && isHttpUrl(tab.url)) {
    currentTargetUrl = normalizeTargetUrl(tab.url);
    currentPageTitle = typeof tab.title === "string" ? tab.title.trim() : "";
    currentPageSupported = true;
  } else {
    currentTargetUrl = "";
    currentPageTitle = "";
    currentPageSupported = false;
  }

  await refreshIntervalAlarmSchedules();
  render();
}

boot().catch(() => {
  setLanguage(settings.language);
  applyMessages(document);
  showStatus("loadFailed", { error: true });
});
