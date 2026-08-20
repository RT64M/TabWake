// 规则数据形状：默认值、迁移、规范化、增删改与设置导入导出。
// 依赖 url-utils 的纯函数，不依赖 chrome.storage。

import {
  isHttpUrl,
  normalizeOrigin,
  normalizeTargetUrl,
  rulesMatchTarget,
  validateDailyTime,
  validateIntervalMinutes,
  validateRulesPerPage,
} from "./url-utils.js";

const DEFAULT_STRATEGIES = {
  browserProcessStartup: false,
  browserWindowStartup: false,
  dailyStartup: false,
  dailyTimes: [],
  intervalMinutes: null,
  countdownRunAt: "",
  returnFromIdleMinutes: null,
  focusScopes: {
    browserProcessStartup: "silent",
    browserWindowStartup: "silent",
    dailyStartup: "device",
    dailyTimes: "device",
    intervalMinutes: "device",
    countdownRunAt: "device",
    returnFromIdle: "device",
  },
};

const DEFAULT_LAST_RUNS = {
  dailyStartupDate: "",
  dailyTimes: {},
};

export const DEFAULT_DAILY_STARTUP_IDLE_MINUTES = 360;
export const DEFAULT_RULES_PER_PAGE = 5;
export const DEFAULT_FAILED_OPEN_BEHAVIOR = "keep";

const OPEN_TARGETS = new Set(["origin", "latestContent"]);
const FOCUS_SCOPES = new Set(["silent", "notify", "browser", "device"]);
const FOCUS_SCOPE_MODES = new Set(["rule", "strategy"]);
const LANGUAGES = new Set(["zh", "en"]);
const FAILED_OPEN_BEHAVIORS = new Set(["keep", "close"]);
const STARTUP_TRIGGER_TYPES = new Set([
  "browserProcessStartup",
  "browserWindowStartup",
]);
const STARTUP_STRATEGY_TYPES = [
  "browserProcessStartup",
  "browserWindowStartup",
  "dailyStartup",
  "dailyTimes",
  "intervalMinutes",
  "countdownRunAt",
  "returnFromIdle",
];
const SETTINGS_EXPORT_APP = "TabWake";
const SETTINGS_EXPORT_SCHEMA_VERSION = 1;

function toTitleWords(value) {
  return String(value || "")
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1).toLowerCase()}`);
}

function createReadableTitleFromUrl(targetUrl) {
  const url = new URL(normalizeTargetUrl(targetUrl));
  const hostParts = url.hostname.split(".").filter(Boolean);
  const hostName =
    hostParts[0] === "www" && hostParts.length > 1 ? hostParts[1] : hostParts[0];
  const words = toTitleWords(hostName);

  return words.length ? words.join(" ") : url.hostname;
}

export function createDefaultRuleTitle({ pageTitle = "", targetUrl }) {
  const title = normalizeRuleTitle(pageTitle);

  if (title) {
    return title;
  }

  try {
    return createReadableTitleFromUrl(targetUrl);
  } catch {
    return normalizeRuleTitle(targetUrl);
  }
}

export function normalizeOpenTarget(value) {
  return OPEN_TARGETS.has(value) ? value : "origin";
}

function getPathSegmentCount(url) {
  try {
    return new URL(url).pathname.split("/").filter(Boolean).length;
  } catch {
    return 0;
  }
}

// 校验"自动更新部分"位置：startIndex / length 为整数，且落在 latestExampleUrl 的段范围内。
// 不依赖 latest-url-rules 以避免与 storage.js 形成循环依赖。
function normalizeUpdatePartRange(range, latestExampleUrl) {
  if (!range || typeof range !== "object" || Array.isArray(range)) {
    return null;
  }

  const { startIndex, length } = range;

  if (
    !Number.isInteger(startIndex) ||
    !Number.isInteger(length) ||
    startIndex < 0 ||
    length < 1
  ) {
    return null;
  }

  if (!latestExampleUrl || !isHttpUrl(latestExampleUrl)) {
    return null;
  }

  if (startIndex + length > getPathSegmentCount(latestExampleUrl)) {
    return null;
  }

  return { startIndex, length };
}

function normalizeExpectedNextExampleUrl(value) {
  return value && isHttpUrl(value) ? normalizeTargetUrl(value) : "";
}

function isLatestExampleWithinTargetScope(latestExampleUrl, targetUrl) {
  if (!isHttpUrl(latestExampleUrl) || !isHttpUrl(targetUrl)) {
    return false;
  }

  try {
    return (
      normalizeOrigin(latestExampleUrl) === normalizeOrigin(targetUrl) &&
      rulesMatchTarget(latestExampleUrl, targetUrl)
    );
  } catch {
    return false;
  }
}

export function normalizeFailedOpenBehavior(value) {
  return FAILED_OPEN_BEHAVIORS.has(value) ? value : DEFAULT_FAILED_OPEN_BEHAVIOR;
}

function normalizeDailyTimes(dailyTimes) {
  if (!Array.isArray(dailyTimes)) {
    return [];
  }

  return [...new Set(dailyTimes.filter(validateDailyTime))].sort();
}

function normalizeIntervalMinutes(value) {
  return validateIntervalMinutes(value) ? value : null;
}

function normalizeReturnFromIdleMinutes(value) {
  return validateIntervalMinutes(value) ? value : null;
}

function normalizeCountdownRunAt(value) {
  if (typeof value !== "string" || !value.trim()) {
    return "";
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function normalizeFocusScope(value) {
  return FOCUS_SCOPES.has(value) ? value : "device";
}

function normalizeFocusScopeMode(value) {
  return FOCUS_SCOPE_MODES.has(value) ? value : "rule";
}

function normalizeLanguage(value) {
  return LANGUAGES.has(value) ? value : "zh";
}

function normalizeFocusScopes(focusScopes = {}, baseScopes = DEFAULT_STRATEGIES.focusScopes) {
  const scopes =
    focusScopes && typeof focusScopes === "object" && !Array.isArray(focusScopes)
      ? focusScopes
      : {};

  return Object.fromEntries(
    STARTUP_STRATEGY_TYPES.map((type) => {
      const hasDirectScope = Object.hasOwn(scopes, type);
      const hasLegacyEveryStartupScope =
        type === "browserProcessStartup" && Object.hasOwn(scopes, "everyStartup");
      const scope = normalizeFocusScope(
        hasDirectScope
          ? scopes[type]
          : hasLegacyEveryStartupScope
          ? scopes.everyStartup
          : baseScopes[type]
      );

      return [
        type,
        STARTUP_TRIGGER_TYPES.has(type) && !["silent", "notify"].includes(scope)
          ? "silent"
          : scope,
      ];
    })
  );
}

function normalizeDailyStartupIdleMinutes() {
  return DEFAULT_DAILY_STARTUP_IDLE_MINUTES;
}

function normalizeRulesPerPage(value) {
  return validateRulesPerPage(value) ? value : DEFAULT_RULES_PER_PAGE;
}

function normalizeRuleTitle(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  return value.trim();
}

export function normalizeSettings(settings = {}) {
  return {
    dailyStartupIdleMinutes: normalizeDailyStartupIdleMinutes(),
    focusScopeMode: normalizeFocusScopeMode(settings.focusScopeMode),
    language: normalizeLanguage(settings.language),
    rulesPerPage: normalizeRulesPerPage(settings.rulesPerPage),
    failedOpenBehavior: normalizeFailedOpenBehavior(settings.failedOpenBehavior),
  };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasRecognizedSettings(settings = {}) {
  return (
    isPlainObject(settings) &&
    [
      "dailyStartupIdleMinutes",
      "focusScopeMode",
      "language",
      "rulesPerPage",
      "failedOpenBehavior",
    ].some((key) => Object.hasOwn(settings, key))
  );
}

function normalizeLastRuns(lastRuns = {}) {
  const dailyTimes =
    lastRuns.dailyTimes && typeof lastRuns.dailyTimes === "object"
      ? Object.fromEntries(
          Object.entries(lastRuns.dailyTimes).filter(
            ([time, date]) => validateDailyTime(time) && typeof date === "string"
          )
        )
      : {};

  return {
    dailyStartupDate:
      typeof lastRuns.dailyStartupDate === "string" ? lastRuns.dailyStartupDate : "",
    dailyTimes,
  };
}

function createRule(origin) {
  const targetUrl = normalizeTargetUrl(origin);

  return {
    origin: normalizeOrigin(targetUrl),
    targetUrl,
    title: "",
    enabled: true,
    openTarget: "origin",
    focusScope: "device",
    latestExampleUrl: "",
    updatePartRange: null,
    expectedNextExampleUrl: "",
    strategies: { ...DEFAULT_STRATEGIES },
    lastRuns: {
      ...DEFAULT_LAST_RUNS,
      dailyTimes: {},
    },
  };
}

function normalizeRule(rule) {
  const normalized = createRule(rule.targetUrl || rule.origin);
  const strategies = rule.strategies || {};

  normalized.title = normalizeRuleTitle(rule.title);
  normalized.enabled = rule.enabled !== false;
  normalized.openTarget = normalizeOpenTarget(rule.openTarget);
  normalized.focusScope = normalizeFocusScope(rule.focusScope);
  normalized.latestExampleUrl =
    rule.latestExampleUrl && isHttpUrl(rule.latestExampleUrl)
      ? normalizeTargetUrl(rule.latestExampleUrl)
      : "";
  normalized.updatePartRange = normalizeUpdatePartRange(
    rule.updatePartRange,
    normalized.latestExampleUrl
  );
  normalized.expectedNextExampleUrl = normalizeExpectedNextExampleUrl(
    rule.expectedNextExampleUrl
  );

  if (
    normalized.expectedNextExampleUrl &&
    !isLatestExampleWithinTargetScope(
      normalized.expectedNextExampleUrl,
      normalized.targetUrl
    )
  ) {
    normalized.expectedNextExampleUrl = "";
  }

  if (
    normalized.latestExampleUrl &&
    !isLatestExampleWithinTargetScope(
      normalized.latestExampleUrl,
      normalized.targetUrl
    )
  ) {
    normalized.openTarget = "origin";
    normalized.latestExampleUrl = "";
    normalized.updatePartRange = null;
    normalized.expectedNextExampleUrl = "";
  }

  normalized.strategies = {
    browserProcessStartup:
      strategies.browserWindowStartup === true
        ? false
        : strategies.browserProcessStartup === true || strategies.everyStartup === true,
    browserWindowStartup: strategies.browserWindowStartup === true,
    dailyStartup: strategies.dailyStartup === true,
    dailyTimes: normalizeDailyTimes(strategies.dailyTimes),
    intervalMinutes: normalizeIntervalMinutes(strategies.intervalMinutes),
    countdownRunAt: normalizeCountdownRunAt(strategies.countdownRunAt),
    returnFromIdleMinutes: normalizeReturnFromIdleMinutes(
      strategies.returnFromIdleMinutes
    ),
    focusScopes: normalizeFocusScopes(strategies.focusScopes),
  };
  normalized.lastRuns = normalizeLastRuns(rule.lastRuns);

  return normalized;
}

export function normalizeRules(rules) {
  if (!Array.isArray(rules)) {
    return [];
  }

  return rules.reduce((accumulator, rule) => {
    const ruleUrl = rule?.targetUrl || rule?.origin;

    if (!ruleUrl || !isHttpUrl(ruleUrl)) {
      return accumulator;
    }

    try {
      const normalized = normalizeRule(rule);
      return upsertRule(accumulator, normalized.targetUrl, normalized);
    } catch {
      return accumulator;
    }
  }, []);
}

function sanitizeRulesForTransfer(rules) {
  let disabledCountdownCount = 0;
  const sanitizedRules = normalizeRules(rules).map((rule) => {
    if (rule.strategies.countdownRunAt) {
      disabledCountdownCount += 1;
    }

    return normalizeRule({
      ...rule,
      strategies: {
        ...rule.strategies,
        countdownRunAt: "",
      },
      lastRuns: {
        dailyStartupDate: "",
        dailyTimes: {},
      },
    });
  });

  return {
    rules: sanitizedRules,
    disabledCountdownCount,
  };
}

export function createSettingsExportPayload(
  { rules = [], settings = {} } = {},
  { now = new Date() } = {}
) {
  const transferRules = sanitizeRulesForTransfer(rules);

  return {
    schemaVersion: SETTINGS_EXPORT_SCHEMA_VERSION,
    app: SETTINGS_EXPORT_APP,
    exportedAt: now.toISOString(),
    settings: normalizeSettings(settings),
    rules: transferRules.rules,
    meta: {
      ruleCount: transferRules.rules.length,
      disabledCountdownCount: transferRules.disabledCountdownCount,
    },
  };
}

export function parseSettingsImportPayload(fileJson) {
  let payload;

  try {
    payload = JSON.parse(String(fileJson));
  } catch {
    throw new Error("Invalid JSON");
  }

  if (
    !isPlainObject(payload) ||
    payload.app !== SETTINGS_EXPORT_APP ||
    payload.schemaVersion !== SETTINGS_EXPORT_SCHEMA_VERSION
  ) {
    throw new Error("Unsupported settings file");
  }

  const transferRules = sanitizeRulesForTransfer(payload.rules);
  const hasSettings = hasRecognizedSettings(payload.settings);
  const declaredDisabledCountdownCount =
    Number.isInteger(payload.meta?.disabledCountdownCount) &&
    payload.meta.disabledCountdownCount >= 0
      ? Math.min(
          payload.meta.disabledCountdownCount,
          transferRules.rules.length
        )
      : 0;

  if (!hasSettings && transferRules.rules.length === 0) {
    throw new Error("No valid settings or rules");
  }

  return {
    schemaVersion: SETTINGS_EXPORT_SCHEMA_VERSION,
    app: SETTINGS_EXPORT_APP,
    exportedAt:
      typeof payload.exportedAt === "string" ? payload.exportedAt : "",
    settings: normalizeSettings(payload.settings),
    rules: transferRules.rules,
    meta: {
      ruleCount: transferRules.rules.length,
      disabledCountdownCount: Math.max(
        transferRules.disabledCountdownCount,
        declaredDisabledCountdownCount
      ),
    },
  };
}

export function applySettingsImportPayload(
  payload,
  { currentRules = [], mode = "replace" } = {}
) {
  const importedRules = normalizeRules(payload?.rules);
  const currentNormalizedRules = normalizeRules(currentRules);
  const currentRuleUrls = new Set(
    currentNormalizedRules.map((rule) => rule.targetUrl)
  );
  const importedRuleUrls = new Set(importedRules.map((rule) => rule.targetUrl));
  const added = importedRules.filter(
    (rule) => !currentRuleUrls.has(rule.targetUrl)
  ).length;
  const updated = importedRules.filter((rule) =>
    currentRuleUrls.has(rule.targetUrl)
  ).length;
  const kept =
    mode === "merge"
      ? currentNormalizedRules.filter(
          (rule) => !importedRuleUrls.has(rule.targetUrl)
        ).length
      : 0;
  const rules =
    mode === "merge"
      ? normalizeRules([...currentNormalizedRules, ...importedRules])
      : importedRules;

  return {
    settings: normalizeSettings(payload?.settings),
    rules,
    stats: {
      imported: importedRules.length,
      added,
      updated,
      kept,
      disabledCountdownCount: payload?.meta?.disabledCountdownCount || 0,
    },
  };
}

export function upsertRule(rules, origin, patch = {}) {
  const normalizedTargetUrl = normalizeTargetUrl(origin);
  const normalizedRules = Array.isArray(rules) ? rules.map(normalizeRule) : [];
  const index = normalizedRules.findIndex(
    (rule) => rule.targetUrl === normalizedTargetUrl
  );
  const rule = index >= 0 ? normalizedRules[index] : createRule(normalizedTargetUrl);

  if ("title" in patch) {
    rule.title = normalizeRuleTitle(patch.title, rule.title);
  }

  if (typeof patch.enabled === "boolean") {
    rule.enabled = patch.enabled;
  }

  if ("openTarget" in patch) {
    rule.openTarget = normalizeOpenTarget(patch.openTarget);
  }

  if ("focusScope" in patch) {
    rule.focusScope = normalizeFocusScope(patch.focusScope);
  }

  if ("latestExampleUrl" in patch) {
    rule.latestExampleUrl =
      patch.latestExampleUrl && isHttpUrl(patch.latestExampleUrl)
        ? normalizeTargetUrl(patch.latestExampleUrl)
        : "";
  }

  if ("updatePartRange" in patch) {
    rule.updatePartRange = normalizeUpdatePartRange(
      patch.updatePartRange,
      rule.latestExampleUrl
    );
  }

  if ("expectedNextExampleUrl" in patch) {
    rule.expectedNextExampleUrl = normalizeExpectedNextExampleUrl(
      patch.expectedNextExampleUrl
    );
  }

  if (patch.strategies) {
    const strategies = patch.strategies;

    if (typeof strategies.everyStartup === "boolean") {
      rule.strategies.browserProcessStartup = strategies.everyStartup;
      if (strategies.everyStartup) {
        rule.strategies.browserWindowStartup = false;
      }
    }

    if (typeof strategies.browserProcessStartup === "boolean") {
      rule.strategies.browserProcessStartup = strategies.browserProcessStartup;
      if (strategies.browserProcessStartup) {
        rule.strategies.browserWindowStartup = false;
      }
    }

    if (typeof strategies.browserWindowStartup === "boolean") {
      rule.strategies.browserWindowStartup = strategies.browserWindowStartup;
      if (strategies.browserWindowStartup) {
        rule.strategies.browserProcessStartup = false;
      }
    }

    if (typeof strategies.dailyStartup === "boolean") {
      rule.strategies.dailyStartup = strategies.dailyStartup;
    }

    if (Array.isArray(strategies.dailyTimes)) {
      rule.strategies.dailyTimes = normalizeDailyTimes(strategies.dailyTimes);
    }

    if ("intervalMinutes" in strategies) {
      rule.strategies.intervalMinutes = normalizeIntervalMinutes(strategies.intervalMinutes);
    }

    if ("countdownRunAt" in strategies) {
      rule.strategies.countdownRunAt = normalizeCountdownRunAt(strategies.countdownRunAt);
    }

    if ("returnFromIdleMinutes" in strategies) {
      rule.strategies.returnFromIdleMinutes = normalizeReturnFromIdleMinutes(
        strategies.returnFromIdleMinutes
      );
    }

    if ("focusScopes" in strategies) {
      rule.strategies.focusScopes = normalizeFocusScopes(
        strategies.focusScopes,
        rule.strategies.focusScopes
      );
    }
  }

  if (patch.lastRuns) {
    rule.lastRuns = normalizeLastRuns({
      ...rule.lastRuns,
      ...patch.lastRuns,
    });
  }

  const normalizedRule = normalizeRule(rule);

  if (index >= 0) {
    normalizedRules[index] = normalizedRule;
    return normalizedRules;
  }

  return [...normalizedRules, normalizedRule];
}

export function markRuleDailyStartupHandledOnActivation(rule, today) {
  const normalizedRule = normalizeRule(rule);
  const nextLastRuns =
    normalizedRule.enabled === false &&
    normalizedRule.strategies.dailyStartup === true &&
    normalizedRule.lastRuns.dailyStartupDate !== today
      ? {
          ...normalizedRule.lastRuns,
          dailyStartupDate: today,
        }
      : normalizedRule.lastRuns;

  return normalizeRule({
    ...normalizedRule,
    enabled: true,
    lastRuns: nextLastRuns,
  });
}

export function renameRuleTargetUrl(rules, currentTargetUrl, nextTargetUrl, patch = {}) {
  const normalizedCurrentUrl = normalizeTargetUrl(currentTargetUrl);
  const normalizedNextUrl = normalizeTargetUrl(nextTargetUrl);
  const normalizedRules = Array.isArray(rules) ? rules.map(normalizeRule) : [];
  const currentIndex = normalizedRules.findIndex(
    (rule) => rule.targetUrl === normalizedCurrentUrl
  );

  if (currentIndex === -1) {
    throw new Error("Rule does not exist");
  }

  const duplicate = normalizedRules.some(
    (rule, index) =>
      index !== currentIndex && rule.targetUrl === normalizedNextUrl
  );

  if (duplicate) {
    throw new Error("Target URL already exists");
  }

  const currentRule = normalizedRules[currentIndex];
  const patchedOpenTarget = Object.hasOwn(patch, "openTarget")
    ? patch.openTarget
    : currentRule.openTarget;
  const patchedRange = Object.hasOwn(patch, "updatePartRange")
    ? patch.updatePartRange
    : currentRule.updatePartRange;
  const patchedExpectedNext = Object.hasOwn(patch, "expectedNextExampleUrl")
    ? patch.expectedNextExampleUrl
    : currentRule.expectedNextExampleUrl;
  // 编辑保存 URL 时，新 URL 即新的示例；只有自动更新部分仍能在新 URL 中按位置定位时才保留 latestContent。
  const patchedLatestExampleUrl = Object.hasOwn(patch, "latestExampleUrl")
    ? patch.latestExampleUrl
    : normalizedNextUrl;
  const rangeFitsNextUrl = Boolean(
    patchedRange &&
      Number.isInteger(patchedRange.startIndex) &&
      Number.isInteger(patchedRange.length) &&
      patchedRange.startIndex >= 0 &&
      patchedRange.length >= 1 &&
      patchedLatestExampleUrl &&
      isHttpUrl(patchedLatestExampleUrl) &&
      patchedRange.startIndex + patchedRange.length <=
        getPathSegmentCount(patchedLatestExampleUrl)
  );
  const shouldKeepLatestConfig =
    patchedOpenTarget === "latestContent" && rangeFitsNextUrl;
  const safePatch = {
    ...patch,
    openTarget: shouldKeepLatestConfig ? "latestContent" : "origin",
    latestExampleUrl: shouldKeepLatestConfig ? patchedLatestExampleUrl : "",
    updatePartRange: shouldKeepLatestConfig ? patchedRange : null,
    expectedNextExampleUrl: shouldKeepLatestConfig ? patchedExpectedNext : "",
  };
  const renamedRule = normalizeRule({
    ...currentRule,
    ...safePatch,
    targetUrl: normalizedNextUrl,
    origin: normalizeOrigin(normalizedNextUrl),
    strategies: {
      ...currentRule.strategies,
      ...(safePatch.strategies || {}),
    },
    lastRuns: {
      ...currentRule.lastRuns,
      ...(safePatch.lastRuns || {}),
    },
  });

  normalizedRules[currentIndex] = renamedRule;

  return normalizedRules;
}
