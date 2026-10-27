import {
  isHttpUrl,
  normalizeOrigin,
  normalizeTargetUrl,
  urlsMatch,
} from "./url-utils.js";
import {
  chooseLatestUrlCandidate,
  chooseLatestUrlCandidateByRange,
  isExampleUrlNewerByRange,
  matchesLatestUrlShape,
  matchesUpdateRangeShape,
  predictNextExampleUrl,
  sliceUrlByUpdateRange,
} from "./latest-url-rules.js";

const ARTICLE_LINK_PATTERNS = [
  /<h1[^>]*class=["'][^"']*\bpost__title\b[^"']*["'][^>]*>[\s\S]*?<a\s+[^>]*href=["']([^"']+)["']/i,
  /<h2[^>]*class=["'][^"']*\bpost__title\b[^"']*["'][^>]*>[\s\S]*?<a\s+[^>]*href=["']([^"']+)["']/i,
  /<article\b[^>]*>[\s\S]*?<h1\b[^>]*>[\s\S]*?<a\s+[^>]*href=["']([^"']+)["']/i,
  /<article\b[^>]*>[\s\S]*?<h2\b[^>]*>[\s\S]*?<a\s+[^>]*href=["']([^"']+)["']/i,
  /<article\b[^>]*>[\s\S]*?<a\s+[^>]*href=["']([^"']+)["']/i,
  /<div[^>]*class=["'][^"']*\bpost\b[^"']*["'][^>]*>[\s\S]*?<a\s+[^>]*href=["']([^"']+)["']/i,
];

const ALL_LINK_PATTERN = /<a\s+[^>]*href=["']([^"']+)["']/i;
const DEFAULT_FETCH_TIMEOUT_MS = 8000;
const DEFAULT_MAX_PROBE_HOPS = 20;
const DEFAULT_TOTAL_FETCH_BUDGET_MS = 15000;

function resolveSameOriginUrl({ href, origin, targetUrl, latestExampleUrl }) {
  try {
    const baseUrl = targetUrl || origin;
    const url = new URL(decodeHtmlEntities(href), baseUrl);

    if (!isHttpUrl(url.href) || normalizeOrigin(url.href) !== normalizeOrigin(origin)) {
      return "";
    }

    if (urlsMatch(url.href, targetUrl || origin)) {
      return "";
    }

    const normalizedUrl = normalizeTargetUrl(url.href);

    if (latestExampleUrl && !matchesLatestUrlShape(normalizedUrl, latestExampleUrl, targetUrl)) {
      return "";
    }

    return normalizedUrl;
  } catch {
    return "";
  }
}

function decodeHtmlEntities(value) {
  return String(value)
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&#x2F;", "/")
    .replaceAll("&#x2f;", "/")
    .replaceAll("&#47;", "/")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_match, code) =>
      String.fromCodePoint(Number.parseInt(code, 16))
    );
}

function decodeXmlEntities(value) {
  return decodeHtmlEntities(value);
}

function createGlobalPattern(pattern) {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;

  return new RegExp(pattern.source, flags);
}

function getArticleLinkHrefs(html) {
  const text = String(html || "");

  return ARTICLE_LINK_PATTERNS.flatMap((pattern) =>
    [...text.matchAll(createGlobalPattern(pattern))].map((match) => match[1])
  );
}

function getAllLinkHrefs(html) {
  const text = String(html || "");

  return [...text.matchAll(createGlobalPattern(ALL_LINK_PATTERN))].map(
    (match) => match[1]
  );
}

export function findLatestContentUrl({
  origin,
  targetUrl = origin,
  latestExampleUrl = "",
  html,
}) {
  const hrefs = latestExampleUrl
    ? [...getArticleLinkHrefs(html), ...getAllLinkHrefs(html)]
    : getArticleLinkHrefs(html);

  const candidates = [];

  for (const href of hrefs) {
    const url = resolveSameOriginUrl({ href, origin, targetUrl, latestExampleUrl });

    if (url) {
      candidates.push(url);
    }
  }

  return chooseLatestUrlCandidate([...new Set(candidates)], latestExampleUrl, targetUrl);
}

export function findLatestContentUrlFromSitemap({
  origin,
  targetUrl = origin,
  latestExampleUrl = "",
  xml,
}) {
  const candidates = [...String(xml || "").matchAll(/<url\b[^>]*>([\s\S]*?)<\/url>/gi)]
    .map((match) => {
      const block = match[1];
      const loc = decodeXmlEntities(/<loc>\s*([\s\S]*?)\s*<\/loc>/i.exec(block)?.[1] || "");

      return resolveSameOriginUrl({
        href: loc,
        origin,
        targetUrl,
        latestExampleUrl,
      });
    })
    .filter(Boolean);

  return chooseLatestUrlCandidate([...new Set(candidates)], latestExampleUrl, targetUrl);
}

export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

async function fetchWithTimeout(fetchImpl, url, timeoutMs, init = {}, readBody = false) {
  if (!(timeoutMs > 0)) throw new Error("Fetch budget exhausted");
  const controller = new AbortController();
  let reader;
  let response;
  let timeoutId;
  const operation = (async () => {
    response = await fetchImpl(url, { ...init, signal: controller.signal });
    if (!readBody || !response?.ok) {
      response?.body?.cancel().catch(() => {});
      return response;
    }
    // A non-streaming response cannot enforce the byte limit while receiving.
    if (!response.body?.getReader) throw new Error("Streaming response required");
    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    let text = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw new Error("Response too large");
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return { ok: response.ok, status: response.status, text: async () => text };
  })();
  try {
    return await Promise.race([operation, new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        reader?.cancel().catch(() => {});
        reject(new Error("Fetch timed out"));
      }, timeoutMs);
    })]);
  } finally {
    clearTimeout(timeoutId);
    controller.abort();
    reader?.cancel().catch(() => {});
  }
}

export async function resolveLatestContentUrl(input, options = {}) {
  const origin = typeof input === "string" ? input : input.origin;
  const targetUrl = typeof input === "string" ? input : input.targetUrl || input.origin;
  const latestExampleUrl =
    typeof input === "string" ? "" : input.latestExampleUrl || "";
  const fetchImpl =
    typeof input === "string"
      ? options.fetchImpl || globalThis.fetch
      : input.fetchImpl || globalThis.fetch;
  const fetchTimeoutMs =
    typeof input === "string"
      ? options.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS
      : input.fetchTimeoutMs ?? options.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;

  if (!fetchImpl) return targetUrl;
  const totalBudget = typeof input === "string" ? options.totalFetchBudgetMs : input.totalFetchBudgetMs ?? options.totalFetchBudgetMs;
  const deadline = Date.now() + Math.min(totalBudget ?? DEFAULT_TOTAL_FETCH_BUDGET_MS, DEFAULT_TOTAL_FETCH_BUDGET_MS);
  const remainingTimeout = () => Math.min(fetchTimeoutMs, Math.max(0, deadline - Date.now()));

  try {
    const homeResponse = await fetchWithTimeout(fetchImpl, targetUrl, remainingTimeout(), {}, true);

    if (homeResponse?.ok) {
      const latestUrl = findLatestContentUrl({
        origin,
        targetUrl,
        latestExampleUrl,
        html: await homeResponse.text(),
      });

      if (latestUrl) {
        return latestUrl;
      }
    }
  } catch {
    // Fall through to sitemap and finally origin.
  }

  try {
    const sitemapUrl = new URL("sitemap.xml", origin).href;
    const sitemapResponse = await fetchWithTimeout(fetchImpl, sitemapUrl, remainingTimeout(), {}, true);

    if (sitemapResponse?.ok) {
      return (
        findLatestContentUrlFromSitemap({
          origin,
          targetUrl,
          latestExampleUrl,
          xml: await sitemapResponse.text(),
        }) || targetUrl
      );
    }
  } catch {
    // Fall through to origin.
  }

  return targetUrl;
}

// ===== 按 updatePartRange 的触发时检索 =====
// 先抓前缀页解析候选取最高值，再从该值/预期值按规则向后逐个探测 URL 存在性，
// 找到真正最新的存在 URL。

function collectSameOriginCandidates(html, prefixUrl, origin) {
  const hrefs = [...getArticleLinkHrefs(html), ...getAllLinkHrefs(html)];
  const candidates = [];

  for (const href of hrefs) {
    try {
      const url = new URL(decodeHtmlEntities(href), prefixUrl);

      if (isHttpUrl(url.href) && normalizeOrigin(url.href) === normalizeOrigin(origin)) {
        candidates.push(normalizeTargetUrl(url.href));
      }
    } catch {
      // 跳过无法解析的链接。
    }
  }

  return [...new Set(candidates)];
}

async function probeUrlExists(fetchImpl, url, timeoutMs, getRequestTimeoutMs = null) {
  const resolveTimeout = () =>
    getRequestTimeoutMs ? getRequestTimeoutMs() : timeoutMs;

  try {
    const headTimeoutMs = resolveTimeout();

    if (headTimeoutMs <= 0) {
      return false;
    }

    const headResponse = await fetchWithTimeout(fetchImpl, url, headTimeoutMs, {
      method: "HEAD",
    });

    if (headResponse?.ok) {
      return true;
    }

    // 只有确定表示资源不存在的状态才停止；其余状态可能是站点仅拒绝 HEAD。
    if (
      headResponse &&
      typeof headResponse.status === "number" &&
      (headResponse.status === 404 || headResponse.status === 410)
    ) {
      return false;
    }
  } catch {
    // HEAD 失败时回退 GET。
  }

  try {
    const getTimeoutMs = resolveTimeout();

    if (getTimeoutMs <= 0) {
      return false;
    }

    const getResponse = await fetchWithTimeout(fetchImpl, url, getTimeoutMs);

    return Boolean(getResponse?.ok);
  } catch {
    return false;
  }
}

export async function resolveLatestContentUrlByRange(input, options = {}) {
  const latestExampleUrl = input?.latestExampleUrl || "";
  const range = input?.updatePartRange;
  const expectedNextExampleUrl = input?.expectedNextExampleUrl || "";
  const fetchImpl = input?.fetchImpl || options.fetchImpl || globalThis.fetch;
  const fetchTimeoutMs =
    input?.fetchTimeoutMs ?? options.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const maxProbeHops =
    input?.maxProbeHops ?? options.maxProbeHops ?? DEFAULT_MAX_PROBE_HOPS;
  const totalFetchBudgetMs =
    input?.totalFetchBudgetMs ??
    options.totalFetchBudgetMs ??
    DEFAULT_TOTAL_FETCH_BUDGET_MS;
  const nowImpl = input?.nowImpl || options.nowImpl || Date.now;

  if (!fetchImpl || !latestExampleUrl || !isHttpUrl(latestExampleUrl) || !range) {
    return latestExampleUrl;
  }

  let current;
  let origin;

  try {
    current = normalizeTargetUrl(latestExampleUrl);
    origin = normalizeOrigin(current);
  } catch {
    return latestExampleUrl;
  }

  const configuredExampleUrl = current;
  const fetchStartedAt = nowImpl();
  const getRequestTimeoutMs = () => {
    const elapsedMs = Math.max(0, nowImpl() - fetchStartedAt);
    const remainingMs = Math.max(0, Math.min(totalFetchBudgetMs, DEFAULT_TOTAL_FETCH_BUDGET_MS) - elapsedMs);

    return Math.min(fetchTimeoutMs, remainingMs);
  };
  let expectedCandidate = "";

  try {
    if (expectedNextExampleUrl && isHttpUrl(expectedNextExampleUrl)) {
      const candidate = normalizeTargetUrl(expectedNextExampleUrl);

      if (
        candidate !== configuredExampleUrl &&
        matchesUpdateRangeShape(candidate, configuredExampleUrl, range)
      ) {
        expectedCandidate = candidate;
      }
    }
  } catch {
    expectedCandidate = "";
  }

  // 1) 抓前缀页解析候选，取按 range 最高的（仅在严格更新时采用）。
  try {
    const slice = sliceUrlByUpdateRange(current, range);

    if (slice?.prefixUrl) {
      const prefixTimeoutMs = getRequestTimeoutMs();

      if (prefixTimeoutMs <= 0) {
        return current;
      }

      const response = await fetchWithTimeout(fetchImpl, slice.prefixUrl, prefixTimeoutMs, {}, true);

      if (response?.ok) {
        const candidates = collectSameOriginCandidates(
          await response.text(),
          slice.prefixUrl,
          origin
        );
        const best = chooseLatestUrlCandidateByRange([current, ...candidates], current, range);

        if (best && isExampleUrlNewerByRange(best, current, range)) {
          current = best;
        }
      }
    }
  } catch {
    // 前缀页抓取失败时仍继续探测。
  }

  // 2) 从 current 向后逐个探测存在性，直到不存在或达到跳数上限。
  let expectedCandidateHandled = false;

  for (let hop = 0; hop < maxProbeHops; hop += 1) {
    const predictedNext = predictNextExampleUrl(current, range);
    let next = "";

    if (!expectedCandidateHandled && expectedCandidate) {
      expectedCandidateHandled = true;

      if (
        isExampleUrlNewerByRange(expectedCandidate, current, range) ||
        (!predictedNext && current === configuredExampleUrl)
      ) {
        next = expectedCandidate;
      }
    }

    if (!next) {
      next = predictedNext;
    }

    if (!next) {
      break;
    }

    const exists = await probeUrlExists(
      fetchImpl,
      next,
      fetchTimeoutMs,
      getRequestTimeoutMs
    );

    if (!exists) {
      break;
    }

    current = next;
  }

  return current;
}
