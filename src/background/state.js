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
const notificationClickRegistrations = new WeakSet();
const webNavigationRegistrations = new WeakSet();
const pendingOpenedTabs = new Map();
const notificationOpenContexts = new Map();
const browserWindowStartupRulesEnabledByStorage = new WeakMap();
let lastStartupHandledAt = 0;
const handledWindowStartupWindowIds = new Map();

// chrome.storage has no transactions, so concurrent triggers (multiple alarms
// firing close together, or an alarm racing the startup flow) could each
// load → mutate → saveRules and clobber one another's write. Chain rule-
// mutating critical sections through a single in-memory queue so each runs to
// completion before the next reads, eliminating the lost-update window inside
// this service worker.
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
  activeIdleTransitionQueue,
  browserWindowStartupRulesEnabledByStorage,
  handledWindowStartupWindowIds,
  notificationClickRegistrations,
  notificationOpenContexts,
  pendingOpenedTabs,
  webNavigationRegistrations,
  normalizeStartupMode,
  shouldSkipRecentStartup,
  shouldSkipRecentWindowStartup,
  queueActiveIdleTransition,
  waitForActiveIdleTransition,
  withRuleMutationLock,
};
