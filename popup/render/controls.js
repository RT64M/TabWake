export function createPopupControls({
  applyMessages,
  createDailyTimeRowState,
  createFieldValidationState,
  getLatestRuleForTarget,
  getRuleTargetUrl,
  message,
  saveLatestDailyTimesPatch,
  showStatus,
  timeTemplate,
}) {
  let activeHelpTrigger = null;
  let helpPopover = null;
  let fieldControlIdSeed = 0;

  function ensureHelpPopover() {
    if (helpPopover) {
      return helpPopover;
    }

    helpPopover = document.createElement("div");
    helpPopover.className = "help-popover";
    helpPopover.id = "help-popover";
    helpPopover.setAttribute("role", "tooltip");
    helpPopover.hidden = true;
    document.body.append(helpPopover);

    return helpPopover;
  }

  function closeHelpPopover() {
    if (!helpPopover) {
      return;
    }

    helpPopover.hidden = true;
    helpPopover.textContent = "";
    activeHelpTrigger?.setAttribute("aria-expanded", "false");
    activeHelpTrigger = null;
  }

  function openHelpPopover(trigger, helpText) {
    const popover = ensureHelpPopover();
    const triggerRect = trigger.getBoundingClientRect();
    const bodyRect = document.body.getBoundingClientRect();
    const maxLeft = Math.max(8, bodyRect.width - 300);

    activeHelpTrigger?.setAttribute("aria-expanded", "false");
    activeHelpTrigger = trigger;
    popover.textContent = helpText;
    popover.hidden = false;
    popover.style.left = `${Math.min(
      Math.max(8, triggerRect.left - bodyRect.left - 10),
      maxLeft
    )}px`;
    popover.style.top = `${triggerRect.bottom - bodyRect.top + 8}px`;
    trigger.setAttribute("aria-expanded", "true");
  }

  function toggleHelpPopover(trigger, helpText) {
    if (activeHelpTrigger === trigger && helpPopover && !helpPopover.hidden) {
      closeHelpPopover();
      return;
    }

    openHelpPopover(trigger, helpText);
  }

  function createHelpTrigger(helpText) {
    const button = document.createElement("button");
    button.className = "help-trigger";
    button.type = "button";
    button.textContent = "?";
    button.title = helpText;
    button.setAttribute("aria-label", helpText);
    button.setAttribute("aria-expanded", "false");
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleHelpPopover(button, helpText);
    });
    button.addEventListener("blur", () => {
      window.setTimeout(() => {
        if (document.activeElement !== button) {
          closeHelpPopover();
        }
      }, 0);
    });
    button.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeHelpPopover();
        button.blur();
        return;
      }

      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggleHelpPopover(button, helpText);
      }
    });
    return button;
  }

  // Interactive help buttons cannot live inside a label without stealing the
  // input's implicit accessible name, so labelled controls use an explicit for.
  function createLabelWithHelp(
    labelText,
    helpText,
    className = "field-label-row",
    controlId = ""
  ) {
    const row = document.createElement("span");
    row.className = className;

    const label = document.createElement(controlId ? "label" : "span");
    if (controlId) {
      label.htmlFor = controlId;
    }
    label.textContent = labelText;
    row.append(label);

    if (helpText) {
      row.append(createHelpTrigger(helpText));
    }

    return row;
  }

  function nextFieldControlId(prefix) {
    fieldControlIdSeed += 1;

    return `${prefix}-${fieldControlIdSeed}`;
  }

  function createTimeRow(rule, time) {
    const row = timeTemplate.content.firstElementChild.cloneNode(true);
    applyMessages(row);
    const ruleTargetUrl = getRuleTargetUrl(rule);
    const dailyTimeRowState = createDailyTimeRowState(time);

    const input = row.querySelector(".time-input");
    const removeButton = row.querySelector(".remove-time");
    const errorNode = row.querySelector(".field-error");

    input.value = time;
    input.dataset.targetUrl = ruleTargetUrl;
    input.dataset.logicType = "dailyTimes";
    input.dataset.focusKey = `daily-time:${time}`;
    input.setAttribute("aria-label", message("dailyTimeInput", { time }));
    errorNode.id = `daily-time-error-${encodeURIComponent(ruleTargetUrl)}-${time.replace(
      ":",
      "-"
    )}`;
    input.setAttribute("aria-describedby", errorNode.id);
    input.addEventListener("change", () => {
      const latestRule = getLatestRuleForTarget(ruleTargetUrl, rule);
      const latestDailyTimes = latestRule.strategies?.dailyTimes || [];
      const validation = createFieldValidationState({
        type: "dailyTime",
        value: input.value,
        previousValue: dailyTimeRowState.value,
        existingValues: latestDailyTimes,
        message,
      });

      if (!validation.valid) {
        input.classList.add("invalid");
        errorNode.textContent = validation.errorMessage;
        showStatus(validation.errorKey, { error: true });
        return;
      }

      input.classList.remove("invalid");
      errorNode.textContent = "";
      const previousTime = dailyTimeRowState.replace(validation.value);
      input.dataset.focusKey = `daily-time:${validation.value}`;
      input.setAttribute(
        "aria-label",
        message("dailyTimeInput", { time: validation.value })
      );
      saveLatestDailyTimesPatch(ruleTargetUrl, rule, (dailyTimes) =>
        dailyTimes.map((item) =>
          item === previousTime ? validation.value : item
        )
      );
    });

    removeButton.addEventListener("click", () => {
      const timeToRemove = dailyTimeRowState.value;
      saveLatestDailyTimesPatch(ruleTargetUrl, rule, (dailyTimes) =>
        dailyTimes.filter((item) => item !== timeToRemove)
      );
    });

    return row;
  }

  return {
    closeHelpPopover,
    createHelpTrigger,
    createLabelWithHelp,
    createTimeRow,
    nextFieldControlId,
  };
}
