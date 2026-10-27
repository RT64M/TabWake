import { defaultStorage, getExtensionApi } from "./shared.js";
import { queueActiveIdleTransition, waitForActiveIdleTransition, withRuleMutationLock } from "./state.js";
import {
  findRule,
  getBrowserIdleDetectionMinutes,
  getConfiguredStrategyTypes,
  getDailyStartupIdleMinutes,
  getIdleElapsedMinutes,
  getIsoTimestamp,
  getMinimumIdleDetectionMinutes,
  getNextDailyTime,
  getReturnFromIdleMinutes,
  getRuleFocusScope,
  getStartupModeForRule,
  getStartupModeForStrategies,
  isDailyAlarmDeliveryOnTime,
  parseAlarmName,
} from "./rule-helpers.js";
import { getSafeRunNowRule } from "./latest-content-runtime.js";
import { runRuleStartupAction } from "./scheduling.js";
import { openPendingReturnFromIdleTargets, runDailyStartupForRules } from "./startup.js";

export async function handleIdleStateChanged(state, options = {}) {
  if (state !== "active") {
    return handleIdleStateChangedCore(state, options);
  }

  return queueActiveIdleTransition(() => handleIdleStateChangedCore(state, options));
}

async function handleIdleStateChangedCore(
  state,
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
  if (state === "idle" || state === "locked") {
    const { dailyStartupIdleStartedAt } =
      await storage.loadDailyStartupIdleState();
    const { returnFromIdleStartedAt } =
      await storage.loadReturnFromIdleState();

    if (dailyStartupIdleStartedAt || returnFromIdleStartedAt) {
      return "idle-start-already-recorded";
    }

    const { rules } = await storage.loadSettings();
    const idleStartedAt = new Date(now);
    const minimumIdleMinutes = getMinimumIdleDetectionMinutes(rules);

    if (state === "idle" && minimumIdleMinutes) {
      idleStartedAt.setMinutes(
        idleStartedAt.getMinutes() - getBrowserIdleDetectionMinutes(minimumIdleMinutes)
      );
    }

    await storage.saveDailyStartupIdleState({
      dailyStartupIdleStartedAt: idleStartedAt.toISOString(),
    });
    await storage.saveReturnFromIdleState({
      returnFromIdleStartedAt: idleStartedAt.toISOString(),
    });
    return "idle-start-recorded";
  }

  if (state !== "active") {
    return "ignored-idle-state";
  }

  const { dailyStartupIdleStartedAt, dailyStartupLastActiveAt } =
    await storage.loadDailyStartupIdleState();
  const { returnFromIdleStartedAt, returnFromIdleLastActiveAt } =
    await storage.loadReturnFromIdleState();
  const effectiveIdleStartedAt =
    dailyStartupIdleStartedAt ||
    returnFromIdleStartedAt ||
    dailyStartupLastActiveAt ||
    returnFromIdleLastActiveAt;

  if (!effectiveIdleStartedAt) {
    await storage.saveDailyStartupIdleState({
      dailyStartupLastActiveAt: getIsoTimestamp(now),
    });
    await storage.saveReturnFromIdleState({
      returnFromIdleLastActiveAt: getIsoTimestamp(now),
    });
    return [];
  }

  const idleElapsedMinutes = getIdleElapsedMinutes(effectiveIdleStartedAt, now);

  try {
    return await runDailyStartupForRules({
      storage,
      tabsApi,
      windowsApi,
      notificationsApi,
      webNavigationApi,
      fetchImpl,
      permissionsApi,
      now,
      deferReturnFromIdle: true,
      getMatchedStrategyTypes(rule, today) {
        const strategyTypes = [];
        const shouldRunDaily =
          rule.strategies.dailyStartup === true &&
          rule.lastRuns.dailyStartupDate !== today &&
          idleElapsedMinutes >= getDailyStartupIdleMinutes();
        const returnFromIdleMinutes = getReturnFromIdleMinutes(rule);
        const shouldRunReturnFromIdle =
          returnFromIdleMinutes !== null &&
          idleElapsedMinutes >= returnFromIdleMinutes;

        if (shouldRunDaily) {
          strategyTypes.push("dailyStartup");
        }

        if (shouldRunReturnFromIdle) {
          strategyTypes.push("returnFromIdle");
        }

        return strategyTypes;
      },
    });

  } finally {
    // Each idle state and its last-active timestamp change in the same storage write.
    const outcomes = await Promise.allSettled([
      storage.saveDailyStartupIdleState({ dailyStartupIdleStartedAt: "", dailyStartupLastActiveAt: getIsoTimestamp(now) }),
      storage.saveReturnFromIdleState({ returnFromIdleStartedAt: "", returnFromIdleLastActiveAt: getIsoTimestamp(now) }),
    ]);
    const failures = outcomes.filter(result => result.status === "rejected");
    if (failures.length) throw new AggregateError(failures.map(result => result.reason), "Idle state update failed");
  }
}

export async function handleBrowserWindowFocused(
  windowId,
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
  if (windowId === -1 || windowId === getExtensionApi()?.windows?.WINDOW_ID_NONE) {
    return [];
  }

  await waitForActiveIdleTransition();

  return withRuleMutationLock(() =>
    openPendingReturnFromIdleTargets({
      storage,
      tabsApi,
      windowsApi,
      notificationsApi,
      webNavigationApi,
      permissionsApi,
      fetchImpl,
      now,
    })
  );
}

export async function runRuleNow(
  targetUrl,
  {
    storage = defaultStorage,
    tabsApi = getExtensionApi()?.tabs,
    windowsApi = getExtensionApi()?.windows,
    notificationsApi = getExtensionApi()?.notifications,
    webNavigationApi = getExtensionApi()?.webNavigation,
    permissionsApi = getExtensionApi()?.permissions,
    fetchImpl = globalThis.fetch,
    ruleOverride = null,
    now = new Date(),
  } = {}
) {
  const { rules, settings } = await storage.loadSettings();
  // 手动"立即启动"是详情页的测试入口,暂停中的规则也允许手测;
  // 自动触发路径(alarm / idle / 启动)仍通过 findRule 只匹配启用规则。
  const storedRule = rules.find(
    (rule) => (rule.targetUrl || rule.origin) === targetUrl
  );

  if (!storedRule) {
    return "missing-rule";
  }

  const rule = getSafeRunNowRule(storedRule, ruleOverride, targetUrl);
  const runNowMode =
    settings.focusScopeMode === "strategy"
      ? getStartupModeForStrategies(rule, getConfiguredStrategyTypes(rule))
      : getRuleFocusScope(rule);

  return runRuleStartupAction(
    rule,
    tabsApi,
    windowsApi,
    notificationsApi,
    fetchImpl,
    runNowMode,
    {
      settings,
      webNavigationApi,
      permissionsApi,
      storage,
      now,
    }
  );
}

export async function handleAlarm(alarm, options = {}) {
  return withRuleMutationLock(() => handleAlarmCore(alarm, options));
}

async function handleAlarmCore(
  alarm,
  {
    storage = defaultStorage,
    tabsApi = getExtensionApi()?.tabs,
    windowsApi = getExtensionApi()?.windows,
    notificationsApi = getExtensionApi()?.notifications,
    webNavigationApi = getExtensionApi()?.webNavigation,
    alarmsApi = getExtensionApi()?.alarms,
    permissionsApi = getExtensionApi()?.permissions,
    fetchImpl = globalThis.fetch,
    now = new Date(),
  } = {}
) {
  const alarmInfo = parseAlarmName(alarm.name);

  if (!alarmInfo) {
    return "ignored-alarm";
  }

  const { rules, settings } = await storage.loadSettings();
  const rule = findRule(rules, alarmInfo.targetUrl);

  if (!rule) {
    return "missing-rule";
  }

  if (alarmInfo.type === "interval") {
    const intervalMinutes = rule.strategies?.intervalMinutes;

    if (!Number.isInteger(intervalMinutes) || intervalMinutes < 1) {
      return "missing-interval";
    }

    if (
      Number.isFinite(alarm.periodInMinutes) &&
      alarm.periodInMinutes !== intervalMinutes
    ) {
      return "stale-interval";
    }

    return runRuleStartupAction(
      rule,
      tabsApi,
      windowsApi,
      notificationsApi,
      fetchImpl,
      getStartupModeForRule(rule, settings, ["intervalMinutes"]),
      {
        settings,
        webNavigationApi,
        permissionsApi,
        storage,
        now,
      }
    );
  }

  if (alarmInfo.type === "countdown") {
    const countdownRunAt = Date.parse(rule.strategies?.countdownRunAt || "");

    if (!Number.isFinite(countdownRunAt)) {
      return "missing-countdown";
    }

    if (
      Number.isFinite(alarm.scheduledTime) &&
      alarm.scheduledTime !== countdownRunAt
    ) {
      return "stale-countdown";
    }

    const result = await runRuleStartupAction(
      rule,
      tabsApi,
      windowsApi,
      notificationsApi,
      fetchImpl,
      getStartupModeForRule(rule, settings, ["countdownRunAt"]),
      {
        settings,
        webNavigationApi,
        permissionsApi,
        storage,
        now,
      }
    );
    await storage.saveRuleRuntime(rule.targetUrl || rule.origin, {
      consumedCountdownRunAt: rule.strategies.countdownRunAt,
    });

    return result;
  }

  if (!rule.strategies.dailyTimes.includes(alarmInfo.time)) {
    return "missing-daily-time";
  }

  if (alarmsApi?.create) {
    try {
      await alarmsApi.create(alarm.name, {
        when: getNextDailyTime(alarmInfo.time, now),
      });
    } catch {
      // 当前触发仍应执行；后台后续启动或规则更新会再次重建调度。
    }
  }

  const today = storage.getLocalDateKey(now);

  if (rule.lastRuns.dailyTimes?.[alarmInfo.time] === today) {
    return "already-ran-today";
  }

  if (!isDailyAlarmDeliveryOnTime(alarm, alarmInfo.time, now)) {
    return "missed-daily-time";
  }

  const result = await runRuleStartupAction(
    rule,
    tabsApi,
    windowsApi,
    notificationsApi,
    fetchImpl,
    getStartupModeForRule(rule, settings, ["dailyTimes"]),
    {
      settings,
      webNavigationApi,
      permissionsApi,
      storage,
      now,
    }
  );
  await storage.saveRuleRuntime(rule.targetUrl || rule.origin, {
    lastRuns: { dailyTimes: { [alarmInfo.time]: today } },
  });

  return result;
}
