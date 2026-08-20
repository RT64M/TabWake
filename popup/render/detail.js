import { getUpdatePartText, locateUpdatePartRange } from "../../src/latest-url-rules.js";
import { isHttpUrl, normalizeTargetUrl } from "../../src/storage.js";
import {
  createFieldValidationState,
  getNextAvailableDailyTime as getSmartNextDailyTime,
  STARTUP_LOGIC_TYPES,
} from "../popup-view.js";
import {
  getPatchForAddedStartupLogic,
  getPatchForRemovedStartupLogic,
  getRuleTargetUrl,
} from "../popup-helpers.js";

export function createDetailRenderer({
  applyMessages,
  blockLatestConfigNavigationIfNeeded,
  cancelPendingInlineConfirmation,
  clearLatestDraftForTarget,
  confirmLatestContentConfig,
  createHelpTrigger,
  createInlineConfirmation,
  createLabelWithHelp,
  createTimeRow,
  ensureLatestContentDraft,
  isDraftRuleTarget,
  isRuleRemovalPending,
  logicCardTemplate,
  message,
  nextFieldControlId,
  onConfirmRuleRemoval,
  onRequestRuleRemoval,
  renameRuleInState,
  render,
  ruleDetailTemplate,
  runRuleNow,
  saveLatestDailyTimesPatch,
  saveRulePatch,
  setPendingFocusTarget,
  showStatus,
  startLatestContentDraft,
}) {
  function createRuleInfoFields(rule, state) {
    const wrapper = document.createElement("div");
    wrapper.className = "rule-fields-grid";
    const ruleTargetUrl = getRuleTargetUrl(rule);

    const titleField = document.createElement("label");
    titleField.className = "field-block";
    const titleLabel = document.createElement("span");
    titleLabel.textContent = state.ruleFields.title.label;
    const titleInput = document.createElement("input");
    titleInput.className = "rule-title-input";
    titleInput.type = "text";
    titleInput.spellcheck = false;
    titleInput.placeholder = state.ruleFields.title.placeholder;
    titleInput.value = state.ruleFields.title.value;
    titleInput.dataset.targetUrl = ruleTargetUrl;
    titleInput.dataset.focusKey = "title";
    const titleError = document.createElement("span");
    titleError.className = "field-error";
    titleInput.addEventListener("change", () => {
      titleInput.classList.remove("invalid");
      titleError.textContent = "";
      saveRulePatch(ruleTargetUrl, {
        title: titleInput.value,
      });
    });
    titleField.append(titleLabel, titleInput, titleError);

    const urlField = document.createElement("label");
    urlField.className = "field-block";
    const urlLabel = document.createElement("span");
    urlLabel.textContent = state.ruleFields.targetUrl.label;
    const urlInput = document.createElement("input");
    urlInput.className = "rule-url-input";
    urlInput.type = "url";
    urlInput.spellcheck = false;
    urlInput.placeholder = state.ruleFields.targetUrl.placeholder;
    urlInput.value = state.ruleFields.targetUrl.value;
    urlInput.title = urlInput.value;
    urlInput.dataset.targetUrl = ruleTargetUrl;
    urlInput.dataset.focusKey = "target-url";
    const urlError = document.createElement("span");
    urlError.className = "field-error";
    urlInput.addEventListener("input", () => {
      urlInput.title = urlInput.value;
    });
    urlInput.addEventListener("change", () => {
      const rawValue = urlInput.value.trim();

      if (!isHttpUrl(rawValue)) {
        urlInput.classList.add("invalid");
        urlError.textContent = message("invalidTargetUrl");
        showStatus("invalidTargetUrl", { error: true });
        return;
      }

      try {
        const normalizedValue = normalizeTargetUrl(rawValue);
        if (normalizedValue === ruleTargetUrl) {
          urlInput.classList.remove("invalid");
          urlInput.value = normalizedValue;
          urlInput.title = normalizedValue;
          urlError.textContent = "";
          return;
        }

        urlInput.classList.remove("invalid");
        urlError.textContent = "";
        renameRuleInState(ruleTargetUrl, normalizedValue);
      } catch (error) {
        urlInput.classList.add("invalid");
        const errorKey = /already exists/i.test(error?.message || "")
          ? "duplicateTargetUrl"
          : "invalidTargetUrl";
        urlError.textContent = message(errorKey);
        showStatus(errorKey, { error: true });
      }
    });
    urlField.append(urlLabel, urlInput, urlError);

    const titleRow = document.createElement("div");
    titleRow.className = "rule-title-row";

    const titleSlot = document.createElement("div");
    titleSlot.className = "rule-title-slot";
    titleSlot.append(titleField);

    const scopeSlot = document.createElement("div");
    scopeSlot.className = "rule-scope-slot";

    titleRow.append(titleSlot, scopeSlot);

    if (state.ruleFields.focusScope) {
      const scopeField = document.createElement("div");
      scopeField.className = "focus-scope-field rule-focus-scope-field";

      const scopeLabel = createLabelWithHelp(
        state.ruleFields.focusScope.label,
        state.ruleFields.focusScope.help,
        "focus-scope-label field-label-row"
      );

      const scopeOptions = document.createElement("div");
      scopeOptions.className = "focus-scope-options";

      for (const option of state.ruleFields.focusScope.options) {
        const button = document.createElement("button");
        button.className = "focus-scope-button";
        button.type = "button";
        button.dataset.targetUrl = ruleTargetUrl;
        button.dataset.focusKey = `rule-focus-scope:${option.value}`;
        button.textContent = option.shortLabel || option.label;
        button.title = option.title || option.label;
        button.setAttribute("aria-label", option.title || option.label);
        button.setAttribute("aria-pressed", String(option.selected));
        button.addEventListener("click", () => {
          saveRulePatch(ruleTargetUrl, {
            focusScope: option.value,
          });
        });
        scopeOptions.append(button);
      }

      scopeField.append(scopeLabel, scopeOptions);
      scopeSlot.append(scopeField);
    }

    const urlRow = document.createElement("div");
    urlRow.className = "rule-url-row";
    urlRow.append(urlField);

    wrapper.append(titleRow, urlRow);

    return wrapper;
  }

  function removeStartupLogic(rule, type) {
    saveRulePatch(getRuleTargetUrl(rule), {
      strategies: getPatchForRemovedStartupLogic(type),
    });
  }

  function createLogicCard(rule, logic) {
    const card = logicCardTemplate.content.firstElementChild.cloneNode(true);
    applyMessages(card);
    const ruleTargetUrl = getRuleTargetUrl(rule);

    const controls = card.querySelector(".logic-controls");
    const removeLogicButton = card.querySelector(".remove-logic");

    card.dataset.logicType = logic.type;
    card.dataset.span = logic.span || "compact";
    card.querySelector(".logic-label").textContent = logic.label;
    card.querySelector(".logic-summary").textContent = logic.summary;
    removeLogicButton.textContent = "×";
    removeLogicButton.dataset.targetUrl = ruleTargetUrl;
    removeLogicButton.dataset.focusKey = "remove-logic";
    removeLogicButton.setAttribute(
      "aria-label",
      message("removeStartupLogicFor", { name: logic.label })
    );
    removeLogicButton.setAttribute(
      "title",
      message("removeStartupLogicFor", { name: logic.label })
    );
    removeLogicButton.addEventListener("click", () => {
      removeStartupLogic(rule, logic.type);
    });

    if (logic.help) {
      card.querySelector(".logic-label-row").append(createHelpTrigger(logic.help));
    }

    if (logic.focusScope) {
      const scopeField = document.createElement("div");
      scopeField.className = "focus-scope-field";

      const scopeLabel = createLabelWithHelp(
        logic.focusScope.label,
        logic.focusScope.help,
        "focus-scope-label field-label-row"
      );

      const scopeOptions = document.createElement("div");
      scopeOptions.className = "focus-scope-options";

      for (const option of logic.focusScope.options) {
        const button = document.createElement("button");
        button.className = "focus-scope-button";
        button.type = "button";
        button.dataset.targetUrl = ruleTargetUrl;
        button.dataset.logicType = logic.type;
        button.dataset.focusKey = `logic-focus-scope:${option.value}`;
        button.textContent = option.shortLabel || option.label;
        button.title = option.title || option.label;
        button.setAttribute("aria-label", option.title || option.label);
        button.setAttribute("aria-pressed", String(option.selected));
        button.addEventListener("click", () => {
          saveRulePatch(ruleTargetUrl, {
            strategies: {
              focusScopes: {
                [logic.type]: option.value,
              },
            },
          });
        });
        scopeOptions.append(button);
      }

      scopeField.append(scopeLabel, scopeOptions);
      controls.append(scopeField);
    }

    if (logic.type === "dailyTimes") {
      const field = document.createElement("div");
      field.className = "field-block";

      const heading = document.createElement("div");
      heading.className = "field-heading";

      const hintWrapper = document.createElement("span");
      const hint = document.createElement("span");
      hint.className = "field-hint";
      hint.textContent = message("dailyTimesHint");
      hintWrapper.append(hint);

      const addTimeButton = document.createElement("button");
      addTimeButton.className = "small-button add-time";
      addTimeButton.type = "button";
      addTimeButton.dataset.targetUrl = ruleTargetUrl;
      addTimeButton.dataset.logicType = logic.type;
      addTimeButton.dataset.focusKey = "add-time";
      addTimeButton.textContent = message("addTime");
      addTimeButton.addEventListener("click", () => {
        saveLatestDailyTimesPatch(ruleTargetUrl, rule, (dailyTimes) => [
          ...dailyTimes,
          getSmartNextDailyTime(dailyTimes),
        ]);
      });

      const timeList = document.createElement("div");
      timeList.className = "time-list";
      for (const time of rule.strategies.dailyTimes) {
        timeList.append(createTimeRow(rule, time));
      }

      heading.append(hintWrapper, addTimeButton);
      field.append(heading, timeList);
      controls.append(field);
    }

    if (
      logic.type === "intervalMinutes" ||
      logic.type === "countdownRunAt" ||
      logic.type === "returnFromIdle"
    ) {
      const field = document.createElement("div");
      field.className = "field-block";
      const validationTypes = {
        intervalMinutes: "intervalPeriod",
        countdownRunAt: "countdownPeriod",
        returnFromIdle: "returnFromIdlePeriod",
      };
      const validationType = validationTypes[logic.type];

      const periodControls = document.createElement("div");
      periodControls.className = "interval-period-controls";

      const hoursLabel = document.createElement("label");
      hoursLabel.className = "interval-period-field";
      const hoursText = document.createElement("span");
      hoursText.textContent = logic.period.hoursLabel;
      const hoursInput = document.createElement("input");
      hoursInput.className = "interval-period-input interval-hours-input";
      if (logic.type === "countdownRunAt") {
        hoursInput.classList.add("countdown-hours-input");
      }
      if (logic.type === "returnFromIdle") {
        hoursInput.classList.add("return-from-idle-hours-input");
      }
      hoursInput.type = "text";
      hoursInput.inputMode = "numeric";
      hoursInput.pattern = "[0-9]*";
      hoursInput.min = "0";
      hoursInput.max = "168";
      hoursInput.step = "1";
      hoursInput.placeholder = logic.period.hoursPlaceholder;
      hoursInput.value = logic.period.hours;
      hoursInput.dataset.focusKey = "hours";
      hoursLabel.append(hoursInput, hoursText);

      const minutesLabel = document.createElement("label");
      minutesLabel.className = "interval-period-field";
      const minutesText = document.createElement("span");
      minutesText.textContent = logic.period.minutesLabel;
      const minutesInput = document.createElement("input");
      minutesInput.className = "interval-period-input interval-minutes-input";
      if (logic.type === "countdownRunAt") {
        minutesInput.classList.add("countdown-minutes-input");
      }
      if (logic.type === "returnFromIdle") {
        minutesInput.classList.add("return-from-idle-minutes-input");
      }
      minutesInput.type = "text";
      minutesInput.inputMode = "numeric";
      minutesInput.pattern = "[0-9]*";
      minutesInput.min = "0";
      minutesInput.max = "59";
      minutesInput.step = "1";
      minutesInput.placeholder = logic.period.minutesPlaceholder;
      minutesInput.value = logic.period.minutes;
      minutesInput.dataset.focusKey = "minutes";
      minutesLabel.append(minutesInput, minutesText);

      const error = document.createElement("span");
      error.className = "field-error interval-error";

      const handlePeriodChange = () => {
        const hasValue = hoursInput.value.trim() || minutesInput.value.trim();

        if (!hasValue) {
          hoursInput.classList.remove("invalid");
          minutesInput.classList.remove("invalid");
          error.textContent = "";
          removeStartupLogic(rule, logic.type);
          return;
        }

        const validation = createFieldValidationState({
          type: validationType,
          value: {
            hours: hoursInput.value,
            minutes: minutesInput.value,
          },
          message,
        });

        if (!validation.valid) {
          hoursInput.classList.add("invalid");
          minutesInput.classList.add("invalid");
          error.textContent = validation.errorMessage;
          showStatus(validation.errorKey, { error: true });
          return;
        }

        hoursInput.classList.remove("invalid");
        minutesInput.classList.remove("invalid");
        error.textContent = "";
        const strategyKey =
          logic.type === "returnFromIdle" ? "returnFromIdleMinutes" : logic.type;
        const strategyValue =
          logic.type === "intervalMinutes" || logic.type === "returnFromIdle"
            ? Number(validation.value)
            : new Date(Date.now() + Number(validation.value) * 60000).toISOString();

        saveRulePatch(ruleTargetUrl, {
          strategies: {
            [strategyKey]: strategyValue,
          },
        });
      };

      hoursInput.addEventListener("change", handlePeriodChange);
      minutesInput.addEventListener("change", handlePeriodChange);
      for (const input of [hoursInput, minutesInput]) {
        input.dataset.targetUrl = ruleTargetUrl;
        input.dataset.logicType = logic.type;
        input.addEventListener("wheel", (event) => {
          if (document.activeElement === input) {
            event.preventDefault();
          }
        });
      }

      periodControls.append(hoursLabel, minutesLabel);
      field.append(periodControls, error);
      controls.append(field);
    }

    return card;
  }

  function createRuleDetail(rule, state) {
    const card = ruleDetailTemplate.content.firstElementChild.cloneNode(true);
    applyMessages(card);
    const ruleTargetUrl = getRuleTargetUrl(rule);

    const openTargetList = card.querySelector(".open-target-segmented");
    const latestExampleSlot = card.querySelector(".latest-example-slot");
    const ruleFieldsList = card.querySelector(".rule-fields-list");
    const runNowButton = card.querySelector(".run-now-button");
    const configuredLogicList = card.querySelector(".configured-logic-list");
    const availableLogicList = card.querySelector(".available-logic-list");
    const empty = card.querySelector(".logic-empty");
    const managementRow = card.querySelector(".management-row");
    const removeRuleButton = card.querySelector(".remove-rule");
    ruleFieldsList.append(createRuleInfoFields(rule, state));

    if (state.showLatestContentConfig) {
      latestExampleSlot.append(createLatestContentConfigPanel(rule, state));
    }

    for (const option of state.openTargetOptions) {
      const label = document.createElement("label");
      label.className = `open-target-choice ${option.visualWeight || "secondary"}`;
      label.title = option.title || option.summary;

      const input = document.createElement("input");
      input.type = "radio";
      input.name = `open-target-${ruleTargetUrl}`;
      input.value = option.value;
      input.checked = option.selected;
      input.addEventListener("change", () => {
        if (!input.checked) {
          return;
        }

        if (option.value === "latestContent") {
          startLatestContentDraft(rule);
          return;
        }

        if (option.value === "origin") {
          clearLatestDraftForTarget(ruleTargetUrl);
          saveRulePatch(ruleTargetUrl, {
            openTarget: option.value,
          });
          return;
        }

        if (blockLatestConfigNavigationIfNeeded()) {
          return;
        }

        clearLatestDraftForTarget(ruleTargetUrl);
        saveRulePatch(ruleTargetUrl, {
          openTarget: option.value,
        });
      });

      const title = document.createElement("span");
      title.className = "open-target-label";
      title.textContent = option.shortLabel || option.label;

      label.append(input, title);
      openTargetList.append(label);
    }

    runNowButton.hidden = state.immediateAction.type !== "run-now";
    if (!runNowButton.hidden) {
      runNowButton.textContent = state.immediateAction.label;
      runNowButton.classList.toggle(
        "primary-button",
        state.immediateAction.visualWeight !== "secondary"
      );
      runNowButton.classList.toggle(
        "secondary-button",
        state.immediateAction.visualWeight === "secondary"
      );
      runNowButton.addEventListener("click", async () => {
        runNowButton.disabled = true;
        showStatus("runningNow");

        try {
          const response = await runRuleNow(rule);

          showStatus(response?.ok ? "runNowStarted" : "runNowFailed", {
            error: response?.ok !== true,
          });
        } catch {
          showStatus("runNowFailed", { error: true });
        } finally {
          runNowButton.disabled = false;
        }
      });
    }

    empty.hidden = state.configuredStartupLogics.length > 0;
    for (const logic of state.configuredStartupLogics) {
      configuredLogicList.append(createLogicCard(rule, logic));
    }

    for (const logic of state.availableStartupLogics) {
      if (!STARTUP_LOGIC_TYPES.includes(logic.type)) {
        continue;
      }

      const button = document.createElement("button");
      button.className = "add-logic-button";
      button.type = "button";
      button.dataset.logicType = logic.type;
      button.textContent = logic.label;
      button.addEventListener("click", () => {
        saveRulePatch(ruleTargetUrl, {
          strategies: getPatchForAddedStartupLogic(rule, logic.type),
        });
      });
      availableLogicList.append(button);
    }

    if (managementRow && removeRuleButton) {
      if (isDraftRuleTarget(ruleTargetUrl)) {
        managementRow.hidden = true;
        return card;
      }

      removeRuleButton.textContent = state.managementAction.label;
      removeRuleButton.dataset.focusTarget = "remove-rule-button";
      removeRuleButton.addEventListener("click", () => {
        onRequestRuleRemoval(ruleTargetUrl);
      });

      if (isRuleRemovalPending(ruleTargetUrl)) {
        managementRow.insertAdjacentElement(
          "afterend",
          createInlineConfirmation({
            messageText: state.managementAction.confirmMessage,
            confirmLabel: message("confirmRemoveRuleAction"),
            cancelLabel: message("cancelRemoveRule"),
            onConfirm: () => {
              onConfirmRuleRemoval(ruleTargetUrl);
            },
            onCancel: cancelPendingInlineConfirmation,
            focusTarget: "remove-rule-confirm",
          })
        );
      }
    }

    return card;
  }

  function createLatestContentConfigPanel(rule, state) {
    const config = state.latestContentConfig;
    const ruleTargetUrl = getRuleTargetUrl(rule);
    const panel = document.createElement("section");
    panel.className = "latest-config-panel latest-inline-split";
    panel.dataset.requiresConfirmation = String(config.requiresConfirmation);

    const panelHeader = document.createElement("div");
    panelHeader.className = "latest-config-header";
    const title = document.createElement("span");
    title.className = "latest-config-title";
    title.textContent = config.title.label;

    const actions = document.createElement("div");
    actions.className = "latest-config-actions";
    const confirmButton = document.createElement("button");
    confirmButton.className = "small-button latest-config-confirm";
    confirmButton.type = "button";
    confirmButton.dataset.action = "confirm-latest-config";
    confirmButton.textContent = config.confirmAction.label;
    actions.append(confirmButton);
    panelHeader.append(title, actions);

    const urlPick = document.createElement("div");
    urlPick.className = "latest-url-pick";
    const originPart = document.createElement("span");
    originPart.className = "latest-url-origin";
    originPart.textContent = config.completeUrl.origin;
    urlPick.append(originPart);

    config.segments.forEach((segment, segmentIndex) => {
      const segmentButton = document.createElement("button");
      segmentButton.type = "button";
      segmentButton.className = "latest-url-segment";
      segmentButton.dataset.index = String(segment.index);
      segmentButton.setAttribute("aria-pressed", String(segment.selected));
      segmentButton.textContent = segment.text;
      segmentButton.addEventListener("click", () => {
        const draft = ensureLatestContentDraft(rule);
        const range = { startIndex: segment.index, length: 1 };
        draft.updatePartRange = range;
        draft.updatePartText = getUpdatePartText(draft.completeUrl, range);
        draft.errorKey = "";
        setPendingFocusTarget({ type: "latest-update-part-input" });
        render();
      });
      urlPick.append(segmentButton);

      const isLastSegment = segmentIndex === config.segments.length - 1;

      if (!isLastSegment || config.completeUrl.hasTrailingSlash) {
        const separator = document.createElement("span");
        separator.className = "latest-url-sep";
        separator.textContent = "/";
        urlPick.append(separator);
      }
    });

    const pickHint = document.createElement("p");
    pickHint.className = "latest-url-pick-hint";
    pickHint.textContent = config.completeUrl.pickHint;

    const updatePartField = document.createElement("div");
    updatePartField.className = "field-block latest-update-part-field";
    const updatePartInputId = nextFieldControlId("latest-update-part");
    const updatePartLabel = createLabelWithHelp(
      config.updatePart.label,
      config.updatePart.help,
      "field-label-row",
      updatePartInputId
    );
    const updatePartInput = document.createElement("input");
    updatePartInput.id = updatePartInputId;
    updatePartInput.className = "latest-config-input latest-update-part-input";
    updatePartInput.type = "text";
    updatePartInput.required = true;
    updatePartInput.spellcheck = false;
    updatePartInput.placeholder = config.updatePart.placeholder;
    updatePartInput.value = config.updatePart.value;
    updatePartInput.dataset.targetUrl = ruleTargetUrl;
    updatePartInput.dataset.logicType = "latestContent";
    updatePartInput.dataset.focusKey = "update-part";
    updatePartInput.addEventListener("input", () => {
      const draft = ensureLatestContentDraft(rule);
      draft.updatePartText = updatePartInput.value;
      draft.errorKey = "";
    });
    updatePartInput.addEventListener("change", () => {
      const draft = ensureLatestContentDraft(rule);
      draft.updatePartText = updatePartInput.value;
      draft.updatePartRange = locateUpdatePartRange(
        draft.completeUrl,
        updatePartInput.value,
        draft.updatePartRange
      );
      draft.errorKey = "";
      setPendingFocusTarget({ type: "latest-update-part-input" });
      render();
    });
    updatePartField.append(updatePartLabel, updatePartInput);

    const predicted = document.createElement("p");
    predicted.className = "latest-predicted";
    predicted.hidden = !config.prediction.hasPrediction;
    if (config.prediction.hasPrediction) {
      predicted.textContent = config.prediction.label;
    }

    const expectedField = document.createElement("label");
    expectedField.className = "field-block latest-expected-next-field";
    expectedField.dataset.required = String(config.expectedNext.required);
    const expectedLabel = document.createElement("span");
    expectedLabel.className = "field-label";
    expectedLabel.textContent = config.expectedNext.label;
    const expectedInput = document.createElement("input");
    expectedInput.className = "latest-config-input latest-expected-next-input";
    expectedInput.type = "url";
    expectedInput.spellcheck = false;
    expectedInput.placeholder = config.expectedNext.placeholder;
    expectedInput.value = config.expectedNext.value;
    expectedInput.dataset.targetUrl = ruleTargetUrl;
    expectedInput.dataset.logicType = "latestContent";
    expectedInput.dataset.focusKey = "expected-next";
    expectedInput.addEventListener("input", () => {
      const draft = ensureLatestContentDraft(rule);
      draft.expectedNext = expectedInput.value;
      draft.errorKey = "";
      if (config.expectedNext.required) {
        const required = !expectedInput.value.trim();
        error.textContent = required ? message("latestExpectedNextRequired") : "";
        expectedInput.classList.toggle("invalid", required);
      }
    });
    expectedField.append(expectedLabel, expectedInput);

    const error = document.createElement("span");
    error.className = "field-error latest-config-error";
    error.textContent = config.errorMessage || "";
    if (config.errorTarget === "update-part") {
      updatePartInput.classList.add("invalid");
    }
    if (config.errorTarget === "expected-next") {
      expectedInput.classList.add("invalid");
    }

    confirmButton.addEventListener("click", () => {
      const draft = ensureLatestContentDraft(rule);
      draft.updatePartText = updatePartInput.value;
      draft.updatePartRange = locateUpdatePartRange(
        draft.completeUrl,
        updatePartInput.value,
        draft.updatePartRange
      );
      draft.expectedNext = expectedInput.value;
      confirmLatestContentConfig(rule);
    });

    panel.append(
      panelHeader,
      urlPick,
      pickHint,
      updatePartField,
      predicted,
      expectedField,
      error
    );

    return panel;
  }

  return { createRuleDetail };
}
