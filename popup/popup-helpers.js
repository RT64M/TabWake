import { isHttpUrl, normalizeTargetUrl, upsertRule } from "../src/storage.js";
import {
  detectUpdatePartRange,
  getUpdatePartText,
  locateUpdatePartRange,
  matchesUpdateRangeShape,
  predictNextExampleUrl,
} from "../src/latest-url-rules.js";
import { getExtensionApi } from "../src/extension-api.js";
import { getNextAvailableDailyTime as getSmartNextDailyTime } from "./popup-view.js";

export function getRuleTargetUrl(rule) {
  return rule.targetUrl || rule.origin;
}

export function getRuleTitle(rule) {
  const title = typeof rule.title === "string" ? rule.title.trim() : "";

  return title || getRuleTargetUrl(rule);
}

export function createDraftRule({ targetUrl, title }) {
  return upsertRule([], targetUrl, {
    title,
    strategies: {
      dailyStartup: true,
    },
  })[0];
}

export function captureStableFocusTarget() {
  const active = document.activeElement;

  if (!active || active === document.body) {
    return null;
  }

  const targetUrl =
    active.dataset?.targetUrl ||
    active.closest?.("[data-target-url]")?.dataset?.targetUrl ||
    "";
  const logicType =
    active.dataset?.logicType ||
    active.closest?.("[data-logic-type]")?.dataset?.logicType ||
    "";
  const focusKey = active.dataset?.focusKey || "";
  const action =
    active.dataset?.action ||
    active.closest?.("[data-action]")?.dataset?.action ||
    "";

  return {
    selector: [
      active.classList?.[0] ? `.${active.classList[0]}` : active.tagName.toLowerCase(),
      targetUrl ? `[data-target-url="${CSS.escape(targetUrl)}"]` : "",
      logicType ? `[data-logic-type="${CSS.escape(logicType)}"]` : "",
      focusKey ? `[data-focus-key="${CSS.escape(focusKey)}"]` : "",
      action ? `[data-action="${CSS.escape(action)}"]` : "",
    ].join(""),
    fallbackClass: active.classList?.[0] || "",
  };
}

export function createLatestContentDraftForRule(rule) {
  const ruleTargetUrl = getRuleTargetUrl(rule);
  const completeUrl = rule.latestExampleUrl || ruleTargetUrl;
  const range = rule.updatePartRange || detectUpdatePartRange(completeUrl);

  return {
    targetUrl: ruleTargetUrl,
    completeUrl,
    updatePartText: range ? getUpdatePartText(completeUrl, range) : "",
    updatePartRange: range,
    expectedNext: rule.expectedNextExampleUrl || "",
    errorKey: "",
  };
}

// 纯本地校验：在完整 URL 中定位更新段、本地推算下一个，必要时要求手填预期下一个。
// 配置阶段不发起任何网络请求。
export function validateLatestContentDraft(draft) {
  const completeRaw = String(draft?.completeUrl || "").trim();
  const updatePartText = String(draft?.updatePartText || "").trim();
  const expectedRaw = String(draft?.expectedNext || "").trim();

  if (!completeRaw || !isHttpUrl(completeRaw)) {
    return { ok: false, errorKey: "invalidLatestConfigUrl" };
  }

  if (!updatePartText) {
    return { ok: false, errorKey: "latestUpdatePartRequired" };
  }

  const completeUrl = normalizeTargetUrl(completeRaw);
  const updatePartRange = locateUpdatePartRange(
    completeUrl,
    updatePartText,
    draft?.updatePartRange
  );

  if (!updatePartRange) {
    return { ok: false, errorKey: "latestUpdatePartNotFound" };
  }

  const predictedNext = predictNextExampleUrl(completeUrl, updatePartRange);
  let expectedNextExampleUrl = "";

  if (expectedRaw) {
    if (!isHttpUrl(expectedRaw)) {
      return { ok: false, errorKey: "invalidLatestConfigUrl" };
    }

    const normalizedExpected = normalizeTargetUrl(expectedRaw);

    if (!matchesUpdateRangeShape(normalizedExpected, completeUrl, updatePartRange)) {
      return { ok: false, errorKey: "latestExpectedNextMismatch" };
    }

    expectedNextExampleUrl = normalizedExpected;
  } else if (!predictedNext) {
    return { ok: false, errorKey: "latestExpectedNextRequired" };
  }

  return {
    ok: true,
    latestExampleUrl: completeUrl,
    updatePartRange,
    expectedNextExampleUrl,
  };
}

export function getHostPermissionOrigin(targetUrl) {
  try {
    const url = new URL(normalizeTargetUrl(targetUrl));

    return `${url.origin}/*`;
  } catch {
    return "";
  }
}

export function requestLatestContentPermission(targetUrl) {
  const origin = getHostPermissionOrigin(targetUrl);
  const permissionsApi = getExtensionApi().permissions;

  if (!origin || !permissionsApi?.request) {
    return Promise.resolve(true);
  }

  return permissionsApi.request({ origins: [origin] });
}

export function getCurrentTab() {
  return getExtensionApi().tabs.query({ active: true, currentWindow: true }).then((tabs) => tabs[0]);
}

export function getPatchForRemovedStartupLogic(type) {
  const patches = {
    browserProcessStartup: { browserProcessStartup: false },
    browserWindowStartup: { browserWindowStartup: false },
    dailyStartup: { dailyStartup: false },
    dailyTimes: { dailyTimes: [] },
    intervalMinutes: { intervalMinutes: null },
    countdownRunAt: { countdownRunAt: "" },
    returnFromIdle: { returnFromIdleMinutes: null },
  };

  return patches[type];
}

export function getPatchForAddedStartupLogic(rule, type) {
  const oneHourFromNow = new Date(Date.now() + 60 * 60000).toISOString();
  const patches = {
    browserProcessStartup: {
      browserProcessStartup: true,
      browserWindowStartup: false,
    },
    browserWindowStartup: {
      browserWindowStartup: true,
      browserProcessStartup: false,
    },
    dailyStartup: { dailyStartup: true },
    dailyTimes: {
      dailyTimes: [getSmartNextDailyTime(rule.strategies.dailyTimes)],
    },
    intervalMinutes: { intervalMinutes: 60 },
    countdownRunAt: { countdownRunAt: oneHourFromNow },
    returnFromIdle: { returnFromIdleMinutes: 360 },
  };

  return patches[type];
}

export function createInlineConfirmation({
  messageText,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  focusTarget = "",
}) {
  const panel = document.createElement("section");
  panel.className = "inline-confirmation";

  const text = document.createElement("p");
  text.className = "inline-confirmation-message";
  text.textContent = messageText;

  const actions = document.createElement("div");
  actions.className = "inline-confirmation-actions";

  const confirmButton = document.createElement("button");
  confirmButton.className = "secondary-button danger-outline-button";
  confirmButton.type = "button";
  if (focusTarget) {
    confirmButton.dataset.focusTarget = focusTarget;
  }
  confirmButton.textContent = confirmLabel;
  confirmButton.addEventListener("click", onConfirm);

  const cancelButton = document.createElement("button");
  cancelButton.className = "secondary-button";
  cancelButton.type = "button";
  cancelButton.textContent = cancelLabel;
  cancelButton.addEventListener("click", onCancel);

  actions.append(confirmButton, cancelButton);
  panel.append(text, actions);

  return panel;
}
