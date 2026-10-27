const NOTIFICATION_OPEN_PREFIX = "tabwake:open:";
const NOTIFICATION_FAILED_OPEN_PREFIX = "tabwake:failed-open:";
const STARTUP_MODES = new Set(["silent", "notify", "browser", "device"]);
const STARTUP_MODE_PRIORITY = {
  notify: 0,
  silent: 1,
  browser: 2,
  device: 3,
};
const STARTUP_TRIGGER_TYPES = new Set([
  "browserProcessStartup",
  "browserWindowStartup",
]);
const STARTUP_DEDUPLICATION_WINDOW_MS = 5000;
const DAILY_ALARM_DELIVERY_TOLERANCE_MS = 5 * 60 * 1000;
const BROWSER_IDLE_DETECTION_MAX_SECONDS = 4 * 60 * 60;
let lastStartupHandledAt = 0;
const handledWindowStartupWindowIds = new Map();

// ponytail: global trigger queue; use per-rule queues if bounded parallel startup is insufficient.
// Serialize trigger decisions so alarms and startup cannot both consume the same run.
// Cross-context configuration/runtime transactions use a separate Web Lock in storage.js.
let ruleMutationQueue = Promise.resolve();
let activeIdleTransitionQueue = Promise.resolve();

function withRuleMutationLock(task) {
  const run = ruleMutationQueue.then(task, task);

  ruleMutationQueue = run.then(
    () => undefined,
    () => undefined
  );

  return run;
}

let latestCacheQueue = Promise.resolve();
function withLatestCacheLock(task) {
  const run = latestCacheQueue.then(task, task);
  latestCacheQueue = run.catch(() => {});
  return run;
}

async function waitForActiveIdleTransition() {
  while (true) {
    const transition = activeIdleTransitionQueue;
    await transition;

    if (transition === activeIdleTransitionQueue) {
      return;
    }
  }
}

function queueActiveIdleTransition(task) {
  const transition = activeIdleTransitionQueue.then(task);

  activeIdleTransitionQueue = transition.then(
    () => undefined,
    () => undefined
  );

  return transition;
}

function normalizeStartupMode(value) {
  return STARTUP_MODES.has(value) ? value : "device";
}

function shouldSkipRecentStartup(now) {
  const timestamp = now.getTime();

  if (
    lastStartupHandledAt > 0 &&
    timestamp - lastStartupHandledAt >= 0 &&
    timestamp - lastStartupHandledAt < STARTUP_DEDUPLICATION_WINDOW_MS
  ) {
    return true;
  }

  lastStartupHandledAt = timestamp;
  return false;
}

function shouldSkipRecentWindowStartup(windowId, now) {
  if (windowId === undefined || windowId === null) {
    return false;
  }

  const timestamp = now.getTime();
  const lastHandledAt = handledWindowStartupWindowIds.get(windowId);

  if (
    Number.isFinite(lastHandledAt) &&
    timestamp - lastHandledAt >= 0 &&
    timestamp - lastHandledAt < STARTUP_DEDUPLICATION_WINDOW_MS
  ) {
    return true;
  }

  handledWindowStartupWindowIds.set(windowId, timestamp);

  for (const [handledWindowId, handledAt] of handledWindowStartupWindowIds) {
    if (timestamp - handledAt >= STARTUP_DEDUPLICATION_WINDOW_MS) {
      handledWindowStartupWindowIds.delete(handledWindowId);
    }
  }

  return false;
}

export {
  BROWSER_IDLE_DETECTION_MAX_SECONDS,
  DAILY_ALARM_DELIVERY_TOLERANCE_MS,
  NOTIFICATION_FAILED_OPEN_PREFIX,
  NOTIFICATION_OPEN_PREFIX,
  STARTUP_DEDUPLICATION_WINDOW_MS,
  STARTUP_MODE_PRIORITY,
  STARTUP_MODES,
  STARTUP_TRIGGER_TYPES,
  normalizeStartupMode,
  shouldSkipRecentStartup,
  shouldSkipRecentWindowStartup,
  queueActiveIdleTransition,
  waitForActiveIdleTransition,
  withLatestCacheLock,
  withRuleMutationLock,
};

// Collections stay private; their owners use narrow operations rather than exported Maps.
const pendingOpenedTabs = new Map();
const notificationOpenContexts = new Map();
const notificationClickRegistrations = new WeakSet();
const webNavigationRegistrations = new WeakSet();
const tabRemovalRegistrations = new WeakSet();
const browserWindowStartupRulesEnabledByStorage = new WeakMap();
function trimMap(map, limit) {
  // ponytail: insertion-order caps; use persistent navigation tracking above 512 pending opens.
  while (map.size >= limit) map.delete(map.keys().next().value);
}
export const notificationState = Object.freeze({
  sizes: () => ({ notifications: notificationOpenContexts.size, pendingTabs: pendingOpenedTabs.size }),
  getPending: id => pendingOpenedTabs.get(id),
  forgetPending: id => pendingOpenedTabs.delete(id),
  rememberPending(id, pending) { trimMap(pendingOpenedTabs, 512); pendingOpenedTabs.set(id, pending); },
  consumeContext(id) { const context = notificationOpenContexts.get(id) || {}; notificationOpenContexts.delete(id); return context; },
  forgetContext: id => notificationOpenContexts.delete(id),
  rememberContext(id, context, baseId) {
    if (baseId) for (const key of notificationOpenContexts.keys()) {
      if (key === baseId || key.startsWith(`${baseId}:`)) notificationOpenContexts.delete(key);
    }
    // Evicted notification contexts can be reconstructed from storage on click.
    trimMap(notificationOpenContexts, 256); notificationOpenContexts.set(id, context);
  },
  clickRegistered: api => notificationClickRegistrations.has(api),
  registerClick: api => notificationClickRegistrations.add(api),
  navigationRegistered: api => webNavigationRegistrations.has(api),
  registerNavigation: api => webNavigationRegistrations.add(api),
  tabRemovalRegistered: api => tabRemovalRegistrations.has(api),
  registerTabRemoval: api => tabRemovalRegistrations.add(api),
});
export const windowStartupRuleCache = Object.freeze({
  has: storage => browserWindowStartupRulesEnabledByStorage.has(storage),
  get: storage => browserWindowStartupRulesEnabledByStorage.get(storage),
  set: (storage, value) => browserWindowStartupRulesEnabledByStorage.set(storage, value),
  delete: storage => browserWindowStartupRulesEnabledByStorage.delete(storage),
});
// ponytail: serialize only tab query/create calls, while URL fetches remain parallel.
let tabActionQueue = Promise.resolve();
export function withTabActionLock(task) {
  const run = tabActionQueue.then(task);
  tabActionQueue = run.catch(() => {});
  return run;
}
