import { getRuleTargetUrl } from "../url-utils.js";
import {
  createLatestContentRuntimeCacheFingerprint,
  defaultStorage,
  DEFAULT_DAILY_STARTUP_IDLE_MINUTES,
  decodeAlarmPart,
  getCountdownAlarmPayload,
  getDailyAlarmPayload,
  getIntervalAlarmPayload,
  isCountdownAlarmName,
  isDailyAlarmName,
  isHttpUrl,
  isIntervalAlarmName,
  normalizeOrigin,
  rulesMatchTarget,
} from "./shared.js";
import {
  BROWSER_IDLE_DETECTION_MAX_SECONDS,
  DAILY_ALARM_DELIVERY_TOLERANCE_MS,
  normalizeStartupMode,
  STARTUP_MODE_PRIORITY,
  STARTUP_MODES,
  STARTUP_TRIGGER_TYPES,
  withLatestCacheLock,
  windowStartupRuleCache,
} from "./state.js";


function parseAlarmName(name) {
  if (isDailyAlarmName(name)) {
    const rest = getDailyAlarmPayload(name);
    const separatorIndex = rest.lastIndexOf(":");

    if (separatorIndex === -1) {
      return null;
    }

      return {
        type: "daily",
        targetUrl: decodeAlarmPart(rest.slice(0, separatorIndex)),
        time: decodeAlarmPart(rest.slice(separatorIndex + 1)),
      };
  }

  if (isIntervalAlarmName(name)) {
    return {
      type: "interval",
      targetUrl: decodeAlarmPart(getIntervalAlarmPayload(name)),
    };
  }

  if (isCountdownAlarmName(name)) {
    return {
      type: "countdown",
      targetUrl: decodeAlarmPart(getCountdownAlarmPayload(name)),
    };
  }

  return null;
}

function getNextDailyTime(time, now = new Date()) {
  const [hours, minutes] = time.split(":").map(Number);
  const next = new Date(now);

  next.setHours(hours, minutes, 0, 0);

  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }

  return next.getTime();
}

function findRule(rules, targetUrl) {
  return rules.find(
    (rule) => rule.enabled !== false && (rule.targetUrl || rule.origin) === targetUrl
  );
}

function getLocalTimeKey(date = new Date()) {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  return `${hours}:${minutes}`;
}



function getDailyStartupIdleMinutes() {
  return DEFAULT_DAILY_STARTUP_IDLE_MINUTES;
}

function getStrategyFocusScope(rule, strategyType) {
  const mode = normalizeStartupMode(rule.strategies?.focusScopes?.[strategyType]);

  if (STARTUP_TRIGGER_TYPES.has(strategyType) && !["silent", "notify"].includes(mode)) {
    return "silent";
  }

  return mode;
}

function getRuleFocusScope(rule) {
  return normalizeStartupMode(rule.focusScope);
}

function getStartupModeForStrategies(rule, strategyTypes) {
  return strategyTypes.reduce((selectedMode, type) => {
    const mode = getStrategyFocusScope(rule, type);

    return STARTUP_MODE_PRIORITY[mode] > STARTUP_MODE_PRIORITY[selectedMode]
      ? mode
      : selectedMode;
  }, "notify");
}

function getStartupModeForRule(rule, settings, strategyTypes) {
  if (settings.focusScopeMode === "strategy") {
    return getStartupModeForStrategies(rule, strategyTypes);
  }

  const mode = getRuleFocusScope(rule);
  const hasOnlyStartupTriggers =
    strategyTypes.length > 0 &&
    strategyTypes.every((type) => STARTUP_TRIGGER_TYPES.has(type));

  if (hasOnlyStartupTriggers) {
    return ["silent", "notify"].includes(mode) ? mode : "silent";
  }

  return mode;
}

function getBrowserStartupModeForRule(rule, settings, strategyTypes) {
  if (
    settings.focusScopeMode === "strategy" &&
    strategyTypes.some((type) => STARTUP_TRIGGER_TYPES.has(type)) &&
    strategyTypes.some((type) => getStrategyFocusScope(rule, type) === "notify")
  ) {
    return "notify";
  }

  return getStartupModeForRule(rule, settings, strategyTypes);
}

function getConfiguredStrategyTypes(rule) {
  const strategies = rule.strategies || {};
  const types = [];

  if (strategies.browserProcessStartup === true) {
    types.push("browserProcessStartup");
  }

  if (strategies.browserWindowStartup === true) {
    types.push("browserWindowStartup");
  }

  if (strategies.dailyStartup === true) {
    types.push("dailyStartup");
  }

  if (Array.isArray(strategies.dailyTimes) && strategies.dailyTimes.length) {
    types.push("dailyTimes");
  }

  if (strategies.intervalMinutes) {
    types.push("intervalMinutes");
  }

  if (strategies.countdownRunAt) {
    types.push("countdownRunAt");
  }

  if (getReturnFromIdleMinutes(rule) !== null) {
    types.push("returnFromIdle");
  }

  return types.length ? types : ["browserProcessStartup"];
}

function hasEnabledDailyStartupRule(rules) {
  return rules.some(
    (rule) => rule.enabled !== false && rule.strategies.dailyStartup === true
  );
}

function hasEnabledBrowserWindowStartupRule(rules) {
  return rules.some(
    (rule) => rule.enabled !== false && rule.strategies.browserWindowStartup === true
  );
}

async function refreshBrowserWindowStartupRuleCache(storage) {
  if (!storage?.loadSettings) {
    return false;
  }

  const { rules } = await storage.loadSettings();
  const hasRule = hasEnabledBrowserWindowStartupRule(rules);
  windowStartupRuleCache.set(storage, hasRule);

  return hasRule;
}

async function hasBrowserWindowStartupRules(storage) {
  if (windowStartupRuleCache.has(storage)) {
    return windowStartupRuleCache.get(storage);
  }

  return refreshBrowserWindowStartupRuleCache(storage);
}

function invalidateBrowserWindowStartupRuleCache(storage) {
  windowStartupRuleCache.delete(storage);
}

// 运行时缓存按配置指纹累积，删除规则或改配置后旧条目不会自己消失。
// 它们既是无上限增长的死数据，也会把用户已删除规则的最后一个网址留在本地存储里。
export async function pruneLatestContentRuntimeCache({
  storage = defaultStorage,
} = {}) {
  if (
    !storage?.loadLatestContentRuntimeCache ||
    !storage?.saveLatestContentRuntimeCache
  ) {
    return "runtime-cache-unavailable";
  }

  return withLatestCacheLock(async () => {
    let cache;
    try { cache = await storage.loadLatestContentRuntimeCache(); }
    catch { return "runtime-cache-unavailable"; }
    if (!Object.keys(cache).length) return "runtime-cache-empty";
    const { rules } = await storage.loadSettings();
    const liveFingerprints = new Set(rules.map(rule => createLatestContentRuntimeCacheFingerprint({
      targetUrl: getRuleTargetUrl(rule), latestExampleUrl: rule.latestExampleUrl,
      updatePartRange: rule.updatePartRange, expectedNextExampleUrl: getSafeExpectedNextExampleUrl(rule),
    })).filter(Boolean));
    const entries = Object.entries(cache).filter(([fingerprint]) => liveFingerprints.has(fingerprint));
    if (entries.length === Object.keys(cache).length) return "runtime-cache-current";
    await storage.saveLatestContentRuntimeCache(Object.fromEntries(entries));
    return "runtime-cache-pruned";
  });
}

function getReturnFromIdleMinutes(rule) {
  const minutes = rule.strategies?.returnFromIdleMinutes;

  return Number.isInteger(minutes) && minutes > 0 ? minutes : null;
}

function getMinimumIdleDetectionMinutes(rules) {
  const thresholds = [];

  if (hasEnabledDailyStartupRule(rules)) {
    thresholds.push(getDailyStartupIdleMinutes());
  }

  for (const rule of rules) {
    if (rule.enabled === false) {
      continue;
    }

    const minutes = getReturnFromIdleMinutes(rule);

    if (minutes) {
      thresholds.push(minutes);
    }
  }

  return thresholds.length ? Math.min(...thresholds) : null;
}

function getBrowserIdleDetectionSeconds(minutes) {
  return Math.min(minutes * 60, BROWSER_IDLE_DETECTION_MAX_SECONDS);
}

function getBrowserIdleDetectionMinutes(minutes) {
  return getBrowserIdleDetectionSeconds(minutes) / 60;
}

function isDailyAlarmDeliveryOnTime(alarm, expectedTime, now) {
  if (Number.isFinite(alarm?.scheduledTime)) {
    const delayMs = now.getTime() - alarm.scheduledTime;

    return delayMs >= 0 && delayMs <= DAILY_ALARM_DELIVERY_TOLERANCE_MS;
  }

  return getLocalTimeKey(now) === expectedTime;
}

function shouldDeferReturnFromIdle(rule, settings) {
  if (settings.focusScopeMode === "strategy") {
    return getStrategyFocusScope(rule, "returnFromIdle") === "browser";
  }

  return getRuleFocusScope(rule) === "browser";
}

function getIdleElapsedMinutes(idleStartedAt, now) {
  const startedAt = Date.parse(idleStartedAt);

  if (!Number.isFinite(startedAt)) {
    return 0;
  }

  return Math.floor((now.getTime() - startedAt) / 60000);
}

function getIsoTimestamp(date) {
  return new Date(date).toISOString();
}



function isUrlWithinRuleTargetScope(url, rule) {
  const targetUrl = getRuleTargetUrl(rule);

  try {
    return (
      isHttpUrl(url) &&
      isHttpUrl(targetUrl) &&
      normalizeOrigin(url) === normalizeOrigin(targetUrl) &&
      rulesMatchTarget(url, targetUrl)
    );
  } catch {
    return false;
  }
}

function hasUnsafeLatestExampleUrl(rule) {
  const latestExampleUrl = rule?.latestExampleUrl;

  return Boolean(latestExampleUrl) && !isUrlWithinRuleTargetScope(latestExampleUrl, rule);
}

function getSafeExpectedNextExampleUrl(rule) {
  const expectedNextExampleUrl = rule?.expectedNextExampleUrl || "";

  return isUrlWithinRuleTargetScope(expectedNextExampleUrl, rule)
    ? expectedNextExampleUrl
    : "";
}


export {
  findRule,
  getBrowserIdleDetectionMinutes,
  getBrowserIdleDetectionSeconds,
  getBrowserStartupModeForRule,
  getConfiguredStrategyTypes,
  getDailyStartupIdleMinutes,
  getIdleElapsedMinutes,
  getIsoTimestamp,
  getLocalTimeKey,
  getMinimumIdleDetectionMinutes,
  getNextDailyTime,
  getReturnFromIdleMinutes,
  getRuleFocusScope,
  getRuleTargetUrl,
  getSafeExpectedNextExampleUrl,
  getStartupModeForRule,
  getStartupModeForStrategies,
  getStrategyFocusScope,
  hasEnabledBrowserWindowStartupRule,
  hasEnabledDailyStartupRule,
  hasUnsafeLatestExampleUrl,
  invalidateBrowserWindowStartupRuleCache,
  isDailyAlarmDeliveryOnTime,
  isUrlWithinRuleTargetScope,
  normalizeStartupMode,
  parseAlarmName,
  refreshBrowserWindowStartupRuleCache,
  shouldDeferReturnFromIdle,
  hasBrowserWindowStartupRules,
};
