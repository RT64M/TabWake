import {
  isHttpUrl,
  normalizeOrigin,
  normalizeTargetUrl,
  rulesMatchTarget,
} from "./storage.js";

function getPathSegments(url) {
  return new URL(url).pathname.split("/").filter(Boolean);
}

function createUrlFromSegments(url, segments, { trailingSlash = true } = {}) {
  const nextUrl = new URL(url);
  nextUrl.pathname = segments.length
    ? `/${segments.join("/")}${trailingSlash ? "/" : ""}`
    : "/";
  nextUrl.search = "";
  nextUrl.hash = "";

  return nextUrl.href;
}

function getComparablePathSegments(url, targetUrl) {
  const targetSegments = getPathSegments(targetUrl);

  return getPathSegments(url).slice(targetSegments.length);
}

function getNumberedSlugShape(segment) {
  return segment.replace(/\d+/g, "{number}");
}

function getVersionParts(segment) {
  const match = /^v?(\d+(?:\.\d+)+)(?:-([0-9a-z.-]+))?(?:\+[0-9a-z.-]+)?$/i.exec(segment);

  if (!match) {
    return null;
  }

  return {
    core: match[1].split(".").map(Number),
    prerelease: match[2] ? match[2].split(".") : [],
  };
}

export function classifyLatestUrlSegment(segment) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(segment)) {
    return "date";
  }

  if (/^\d+$/.test(segment)) {
    return "number";
  }

  if (getVersionParts(segment)) {
    return "version";
  }

  if (/\d/.test(segment)) {
    return "numbered-slug";
  }

  return "slug";
}

function isYearSegment(segment) {
  return /^\d{4}$/.test(segment);
}

function isMonthSegment(segment) {
  const value = Number(segment);

  return /^\d{1,2}$/.test(segment) && value >= 1 && value <= 12;
}

function isDaySegment(segment) {
  const value = Number(segment);

  return /^\d{1,2}$/.test(segment) && value >= 1 && value <= 31;
}

function getLatestUpdateStartIndex(segments) {
  for (let index = 0; index < segments.length; index += 1) {
    if (
      isYearSegment(segments[index]) &&
      isMonthSegment(segments[index + 1] || "") &&
      isDaySegment(segments[index + 2] || "")
    ) {
      return index;
    }
  }

  const trailingNumericIndex = segments.findIndex((segment, index) =>
    index > 0 && /^\d+$/.test(segment)
  );

  if (trailingNumericIndex > 0) {
    return trailingNumericIndex - 1;
  }

  for (let index = 0; index < segments.length; index += 1) {
    if (classifyLatestUrlSegment(segments[index]) !== "slug") {
      return index;
    }
  }

  return -1;
}

function latestUrlSegmentsMatch(candidateSegment, exampleSegment) {
  const candidateType = classifyLatestUrlSegment(candidateSegment);
  const exampleType = classifyLatestUrlSegment(exampleSegment);

  if (candidateType !== exampleType) {
    return false;
  }

  if (exampleType === "numbered-slug") {
    return getNumberedSlugShape(candidateSegment) === getNumberedSlugShape(exampleSegment);
  }

  if (exampleType === "version") {
    return /^v/i.test(candidateSegment) === /^v/i.test(exampleSegment);
  }

  return true;
}

export function matchesLatestUrlShape(candidateUrl, latestExampleUrl, targetUrl) {
  if (!latestExampleUrl) {
    return true;
  }

  if (!isHttpUrl(candidateUrl) || !isHttpUrl(latestExampleUrl) || !isHttpUrl(targetUrl)) {
    return false;
  }

  if (normalizeOrigin(candidateUrl) !== normalizeOrigin(latestExampleUrl)) {
    return false;
  }

  if (!rulesMatchTarget(candidateUrl, targetUrl)) {
    return false;
  }

  const candidateSegments = getComparablePathSegments(
    normalizeTargetUrl(candidateUrl),
    normalizeTargetUrl(targetUrl)
  );
  const exampleSegments = getComparablePathSegments(
    normalizeTargetUrl(latestExampleUrl),
    normalizeTargetUrl(targetUrl)
  );

  if (!candidateSegments.length || candidateSegments.length !== exampleSegments.length) {
    return false;
  }

  return candidateSegments.every((segment, index) =>
    latestUrlSegmentsMatch(segment, exampleSegments[index])
  );
}

function compareNumberArrays(left, right) {
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    const leftPart = left[index] || 0;
    const rightPart = right[index] || 0;

    if (leftPart !== rightPart) {
      return leftPart - rightPart;
    }
  }

  return 0;
}

function getSegmentNumber(segment) {
  return /^\d+$/.test(segment) ? Number(segment) : null;
}

function getDateTupleSortValue(candidateSegments, exampleSegments) {
  for (let index = 0; index < exampleSegments.length - 1; index += 1) {
    const year = getSegmentNumber(exampleSegments[index]);
    const month = getSegmentNumber(exampleSegments[index + 1]);
    const day =
      index + 2 < exampleSegments.length ? getSegmentNumber(exampleSegments[index + 2]) : null;

    if (year === null || year < 1000 || year > 9999 || month === null || month < 1 || month > 12) {
      continue;
    }

    if (day !== null && day >= 1 && day <= 31) {
      return {
        type: "number",
        value:
          getSegmentNumber(candidateSegments[index]) * 10000 +
          getSegmentNumber(candidateSegments[index + 1]) * 100 +
          getSegmentNumber(candidateSegments[index + 2]),
      };
    }

    return {
      type: "number",
      value:
        getSegmentNumber(candidateSegments[index]) * 100 +
        getSegmentNumber(candidateSegments[index + 1]),
    };
  }

  return null;
}

function comparePrereleaseParts(left, right) {
  if (!left.length && !right.length) {
    return 0;
  }

  if (!left.length) {
    return 1;
  }

  if (!right.length) {
    return -1;
  }

  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];

    if (leftPart === undefined) {
      return -1;
    }

    if (rightPart === undefined) {
      return 1;
    }

    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : null;
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : null;

    if (leftNumber !== null && rightNumber !== null && leftNumber !== rightNumber) {
      return leftNumber - rightNumber;
    }

    if (leftNumber !== null && rightNumber === null) {
      return -1;
    }

    if (leftNumber === null && rightNumber !== null) {
      return 1;
    }

    if (leftPart !== rightPart) {
      return leftPart < rightPart ? -1 : 1;
    }
  }

  return 0;
}

function getSortableSegmentValue(segment, exampleSegment) {
  const segmentType = classifyLatestUrlSegment(exampleSegment);

  if (segmentType === "date") {
    const dateTime = Date.parse(segment);

    return Number.isNaN(dateTime) ? null : { type: "number", value: dateTime };
  }

  if (segmentType === "version") {
    const version = getVersionParts(segment);

    return version ? { type: "version", value: version } : null;
  }

  if (segmentType === "number" || segmentType === "numbered-slug") {
    const numbers = segment.match(/\d+/g);

    if (!numbers?.length) {
      return null;
    }

    return { type: "number", value: Number(numbers.at(-1)) };
  }

  return null;
}

function getLatestSortValue(url, latestExampleUrl, targetUrl) {
  if (!latestExampleUrl) {
    return null;
  }

  const candidateSegments = getComparablePathSegments(url, targetUrl);
  const exampleSegments = getComparablePathSegments(latestExampleUrl, targetUrl);
  const dateTupleSortValue = getDateTupleSortValue(candidateSegments, exampleSegments);

  if (dateTupleSortValue) {
    return dateTupleSortValue;
  }

  let sortValue = null;

  for (let index = 0; index < candidateSegments.length; index += 1) {
    const value = getSortableSegmentValue(candidateSegments[index], exampleSegments[index]);

    if (value) {
      sortValue = value;
    }
  }

  return sortValue;
}

function compareSortValues(left, right) {
  if (left.type === "version" && right.type === "version") {
    const coreResult = compareNumberArrays(left.value.core, right.value.core);

    if (coreResult !== 0) {
      return coreResult;
    }

    return comparePrereleaseParts(left.value.prerelease, right.value.prerelease);
  }

  if (left.type === "number" && right.type === "number") {
    return left.value - right.value;
  }

  return 0;
}

export function chooseLatestUrlCandidate(candidates, latestExampleUrl, targetUrl) {
  if (!candidates.length) {
    return "";
  }

  const normalizedCandidates = candidates
    .map((url) => {
      try {
        return normalizeTargetUrl(url);
      } catch {
        return "";
      }
    })
    .filter(Boolean)
    .filter((url) => matchesLatestUrlShape(url, latestExampleUrl, targetUrl));

  if (!normalizedCandidates.length) {
    return "";
  }

  const uniqueCandidates = [...new Set(normalizedCandidates)];
  const scored = uniqueCandidates.map((url, index) => ({
    url,
    index,
    sortValue: getLatestSortValue(url, latestExampleUrl, targetUrl),
  }));
  const sortable = scored.filter((entry) => entry.sortValue);

  if (!sortable.length) {
    return uniqueCandidates[0];
  }

  sortable.sort((left, right) => {
    const sortResult = compareSortValues(right.sortValue, left.sortValue);

    if (sortResult !== 0) {
      return sortResult;
    }

    return left.index - right.index;
  });

  return sortable[0].url;
}

// ===== 自动更新部分（updatePartRange）支持 =====
// 更新部分可位于 URL 中间、可连续多段，前后段固定。

function isValidUpdateRange(range, segmentsLength) {
  return Boolean(
    range &&
      Number.isInteger(range.startIndex) &&
      Number.isInteger(range.length) &&
      range.startIndex >= 0 &&
      range.length >= 1 &&
      range.startIndex + range.length <= segmentsLength
  );
}

export function detectUpdatePartRange(url) {
  let segments;

  try {
    segments = getPathSegments(normalizeTargetUrl(url));
  } catch {
    return null;
  }

  if (!segments.length) {
    return null;
  }

  const start = getLatestUpdateStartIndex(segments);

  if (start >= 0) {
    return { startIndex: start, length: segments.length - start };
  }

  // 无可识别的可递增段时，默认高亮最后一段，交由用户改正或手填预期下一个。
  return { startIndex: segments.length - 1, length: 1 };
}

export function getUpdatePartText(url, range) {
  let segments;

  try {
    segments = getPathSegments(normalizeTargetUrl(url));
  } catch {
    return "";
  }

  if (!isValidUpdateRange(range, segments.length)) {
    return "";
  }

  return segments.slice(range.startIndex, range.startIndex + range.length).join("/");
}

export function locateUpdatePartRange(url, partText, preferredRange = null) {
  let segments;

  try {
    segments = getPathSegments(normalizeTargetUrl(url));
  } catch {
    return null;
  }

  const targetSegments = String(partText || "")
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (!targetSegments.length) {
    return null;
  }

  if (
    isValidUpdateRange(preferredRange, segments.length) &&
    preferredRange.length === targetSegments.length &&
    targetSegments.every(
      (segment, offset) => segments[preferredRange.startIndex + offset] === segment
    )
  ) {
    return {
      startIndex: preferredRange.startIndex,
      length: preferredRange.length,
    };
  }

  for (let start = 0; start + targetSegments.length <= segments.length; start += 1) {
    const matches = targetSegments.every(
      (segment, offset) => segments[start + offset] === segment
    );

    if (matches) {
      return { startIndex: start, length: targetSegments.length };
    }
  }

  return null;
}

export function sliceUrlByUpdateRange(url, range) {
  const normalizedUrl = normalizeTargetUrl(url);
  const segments = getPathSegments(normalizedUrl);

  if (!isValidUpdateRange(range, segments.length)) {
    return null;
  }

  const prefixSegments = segments.slice(0, range.startIndex);

  return {
    prefixSegments,
    updateSegments: segments.slice(range.startIndex, range.startIndex + range.length),
    suffixSegments: segments.slice(range.startIndex + range.length),
    prefixUrl: createUrlFromSegments(normalizedUrl, prefixSegments),
  };
}

function padNumber(value, length) {
  return String(value).padStart(length, "0");
}

function addDaysToDate(year, month, day, deltaDays) {
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + deltaDays);

  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function addMonths(year, month, delta) {
  const total = year * 12 + (month - 1) + delta;

  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

function bumpVersionSegment(segment) {
  const parts = getVersionParts(segment);

  if (!parts) {
    return null;
  }

  const core = [...parts.core];
  core[core.length - 1] += 1;

  return `${/^v/i.test(segment) ? segment.slice(0, 1) : ""}${core.join(".")}`;
}

function bumpLastNumberInSlug(segment) {
  return segment.replace(/\d+(?!.*\d)/, incrementDecimalString);
}

function incrementDecimalString(value) {
  return (BigInt(value) + 1n).toString().padStart(value.length, "0");
}

function findDateSequenceIndex(segments) {
  for (let index = 0; index < segments.length; index += 1) {
    if (isYearSegment(segments[index]) && isMonthSegment(segments[index + 1] || "")) {
      return index;
    }
  }

  return -1;
}

function incrementUpdateSegments(segments) {
  const next = [...segments];
  const isoIndex = next.findIndex((segment) => /^\d{4}-\d{2}-\d{2}$/.test(segment));

  if (isoIndex >= 0) {
    const [year, month, day] = next[isoIndex].split("-").map(Number);
    const result = addDaysToDate(year, month, day, 1);
    next[isoIndex] = `${padNumber(result.year, 4)}-${padNumber(result.month, 2)}-${padNumber(result.day, 2)}`;

    return next;
  }

  const dateIndex = findDateSequenceIndex(next);

  if (dateIndex >= 0) {
    const year = Number(next[dateIndex]);
    const month = Number(next[dateIndex + 1]);

    if (isDaySegment(next[dateIndex + 2] || "")) {
      const result = addDaysToDate(year, month, Number(next[dateIndex + 2]), 1);
      next[dateIndex] = padNumber(result.year, 4);
      next[dateIndex + 1] = padNumber(result.month, 2);
      next[dateIndex + 2] = padNumber(result.day, 2);
    } else {
      const result = addMonths(year, month, 1);
      next[dateIndex] = padNumber(result.year, 4);
      next[dateIndex + 1] = padNumber(result.month, 2);
    }

    return next;
  }

  for (let index = next.length - 1; index >= 0; index -= 1) {
    const type = classifyLatestUrlSegment(next[index]);

    if (type === "number") {
      next[index] = incrementDecimalString(next[index]);

      return next;
    }

    if (type === "version") {
      const bumped = bumpVersionSegment(next[index]);

      if (bumped) {
        next[index] = bumped;

        return next;
      }
    }

    if (type === "numbered-slug") {
      next[index] = bumpLastNumberInSlug(next[index]);

      return next;
    }
  }

  return null;
}

export function predictNextExampleUrl(url, range) {
  const normalizedUrl = normalizeTargetUrl(url);
  const trailingSlash = new URL(normalizedUrl).pathname.endsWith("/");
  const segments = getPathSegments(normalizedUrl);

  if (!isValidUpdateRange(range, segments.length)) {
    return "";
  }

  const nextUpdate = incrementUpdateSegments(
    segments.slice(range.startIndex, range.startIndex + range.length)
  );

  if (!nextUpdate) {
    return "";
  }

  return createUrlFromSegments(
    normalizedUrl,
    [
      ...segments.slice(0, range.startIndex),
      ...nextUpdate,
      ...segments.slice(range.startIndex + range.length),
    ],
    { trailingSlash }
  );
}

export function matchesUpdateRangeShape(candidateUrl, exampleUrl, range) {
  if (!isHttpUrl(candidateUrl) || !isHttpUrl(exampleUrl)) {
    return false;
  }

  if (normalizeOrigin(candidateUrl) !== normalizeOrigin(exampleUrl)) {
    return false;
  }

  const candidateSegments = getPathSegments(normalizeTargetUrl(candidateUrl));
  const exampleSegments = getPathSegments(normalizeTargetUrl(exampleUrl));

  if (!isValidUpdateRange(range, exampleSegments.length)) {
    return false;
  }

  if (candidateSegments.length !== exampleSegments.length) {
    return false;
  }

  const updateEnd = range.startIndex + range.length;

  for (let index = 0; index < exampleSegments.length; index += 1) {
    const inUpdate = index >= range.startIndex && index < updateEnd;

    if (inUpdate) {
      if (!latestUrlSegmentsMatch(candidateSegments[index], exampleSegments[index])) {
        return false;
      }
    } else if (candidateSegments[index] !== exampleSegments[index]) {
      return false;
    }
  }

  return true;
}

export function chooseLatestUrlCandidateByRange(candidates, exampleUrl, range) {
  if (!isHttpUrl(exampleUrl)) {
    return "";
  }

  const matching = [...new Set(candidates)]
    .map((url) => {
      try {
        return normalizeTargetUrl(url);
      } catch {
        return "";
      }
    })
    .filter(Boolean)
    .filter((url) => matchesUpdateRangeShape(url, exampleUrl, range));

  if (!matching.length) {
    return "";
  }

  const exampleSegments = getPathSegments(normalizeTargetUrl(exampleUrl));
  const exampleUpdate = exampleSegments.slice(range.startIndex, range.startIndex + range.length);
  const scored = matching.map((url, index) => {
    const segments = getPathSegments(url);
    const updateSegments = segments.slice(range.startIndex, range.startIndex + range.length);

    return { url, index, sortValue: getUpdateRangeSortValue(updateSegments, exampleUpdate) };
  });
  const sortable = scored.filter((entry) => entry.sortValue);

  if (!sortable.length) {
    return matching[0];
  }

  sortable.sort((left, right) => {
    const sortResult = compareSortValues(right.sortValue, left.sortValue);

    return sortResult !== 0 ? sortResult : left.index - right.index;
  });

  return sortable[0].url;
}

function getUpdateRangeSortValue(candidateSegments, exampleSegments) {
  const dateTupleSortValue = getDateTupleSortValue(candidateSegments, exampleSegments);

  if (dateTupleSortValue) {
    return dateTupleSortValue;
  }

  let sortValue = null;

  for (let index = 0; index < candidateSegments.length; index += 1) {
    const value = getSortableSegmentValue(candidateSegments[index], exampleSegments[index]);

    if (value) {
      sortValue = value;
    }
  }

  return sortValue;
}

// 候选 URL 的更新段是否严格比当前 URL 更新；纯文字段无法比较时返回 false。
export function isExampleUrlNewerByRange(candidateUrl, currentUrl, range) {
  if (!isHttpUrl(candidateUrl) || !isHttpUrl(currentUrl)) {
    return false;
  }

  if (!matchesUpdateRangeShape(candidateUrl, currentUrl, range)) {
    return false;
  }

  const candidate = normalizeTargetUrl(candidateUrl);
  const current = normalizeTargetUrl(currentUrl);

  if (candidate === current) {
    return false;
  }

  const candidateSegments = getPathSegments(candidate).slice(
    range.startIndex,
    range.startIndex + range.length
  );
  const currentSegments = getPathSegments(current).slice(
    range.startIndex,
    range.startIndex + range.length
  );
  const candidateValue = getUpdateRangeSortValue(candidateSegments, currentSegments);
  const currentValue = getUpdateRangeSortValue(currentSegments, currentSegments);

  if (!candidateValue || !currentValue) {
    return false;
  }

  return compareSortValues(candidateValue, currentValue) > 0;
}
