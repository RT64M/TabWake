import {
  STARTUP_LOGIC_TYPES,
  addFocusScopeIfNeeded,
  formatDurationLabel,
  formatLocalTime,
  getStartupLogicLabel,
  hasStartupLogic,
  splitCountdownPeriod,
  splitIntervalPeriod,
} from "./shared.js";

export function createStartupLogicState(
  rule,
  message,
  now = new Date(),
  { focusScopeMode = "rule" } = {}
) {
  const strategies = rule.strategies || {};
  const configuredStartupLogics = [];
  const showStrategyFocusScopes = focusScopeMode === "strategy";

  if (hasStartupLogic(rule, "browserProcessStartup")) {
    configuredStartupLogics.push(
      addFocusScopeIfNeeded(
        {
          type: "browserProcessStartup",
          label: getStartupLogicLabel("browserProcessStartup", message),
          summary: message("browserProcessStartupShort"),
          removable: true,
          span: "compact",
        },
        rule,
        "browserProcessStartup",
        message,
        showStrategyFocusScopes
      )
    );
  }

  if (hasStartupLogic(rule, "browserWindowStartup")) {
    configuredStartupLogics.push(
      addFocusScopeIfNeeded(
        {
          type: "browserWindowStartup",
          label: getStartupLogicLabel("browserWindowStartup", message),
          summary: message("browserWindowStartupShort"),
          removable: true,
          span: "compact",
        },
        rule,
        "browserWindowStartup",
        message,
        showStrategyFocusScopes
      )
    );
  }

  if (hasStartupLogic(rule, "dailyStartup")) {
    configuredStartupLogics.push(
      addFocusScopeIfNeeded(
        {
          type: "dailyStartup",
          label: getStartupLogicLabel("dailyStartup", message),
          summary: message("dailyStartupShort"),
          removable: true,
          span: "compact",
        },
        rule,
        "dailyStartup",
        message,
        showStrategyFocusScopes
      )
    );
  }

  if (hasStartupLogic(rule, "returnFromIdle")) {
    const period = splitIntervalPeriod(strategies.returnFromIdleMinutes);

    configuredStartupLogics.push(
      addFocusScopeIfNeeded(
        {
          type: "returnFromIdle",
          label: getStartupLogicLabel("returnFromIdle", message),
          summary: message("returnFromIdleShort", {
            duration: formatDurationLabel(
              strategies.returnFromIdleMinutes,
              message
            ),
          }),
          removable: true,
          value: strategies.returnFromIdleMinutes,
          help: message("returnFromIdleHelp"),
          period: {
            ...period,
            hoursLabel: message("intervalHoursLabel"),
            minutesLabel: message("intervalMinutesLabel"),
            hoursPlaceholder: message("intervalHoursPlaceholder"),
            minutesPlaceholder: message("intervalMinutesPlaceholder"),
          },
          span: "wide",
        },
        rule,
        "returnFromIdle",
        message,
        showStrategyFocusScopes
      )
    );
  }

  if (hasStartupLogic(rule, "dailyTimes")) {
    configuredStartupLogics.push(
      addFocusScopeIfNeeded(
        {
          type: "dailyTimes",
          label: getStartupLogicLabel("dailyTimes", message),
          summary: `${message("dailyTimesShort")} ${strategies.dailyTimes.join(", ")}`,
          removable: true,
          values: strategies.dailyTimes,
          span: "wide",
        },
        rule,
        "dailyTimes",
        message,
        showStrategyFocusScopes
      )
    );
  }

  if (hasStartupLogic(rule, "intervalMinutes")) {
    const period = splitIntervalPeriod(strategies.intervalMinutes);

    configuredStartupLogics.push(
      addFocusScopeIfNeeded(
        {
          type: "intervalMinutes",
          label: getStartupLogicLabel("intervalMinutes", message),
          summary: message("intervalMinutesShort", {
            duration: formatDurationLabel(strategies.intervalMinutes, message),
          }),
          removable: true,
          value: strategies.intervalMinutes,
          period: {
            ...period,
            hoursLabel: message("intervalHoursLabel"),
            minutesLabel: message("intervalMinutesLabel"),
            hoursPlaceholder: message("intervalHoursPlaceholder"),
            minutesPlaceholder: message("intervalMinutesPlaceholder"),
          },
          span: "wide",
        },
        rule,
        "intervalMinutes",
        message,
        showStrategyFocusScopes
      )
    );
  }

  if (hasStartupLogic(rule, "countdownRunAt")) {
    const period = splitCountdownPeriod(strategies.countdownRunAt, now);

    configuredStartupLogics.push(
      addFocusScopeIfNeeded(
        {
          type: "countdownRunAt",
          label: getStartupLogicLabel("countdownRunAt", message),
          summary: message("countdownStartupShort", {
            time: formatLocalTime(new Date(strategies.countdownRunAt)),
          }),
          removable: true,
          runAt: strategies.countdownRunAt,
          period: {
            ...period,
            hoursLabel: message("intervalHoursLabel"),
            minutesLabel: message("intervalMinutesLabel"),
            hoursPlaceholder: message("intervalHoursPlaceholder"),
            minutesPlaceholder: message("intervalMinutesPlaceholder"),
          },
          span: "wide",
        },
        rule,
        "countdownRunAt",
        message,
        showStrategyFocusScopes
      )
    );
  }

  return {
    configuredStartupLogics,
    availableStartupLogics: STARTUP_LOGIC_TYPES.filter(
      (type) => !hasStartupLogic(rule, type)
    ).map((type) => ({
      type,
      label: getStartupLogicLabel(type, message),
    })),
    startupLogicEmptyMessage: message("startupLogicEmpty"),
  };
}
