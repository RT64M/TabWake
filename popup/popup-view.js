import { validateDailyTime, validateIntervalMinutes } from "../src/storage.js";
import {
  createEmptyRulesGuidance,
  createLanguageSwitchState,
  createRuleRowState,
  createRulesToolbarState,
  filterRuleRows,
  getFocusScopeMode,
  getRuleTargetUrl,
  getRuleTitle,
  getRulesPageSize,
  sortRuleRows,
} from "./view/shared.js";
import { createStartupLogicState } from "./view/startup-logic.js";
import {
  createLatestContentConfigState,
  createOpenTargetOptions,
  getLatestContentDraftForRule,
} from "./view/latest-content.js";
import {
  createGlobalAdvancedSettingsState,
  createRuleFieldsState,
  createSettingsTransferState,
} from "./view/settings.js";

export { OPEN_TARGET_TYPES } from "./view/shared.js";
export { STARTUP_LOGIC_TYPES } from "./view/shared.js";
export { getPopupStatusMessage } from "./view/shared.js";
export { summarizeRuleStrategies } from "./view/shared.js";
export { getRuleStatePresentation } from "./view/shared.js";
export { createStartupLogicState } from "./view/startup-logic.js";
export { createOpenTargetOptions } from "./view/latest-content.js";
export { createGlobalAdvancedSettingsState } from "./view/settings.js";

const RULE_URL_DISPLAY_MAX_LENGTH = 36;

export function formatRuleUrlForDisplay(targetUrl) {
  const rawTargetUrl = String(targetUrl || "");
  let host = "";
  let pathname = "";

  try {
    const url = new URL(rawTargetUrl);
    host = url.host;
    pathname = url.pathname;
  } catch {
    return rawTargetUrl.replace(/^https?:\/\//, "");
  }

  const displayUrl = `${host}${pathname}`;

  if (displayUrl.length <= RULE_URL_DISPLAY_MAX_LENGTH) {
    return displayUrl;
  }

  const pathSegments = pathname.split("/").filter(Boolean);
  const hasTrailingSlash = pathname.endsWith("/");

  for (let segmentCount = Math.min(2, pathSegments.length); segmentCount > 0; segmentCount -= 1) {
    const tail = pathSegments.slice(-segmentCount).join("/");
    const shortened = `${host}/…/${tail}${hasTrailingSlash ? "/" : ""}`;

    if (shortened.length <= RULE_URL_DISPLAY_MAX_LENGTH) {
      return shortened;
    }
  }

  const fallbackPrefix = `${host}/…`;
  const tailLength = RULE_URL_DISPLAY_MAX_LENGTH - fallbackPrefix.length;

  if (tailLength > 0 && pathSegments.length) {
    return `${fallbackPrefix}${pathSegments.at(-1).slice(-tailLength)}`;
  }

  return displayUrl;
}

export function createPopupViewState({
  view,
  rules,
  settings = {},
  currentOrigin = "",
  currentTargetUrl,
  page = 1,
  ruleFilter = "all",
  ruleSort = "added",
  selectedOrigin = "",
  selectedTargetUrl = selectedOrigin,
  latestContentDraft = null,
  settingsImportPreview = null,
  settingsImportErrorKey = "",
  settingsImportApplying = false,
  draftTargetUrl = "",
  currentPageSupported = true,
  intervalAlarmSchedules = {},
  now = new Date(),
  message,
}) {
  const focusScopeMode = getFocusScopeMode(settings);
  const languageSwitch = createLanguageSwitchState(settings, message);
  const hasExplicitCurrentTarget = currentTargetUrl !== undefined;
  const currentTarget = hasExplicitCurrentTarget ? currentTargetUrl : currentOrigin;
  const selectedKey = selectedTargetUrl || selectedOrigin;
  const selectedRule =
    view === "detail"
      ? rules.find(
          (rule) =>
            getRuleTargetUrl(rule) === selectedKey ||
            (selectedOrigin && rule.origin === selectedOrigin)
        )
      : null;
  const currentAlreadyAdded =
    Boolean(currentTarget) &&
    rules.some(
      (rule) =>
        getRuleTargetUrl(rule) === currentTarget ||
        (!hasExplicitCurrentTarget && rule.origin === currentOrigin)
    );
  const currentAction = (() => {
    if (!currentPageSupported) {
      return {
        type: "disabled",
        label: message("unsupportedPage"),
        title: message("unsupportedPage"),
        targetUrl: "",
      };
    }

    if (currentAlreadyAdded) {
      return {
        type: "edit",
        label: message("alreadyAdded"),
        title: message("alreadyAdded"),
        targetUrl: currentTarget,
      };
    }

    if (currentTarget) {
      return {
        type: "add",
        label: message("addCurrentOrigin"),
        title: message("addCurrentOrigin"),
        targetUrl: currentTarget,
      };
    }

    return {
      type: "none",
      label: "",
      title: "",
      targetUrl: "",
    };
  })();

  if (view === "settings") {
    return {
      view: "settings",
      languageSwitch,
      canAddCurrentOrigin: false,
      canAddCurrentTarget: false,
      showCurrentPanel: false,
      currentAction,
      rows: [],
      rulesToolbar: null,
      selectedRule: null,
      selectedSummary: "",
      showDetailSummary: false,
      showActivationControls: false,
      showDetailControls: false,
      globalAdvancedSettings: createGlobalAdvancedSettingsState(settings, message),
      settingsTransfer: createSettingsTransferState(
        {
          preview: settingsImportPreview,
          errorKey: settingsImportErrorKey,
          rules,
          isApplying: settingsImportApplying,
        },
        message
      ),
      settingsNavigationAction: {
        type: "back",
        label: message("backToRules"),
      },
      settingsAction: null,
    };
  }

  if (view === "detail" && selectedRule) {
    const isDraft = Boolean(draftTargetUrl && getRuleTargetUrl(selectedRule) === draftTargetUrl);
    const startupLogicState = createStartupLogicState(selectedRule, message, now, {
      focusScopeMode,
    });
    const draft = getLatestContentDraftForRule(selectedRule, latestContentDraft);
    const selectedOpenTarget = draft ? "latestContent" : selectedRule.openTarget;
    const showLatestContentConfig =
      selectedOpenTarget === "latestContent" ||
      (selectedRule.openTarget === "latestContent" && !selectedRule.latestExampleUrl);
    const openTargetOptions = createOpenTargetOptions(selectedRule, message, {
      selectedOpenTarget,
    });

    return {
      view: "detail",
      languageSwitch,
      canAddCurrentOrigin: false,
      canAddCurrentTarget: false,
      showCurrentPanel: false,
      rows: [],
      selectedRule,
      selectedSummary: "",
      showDetailSummary: false,
      showActivationControls: false,
      openTargetOptions,
      ruleFields: createRuleFieldsState(selectedRule, message, {
        focusScopeMode,
      }),
      ...startupLogicState,
      managementAction: {
        type: "remove-rule",
        label: message("removeRule"),
        tone: "danger",
        confirmMessage: message("confirmRemoveRule", {
          title: getRuleTitle(selectedRule),
        }),
      },
      immediateAction: {
        type: isDraft ? "none" : "run-now",
        label: isDraft ? "" : message("runNow"),
        visualWeight: "secondary",
      },
      openTargetField: {
        label: message("openTargetTitle"),
        options: openTargetOptions,
      },
      showLatestExampleField: false,
      latestExampleField: null,
      showLatestContentConfig,
      latestContentConfig: showLatestContentConfig
        ? createLatestContentConfigState(selectedRule, message, {
            latestContentDraft,
          })
        : null,
      currentAction,
      detailSectionOrder: [
        "ruleFields",
        "openTarget",
        "startupLogic",
        "addStartupLogic",
        "management",
      ],
      detailStructure: {
        hasTopNavigation: true,
        hasDangerZone: false,
        hasScrollHint: true,
        hasStartupLogicCanvas: true,
        hasAddStartupLogic: true,
        hasNavRemoveAction: false,
        hasBottomManagementAction: true,
        hasOuterRuleCardFrame: false,
        hasRuleScopeInTitleRow: true,
        hasLightweightOpenTarget: true,
        isDraft,
        draftBadge: isDraft ? message("draftBadge") : "",
        detailTitle: isDraft ? message("draftDetailTitle") : message("detailTitle"),
      },
      draftDiscardConfirmMessage: isDraft ? message("confirmDiscardDraft") : "",
      showDetailControls: true,
      globalAdvancedSettings: null,
      settingsAction: null,
    };
  }

  const allRows = rules.map((rule, index) =>
    createRuleRowState(rule, message, now, index, intervalAlarmSchedules)
  );
  const filteredRows = filterRuleRows(sortRuleRows(allRows, ruleSort), ruleFilter);
  const totalItems = filteredRows.length;
  const rulesPageSize = getRulesPageSize(settings);
  const totalPages = Math.max(1, Math.ceil(totalItems / rulesPageSize));
  const currentPage = Math.min(Math.max(Number(page) || 1, 1), totalPages);
  const pageStart = (currentPage - 1) * rulesPageSize;
  const pageRows = filteredRows.slice(pageStart, pageStart + rulesPageSize);

  return {
    view: "home",
    languageSwitch,
    canAddCurrentOrigin:
      Boolean(currentTarget) && currentPageSupported && !currentAlreadyAdded,
    canAddCurrentTarget:
      Boolean(currentTarget) && currentPageSupported && !currentAlreadyAdded,
    showCurrentPanel: false,
    currentAction,
    nextStartup: null,
    rows: pageRows,
    rulesToolbar:
      rules.length > 0
        ? createRulesToolbarState({
            filter: ruleFilter,
            sort: ruleSort,
            message,
          })
        : null,
    emptyRulesMessage:
      rules.length && !pageRows.length
        ? message("emptyFilteredRules")
        : message("emptyRules"),
    emptyRulesGuidance:
      rules.length === 0 ? createEmptyRulesGuidance(currentAction, message) : "",
    pagination: {
      page: currentPage,
      pageSize: rulesPageSize,
      totalPages,
      totalItems,
      hasPrevious: currentPage > 1,
      hasNext: currentPage < totalPages,
      previousLabel: message("paginationPrevious"),
      nextLabel: message("paginationNext"),
      status: message("paginationStatus", {
        page: currentPage,
        total: totalPages,
      }),
    },
    selectedRule: null,
    selectedSummary: "",
    showDetailSummary: false,
    showDetailControls: false,
    globalAdvancedSettings: null,
    settingsAction: {
      type: "open-settings",
      label: message("openSettings"),
    },
  };
}

export function normalizePopupViewStateForRender(state, context = {}) {
  const safeHomeState = () =>
    createPopupViewState({
      ...context,
      view: "home",
    });

  if (state?.view === "detail") {
    const hasRenderableDetailState =
      state.selectedRule &&
      state.managementAction &&
      state.immediateAction &&
      state.ruleFields &&
      Array.isArray(state.openTargetOptions) &&
      (!state.showLatestContentConfig || state.latestContentConfig);

    if (!hasRenderableDetailState) {
      return safeHomeState();
    }
  }

  if (state?.view === "settings" && (!state.globalAdvancedSettings || !state.settingsTransfer)) {
    return safeHomeState();
  }

  return state;
}

function addMinutesToTime(time, minutesToAdd) {
  const [hours, minutes] = time.split(":").map(Number);
  const totalMinutes = (hours * 60 + minutes + minutesToAdd) % 1440;
  const nextHours = Math.floor(totalMinutes / 60);
  const nextMinutes = totalMinutes % 60;

  return `${String(nextHours).padStart(2, "0")}:${String(nextMinutes).padStart(2, "0")}`;
}

export function getNextAvailableDailyTime(dailyTimes, now = new Date()) {
  const validTimes = Array.isArray(dailyTimes)
    ? dailyTimes.filter(validateDailyTime).sort()
    : [];

  if (validTimes.length) {
    const occupiedTimes = new Set(validTimes);
    const firstCandidate = addMinutesToTime(validTimes.at(-1), 60);

    for (let offset = 0; offset < 24; offset += 1) {
      const candidate = addMinutesToTime(firstCandidate, offset * 60);

      if (!occupiedTimes.has(candidate)) {
        return candidate;
      }
    }

    for (let offset = 1; offset < 1440; offset += 1) {
      const candidate = addMinutesToTime(firstCandidate, offset);

      if (!occupiedTimes.has(candidate)) {
        return candidate;
      }
    }

    return "";
  }

  const next = new Date(now);
  next.setHours(next.getHours() + 1, 0, 0, 0);

  return `${String(next.getHours()).padStart(2, "0")}:00`;
}

export function getAddRuleNavigationTarget(origin) {
  return {
    view: "detail",
    selectedTargetUrl: origin,
  };
}

export function createPersistenceQueue() {
  let pending = Promise.resolve();

  return (operation) => {
    const task = pending.then(operation, operation);
    pending = task.catch(() => undefined);
    return task;
  };
}

export function createRulesPersistenceQueue({
  saveRules,
  synchronizeRules = () => true,
  enqueue = createPersistenceQueue(),
}) {
  return (nextRules) => {
    const persist = async () => {
      const savedRules = await saveRules(nextRules);
      const scheduleSynced = await synchronizeRules(savedRules);

      return {
        rules: savedRules,
        scheduleSynced,
      };
    };

    return enqueue(persist);
  };
}

export function createDailyTimesPatch(rule, updateDailyTimes) {
  const dailyTimes = Array.isArray(rule?.strategies?.dailyTimes)
    ? rule.strategies.dailyTimes
    : [];

  return {
    strategies: {
      dailyTimes: updateDailyTimes([...dailyTimes]),
    },
  };
}

export function createDailyTimeRowState(initialValue) {
  let value = initialValue;

  return {
    get value() {
      return value;
    },
    replace(nextValue) {
      const previousValue = value;
      value = nextValue;
      return previousValue;
    },
  };
}

export function createFieldValidationState({
  type,
  value,
  previousValue = "",
  existingValues = [],
  message,
}) {
  const trimmedValue = String(value).trim();
  const intervalPeriodMinutes = () => {
    const hoursRaw = String(value?.hours ?? "").trim();
    const minutesRaw = String(value?.minutes ?? "").trim();
    const hours = hoursRaw ? Number(hoursRaw) : 0;
    const minutes = minutesRaw ? Number(minutesRaw) : 0;

    if (
      !Number.isInteger(hours) ||
      !Number.isInteger(minutes) ||
      hours < 0 ||
      minutes < 0 ||
      minutes > 59
    ) {
      return null;
    }

    return hours * 60 + minutes;
  };
  const validators = {
    dailyTime: () => validateDailyTime(trimmedValue),
    intervalMinutes: () => validateIntervalMinutes(Number(trimmedValue)),
    intervalPeriod: () => validateIntervalMinutes(intervalPeriodMinutes()),
    countdownPeriod: () => validateIntervalMinutes(intervalPeriodMinutes()),
    returnFromIdlePeriod: () =>
      validateIntervalMinutes(intervalPeriodMinutes()),
  };
  const errorKeys = {
    dailyTime: "invalidTime",
    intervalMinutes: "invalidInterval",
    intervalPeriod: "invalidInterval",
    countdownPeriod: "invalidInterval",
    returnFromIdlePeriod: "invalidReturnFromIdle",
  };
  const isValid = validators[type]?.() === true;
  const errorKey = errorKeys[type] || "invalidInterval";

  if (isValid) {
    if (
      type === "dailyTime" &&
      trimmedValue !== previousValue &&
      existingValues.includes(trimmedValue)
    ) {
      return {
        valid: false,
        value: trimmedValue,
        errorKey: "duplicateDailyTime",
        errorMessage: message("duplicateDailyTime"),
      };
    }

    return {
      valid: true,
      value:
        type === "intervalPeriod" ||
        type === "countdownPeriod" ||
        type === "returnFromIdlePeriod"
          ? String(intervalPeriodMinutes())
          : trimmedValue,
      errorKey: "",
      errorMessage: "",
    };
  }

  return {
    valid: false,
    value,
    errorKey,
    errorMessage: message(errorKey),
  };
}

export function getPopupFocusTarget({
  view,
  previousOrigin = "",
  replacementControl = "",
  returnFromSettings = false,
}) {
  if (view === "detail") {
    return {
      type: "back-button",
    };
  }

  if (view === "settings") {
    return {
      type: "back-settings-button",
    };
  }

  if (replacementControl === "filter" || replacementControl === "sort") {
    return {
      type: "rules-toolbar-control",
      control: replacementControl,
    };
  }

  if (replacementControl === "previous-page" || replacementControl === "next-page") {
    return {
      type: "pagination-button",
      action: replacementControl === "previous-page" ? "previous" : "next",
    };
  }

  if (returnFromSettings) {
    return {
      type: "settings-button",
    };
  }

  if (previousOrigin) {
    return {
      type: "rule-row",
      origin: previousOrigin,
    };
  }

  return {
    type: "none",
  };
}
