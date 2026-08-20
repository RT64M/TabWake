import {
  getLocalDateKey,
  markRuleDailyStartupHandledOnActivation,
  upsertRule,
} from "../../src/storage.js";
import { formatRuleUrlForDisplay } from "../popup-view.js";
import { getRuleTargetUrl } from "../popup-helpers.js";

export function createHomeRenderer({
  applyMessages,
  getCurrentPage,
  getPopupFocusTarget,
  getRules,
  message,
  openDetail,
  persistRules,
  render,
  ruleRowTemplate,
  rulesToolbar,
  setCurrentPage,
  setPendingFocusTarget,
  setRuleFilter,
  setRuleSort,
}) {
  function createRuleRow(row) {
    const item = ruleRowTemplate.content.firstElementChild.cloneNode(true);
    applyMessages(item);

    const rowBodyButton = item.querySelector(".rule-body");
    const statusDot = item.querySelector(".rule-status-dot");
    const stateSwitchButton = item.querySelector(".rule-state-switch");
    const configureButton = item.querySelector(".row-action");

    item.querySelector(".rule-title").textContent = row.title;
    const ruleUrl = item.querySelector(".rule-url");
    ruleUrl.textContent = formatRuleUrlForDisplay(row.targetUrl);
    ruleUrl.title = row.targetUrl;
    item.querySelector(".rule-summary").textContent = row.summary;
    const nextStartupNode = item.querySelector(".rule-next-startup");
    nextStartupNode.textContent = row.nextStartup?.text || "";
    nextStartupNode.hidden = !row.nextStartup;
    item.dataset.state = row.state;
    item.dataset.tone = row.visualTone;
    item.dataset.summaryTone = row.summaryTone || "normal";
    statusDot.setAttribute("role", "img");
    statusDot.setAttribute("aria-label", row.stateLabel || row.summary);
    rowBodyButton.dataset.targetUrl = row.targetUrl;
    rowBodyButton.dataset.origin = row.targetUrl;
    rowBodyButton.setAttribute(
      "aria-label",
      message("configureRuleSummary", {
        title: row.title,
        summary: [row.targetUrl, row.summary, row.nextStartup?.text]
          .filter(Boolean)
          .join(" · "),
      })
    );
    if (row.togglePresentation === "switch") {
      stateSwitchButton.dataset.targetUrl = row.targetUrl;
      stateSwitchButton.dataset.origin = row.targetUrl;
      stateSwitchButton.dataset.action = row.toggleAction;
      stateSwitchButton.dataset.focusKey = "state-switch";
      if (row.toggleDisabled) {
        stateSwitchButton.disabled = true;
      }
      stateSwitchButton.setAttribute("role", "switch");
      stateSwitchButton.setAttribute("aria-checked", String(row.state !== "paused"));
      stateSwitchButton.setAttribute(
        "aria-label",
        message("toggleRuleFor", {
          action: row.toggleLabel,
          origin: row.targetUrl,
        })
      );
    } else {
      stateSwitchButton.remove();
    }
    configureButton.textContent =
      row.togglePresentation === "switch" ? row.configureLabel : row.toggleLabel;
    configureButton.dataset.action = row.toggleAction;
    configureButton.setAttribute(
      "aria-label",
      message("configureRuleFor", { origin: row.targetUrl })
    );
    const toggleRuleState = () => {
      const currentRules = getRules();
      const currentRule = currentRules.find(
        (rule) => getRuleTargetUrl(rule) === row.targetUrl
      );

      if (currentRule?.enabled !== false) {
        persistRules(
          upsertRule(currentRules, row.targetUrl, {
            enabled: false,
          })
        );
        return;
      }

      persistRules(
        currentRules.map((rule) =>
          getRuleTargetUrl(rule) === row.targetUrl
            ? markRuleDailyStartupHandledOnActivation(rule, getLocalDateKey())
            : rule
        )
      );
    };
    rowBodyButton.addEventListener("click", () => {
      openDetail(row.targetUrl);
    });
    if (row.togglePresentation === "switch") {
      stateSwitchButton.addEventListener("click", (event) => {
        event.stopPropagation();
        toggleRuleState();
      });
    }
    configureButton.addEventListener("click", (event) => {
      event.stopPropagation();
      openDetail(row.targetUrl);
    });

    return item;
  }

  function createSelectControl(controlState, onChange, focusControl = "") {
    const label = document.createElement("label");
    label.className = "rules-toolbar-field";

    const text = document.createElement("span");
    text.textContent = controlState.label;

    const select = document.createElement("select");
    select.value = controlState.value;
    if (focusControl) {
      select.dataset.focusControl = focusControl;
    }
    for (const option of controlState.options) {
      const optionNode = document.createElement("option");
      optionNode.value = option.value;
      optionNode.textContent = option.label;
      optionNode.selected = option.selected;
      select.append(optionNode);
    }
    select.addEventListener("change", () => onChange(select.value));

    label.append(text, select);
    return label;
  }

  function renderRulesToolbar(state) {
    rulesToolbar.replaceChildren();
    rulesToolbar.hidden = state.view !== "home" || !state.rulesToolbar;

    if (rulesToolbar.hidden) {
      return;
    }

    rulesToolbar.append(
      createSelectControl(
        state.rulesToolbar.filter,
        (value) => {
          setRuleFilter(value);
          setCurrentPage(1);
          setPendingFocusTarget(
            getPopupFocusTarget({
              view: "home",
              replacementControl: "filter",
            })
          );
          render();
        },
        "filter"
      ),
      createSelectControl(
        state.rulesToolbar.sort,
        (value) => {
          setRuleSort(value);
          setCurrentPage(1);
          setPendingFocusTarget(
            getPopupFocusTarget({
              view: "home",
              replacementControl: "sort",
            })
          );
          render();
        },
        "sort"
      )
    );
  }

  function createPaginationControls(pagination) {
    const controls = document.createElement("div");
    controls.className = "pagination-controls";
    controls.hidden = pagination.totalPages <= 1;

    const previous = document.createElement("button");
    previous.className = "pagination-button";
    previous.type = "button";
    previous.dataset.paginationAction = "previous";
    previous.textContent = pagination.previousLabel;
    previous.disabled = !pagination.hasPrevious;
    previous.addEventListener("click", () => {
      setCurrentPage(Math.max(1, getCurrentPage() - 1));
      setPendingFocusTarget(
        getPopupFocusTarget({
          view: "home",
          replacementControl: "previous-page",
        })
      );
      render();
    });

    const status = document.createElement("span");
    status.className = "pagination-status";
    status.textContent = pagination.status;

    const next = document.createElement("button");
    next.className = "pagination-button";
    next.type = "button";
    next.dataset.paginationAction = "next";
    next.textContent = pagination.nextLabel;
    next.disabled = !pagination.hasNext;
    next.addEventListener("click", () => {
      setCurrentPage(Math.min(pagination.totalPages, getCurrentPage() + 1));
      setPendingFocusTarget(
        getPopupFocusTarget({
          view: "home",
          replacementControl: "next-page",
        })
      );
      render();
    });

    controls.append(previous, status, next);
    return controls;
  }

  return {
    createPaginationControls,
    createRuleRow,
    renderRulesToolbar,
  };
}
