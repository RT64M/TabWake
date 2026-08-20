import { storage as defaultStorage } from "./storage.js";
import { getExtensionApi } from "./extension-api.js";
import {
  invalidateBrowserWindowStartupRuleCache,
} from "./background/rule-helpers.js";
import { ensureNotificationClickListener } from "./background/tab-notifications.js";
import {
  configureIdleDetection,
  rebuildAlarms,
  syncRuntimeSchedules,
} from "./background/scheduling.js";
import {
  handleBrowserStartup,
  handleBrowserWindowCreated,
  handleBrowserWindowTabCreated,
  runDailyStartup,
} from "./background/startup.js";
import {
  handleAlarm,
  handleBrowserWindowFocused,
  handleIdleStateChanged,
  runRuleNow,
} from "./background/alarms.js";

export { pruneLatestContentRuntimeCache } from "./background/rule-helpers.js";
export { rebuildAlarms, configureIdleDetection } from "./background/scheduling.js";
export {
  runDailyStartup,
  handleBrowserStartup,
  handleBrowserWindowCreated,
  handleBrowserWindowTabCreated,
} from "./background/startup.js";
export {
  handleIdleStateChanged,
  handleBrowserWindowFocused,
  runRuleNow,
  handleAlarm,
} from "./background/alarms.js";

if (getExtensionApi()?.runtime) {
  const chromeApi = getExtensionApi();
  const runtimeStorage = {
    ...defaultStorage,
    loadSettings: () => defaultStorage.loadSettings(chromeApi.storage?.local),
    saveRules: (rules) => defaultStorage.saveRules(rules, chromeApi.storage?.local),
    saveSettings: (settings) =>
      defaultStorage.saveSettings(settings, chromeApi.storage?.local),
    loadDailyStartupIdleState: () =>
      defaultStorage.loadDailyStartupIdleState(chromeApi.storage?.local),
    saveDailyStartupIdleState: (state) =>
      defaultStorage.saveDailyStartupIdleState(state, chromeApi.storage?.local),
    clearDailyStartupIdleState: () =>
      defaultStorage.clearDailyStartupIdleState(chromeApi.storage?.local),
    loadReturnFromIdleState: () =>
      defaultStorage.loadReturnFromIdleState(chromeApi.storage?.local),
    saveReturnFromIdleState: (state) =>
      defaultStorage.saveReturnFromIdleState(state, chromeApi.storage?.local),
    clearReturnFromIdleState: () =>
      defaultStorage.clearReturnFromIdleState(chromeApi.storage?.local),
    loadPendingReturnFromIdleTargets: () =>
      defaultStorage.loadPendingReturnFromIdleTargets(chromeApi.storage?.local),
    savePendingReturnFromIdleTargets: (targets) =>
      defaultStorage.savePendingReturnFromIdleTargets(
        targets,
        chromeApi.storage?.local
      ),
    clearPendingReturnFromIdleTargets: () =>
      defaultStorage.clearPendingReturnFromIdleTargets(chromeApi.storage?.local),
    loadLatestContentRuntimeCache: () =>
      defaultStorage.loadLatestContentRuntimeCache(chromeApi.storage?.local),
    saveLatestContentRuntimeCache: (cache) =>
      defaultStorage.saveLatestContentRuntimeCache(cache, chromeApi.storage?.local),
  };

  chromeApi.runtime.onStartup?.addListener(() => {
    return handleBrowserStartup({
      storage: runtimeStorage,
      tabsApi: chromeApi.tabs,
      windowsApi: chromeApi.windows,
      notificationsApi: chromeApi.notifications,
      webNavigationApi: chromeApi.webNavigation,
      alarmsApi: chromeApi.alarms,
    }).catch((error) => {
      console.error("TabWake startup rules failed to run", error);
    });
  });

  chromeApi.runtime.onInstalled?.addListener(() => {
    return syncRuntimeSchedules({
      storage: runtimeStorage,
      alarmsApi: chromeApi.alarms,
      idleApi: chromeApi.idle,
    }).catch((error) => {
      console.error("TabWake schedules failed to rebuild", error);
    });
  });

  chromeApi.alarms?.onAlarm?.addListener((alarm) => {
    return handleAlarm(alarm, {
      storage: runtimeStorage,
      tabsApi: chromeApi.tabs,
      windowsApi: chromeApi.windows,
      notificationsApi: chromeApi.notifications,
      webNavigationApi: chromeApi.webNavigation,
      permissionsApi: chromeApi.permissions,
    }).catch((error) => {
      console.error("TabWake alarm failed to run", error);
    });
  });

  chromeApi.runtime.onMessage?.addListener((message, _sender, sendResponse) => {
    if (message?.type === "run-rule-now") {
      runRuleNow(message.targetUrl || message.origin, {
        storage: runtimeStorage,
        tabsApi: chromeApi.tabs,
        windowsApi: chromeApi.windows,
        notificationsApi: chromeApi.notifications,
        webNavigationApi: chromeApi.webNavigation,
        permissionsApi: chromeApi.permissions,
        ruleOverride: message.rule || null,
      })
        .then((result) => {
          if (result === "missing-rule") {
            sendResponse({ ok: false, error: "missing-rule", result });
            return;
          }

          sendResponse({ ok: true, result });
        })
        .catch(() => {
          sendResponse({ ok: false, error: "runFailed" });
        });

      return true;
    }

    if (message?.type !== "rules-updated") {
      return false;
    }

    syncRuntimeSchedules({
      storage: runtimeStorage,
      alarmsApi: chromeApi.alarms,
      idleApi: chromeApi.idle,
    })
      .then(() => {
        sendResponse({ ok: true });
      })
      .catch((error) => {
        console.error("TabWake schedules failed to rebuild after rules update", error);
        sendResponse({ ok: false, error: "rulesUpdateFailed" });
      });

    return true;
  });

  chromeApi.storage?.onChanged?.addListener((changes, areaName) => {
    if (areaName === "local" && Object.hasOwn(changes || {}, "rules")) {
      invalidateBrowserWindowStartupRuleCache(runtimeStorage);
    }
  });

  chromeApi.idle?.onStateChanged?.addListener((state) => {
    return handleIdleStateChanged(state, {
      storage: runtimeStorage,
      tabsApi: chromeApi.tabs,
      windowsApi: chromeApi.windows,
      notificationsApi: chromeApi.notifications,
      webNavigationApi: chromeApi.webNavigation,
      permissionsApi: chromeApi.permissions,
    }).catch((error) => {
      console.error("TabWake idle state failed to run", error);
    });
  });

  chromeApi.windows?.onFocusChanged?.addListener((windowId) => {
    return handleBrowserWindowFocused(windowId, {
      storage: runtimeStorage,
      tabsApi: chromeApi.tabs,
      windowsApi: chromeApi.windows,
      notificationsApi: chromeApi.notifications,
      webNavigationApi: chromeApi.webNavigation,
      permissionsApi: chromeApi.permissions,
    }).catch((error) => {
      console.error("Return-from-idle pending rules failed to run", error);
    });
  });

  chromeApi.windows?.onCreated?.addListener((window) => {
    return handleBrowserWindowCreated(window, {
      storage: runtimeStorage,
      tabsApi: chromeApi.tabs,
      windowsApi: chromeApi.windows,
      notificationsApi: chromeApi.notifications,
      webNavigationApi: chromeApi.webNavigation,
      permissionsApi: chromeApi.permissions,
    }).catch((error) => {
      console.error("Browser window startup rules failed to run", error);
    });
  });

  chromeApi.tabs?.onCreated?.addListener((tab) => {
    return handleBrowserWindowTabCreated(tab, {
      storage: runtimeStorage,
      tabsApi: chromeApi.tabs,
      windowsApi: chromeApi.windows,
      notificationsApi: chromeApi.notifications,
      webNavigationApi: chromeApi.webNavigation,
      permissionsApi: chromeApi.permissions,
    }).catch((error) => {
      console.error("Browser window startup tab-created rules failed to run", error);
    });
  });

  ensureNotificationClickListener(
    chromeApi.notifications,
    chromeApi.tabs,
    chromeApi.windows,
    {
      storage: runtimeStorage,
      webNavigationApi: chromeApi.webNavigation,
    }
  );

  syncRuntimeSchedules({
    storage: runtimeStorage,
    alarmsApi: chromeApi.alarms,
    idleApi: chromeApi.idle,
  }).catch((error) => {
    console.error("TabWake schedules failed to initialize", error);
  });
}
