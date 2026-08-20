import {
  detectUpdatePartRange,
  getUpdatePartText,
  predictNextExampleUrl,
} from "../../src/latest-url-rules.js";
import { OPEN_TARGET_TYPES, getRuleTargetUrl } from "./shared.js";

function getLatestContentDraftForRule(rule, latestContentDraft = null) {
  if (!latestContentDraft) {
    return null;
  }

  return latestContentDraft.targetUrl === getRuleTargetUrl(rule)
    ? latestContentDraft
    : null;
}

export function createOpenTargetOptions(rule, message, { selectedOpenTarget } = {}) {
  const currentTarget = OPEN_TARGET_TYPES.includes(selectedOpenTarget)
    ? selectedOpenTarget
    : OPEN_TARGET_TYPES.includes(rule.openTarget)
    ? rule.openTarget
    : "origin";
  const labels = {
    origin: "openTargetOrigin",
    latestContent: "openTargetLatestContent",
  };
  const summaries = {
    origin: "openTargetOriginSummary",
    latestContent: "openTargetLatestContentSummary",
  };
  const shortLabels = {
    origin: "openTargetOriginShort",
    latestContent: "openTargetLatestContentShort",
  };
  const visualWeights = {
    origin: "primary",
    latestContent: "secondary",
  };

  return OPEN_TARGET_TYPES.map((value) => ({
    value,
    label: message(labels[value]),
    shortLabel: message(shortLabels[value]),
    summary: message(summaries[value]),
    title: message(summaries[value]),
    visualWeight: visualWeights[value],
    selected: value === currentTarget,
  }));
}

function buildUpdatePartSegments(completeUrl, range) {
  let origin = "";
  let pathSegments = [];
  // 尾斜杠对自动追踪是有意义的差异，选段视图必须照实反映而不是一律补一个 /。
  let hasTrailingSlash = false;

  try {
    const url = new URL(completeUrl);
    origin = `${url.origin}/`;
    pathSegments = url.pathname.split("/").filter(Boolean);
    hasTrailingSlash = pathSegments.length > 0 && url.pathname.endsWith("/");
  } catch {
    return { origin: "", segments: [], hasTrailingSlash: false };
  }

  const start = range?.startIndex ?? -1;
  const end = range ? range.startIndex + range.length : -1;

  return {
    origin,
    hasTrailingSlash,
    segments: pathSegments.map((text, index) => ({
      text,
      index,
      selected: Boolean(range) && index >= start && index < end,
    })),
  };
}

function createLatestContentConfigState(
  rule,
  message,
  { latestContentDraft = null } = {}
) {
  const draft = getLatestContentDraftForRule(rule, latestContentDraft);
  const completeUrl =
    draft?.completeUrl || rule.latestExampleUrl || getRuleTargetUrl(rule);
  const range =
    draft?.updatePartRange ?? rule.updatePartRange ?? detectUpdatePartRange(completeUrl);
  const updatePartValue = draft
    ? draft.updatePartText ?? ""
    : range
    ? getUpdatePartText(completeUrl, range)
    : "";
  const expectedNextValue = draft
    ? draft.expectedNext ?? ""
    : rule.expectedNextExampleUrl || "";
  const predictedUrl = range ? predictNextExampleUrl(completeUrl, range) : "";
  const { origin, segments, hasTrailingSlash } = buildUpdatePartSegments(
    completeUrl,
    range
  );
  const requiresConfirmation =
    Boolean(draft) ||
    (rule.openTarget === "latestContent" &&
      (!rule.latestExampleUrl || !rule.updatePartRange));
  const immediateErrorKey =
    draft?.errorKey ||
    (Boolean(range) && !predictedUrl && !String(expectedNextValue).trim()
      ? "latestExpectedNextRequired"
      : "");

  return {
    title: { label: message("latestUpdatePartTitle") },
    completeUrl: {
      value: completeUrl,
      origin,
      hasTrailingSlash,
      pickHint: message("latestUrlPickHint"),
    },
    segments,
    updatePart: {
      label: message("latestUpdatePartLabel"),
      help: message("latestUpdatePartHelp"),
      value: updatePartValue,
      placeholder: message("latestUpdatePartPlaceholder"),
    },
    prediction: {
      hasPrediction: Boolean(predictedUrl),
      url: predictedUrl,
      label: predictedUrl ? message("latestPredictedNext", { url: predictedUrl }) : "",
    },
    expectedNext: {
      label: message("latestExpectedNextLabel"),
      placeholder: message("latestExpectedNextPlaceholder"),
      value: expectedNextValue,
      required: Boolean(range) && !predictedUrl,
    },
    confirmAction: {
      type: "confirm-latest-config",
      label: message("latestConfigConfirm"),
    },
    requiresConfirmation,
    blocksNavigation: false,
    errorMessage: immediateErrorKey ? message(immediateErrorKey) : "",
    errorTarget: getLatestContentErrorTarget(immediateErrorKey),
  };
}

function getLatestContentErrorTarget(errorKey) {
  if (
    errorKey === "latestExpectedNextRequired" ||
    errorKey === "latestExpectedNextMismatch"
  ) {
    return "expected-next";
  }

  if (errorKey === "latestPermissionRequired") {
    return "";
  }

  return errorKey ? "update-part" : "";
}

export { createLatestContentConfigState, getLatestContentDraftForRule };
