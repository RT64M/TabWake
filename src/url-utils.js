// URL 规范化、匹配与基础字段校验的纯函数；不依赖 chrome.storage 或规则形状，
// 供 storage / rules / background / popup 共享。

const RULES_PER_PAGE_OPTIONS = new Set([3, 5, 10]);

export function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function isHttpUrl(value) {
  try {
    const url = new URL(String(value).trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function normalizeOrigin(value) {
  const url = new URL(String(value).trim());

  if (!isHttpUrl(url.href)) {
    throw new Error("URL must start with http:// or https://");
  }

  return `${url.origin}/`;
}

export function normalizeTargetUrl(value) {
  const url = new URL(String(value).trim());

  if (!isHttpUrl(url.href)) {
    throw new Error("URL must start with http:// or https://");
  }

  url.search = "";
  url.hash = "";

  return url.href;
}

export function normalizeComparableUrl(value) {
  const url = new URL(String(value).trim());
  const path = url.pathname || "/";
  const normalizedPath = path.endsWith("/") && path !== "/" ? path.slice(0, -1) : path;

  return `${url.protocol}//${url.hostname}${url.port ? `:${url.port}` : ""}${normalizedPath}`;
}

export function urlsMatch(left, right) {
  if (!isHttpUrl(left) || !isHttpUrl(right)) {
    return false;
  }

  return normalizeComparableUrl(left) === normalizeComparableUrl(right);
}

export function rulesMatchTarget(tabUrl, targetUrl) {
  if (!isHttpUrl(tabUrl) || !isHttpUrl(targetUrl)) {
    return false;
  }

  const tab = new URL(normalizeTargetUrl(tabUrl));
  const target = new URL(normalizeTargetUrl(targetUrl));

  if (tab.origin !== target.origin) {
    return false;
  }

  if (target.pathname === "/" || !target.pathname) {
    return true;
  }

  if (target.pathname.endsWith("/")) {
    return tab.pathname.startsWith(target.pathname);
  }

  return tab.pathname === target.pathname;
}

export function validateDailyTime(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value));
}

export function validateIntervalMinutes(value) {
  return Number.isInteger(value) && value >= 1 && value <= 10080;
}

export function validateRulesPerPage(value) {
  return Number.isInteger(value) && RULES_PER_PAGE_OPTIONS.has(value);
}

export function getHostPermissionOrigin(targetUrl) {
  try {
    const url = new URL(normalizeTargetUrl(targetUrl));
    return isHttpUrl(url.href) ? `${url.origin}/*` : "";
  } catch { return ""; }
}

export function getRuleTargetUrl(rule) {
  return rule.targetUrl || rule.origin;
}

export function getRuleTitle(rule) {
  return (typeof rule.title === "string" ? rule.title.trim() : "") || getRuleTargetUrl(rule);
}
