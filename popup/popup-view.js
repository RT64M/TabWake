export { formatRuleUrlForDisplay, getNextAvailableDailyTime, createFieldValidationState } from "./view/shared.js";
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
