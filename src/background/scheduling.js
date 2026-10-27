import {
  createCountdownAlarmName,
  createDailyAlarmName,
  createIntervalAlarmName,
  defaultStorage,
  getExtensionApi,
  isExtensionAlarmName,
} from "./shared.js";
import { BROWSER_IDLE_DETECTION_MAX_SECONDS } from "./state.js";
import {
  getBrowserIdleDetectionSeconds,
  getIsoTimestamp,
  getMinimumIdleDetectionMinutes,
  getNextDailyTime,
  pruneLatestContentRuntimeCache,
  refreshBrowserWindowStartupRuleCache,
} from "./rule-helpers.js";
import {
  persistLatestContentRuntimeCacheIfAdvanced,
  resolveRuleOpenUrl,
} from "./latest-content-runtime.js";
import { createRuleNotification, openOrFocusUrl } from "./tab-notifications.js";

async function runRuleStartupAction(
  rule,
  tabsApi,
  windowsApi,
  notificationsApi,
  fetchImpl,
  mode,
  {
    settings = {},
    webNavigationApi = null,
    permissionsApi = null,
    storage = null,
    now = new Date(),
    fetchDeadline = Infinity,
  } = {}
) {
  const resolution = await resolveRuleOpenUrl(
    rule,
    fetchImpl,
    permissionsApi,
    storage,
    fetchDeadline
  );
  await persistLatestContentRuntimeCacheIfAdvanced(rule, resolution, storage);
  const resolvedUrl = resolution.url;

  if (mode === "notify") {
    if (!notificationsApi?.create) throw new Error("Notifications unavailable");
    return createRuleNotification(
      rule,
      resolvedUrl,
      notificationsApi,
      tabsApi,
      windowsApi,
      {
        uniqueNotification: settings.uniqueStartupNotification === true,
        settings,
        webNavigationApi,
        now,
      }
    );
  }

  return openOrFocusUrl(resolvedUrl, tabsApi, windowsApi, {
    matchMode: rule.openTarget === "latestContent" ? "url" : "origin",
    focusWindow: mode === "device",
    activateTab: mode !== "silent",
    rule,
    settings,
    notificationsApi,
    webNavigationApi,
    now,
  });
}

export async function rebuildAlarms({
  storage = defaultStorage,
  alarmsApi = getExtensionApi()?.alarms,
  now = new Date(),
} = {}) {
  if (!alarmsApi?.getAll || !alarmsApi?.clear || !alarmsApi?.create) {
    return "alarms-unavailable";
  }

  const { rules } = await storage.loadSettings();
  const existingAlarms = await alarmsApi.getAll();
  const desiredAlarms = new Map();

  for (const rule of rules.filter((item) => item.enabled !== false)) {
    for (const time of rule.strategies.dailyTimes || []) {
      desiredAlarms.set(createDailyAlarmName(rule.targetUrl || rule.origin, time), {
        type: "daily",
        info: {
          when: getNextDailyTime(time, now),
        },
      });
    }

    if (rule.strategies.intervalMinutes) {
      desiredAlarms.set(createIntervalAlarmName(rule.targetUrl || rule.origin), {
        type: "interval",
        info: {
          periodInMinutes: rule.strategies.intervalMinutes,
        },
      });
    }

    if (rule.strategies.countdownRunAt) {
      desiredAlarms.set(createCountdownAlarmName(rule.targetUrl || rule.origin), {
        type: "countdown",
        info: {
          when: new Date(rule.strategies.countdownRunAt).getTime(),
        },
      });
    }
  }

  const preservedAlarmNames = new Set();
  const errors = [];

  for (const alarm of existingAlarms.filter((item) => isExtensionAlarmName(item.name))) {
    const desiredAlarm = desiredAlarms.get(alarm.name);
    const shouldPreserveInterval =
      desiredAlarm?.type === "interval" &&
      alarm.periodInMinutes === desiredAlarm.info.periodInMinutes;
    const shouldPreserveDaily =
      desiredAlarm?.type === "daily" &&
      !Number.isFinite(alarm.periodInMinutes) &&
      Number.isFinite(alarm.scheduledTime) &&
      Math.abs(alarm.scheduledTime - desiredAlarm.info.when) < 1000;
    const shouldPreserve = shouldPreserveInterval || shouldPreserveDaily;

    if (shouldPreserve) {
      preservedAlarmNames.add(alarm.name);
      continue;
    }

    try { await alarmsApi.clear(alarm.name); } catch (error) { errors.push(error); }
  }

  for (const [name, desiredAlarm] of desiredAlarms) {
    if (preservedAlarmNames.has(name)) {
      continue;
    }

    try { await alarmsApi.create(name, desiredAlarm.info); } catch (error) { errors.push(error); }
  }

  if (errors.length) throw new AggregateError(errors, "Some alarms could not be rebuilt");
  return "alarms-rebuilt";
}

export async function configureIdleDetection({
  storage = defaultStorage,
  idleApi = getExtensionApi()?.idle,
  now = new Date(),
} = {}) {
  if (!idleApi?.setDetectionInterval) {
    return "idle-unavailable";
  }

  const { rules } = await storage.loadSettings();

  const minimumIdleMinutes = getMinimumIdleDetectionMinutes(rules);

  if (!minimumIdleMinutes) {
    idleApi.setDetectionInterval(BROWSER_IDLE_DETECTION_MAX_SECONDS);
    return "idle-detection-reset";
  }

  idleApi.setDetectionInterval(getBrowserIdleDetectionSeconds(minimumIdleMinutes));
  const { dailyStartupLastActiveAt } = await storage.loadDailyStartupIdleState();
  const { returnFromIdleLastActiveAt } = await storage.loadReturnFromIdleState();

  if (!dailyStartupLastActiveAt) {
    await storage.saveDailyStartupIdleState({
      dailyStartupLastActiveAt: getIsoTimestamp(now),
    });
  }

  if (!returnFromIdleLastActiveAt) {
    await storage.saveReturnFromIdleState({
      returnFromIdleLastActiveAt: getIsoTimestamp(now),
    });
  }

  return "idle-detection-configured";
}

function syncRuntimeSchedules({ storage, alarmsApi, idleApi }) {
  return Promise.all([
    pruneLatestContentRuntimeCache({ storage }),
    rebuildAlarms({ storage, alarmsApi }),
    configureIdleDetection({
      storage,
      idleApi,
    }),
    refreshBrowserWindowStartupRuleCache(storage),
  ]);
}

export { runRuleStartupAction, syncRuntimeSchedules };
