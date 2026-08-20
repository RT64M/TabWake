import {
  getExtensionUrl,
  isHttpUrl,
  normalizeFailedOpenBehavior,
  rulesMatchTarget,
  urlsMatch,
} from "./shared.js";
import {
  NOTIFICATION_FAILED_OPEN_PREFIX,
  NOTIFICATION_OPEN_PREFIX,
  notificationClickRegistrations,
  notificationOpenContexts,
  pendingOpenedTabs,
  webNavigationRegistrations,
} from "./state.js";
import { getRuleTargetUrl } from "./rule-helpers.js";
import {
  persistLatestContentRuntimeCacheIfAdvanced,
  resolveRuleOpenUrl,
} from "./latest-content-runtime.js";

function createOpenNotificationId(url, uniqueSuffix = "") {
  const suffix = uniqueSuffix ? `:${encodeURIComponent(uniqueSuffix)}` : "";

  return `${NOTIFICATION_OPEN_PREFIX}${encodeURIComponent(url)}${suffix}`;
}

function createFailedOpenNotificationId(url) {
  return `${NOTIFICATION_FAILED_OPEN_PREFIX}${encodeURIComponent(url)}`;
}

function parseUrlNotificationId(notificationId) {
  const prefix = notificationId.startsWith(NOTIFICATION_OPEN_PREFIX)
    ? NOTIFICATION_OPEN_PREFIX
    : notificationId.startsWith(NOTIFICATION_FAILED_OPEN_PREFIX)
      ? NOTIFICATION_FAILED_OPEN_PREFIX
      : "";

  if (!prefix) {
    return null;
  }

  try {
    const encodedValue = notificationId.slice(prefix.length);
    const encodedUrl = prefix === NOTIFICATION_OPEN_PREFIX
      ? encodedValue.split(":")[0]
      : encodedValue;
    const url = decodeURIComponent(encodedUrl);

    return isHttpUrl(url) ? url : null;
  } catch {
    return null;
  }
}

function tabMatchesOpenUrl(tabUrl, targetUrl, matchMode) {
  if (matchMode === "url") {
    return urlsMatch(tabUrl, targetUrl);
  }

  return rulesMatchTarget(tabUrl, targetUrl);
}

function getFailedOpenTimestamp(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");

  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function registerPendingOpenedTab({
  tab,
  rule,
  url,
  createdByTabWake,
  settings = {},
  notificationsApi,
  webNavigationApi,
  tabsApi,
  windowsApi,
  now = new Date(),
}) {
  if (tab?.id === undefined || !isHttpUrl(url)) {
    return;
  }

  pendingOpenedTabs.set(tab.id, {
    tabId: tab.id,
    rule,
    url,
    createdByTabWake,
    failedOpenBehavior: normalizeFailedOpenBehavior(settings.failedOpenBehavior),
    notificationsApi,
    webNavigationApi,
    tabsApi,
    windowsApi,
    openedAt: now,
  });
}

function registerNotificationOpenContext(notificationId, context = {}) {
  if (!notificationId) {
    return;
  }

  // 同一 URL 的旧通知(尤其窗口启动的 unique 后缀通知)不会再被点击消费,
  // 注册新条目时顺带清理同 URL 旧键,避免长寿命后台中 Map 无界增长。
  if (notificationId.startsWith(NOTIFICATION_OPEN_PREFIX)) {
    const encodedUrl = notificationId
      .slice(NOTIFICATION_OPEN_PREFIX.length)
      .split(":")[0];
    const baseId = `${NOTIFICATION_OPEN_PREFIX}${encodedUrl}`;

    for (const existingId of notificationOpenContexts.keys()) {
      if (existingId === baseId || existingId.startsWith(`${baseId}:`)) {
        notificationOpenContexts.delete(existingId);
      }
    }
  }

  notificationOpenContexts.set(notificationId, context);
}

function consumeNotificationOpenContext(notificationId) {
  const context = notificationOpenContexts.get(notificationId) || {};
  notificationOpenContexts.delete(notificationId);
  return context;
}

function unregisterPendingOpenedTab(tabId) {
  pendingOpenedTabs.delete(tabId);
}

function ensureWebNavigationListeners(webNavigationApi) {
  if (
    !webNavigationApi?.onErrorOccurred?.addListener ||
    webNavigationRegistrations.has(webNavigationApi)
  ) {
    return;
  }

  webNavigationApi.onErrorOccurred.addListener((details) => {
    if (details?.frameId !== 0) {
      return;
    }

    return handleOpenedTabNavigationError(details).catch((error) => {
      console.error("TabWake failed-open notification failed", error);
    });
  });

  webNavigationApi.onCompleted?.addListener?.((details) => {
    if (details?.frameId === 0 && details.tabId !== undefined) {
      unregisterPendingOpenedTab(details.tabId);
    }
  });

  webNavigationRegistrations.add(webNavigationApi);
}

async function handleOpenedTabNavigationError(details) {
  const pending = pendingOpenedTabs.get(details.tabId);

  if (!pending || !urlsMatch(details.url || pending.url, pending.url)) {
    return "ignored-navigation-error";
  }

  // 用户在加载完成前主动跳转 / 停止(ERR_ABORTED / NS_BINDING_ABORTED)
  // 不代表目标网址不可用:不发失败通知,也不能按 close 设置关掉用户正在操作的标签页。
  const navigationError = String(details.error || "");

  if (
    navigationError === "net::ERR_ABORTED" ||
    navigationError === "NS_BINDING_ABORTED"
  ) {
    pendingOpenedTabs.delete(details.tabId);
    return "ignored-aborted-navigation";
  }

  pendingOpenedTabs.delete(details.tabId);

  if (pending.failedOpenBehavior === "close" && pending.createdByTabWake) {
    await pending.tabsApi?.remove?.(details.tabId);
  }

  return createFailedOpenNotification(pending);
}

async function createFailedOpenNotification(pending) {
  const notificationsApi = pending.notificationsApi;

  if (!notificationsApi?.create) {
    return "notifications-unavailable";
  }

  ensureNotificationClickListener(
    notificationsApi,
    pending.tabsApi,
    pending.windowsApi,
    {
      webNavigationApi: pending.webNavigationApi,
    }
  );

  const notificationId = createFailedOpenNotificationId(pending.url);
  registerNotificationOpenContext(notificationId, {
    rule: pending.rule,
    settings: {
      failedOpenBehavior: pending.failedOpenBehavior,
    },
    webNavigationApi: pending.webNavigationApi,
    now: new Date(),
  });

  await notificationsApi.create(notificationId, {
    type: "basic",
    iconUrl: getExtensionUrl("icons/icon128.png"),
    title: getRuleNotificationTitle(pending.rule, pending.url),
    message: `${getFailedOpenTimestamp(pending.openedAt)} - ${pending.url}`,
  });

  return "failed-open-notification-created";
}

async function openOrFocusUrl(
  url,
  tabsApi,
  windowsApi,
  {
    matchMode = "origin",
    focusWindow = true,
    activateTab = true,
    rule = null,
    settings = {},
    notificationsApi = null,
    webNavigationApi = null,
    now = new Date(),
  } = {}
) {
  const tabs = await tabsApi.query({});
  const matchingTab = tabs.find(
    (tab) => tab.url && tabMatchesOpenUrl(tab.url, url, matchMode)
  );

  ensureWebNavigationListeners(webNavigationApi);

  if (matchingTab?.id !== undefined) {
    if (activateTab) {
      await tabsApi.update(matchingTab.id, { active: true });
    }

    if (focusWindow && matchingTab.windowId !== undefined && windowsApi?.update) {
      await windowsApi.update(matchingTab.windowId, { focused: true });
    }

    return "focused-existing-tab";
  }

  const createdTab = await tabsApi.create({ url, active: activateTab });

  if (focusWindow && createdTab?.windowId !== undefined && windowsApi?.update) {
    await windowsApi.update(createdTab.windowId, { focused: true });
  }

  registerPendingOpenedTab({
    tab: createdTab,
    rule,
    url,
    createdByTabWake: true,
    settings,
    notificationsApi,
    webNavigationApi,
    tabsApi,
    windowsApi,
    now,
  });

  return "created-new-tab";
}

async function openOrFocusRule(
  rule,
  tabsApi,
  windowsApi,
  fetchImpl,
  {
    focusWindow = true,
    activateTab = true,
    settings = {},
    notificationsApi = null,
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
  const url = resolution.url;

  return openOrFocusUrl(url, tabsApi, windowsApi, {
    matchMode: rule.openTarget === "latestContent" ? "url" : "origin",
    focusWindow,
    activateTab,
    rule,
    settings,
    notificationsApi,
    webNavigationApi,
    now,
  });
}

function getRuleNotificationTitle(rule, fallbackUrl = "") {
  const title = typeof rule?.title === "string" ? rule.title.trim() : "";
  const targetUrl = rule ? getRuleTargetUrl(rule) : "";

  return title || targetUrl || fallbackUrl;
}

function findRuleByOpenUrl(rules, url) {
  return rules.find((rule) => {
    if (rule.enabled === false) {
      return false;
    }

    const targetUrl = getRuleTargetUrl(rule);

    return urlsMatch(url, targetUrl) || rulesMatchTarget(url, targetUrl);
  });
}

async function getNotificationOpenContext({
  notificationId,
  url,
  storage,
  webNavigationApi,
  now = new Date(),
}) {
  const storedContext = consumeNotificationOpenContext(notificationId);

  if (storedContext.rule || storedContext.settings || storedContext.webNavigationApi) {
    return {
      rule: storedContext.rule || null,
      settings: storedContext.settings || {},
      webNavigationApi: storedContext.webNavigationApi || webNavigationApi || null,
      now: storedContext.now || now,
    };
  }

  if (!storage?.loadSettings) {
    return {
      rule: null,
      settings: {},
      webNavigationApi: webNavigationApi || null,
      now,
    };
  }

  try {
    const { rules, settings } = await storage.loadSettings();

    return {
      rule: findRuleByOpenUrl(rules, url) || null,
      settings: settings || {},
      webNavigationApi: webNavigationApi || null,
      now,
    };
  } catch {
    return {
      rule: null,
      settings: {},
      webNavigationApi: webNavigationApi || null,
      now,
    };
  }
}

function ensureNotificationClickListener(
  notificationsApi,
  tabsApi,
  windowsApi,
  { storage = null, webNavigationApi = null } = {}
) {
  if (
    !notificationsApi?.onClicked?.addListener ||
    notificationClickRegistrations.has(notificationsApi)
  ) {
    return;
  }

  notificationsApi.onClicked.addListener((notificationId) => {
    const url = parseUrlNotificationId(notificationId);

    if (!url) {
      return;
    }

    return Promise.resolve(notificationsApi.clear?.(notificationId))
      .catch(() => false)
      .then(async () => {
        const context = await getNotificationOpenContext({
          notificationId,
          url,
          storage,
          webNavigationApi,
        });

        return openOrFocusUrl(url, tabsApi, windowsApi, {
          matchMode: "url",
          focusWindow: true,
          activateTab: true,
          rule: context.rule || null,
          settings: context.settings || {},
          notificationsApi,
          webNavigationApi: context.webNavigationApi || null,
          now: context.now || new Date(),
        });
      })
      .catch((error) => {
        console.error("TabWake notification target failed to open", error);
      });
  });
  notificationClickRegistrations.add(notificationsApi);
}

async function createRuleNotification(
  rule,
  url,
  notificationsApi,
  tabsApi,
  windowsApi,
  {
    uniqueNotification = false,
    settings = {},
    webNavigationApi = null,
    now = new Date(),
  } = {}
) {
  if (!notificationsApi?.create) {
    return "notifications-unavailable";
  }

  ensureNotificationClickListener(notificationsApi, tabsApi, windowsApi, {
    webNavigationApi,
  });
  const uniqueSuffix = uniqueNotification
    ? `${now.getTime()}:${Math.random().toString(36).slice(2)}`
    : "";
  const notificationId = createOpenNotificationId(url, uniqueSuffix);
  registerNotificationOpenContext(notificationId, {
    rule,
    settings: {
      failedOpenBehavior: settings.failedOpenBehavior,
    },
    webNavigationApi,
    now,
  });

  await notificationsApi.create(notificationId, {
    type: "basic",
    iconUrl: getExtensionUrl("icons/icon128.png"),
    title: getRuleNotificationTitle(rule, url),
    message: url,
  });

  return "notification-created";
}


export {
  createRuleNotification,
  ensureNotificationClickListener,
  ensureWebNavigationListeners,
  openOrFocusRule,
  openOrFocusUrl,
  tabMatchesOpenUrl,
};
