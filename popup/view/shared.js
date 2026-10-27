import { getRuleTargetUrl, getRuleTitle } from "../../src/url-utils.js";
import { validateDailyTime, validateIntervalMinutes } from "../../src/url-utils.js";

export const OPEN_TARGET_TYPES = ["origin", "latestContent"];

export const STARTUP_LOGIC_TYPES = [
  "browserProcessStartup",
  "browserWindowStartup",
  "dailyStartup",
  "returnFromIdle",
  "dailyTimes",
  "intervalMinutes",
  "countdownRunAt",
];

const DEFAULT_RULES_PAGE_SIZE = 5;
const RULES_PAGE_SIZE_OPTIONS = [3, 5, 10];
const RULE_FILTERS = ["all", "incomplete", "active", "paused"];
const RULE_SORTS = ["status", "added", "startup"];
const SILENT_STATUS_KEYS = new Set(["saved", "latestConfigSaved"]);
const STARTUP_TRIGGER_TYPES = new Set([
  "browserProcessStartup",
  "browserWindowStartup",
]);

export function getPopupStatusMessage({ key, view = "home", error = false, message }) {
  const text = key && !SILENT_STATUS_KEYS.has(key) ? message(key) : "";

  return {
    homeText: text,
    detailText: view === "detail" ? text : "",
    error,
  };
}

function formatDurationLabel(totalMinutes, message) {
  const minutes = Number(totalMinutes);

  if (!Number.isInteger(minutes) || minutes <= 0) {
    return "";
  }

  if (minutes < 60) {
    return message("durationMinutes", { minutes });
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (remainingMinutes === 0) {
    return message("durationHours", { hours });
  }

  return message("durationHoursMinutes", {
    hours,
    minutes: remainingMinutes,
  });
}





function isValidDate(value) {
  return Number.isFinite(new Date(value).getTime());
}

function formatLocalTime(date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes()
  ).padStart(2, "0")}`;
}

export function summarizeRuleStrategies(rule, message) {
  const strategies = rule.strategies || {};
  const parts = [];

  if (strategies.browserProcessStartup) {
    parts.push(message("browserProcessStartupShort"));
  }

  if (strategies.browserWindowStartup) {
    parts.push(message("browserWindowStartupShort"));
  }

  if (strategies.dailyStartup) {
    parts.push(message("dailyStartupShort"));
  }

  if (strategies.returnFromIdleMinutes) {
    parts.push(
      message("returnFromIdleShort", {
        duration: formatDurationLabel(strategies.returnFromIdleMinutes, message),
      })
    );
  }

  if (strategies.dailyTimes?.length) {
    parts.push(`${message("dailyTimesShort")} ${strategies.dailyTimes.join(", ")}`);
  }

  if (strategies.intervalMinutes) {
    parts.push(
      message("intervalMinutesShort", {
        duration: formatDurationLabel(strategies.intervalMinutes, message),
      })
    );
  }

  if (isValidDate(strategies.countdownRunAt)) {
    parts.push(
      message("countdownStartupShort", {
        time: formatLocalTime(new Date(strategies.countdownRunAt)),
      })
    );
  }

  if (!parts.length) {
    return message("noStartupLogic");
  }

  if (rule.enabled === false) {
    return message("disabled");
  }

  return parts.join(" · ");
}

export function getRuleStatePresentation(rule, message) {
  if (!hasAnyStartupLogic(rule)) {
    return {
      state: "incomplete",
      stateLabel: message("incomplete"),
      visualTone: "incomplete",
    };
  }

  if (rule.enabled === false) {
    return {
      state: "paused",
      stateLabel: message("disabled"),
      visualTone: "paused",
    };
  }

  return {
    state: "active",
    stateLabel: message("enabled"),
    visualTone: "active",
  };
}

function hasStartupLogic(rule, type) {
  const strategies = rule.strategies || {};

  if (type === "browserProcessStartup") {
    return strategies.browserProcessStartup === true;
  }

  if (type === "browserWindowStartup") {
    return strategies.browserWindowStartup === true;
  }

  if (type === "dailyStartup") {
    return strategies.dailyStartup === true;
  }

  if (type === "returnFromIdle") {
    return Boolean(strategies.returnFromIdleMinutes);
  }

  if (type === "dailyTimes") {
    return Boolean(strategies.dailyTimes?.length);
  }

  if (type === "intervalMinutes") {
    return Boolean(strategies.intervalMinutes);
  }

  if (type === "countdownRunAt") {
    return isValidDate(strategies.countdownRunAt);
  }

  return false;
}

function hasAnyStartupLogic(rule) {
  return STARTUP_LOGIC_TYPES.some((type) => hasStartupLogic(rule, type));
}

function normalizeRuleFilter(value) {
  return RULE_FILTERS.includes(value) ? value : "all";
}

function normalizeRuleSort(value) {
  return RULE_SORTS.includes(value) ? value : "added";
}

function createRulesToolbarState({ filter, sort, message }) {
  const currentFilter = normalizeRuleFilter(filter);
  const currentSort = normalizeRuleSort(sort);

  return {
    filter: {
      label: message("rulesFilterLabel"),
      value: currentFilter,
      options: [
        ["all", "rulesFilterAll"],
        ["incomplete", "rulesFilterIncomplete"],
        ["active", "rulesFilterActive"],
        ["paused", "rulesFilterPaused"],
      ].map(([value, labelKey]) => ({
        value,
        label: message(labelKey),
        selected: value === currentFilter,
      })),
    },
    sort: {
      label: message("rulesSortLabel"),
      value: currentSort,
      options: [
        ["status", "rulesSortStatus"],
        ["added", "rulesSortAdded"],
        ["startup", "rulesSortStartup"],
      ].map(([value, labelKey]) => ({
        value,
        label: message(labelKey),
        selected: value === currentSort,
      })),
    },
  };
}

function createEmptyRulesGuidance(currentAction, message) {
  if (currentAction.type === "add") {
    return message("emptyRulesAddCurrent");
  }

  if (currentAction.type === "edit") {
    return message("emptyRulesAlreadyAdded");
  }

  return message("emptyRulesUnsupportedPage");
}

function createRuleRowState(rule, message, now, index = 0, intervalAlarmSchedules = {}) {
  const state = getRuleStatePresentation(rule, message);
  const targetUrl = getRuleTargetUrl(rule);
  const configured = hasAnyStartupLogic(rule);
  const nextStartup = createRuleNextStartupState(rule, message, now, {
    intervalAlarmSchedules,
  });
  const canToggleActive = configured || state.state === "active";
  const togglePresentation = canToggleActive ? "switch" : "configure";

  const row = {
    origin: rule.origin,
    targetUrl,
    title: getRuleTitle(rule),
    summary: summarizeRuleStrategies(rule, message),
    summaryTone: state.state === "incomplete" ? "warning" : "normal",
    selected: false,
    primaryAction: "open-detail",
    secondaryAction: "configure",
    toggleAction: canToggleActive ? "toggle-active" : "configure-required",
    toggleDisabled: false,
    togglePresentation,
    toggleLabel:
      !canToggleActive
        ? message("configureNow")
        : state.state === "paused"
        ? message("active")
        : message("paused"),
    configureLabel: message("editRule"),
    nextStartup,
    ...state,
  };
  Object.defineProperty(row, "addedIndex", {
    value: index,
    enumerable: false,
  });

  return row;
}

function filterRuleRows(rows, filter) {
  const currentFilter = normalizeRuleFilter(filter);

  if (currentFilter === "all") {
    return rows;
  }

  return rows.filter((row) => row.state === currentFilter);
}

function sortRuleRows(rows, sort) {
  const currentSort = normalizeRuleSort(sort);

  if (currentSort === "status") {
    const statusOrder = {
      incomplete: 0,
      active: 1,
      paused: 2,
    };

    return [...rows].sort((left, right) => {
      const statusDiff =
        (statusOrder[left.state] ?? 99) - (statusOrder[right.state] ?? 99);

      if (statusDiff !== 0) {
        return statusDiff;
      }

      return left.title.localeCompare(right.title, undefined, {
        sensitivity: "base",
      });
    });
  }

  if (currentSort === "startup") {
    return [...rows].sort((left, right) => {
      const leftTime = left.nextStartup?.runAt?.getTime?.() ?? Number.POSITIVE_INFINITY;
      const rightTime =
        right.nextStartup?.runAt?.getTime?.() ?? Number.POSITIVE_INFINITY;
      const timeDiff = leftTime - rightTime;

      if (timeDiff !== 0) {
        return timeDiff;
      }

      return (left.addedIndex ?? 0) - (right.addedIndex ?? 0);
    });
  }

  return rows;
}

function getStartupLogicLabel(type, message) {
  const labels = {
    browserProcessStartup: "browserProcessStartup",
    browserWindowStartup: "browserWindowStartup",
    dailyStartup: "dailyStartup",
    returnFromIdle: "returnFromIdle",
    dailyTimes: "dailyTimes",
    intervalMinutes: "intervalMinutes",
    countdownRunAt: "countdownStartup",
  };

  return message(labels[type]);
}

function getStrategyFocusScopeValue(rule, type) {
  const value = getFocusScopeValue(rule.strategies?.focusScopes?.[type]);

  if (STARTUP_TRIGGER_TYPES.has(type) && !["silent", "notify"].includes(value)) {
    return "silent";
  }

  return value;
}

function getRuleFocusScopeValue(rule) {
  return getFocusScopeValue(rule.focusScope);
}

function getFocusScopeMode(settings = {}) {
  return settings.focusScopeMode === "strategy" ? "strategy" : "rule";
}

function getLanguage(settings = {}) {
  return settings.language === "en" ? "en" : "zh";
}

function getRulesPageSize(settings = {}) {
  const pageSize = Number(settings.rulesPerPage);

  return RULES_PAGE_SIZE_OPTIONS.includes(pageSize)
    ? pageSize
    : DEFAULT_RULES_PAGE_SIZE;
}

function getFocusScopeHelpKey(value) {
  const keys = {
    silent: "focusScopeSilentHelp",
    notify: "focusScopeNotifyHelp",
    browser: "focusScopeBrowserHelp",
    device: "focusScopeDeviceHelp",
  };

  return keys[getFocusScopeValue(value)];
}

function getFocusScopeModeHelpKey(value) {
  return value === "strategy"
    ? "focusScopeModeStrategyHelp"
    : "focusScopeModeRuleHelp";
}

function createFocusScopeState(value, message, allowedValues = null) {
  const currentValue = getFocusScopeValue(value);
  const allowedOptions = Array.isArray(allowedValues) ? allowedValues : null;

  return {
    label: message("focusScopeLabel"),
    help: message(getFocusScopeHelpKey(currentValue)),
    value: currentValue,
    options: [
      {
        value: "silent",
        label: message("focusScopeSilent"),
        shortLabel: message("focusScopeSilentShort"),
        title: message("focusScopeSilentHelp"),
        selected: currentValue === "silent",
      },
      {
        value: "notify",
        label: message("focusScopeNotify"),
        shortLabel: message("focusScopeNotifyShort"),
        title: message("focusScopeNotifyHelp"),
        selected: currentValue === "notify",
      },
      {
        value: "browser",
        label: message("focusScopeBrowser"),
        shortLabel: message("focusScopeBrowserShort"),
        title: message("focusScopeBrowserHelp"),
        selected: currentValue === "browser",
      },
      {
        value: "device",
        label: message("focusScopeDevice"),
        shortLabel: message("focusScopeDeviceShort"),
        title: message("focusScopeDeviceHelp"),
        selected: currentValue === "device",
      },
    ].filter(
      (option) => !allowedOptions || allowedOptions.includes(option.value)
    ),
  };
}

function getFocusScopeValue(value) {
  return ["silent", "notify", "browser", "device"].includes(value)
    ? value
    : "device";
}

function createStrategyFocusScopeState(rule, type, message) {
  const allowedValues = STARTUP_TRIGGER_TYPES.has(type) ? ["silent", "notify"] : null;

  return createFocusScopeState(
    getStrategyFocusScopeValue(rule, type),
    message,
    allowedValues
  );
}

function hasOnlyStartupTriggerLogics(rule) {
  const configuredTypes = STARTUP_LOGIC_TYPES.filter((type) =>
    hasStartupLogic(rule, type)
  );

  return (
    configuredTypes.length > 0 &&
    configuredTypes.every((type) => STARTUP_TRIGGER_TYPES.has(type))
  );
}

function createFocusScopeModeState(settings, message) {
  const value = getFocusScopeMode(settings);

  return {
    type: "focusScopeMode",
    label: message("focusScopeModeLabel"),
    help: message(getFocusScopeModeHelpKey(value)),
    value,
    options: [
      {
        value: "rule",
        label: message("focusScopeModeRule"),
        selected: value === "rule",
      },
      {
        value: "strategy",
        label: message("focusScopeModeStrategy"),
        selected: value === "strategy",
      },
    ],
  };
}

function createLanguageSwitchState(settings, message) {
  const language = getLanguage(settings);

  return {
    label: message("languageSwitchLabel"),
    value: language,
    nextValue: language === "zh" ? "en" : "zh",
    labels: [
      {
        value: "zh",
        label: message("languageSwitchZh"),
        selected: language === "zh",
      },
      {
        value: "en",
        label: message("languageSwitchEn"),
        selected: language === "en",
      },
    ],
  };
}

function createRulesPerPageState(settings, message) {
  const value = getRulesPageSize(settings);

  return {
    type: "rulesPerPage",
    label: message("rulesPerPageLabel"),
    help: message("rulesPerPageHelp"),
    control: "select",
    value,
    options: RULES_PAGE_SIZE_OPTIONS.map((option) => ({
      value: option,
      label: String(option),
      selected: option === value,
    })),
  };
}

function getFailedOpenBehavior(settings = {}) {
  return settings.failedOpenBehavior === "close" ? "close" : "keep";
}

function createFailedOpenBehaviorState(settings, message) {
  const value = getFailedOpenBehavior(settings);
  const options = [
    {
      value: "keep",
      label: message("failedOpenBehaviorKeep"),
    },
    {
      value: "close",
      label: message("failedOpenBehaviorClose"),
    },
  ];

  return {
    type: "failedOpenBehavior",
    label: message("failedOpenBehaviorLabel"),
    help: message("failedOpenBehaviorHelp"),
    value,
    options: options.map((option) => ({
      ...option,
      selected: option.value === value,
    })),
  };
}

function addFocusScopeIfNeeded(logic, rule, type, message, showStrategyFocusScopes) {
  if (!showStrategyFocusScopes) {
    return logic;
  }

  return {
    ...logic,
    focusScope: createStrategyFocusScopeState(rule, type, message),
  };
}

function splitCountdownPeriod(runAt, now = new Date()) {
  const runAtDate = new Date(runAt);
  const diffMinutes = Math.max(
    1,
    Math.ceil((runAtDate.getTime() - now.getTime()) / 60000)
  );

  return {
    hours: Math.floor(diffMinutes / 60),
    minutes: diffMinutes % 60,
  };
}

function getNextIntervalRunAt(intervalMinutes, targetUrl, intervalAlarmSchedules = {}) {
  if (!validateIntervalMinutes(intervalMinutes) || !targetUrl) {
    return null;
  }

  const scheduledTime = intervalAlarmSchedules[targetUrl];

  if (!Number.isFinite(scheduledTime)) {
    return null;
  }

  const runAt = new Date(scheduledTime);

  return Number.isNaN(runAt.getTime()) ? null : runAt;
}

function getNextDailyRunAt(time, now) {
  const [hours, minutes] = time.split(":").map(Number);
  const next = new Date(now);

  next.setHours(hours, minutes, 0, 0);

  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }

  return next;
}

function getNextDailyStartupRunAt(now) {
  const next = new Date(now);

  next.setDate(next.getDate() + 1);
  next.setHours(0, 0, 0, 0);

  return next;
}

function createRuleNextStartupState(
  rule,
  message,
  now,
  { intervalAlarmSchedules = {} } = {}
) {
  if (rule.enabled === false) {
    return null;
  }

  const candidates = [];
  const strategies = rule.strategies || {};

  if (isValidDate(strategies.countdownRunAt)) {
    const runAt = new Date(strategies.countdownRunAt);

    if (runAt.getTime() > now.getTime()) {
      candidates.push({
        runAt,
        timeText: formatLocalTime(runAt),
        source: message("nextStartupSourceCountdown"),
      });
    }
  }

  for (const time of strategies.dailyTimes || []) {
    candidates.push({
      runAt: getNextDailyRunAt(time, now),
      timeText: time,
      source: message("nextStartupSourceDailyTime"),
    });
  }

  const intervalRunAt = getNextIntervalRunAt(
    strategies.intervalMinutes,
    getRuleTargetUrl(rule),
    intervalAlarmSchedules
  );

  if (intervalRunAt) {
    candidates.push({
      runAt: intervalRunAt,
      timeText: formatLocalTime(intervalRunAt),
      source: message("nextStartupSourceInterval"),
    });
  }

  if (strategies.dailyStartup === true) {
    candidates.push({
      runAt: getNextDailyStartupRunAt(now),
      timeText: message("nextStartupTomorrow"),
      source: message("nextStartupSourceDailyStartup"),
    });
  }

  const next = candidates.sort((left, right) => left.runAt - right.runAt)[0];

  if (!next) {
    return null;
  }

  const state = {
    label: message("nextStartupTitle"),
    timeText: next.timeText,
    source: next.source,
    text: message("nextStartupInline", {
      time: next.timeText,
      source: next.source,
    }),
  };
  Object.defineProperty(state, "runAt", {
    value: next.runAt,
    enumerable: false,
  });

  return state;
}

function splitIntervalPeriod(totalMinutes) {
  const normalizedMinutes = validateIntervalMinutes(totalMinutes) ? totalMinutes : 0;

  return {
    hours: Math.floor(normalizedMinutes / 60),
    minutes: normalizedMinutes % 60,
  };
}

export {
  addFocusScopeIfNeeded,
  createEmptyRulesGuidance,
  createFocusScopeModeState,
  createFocusScopeState,
  createLanguageSwitchState,
  createRuleRowState,
  createRulesPerPageState,
  createRulesToolbarState,
  createStrategyFocusScopeState,
  createFailedOpenBehaviorState,
  filterRuleRows,
  formatDurationLabel,
  formatLocalTime,
  getFocusScopeMode,
  getRuleFocusScopeValue,
  getRuleTargetUrl,
  getRuleTitle,
  getRulesPageSize,
  getStartupLogicLabel,
  hasOnlyStartupTriggerLogics,
  hasStartupLogic,
  sortRuleRows,
  splitCountdownPeriod,
  splitIntervalPeriod,
};

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
