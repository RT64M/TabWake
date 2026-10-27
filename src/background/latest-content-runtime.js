import { getHostPermissionOrigin as getLatestContentPermissionOrigin } from "../url-utils.js";
import {
  createLatestContentRuntimeCacheFingerprint,
  getExtensionApi,
  isExampleUrlNewerByRange,
  isHttpUrl,
  normalizeRules,
  normalizeTargetUrl,
  resolveLatestContentUrl,
  resolveLatestContentUrlByRange,
} from "./shared.js";
import { withLatestCacheLock } from "./state.js";
import {
  getRuleTargetUrl,
  getSafeExpectedNextExampleUrl,
  hasUnsafeLatestExampleUrl,
  isUrlWithinRuleTargetScope,
} from "./rule-helpers.js";

function isStrictLatestRangeAdvanceFrom(rule, currentExampleUrl, nextUrl) {
  try {
    return Boolean(
      rule?.openTarget === "latestContent" &&
        rule?.updatePartRange &&
        isUrlWithinRuleTargetScope(currentExampleUrl, rule) &&
        isUrlWithinRuleTargetScope(nextUrl, rule) &&
        isExampleUrlNewerByRange(
          nextUrl,
          currentExampleUrl,
          rule.updatePartRange
        )
    );
  } catch {
    return false;
  }
}

async function getLatestContentRuntimeCacheContext(rule, storage) {
  const latestExampleUrl = rule.latestExampleUrl || getRuleTargetUrl(rule);
  const expectedNextExampleUrl = getSafeExpectedNextExampleUrl(rule);
  const fingerprint = createLatestContentRuntimeCacheFingerprint({
    targetUrl: getRuleTargetUrl(rule),
    latestExampleUrl: rule.latestExampleUrl,
    updatePartRange: rule.updatePartRange,
    expectedNextExampleUrl,
  });
  const context = {
    fingerprint,
    latestExampleUrl,
    expectedNextExampleUrl,
  };

  if (!fingerprint || !storage?.loadLatestContentRuntimeCache) {
    return context;
  }

  try {
    const cache = await storage.loadLatestContentRuntimeCache();
    const cachedExampleUrl = cache?.[fingerprint];

    if (
      isStrictLatestRangeAdvanceFrom(
        rule,
        rule.latestExampleUrl,
        cachedExampleUrl
      )
    ) {
      context.latestExampleUrl = normalizeTargetUrl(cachedExampleUrl);
    }
  } catch {
    // Runtime cache is opportunistic and must not block opening the saved target.
  }

  return context;
}

async function persistLatestContentRuntimeCacheIfAdvanced(
  rule,
  resolution,
  storage
) {
  const runtimeCache = resolution.runtimeCache;

  if (
    !runtimeCache?.fingerprint ||
    !storage?.loadLatestContentRuntimeCache ||
    !storage?.saveLatestContentRuntimeCache ||
    !isStrictLatestRangeAdvanceFrom(
      rule,
      runtimeCache.latestExampleUrl,
      resolution.url
    )
  ) {
    return;
  }

  const task = async () => {
    let cache;

    try {
      cache = await storage.loadLatestContentRuntimeCache();
    } catch {
      return;
    }

    const cachedExampleUrl = cache[runtimeCache.fingerprint];
    const currentExampleUrl = isStrictLatestRangeAdvanceFrom(
      rule,
      rule.latestExampleUrl,
      cachedExampleUrl
    )
      ? cachedExampleUrl
      : runtimeCache.latestExampleUrl;

    if (
      !isStrictLatestRangeAdvanceFrom(
        rule,
        currentExampleUrl,
        resolution.url
      )
    ) {
      return;
    }

    await storage.saveLatestContentRuntimeCache({
      ...cache,
      [runtimeCache.fingerprint]: normalizeTargetUrl(resolution.url),
    });
  };

  return withLatestCacheLock(task);
}

function getSafeRunNowRule(storedRule, ruleOverride, targetUrl) {
  if (!ruleOverride || getRuleTargetUrl(ruleOverride) !== targetUrl) {
    return storedRule;
  }

  const [normalizedOverride] = normalizeRules([ruleOverride]);

  if (
    !normalizedOverride ||
    normalizedOverride.targetUrl !== getRuleTargetUrl(storedRule) ||
    normalizedOverride.origin !== storedRule.origin
  ) {
    return storedRule;
  }

  return normalizedOverride;
}



async function resolveRuleOpenUrl(
  rule,
  fetchImpl,
  permissionsApi = null,
  storage = null,
  fetchDeadline = Infinity
) {
  const targetUrl = getRuleTargetUrl(rule);

  if (rule.openTarget === "latestContent") {
    if (hasUnsafeLatestExampleUrl(rule)) {
      return { url: targetUrl, runtimeCache: null };
    }

    const permission = await getLatestContentPermissionStatus(
      targetUrl,
      permissionsApi
    );

    if (!permission.allowed) {
      return { url: targetUrl, runtimeCache: null };
    }

    // 新模型：有 updatePartRange 时按更新段主动检索真正最新 URL。
    if (rule.updatePartRange) {
      const runtimeCache = await getLatestContentRuntimeCacheContext(rule, storage);
      const resolvedUrl = await resolveLatestContentUrlByRange({
        latestExampleUrl: runtimeCache.latestExampleUrl,
        updatePartRange: rule.updatePartRange,
        expectedNextExampleUrl: runtimeCache.expectedNextExampleUrl,
        fetchImpl,
        totalFetchBudgetMs: Math.max(0, fetchDeadline - Date.now()),
      });

      return {
        url: isUrlWithinRuleTargetScope(resolvedUrl, rule)
          ? resolvedUrl
          : targetUrl,
        runtimeCache,
      };
    }

    // 旧模型迁移兼容路径:仅对没有 updatePartRange 的历史 / 导入规则生效
    //(popup 已按未完成配置要求重新确认更新段),按基础页 + 末尾示例形状解析。
    if (!rule.latestExampleUrl) return { url: targetUrl, runtimeCache: null };
    const resolvedUrl = await resolveLatestContentUrl({
      origin: rule.origin,
      targetUrl,
      latestExampleUrl: rule.latestExampleUrl || "",
      fetchImpl,
      totalFetchBudgetMs: Math.max(0, fetchDeadline - Date.now()),
    });

    return {
      url: isUrlWithinRuleTargetScope(resolvedUrl, rule)
        ? resolvedUrl
        : targetUrl,
      runtimeCache: null,
    };
  }

  return { url: targetUrl, runtimeCache: null };
}

async function getLatestContentPermissionStatus(
  targetUrl,
  permissionsApi = getExtensionApi()?.permissions
) {
  const permissionOrigin = getLatestContentPermissionOrigin(targetUrl);

  if (!permissionOrigin || !permissionsApi?.contains) {
    return {
      allowed: true,
      permissionOrigin,
    };
  }

  try {
    return {
      allowed: await permissionsApi.contains({ origins: [permissionOrigin] }),
      permissionOrigin,
    };
  } catch {
    return {
      allowed: false,
      permissionOrigin,
    };
  }
}


export {
  getLatestContentPermissionOrigin,
  getLatestContentPermissionStatus,
  getLatestContentRuntimeCacheContext,
  getSafeRunNowRule,
  getSafeExpectedNextExampleUrl,
  hasUnsafeLatestExampleUrl,
  isStrictLatestRangeAdvanceFrom,
  persistLatestContentRuntimeCacheIfAdvanced,
  resolveRuleOpenUrl,
};
