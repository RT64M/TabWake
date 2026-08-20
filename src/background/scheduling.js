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
    serializeLatestUpdate = true,
    now = new Date(),
  } = {}
) {
  const resolution = await resolveRuleOpenUrl(
    rule,
    fetchImpl,
    permissionsApi,
    storage
  );
  await persistLatestContentRuntimeCacheIfAdvanced(rule, resolution, storage, {
    serialize: serializeLatestUpdate,
  });
  const resolvedUrl = resolution.url;

  if (mode === "notify") {
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

    await alarmsApi.clear(alarm.name);
  }

  for (const [name, desiredAlarm] of desiredAlarms) {
    if (preservedAlarmNames.has(name)) {
      continue;
    }

    await alarmsApi.create(name, desiredAlarm.info);
  }

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
  // 清理要排队等规则写锁，而自动追踪一次最长可占用 15 秒；不能让 popup 的
  // rules-updated 应答等它，因此只触发不等待。
  pruneLatestContentRuntimeCache({ storage }).catch(() => {
    // 尽力而为，失败不影响调度重建。
  });

  return Promise.all([
    rebuildAlarms({ storage, alarmsApi }),
    configureIdleDetection({
      storage,
      idleApi,
    }),
    refreshBrowserWindowStartupRuleCache(storage),
  ]);
}

export { runRuleStartupAction, syncRuntimeSchedules };
