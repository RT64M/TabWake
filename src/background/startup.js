import { defaultStorage, getExtensionApi } from "./shared.js";
import {
  shouldSkipRecentStartup,
  shouldSkipRecentWindowStartup,
  withRuleMutationLock,
} from "./state.js";
import {
  findRule,
  getBrowserStartupModeForRule,
  getDailyStartupIdleMinutes,
  getIdleElapsedMinutes,
  getIsoTimestamp,
  getReturnFromIdleMinutes,
  getRuleTargetUrl,
  getStartupModeForRule,
  hasBrowserWindowStartupRules,
  markDailyStartup,
  shouldDeferReturnFromIdle,
} from "./rule-helpers.js";
import { configureIdleDetection, rebuildAlarms, runRuleStartupAction } from "./scheduling.js";
import { openOrFocusRule } from "./tab-notifications.js";

function runDailyStartupForRules(params) {
  return withRuleMutationLock(() => runDailyStartupForRulesCore(params));
}

async function runDailyStartupForRulesCore({
  storage,
  tabsApi,
  windowsApi,
  notificationsApi,
  webNavigationApi,
  fetchImpl,
  permissionsApi = null,
  now = new Date(),
  getMatchedStrategyTypes,
  deferReturnFromIdle = false,
  preferStartupTriggerNotification = false,
  uniqueStartupNotification = false,
}) {
  const { rules, settings } = await storage.loadSettings();

  if (!rules.length) {
    return "no-rules";
  }

  const today = storage.getLocalDateKey();
  const dailyStartupHandledTargets = new Set();
  const results = [];
  const pendingReturnFromIdleTargets = deferReturnFromIdle
    ? await storage.loadPendingReturnFromIdleTargets()
    : [];

  for (const rule of rules) {
    if (rule.enabled === false) {
      continue;
    }

    const matchedStrategyTypes = getMatchedStrategyTypes(rule, today);

    if (!matchedStrategyTypes.length) {
      continue;
    }

    let immediateStrategyTypes = matchedStrategyTypes;
    let shouldQueueReturnFromIdle = false;

    if (
      deferReturnFromIdle &&
      matchedStrategyTypes.includes("returnFromIdle") &&
      shouldDeferReturnFromIdle(rule, settings)
    ) {
      immediateStrategyTypes = matchedStrategyTypes.filter(
        (type) => type !== "returnFromIdle"
      );
      shouldQueueReturnFromIdle = true;
    }

    if (immediateStrategyTypes.length) {
      try {
        results.push(
          await runRuleStartupAction(
            rule,
            tabsApi,
            windowsApi,
            notificationsApi,
            fetchImpl,
            preferStartupTriggerNotification
              ? getBrowserStartupModeForRule(rule, settings, immediateStrategyTypes)
              : getStartupModeForRule(rule, settings, immediateStrategyTypes),
            {
              settings: {
                ...settings,
                uniqueStartupNotification,
              },
              webNavigationApi,
              permissionsApi,
              storage,
              serializeLatestUpdate: false,
              now,
            }
          )
        );

        // 执行失败(下方 catch)不标记当天已处理,后续 idle 回归等触发当天仍可重试;
        // 只有实际打开 / 通知成功后才按每日去重记账。
        if (matchedStrategyTypes.includes("dailyStartup")) {
          dailyStartupHandledTargets.add(getRuleTargetUrl(rule));
        }
      } catch (error) {
        console.error("TabWake rule failed to run", error);
        results.push("rule-failed");
      }
    } else if (shouldQueueReturnFromIdle) {
      const targetUrl = getRuleTargetUrl(rule);

      if (!pendingReturnFromIdleTargets.includes(targetUrl)) {
        pendingReturnFromIdleTargets.push(targetUrl);
      }
      results.push("queued-return-from-idle");
    }
  }

  if (pendingReturnFromIdleTargets.length && deferReturnFromIdle) {
    await storage.savePendingReturnFromIdleTargets(pendingReturnFromIdleTargets);
  }

  if (results.length) {
    // 打开 / 检索可能耗时数秒;写回前重读最新规则,只应用本次每日首启标记,
    // 收窄与 popup 并发编辑之间的丢更新窗口(popup 与后台分属不同上下文,
    // withRuleMutationLock 只能序列化后台内部写)。
    const { rules: freshRules } = await storage.loadSettings();

    await storage.saveRules(
      freshRules.map((item) =>
        dailyStartupHandledTargets.has(getRuleTargetUrl(item))
          ? markDailyStartup(item, today)
          : item
      )
    );
  }

  return results;
}

async function openPendingReturnFromIdleTargets({
  storage,
  tabsApi,
  windowsApi,
  notificationsApi,
  webNavigationApi,
  fetchImpl,
  permissionsApi = null,
  serializeLatestUpdate = true,
  now = new Date(),
}) {
  const pendingTargets = await storage.loadPendingReturnFromIdleTargets();

  if (!pendingTargets.length) {
    return [];
  }

  const { rules, settings } = await storage.loadSettings();
  const results = [];
  const retryTargets = [];

  for (const targetUrl of pendingTargets) {
    const rule = findRule(rules, targetUrl);

    if (!rule || getReturnFromIdleMinutes(rule) === null) {
      continue;
    }

    try {
      results.push(
        await openOrFocusRule(rule, tabsApi, windowsApi, fetchImpl, {
          focusWindow: true,
          settings,
          notificationsApi,
          webNavigationApi,
          permissionsApi,
          storage,
          serializeLatestUpdate,
          now,
        })
      );
    } catch {
      retryTargets.push(targetUrl);
    }
  }

  await storage.savePendingReturnFromIdleTargets(retryTargets);

  return results;
}

export async function runDailyStartup({
  storage = defaultStorage,
  tabsApi = getExtensionApi()?.tabs,
  windowsApi = getExtensionApi()?.windows,
  notificationsApi = getExtensionApi()?.notifications,
  webNavigationApi = getExtensionApi()?.webNavigation,
  alarmsApi = getExtensionApi()?.alarms,
  permissionsApi = getExtensionApi()?.permissions,
  fetchImpl = globalThis.fetch,
  rebuildSchedule = true,
  now = new Date(),
} = {}) {
  if (rebuildSchedule) {
    await rebuildAlarms({ storage, alarmsApi, now });
    await configureIdleDetection({ storage, now });
  }

  const { returnFromIdleLastActiveAt } = await storage.loadReturnFromIdleState();
  const startupIdleElapsedMinutes = returnFromIdleLastActiveAt
    ? getIdleElapsedMinutes(returnFromIdleLastActiveAt, now)
    : 0;
  const result = await runDailyStartupForRules({
    storage,
    tabsApi,
    windowsApi,
    notificationsApi,
    webNavigationApi,
    fetchImpl,
    permissionsApi,
    now,
    preferStartupTriggerNotification: true,
    getMatchedStrategyTypes(rule, today) {
      const strategyTypes = [];
      const shouldRunBrowserProcessStartup =
        rule.strategies.browserProcessStartup === true;
      const shouldRunDailyStartup =
        rule.strategies.dailyStartup === true &&
        rule.lastRuns.dailyStartupDate !== today;
      const returnFromIdleMinutes = getReturnFromIdleMinutes(rule);
      const shouldRunReturnFromIdle =
        returnFromIdleMinutes !== null &&
        startupIdleElapsedMinutes >= returnFromIdleMinutes;

      if (shouldRunBrowserProcessStartup) {
        strategyTypes.push("browserProcessStartup");
      }

      if (shouldRunDailyStartup) {
        strategyTypes.push("dailyStartup");
      }

      if (shouldRunReturnFromIdle) {
        strategyTypes.push("returnFromIdle");
      }

      return strategyTypes;
    },
  });

  if (startupIdleElapsedMinutes > 0) {
    await storage.saveReturnFromIdleState({
      returnFromIdleLastActiveAt: getIsoTimestamp(now),
    });
  }

  return result;
}

export async function handleBrowserStartup({
  storage = defaultStorage,
  tabsApi = getExtensionApi()?.tabs,
  windowsApi = getExtensionApi()?.windows,
  notificationsApi = getExtensionApi()?.notifications,
  webNavigationApi = getExtensionApi()?.webNavigation,
  alarmsApi = getExtensionApi()?.alarms,
  permissionsApi = getExtensionApi()?.permissions,
  fetchImpl = globalThis.fetch,
  rebuildSchedule = true,
  now = new Date(),
} = {}) {
  if (shouldSkipRecentStartup(now)) {
    return "recent-startup-already-handled";
  }

  return runDailyStartup({
    storage,
    tabsApi,
    windowsApi,
    notificationsApi,
    webNavigationApi,
    alarmsApi,
    permissionsApi,
    fetchImpl,
    rebuildSchedule,
    now,
  });
}

export async function handleBrowserWindowCreated(
  window,
  {
    storage = defaultStorage,
    tabsApi = getExtensionApi()?.tabs,
    windowsApi = getExtensionApi()?.windows,
    notificationsApi = getExtensionApi()?.notifications,
    webNavigationApi = getExtensionApi()?.webNavigation,
    permissionsApi = getExtensionApi()?.permissions,
    fetchImpl = globalThis.fetch,
    now = new Date(),
  } = {}
) {
  if (window?.type && window.type !== "normal") {
    return "ignored-window";
  }

  if (shouldSkipRecentWindowStartup(window?.id, now)) {
    return "recent-window-startup-already-handled";
  }

  const result = await runDailyStartupForRules({
    storage,
    tabsApi,
    windowsApi,
    notificationsApi,
    webNavigationApi,
    fetchImpl,
    permissionsApi,
    now,
    preferStartupTriggerNotification: true,
    uniqueStartupNotification: true,
    getMatchedStrategyTypes(rule) {
      return rule.strategies.browserWindowStartup === true
        ? ["browserWindowStartup"]
        : [];
    },
  });

  return Array.isArray(result) && result.length ? result : "no-window-startup-rules";
}

export async function handleBrowserWindowTabCreated(
  tab,
  {
    storage = defaultStorage,
    tabsApi = getExtensionApi()?.tabs,
    windowsApi = getExtensionApi()?.windows,
    notificationsApi = getExtensionApi()?.notifications,
    webNavigationApi = getExtensionApi()?.webNavigation,
    permissionsApi = getExtensionApi()?.permissions,
    fetchImpl = globalThis.fetch,
    now = new Date(),
  } = {}
) {
  if (tab?.windowId === undefined || !windowsApi?.get) {
    return "window-unavailable";
  }

  if (!(await hasBrowserWindowStartupRules(storage))) {
    return "no-window-startup-rules";
  }

  const window = await windowsApi.get(tab.windowId, { populate: true });

  if (window?.type && window.type !== "normal") {
    return "ignored-window";
  }

  const windowTabs = Array.isArray(window?.tabs) ? window.tabs : [];
  const isFirstWindowTab = windowTabs.length === 1 && windowTabs[0]?.id === tab.id;

  if (!isFirstWindowTab) {
    return "ignored-existing-window-tab";
  }

  return handleBrowserWindowCreated(window, {
    storage,
    tabsApi,
    windowsApi,
    notificationsApi,
    webNavigationApi,
    permissionsApi,
    fetchImpl,
    now,
  });
}


export {
  openPendingReturnFromIdleTargets,
  runDailyStartupForRules,
};
