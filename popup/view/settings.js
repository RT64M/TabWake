import { applySettingsImportPayload } from "../../src/storage.js";
import {
  createFailedOpenBehaviorState,
  createFocusScopeModeState,
  createFocusScopeState,
  createRulesPerPageState,
  getRuleFocusScopeValue,
  getRuleTargetUrl,
  hasOnlyStartupTriggerLogics,
} from "./shared.js";

export function createGlobalAdvancedSettingsState(settings = {}, message) {
  return {
    focusScopeMode: createFocusScopeModeState(settings, message),
    rulesPerPage: createRulesPerPageState(settings, message),
    failedOpenBehavior: createFailedOpenBehaviorState(settings, message),
  };
}

function createSettingsImportStats(preview, currentRules, mode) {
  return applySettingsImportPayload(preview, {
    currentRules,
    mode,
  }).stats;
}

function createSettingsImportPreviewState(preview, currentRules, message) {
  if (!preview) {
    return null;
  }

  const replaceStats = createSettingsImportStats(preview, currentRules, "replace");
  const mergeStats = createSettingsImportStats(preview, currentRules, "merge");
  const settingsState = createGlobalAdvancedSettingsState(preview.settings, message);
  const focusScopeModeLabel =
    settingsState.focusScopeMode.options.find(
      (option) => option.value === settingsState.focusScopeMode.value
    )?.label || settingsState.focusScopeMode.value;
  const language =
    preview.settings?.language === "en"
      ? message("languageSwitchEn")
      : message("languageSwitchZh");

  return {
    title: message("settingsImportPreviewTitle"),
    ruleCountLabel: message("settingsImportRuleCount", {
      count: preview.meta?.ruleCount ?? preview.rules?.length ?? 0,
    }),
    replaceSummary: message("settingsImportReplaceSummary", replaceStats),
    mergeSummary: message("settingsImportMergeSummary", mergeStats),
    settingsSummary: message("settingsImportSettingsSummary", {
      language,
      focusScopeMode: focusScopeModeLabel,
      rulesPerPage: settingsState.rulesPerPage.value,
    }),
    countdownWarning: preview.meta?.disabledCountdownCount
      ? message("settingsImportCountdownWarning", {
          count: preview.meta.disabledCountdownCount,
          countPlural: preview.meta.disabledCountdownCount === 1 ? "" : "s",
        })
      : "",
    replaceAction: {
      type: "apply-import-replace",
      label: message("settingsImportApplyReplace"),
      visualWeight: "danger",
    },
    mergeAction: {
      type: "apply-import-merge",
      label: message("settingsImportApplyMerge"),
      visualWeight: "primary",
    },
    cancelAction: {
      type: "cancel-import",
      label: message("settingsImportCancel"),
    },
  };
}

function createSettingsTransferState(
  { preview = null, errorKey = "", rules = [], isApplying = false } = {},
  message
) {
  return {
    title: message("settingsTransferTitle"),
    description: message("settingsTransferDescription"),
    exportAction: {
      type: "export-settings",
      label: message("settingsExport"),
      visualWeight: "secondary",
    },
    importAction: {
      type: "import-settings",
      label: message("settingsImport"),
      visualWeight: "secondary",
    },
    isApplying,
    preview: createSettingsImportPreviewState(preview, rules, message),
    errorMessage: errorKey ? message(errorKey) : "",
  };
}

function createRuleFieldsState(rule, message, { focusScopeMode = "rule" } = {}) {
  const fields = {
    title: {
      label: message("ruleTitleLabel"),
      value: typeof rule.title === "string" ? rule.title : "",
      placeholder: message("ruleTitlePlaceholder"),
    },
    targetUrl: {
      label: message("ruleUrlLabel"),
      value: getRuleTargetUrl(rule),
      placeholder: message("ruleUrlPlaceholder"),
    },
  };

  if (focusScopeMode !== "strategy") {
    const allowedValues = hasOnlyStartupTriggerLogics(rule)
      ? ["silent", "notify"]
      : null;
    const currentValue = getRuleFocusScopeValue(rule);

    fields.focusScope = createFocusScopeState(
      allowedValues && !allowedValues.includes(currentValue)
        ? "silent"
        : currentValue,
      message,
      allowedValues
    );
  }

  return fields;
}

export { createRuleFieldsState, createSettingsTransferState };
