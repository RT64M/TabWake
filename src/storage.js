// chrome.storage.local 持久化层：规则、设置、空闲与离开返回状态的读写与旧配置迁移。
// URL/校验纯函数见 url-utils.js，规则形状与导入导出见 rules.js；本文件统一 re-export
// 这两个模块的公共 API，保持 `storage.js` 作为对外单一入口。

import { getExtensionStorageArea } from "./extension-api.js";
import { getLocalDateKey, isHttpUrl, normalizeTargetUrl } from "./url-utils.js";
import {
  normalizeRules,
  normalizeSettings,
  upsertRule,
} from "./rules.js";

export * from "./url-utils.js";
export * from "./rules.js";

const DEFAULT_SETTINGS = {
  rules: [],
};

const DAILY_STARTUP_IDLE_STATE_KEY = "dailyStartupIdleStartedAt";
const DAILY_STARTUP_LAST_ACTIVE_KEY = "dailyStartupLastActiveAt";
const RETURN_FROM_IDLE_STATE_KEY = "returnFromIdleStartedAt";
const RETURN_FROM_IDLE_LAST_ACTIVE_KEY = "returnFromIdleLastActiveAt";
const RETURN_FROM_IDLE_PENDING_TARGETS_KEY = "returnFromIdlePendingTargets";
const LATEST_CONTENT_RUNTIME_CACHE_KEY = "latestContentRuntimeCache";

export async function loadSettings(storageArea = getExtensionStorageArea("local")) {
  const values = await storageArea.get([
    "rules",
    "targetUrl",
    "lastOpenedDate",
    "settings",
  ]);
  const settings = normalizeSettings(values.settings);

  if (Array.isArray(values.rules)) {
    return {
      ...DEFAULT_SETTINGS,
      settings,
      rules: normalizeRules(values.rules),
    };
  }

  if (values.targetUrl && isHttpUrl(values.targetUrl)) {
    const rules = upsertRule([], values.targetUrl, {
      strategies: {
        dailyStartup: true,
      },
      lastRuns: {
        dailyStartupDate:
          typeof values.lastOpenedDate === "string" ? values.lastOpenedDate : "",
      },
    });

    await storageArea.set({ rules });

    return {
      ...DEFAULT_SETTINGS,
      settings,
      rules,
    };
  }

  return { ...DEFAULT_SETTINGS, settings };
}

export async function saveSettings(settings, storageArea = getExtensionStorageArea("local")) {
  const normalizedSettings = normalizeSettings(settings);
  await storageArea.set({ settings: normalizedSettings });
  return normalizedSettings;
}

export async function saveSettingsAndRules(
  settings,
  rules,
  storageArea = getExtensionStorageArea("local")
) {
  const normalizedSettings = normalizeSettings(settings);
  const normalizedRules = normalizeRules(rules);

  await storageArea.set({
    settings: normalizedSettings,
    rules: normalizedRules,
  });

  return {
    settings: normalizedSettings,
    rules: normalizedRules,
  };
}

export async function loadDailyStartupIdleState(
  storageArea = getExtensionStorageArea("local")
) {
  const values = await storageArea.get([
    DAILY_STARTUP_IDLE_STATE_KEY,
    DAILY_STARTUP_LAST_ACTIVE_KEY,
  ]);

  return {
    dailyStartupIdleStartedAt:
      typeof values[DAILY_STARTUP_IDLE_STATE_KEY] === "string"
        ? values[DAILY_STARTUP_IDLE_STATE_KEY]
        : "",
    dailyStartupLastActiveAt:
      typeof values[DAILY_STARTUP_LAST_ACTIVE_KEY] === "string"
        ? values[DAILY_STARTUP_LAST_ACTIVE_KEY]
        : "",
  };
}

export async function saveDailyStartupIdleState(
  state,
  storageArea = getExtensionStorageArea("local")
) {
  const nextState = {};

  if (Object.hasOwn(state, "dailyStartupIdleStartedAt")) {
    nextState[DAILY_STARTUP_IDLE_STATE_KEY] =
      typeof state.dailyStartupIdleStartedAt === "string"
        ? state.dailyStartupIdleStartedAt
        : "";
  }

  if (Object.hasOwn(state, "dailyStartupLastActiveAt")) {
    nextState[DAILY_STARTUP_LAST_ACTIVE_KEY] =
      typeof state.dailyStartupLastActiveAt === "string"
        ? state.dailyStartupLastActiveAt
        : "";
  }

  if (Object.keys(nextState).length) {
    await storageArea.set(nextState);
  }
}

export async function clearDailyStartupIdleState(
  storageArea = getExtensionStorageArea("local")
) {
  await storageArea.remove(DAILY_STARTUP_IDLE_STATE_KEY);
}

export async function loadReturnFromIdleState(
  storageArea = getExtensionStorageArea("local")
) {
  const values = await storageArea.get([
    RETURN_FROM_IDLE_STATE_KEY,
    RETURN_FROM_IDLE_LAST_ACTIVE_KEY,
  ]);

  return {
    returnFromIdleStartedAt:
      typeof values[RETURN_FROM_IDLE_STATE_KEY] === "string"
        ? values[RETURN_FROM_IDLE_STATE_KEY]
        : "",
    returnFromIdleLastActiveAt:
      typeof values[RETURN_FROM_IDLE_LAST_ACTIVE_KEY] === "string"
        ? values[RETURN_FROM_IDLE_LAST_ACTIVE_KEY]
        : "",
  };
}

export async function saveReturnFromIdleState(
  state,
  storageArea = getExtensionStorageArea("local")
) {
  const nextState = {};

  if (Object.hasOwn(state, "returnFromIdleStartedAt")) {
    nextState[RETURN_FROM_IDLE_STATE_KEY] =
      typeof state.returnFromIdleStartedAt === "string"
        ? state.returnFromIdleStartedAt
        : "";
  }

  if (Object.hasOwn(state, "returnFromIdleLastActiveAt")) {
    nextState[RETURN_FROM_IDLE_LAST_ACTIVE_KEY] =
      typeof state.returnFromIdleLastActiveAt === "string"
        ? state.returnFromIdleLastActiveAt
        : "";
  }

  if (Object.keys(nextState).length) {
    await storageArea.set(nextState);
  }
}

export async function clearReturnFromIdleState(
  storageArea = getExtensionStorageArea("local")
) {
  await storageArea.remove(RETURN_FROM_IDLE_STATE_KEY);
}

function normalizePendingReturnFromIdleTargets(targets) {
  if (!Array.isArray(targets)) {
    return [];
  }

  const normalizedTargets = [];

  for (const target of targets) {
    if (!isHttpUrl(target)) {
      continue;
    }

    const normalizedTarget = normalizeTargetUrl(target);

    if (!normalizedTargets.includes(normalizedTarget)) {
      normalizedTargets.push(normalizedTarget);
    }
  }

  return normalizedTargets;
}

export async function loadPendingReturnFromIdleTargets(
  storageArea = getExtensionStorageArea("local")
) {
  const values = await storageArea.get([RETURN_FROM_IDLE_PENDING_TARGETS_KEY]);

  return normalizePendingReturnFromIdleTargets(
    values[RETURN_FROM_IDLE_PENDING_TARGETS_KEY]
  );
}

export async function savePendingReturnFromIdleTargets(
  targets,
  storageArea = getExtensionStorageArea("local")
) {
  await storageArea.set({
    [RETURN_FROM_IDLE_PENDING_TARGETS_KEY]:
      normalizePendingReturnFromIdleTargets(targets),
  });
}

export async function clearPendingReturnFromIdleTargets(
  storageArea = getExtensionStorageArea("local")
) {
  await storageArea.remove(RETURN_FROM_IDLE_PENDING_TARGETS_KEY);
}

export function createLatestContentRuntimeCacheFingerprint({
  targetUrl = "",
  latestExampleUrl = "",
  updatePartRange = null,
  expectedNextExampleUrl = "",
} = {}) {
  if (
    !isHttpUrl(targetUrl) ||
    !isHttpUrl(latestExampleUrl) ||
    !Number.isInteger(updatePartRange?.startIndex) ||
    !Number.isInteger(updatePartRange?.length) ||
    updatePartRange.startIndex < 0 ||
    updatePartRange.length < 1
  ) {
    return "";
  }

  try {
    return JSON.stringify({
      targetUrl: normalizeTargetUrl(targetUrl),
      latestExampleUrl: normalizeTargetUrl(latestExampleUrl),
      updatePartRange: {
        startIndex: updatePartRange.startIndex,
        length: updatePartRange.length,
      },
      expectedNextExampleUrl: isHttpUrl(expectedNextExampleUrl)
        ? normalizeTargetUrl(expectedNextExampleUrl)
        : "",
    });
  } catch {
    return "";
  }
}

function normalizeLatestContentRuntimeCache(cache) {
  if (!cache || typeof cache !== "object" || Array.isArray(cache)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(cache).flatMap(([fingerprint, latestExampleUrl]) => {
      if (typeof fingerprint !== "string" || !isHttpUrl(latestExampleUrl)) {
        return [];
      }

      return [[fingerprint, normalizeTargetUrl(latestExampleUrl)]];
    })
  );
}

export async function loadLatestContentRuntimeCache(
  storageArea = getExtensionStorageArea("local")
) {
  const values = await storageArea.get([LATEST_CONTENT_RUNTIME_CACHE_KEY]);

  return normalizeLatestContentRuntimeCache(
    values[LATEST_CONTENT_RUNTIME_CACHE_KEY]
  );
}

export async function saveLatestContentRuntimeCache(
  cache,
  storageArea = getExtensionStorageArea("local")
) {
  const normalizedCache = normalizeLatestContentRuntimeCache(cache);

  await storageArea.set({
    [LATEST_CONTENT_RUNTIME_CACHE_KEY]: normalizedCache,
  });

  return normalizedCache;
}

export async function saveRules(rules, storageArea = getExtensionStorageArea("local")) {
  const normalizedRules = normalizeRules(rules);
  await storageArea.set({ rules: normalizedRules });
  return normalizedRules;
}

export const storage = {
  getLocalDateKey,
  loadSettings,
  saveSettings,
  saveSettingsAndRules,
  saveRules,
  loadDailyStartupIdleState,
  saveDailyStartupIdleState,
  clearDailyStartupIdleState,
  loadReturnFromIdleState,
  saveReturnFromIdleState,
  clearReturnFromIdleState,
  loadPendingReturnFromIdleTargets,
  savePendingReturnFromIdleTargets,
  clearPendingReturnFromIdleTargets,
  createLatestContentRuntimeCacheFingerprint,
  loadLatestContentRuntimeCache,
  saveLatestContentRuntimeCache,
};
