export function createSettingsRenderer({
  applySettingsImport,
  cancelSettingsImportPreview,
  createLabelWithHelp,
  exportSettingsFile,
  languageSwitchButton,
  openSettingsImportFilePicker,
  persistSettings,
  setCurrentPage,
}) {
  function createSettingsTransferPanel(state) {
    const transfer = state.settingsTransfer;
    const isApplying = transfer.isApplying;
    const panel = document.createElement("section");
    panel.className = "settings-transfer-panel";

    const header = document.createElement("div");
    header.className = "settings-transfer-header";

    const title = document.createElement("h2");
    title.className = "settings-transfer-title";
    title.textContent = transfer.title;

    const description = document.createElement("p");
    description.className = "settings-transfer-description";
    description.textContent = transfer.description;

    header.append(title, description);

    const actions = document.createElement("div");
    actions.className = "settings-transfer-actions";

    const exportButton = document.createElement("button");
    exportButton.className = `secondary-button ${transfer.exportAction.visualWeight || ""}`.trim();
    exportButton.type = "button";
    exportButton.disabled = isApplying;
    exportButton.textContent = transfer.exportAction.label;
    exportButton.addEventListener("click", exportSettingsFile);

    const importButton = document.createElement("button");
    importButton.className = `secondary-button ${transfer.importAction.visualWeight || ""}`.trim();
    importButton.type = "button";
    importButton.disabled = isApplying;
    importButton.dataset.focusTarget = "settings-import-button";
    importButton.textContent = transfer.importAction.label;
    importButton.addEventListener("click", openSettingsImportFilePicker);

    actions.append(exportButton, importButton);
    panel.append(header, actions);

    if (transfer.errorMessage) {
      const error = document.createElement("p");
      error.className = "field-error";
      error.textContent = transfer.errorMessage;
      panel.append(error);
    }

    if (transfer.preview) {
      const preview = document.createElement("div");
      preview.className = "settings-import-preview";

      const previewTitle = document.createElement("h3");
      previewTitle.className = "settings-import-preview-title";
      previewTitle.textContent = transfer.preview.title;

      const ruleCount = document.createElement("p");
      ruleCount.className = "settings-import-preview-line";
      ruleCount.textContent = transfer.preview.ruleCountLabel;

      const replaceSummary = document.createElement("p");
      replaceSummary.className = "settings-import-preview-line";
      replaceSummary.textContent = transfer.preview.replaceSummary;

      const mergeSummary = document.createElement("p");
      mergeSummary.className = "settings-import-preview-line";
      mergeSummary.textContent = transfer.preview.mergeSummary;

      const settingsSummary = document.createElement("p");
      settingsSummary.className = "settings-import-preview-line";
      settingsSummary.textContent = transfer.preview.settingsSummary;

      preview.append(
        previewTitle,
        ruleCount,
        replaceSummary,
        mergeSummary,
        settingsSummary
      );

      if (transfer.preview.discardedWarning) {
        const warning = document.createElement("p");
        warning.className = "field-error";
        warning.setAttribute("role", "alert");
        warning.textContent = transfer.preview.discardedWarning;
        preview.append(warning);
      }
      if (transfer.preview.countdownWarning) {
        const warning = document.createElement("p");
        warning.className = "settings-import-warning";
        warning.textContent = transfer.preview.countdownWarning;
        preview.append(warning);
      }

      const previewActions = document.createElement("div");
      previewActions.className = "settings-import-preview-actions";

      const replaceButton = document.createElement("button");
      replaceButton.className =
        transfer.preview.replaceAction.visualWeight === "danger"
          ? "secondary-button danger-outline-button"
          : "secondary-button";
      replaceButton.type = "button";
      replaceButton.disabled = isApplying;
      replaceButton.textContent = transfer.preview.replaceAction.label;
      replaceButton.addEventListener("click", () => {
        applySettingsImport("replace");
      });

      const mergeButton = document.createElement("button");
      mergeButton.className =
        transfer.preview.mergeAction.visualWeight === "primary"
          ? "primary-button"
          : "secondary-button";
      mergeButton.type = "button";
      mergeButton.disabled = isApplying;
      mergeButton.textContent = transfer.preview.mergeAction.label;
      mergeButton.addEventListener("click", () => {
        applySettingsImport("merge");
      });

      const cancelButton = document.createElement("button");
      cancelButton.className = "ghost-button";
      cancelButton.type = "button";
      cancelButton.disabled = isApplying;
      cancelButton.textContent = transfer.preview.cancelAction.label;
      cancelButton.addEventListener("click", cancelSettingsImportPreview);

      previewActions.append(replaceButton, mergeButton, cancelButton);
      preview.append(previewActions);
      panel.append(preview);
    }

    return panel;
  }

  function createGlobalAdvancedPanel(state) {
    const panel = document.createElement("section");
    panel.className = "global-advanced-panel";

    const modeState = state.globalAdvancedSettings.focusScopeMode;
    const rulesPerPageState = state.globalAdvancedSettings.rulesPerPage;
    const failedOpenBehaviorState = state.globalAdvancedSettings.failedOpenBehavior;
    const isApplyingImport = state.settingsTransfer.isApplying;

    const settingsFields = document.createElement("div");
    settingsFields.className = "settings-fields";

    const modeField = document.createElement("div");
    modeField.className = "field-block";

    const modeLabel = createLabelWithHelp(modeState.label, modeState.help);

    const modeOptions = document.createElement("div");
    modeOptions.className = "focus-scope-options settings-choice-list";
    for (const option of modeState.options) {
      const button = document.createElement("button");
      button.className = "focus-scope-button";
      button.type = "button";
      button.disabled = isApplyingImport;
      button.textContent = option.label;
      button.setAttribute("aria-pressed", String(option.selected));
      button.addEventListener("click", () => {
        persistSettings((currentSettings) => ({
          ...currentSettings,
          focusScopeMode: option.value,
        }));
      });
      modeOptions.append(button);
    }

    modeField.append(modeLabel, modeOptions);

    const pageSizeField = document.createElement("div");
    pageSizeField.className = "field-block settings-inline-field";

    const pageSizeLabel = createLabelWithHelp(
      rulesPerPageState.label,
      rulesPerPageState.help
    );

    const pageSizeShell = document.createElement("div");
    pageSizeShell.className = "settings-select-shell";
    const pageSizeSelect = document.createElement("select");
    pageSizeSelect.className = "settings-select rules-per-page-select";
    pageSizeSelect.disabled = isApplyingImport;
    pageSizeSelect.setAttribute("aria-label", rulesPerPageState.label);
    for (const option of rulesPerPageState.options) {
      const selectOption = document.createElement("option");
      selectOption.value = String(option.value);
      selectOption.textContent = option.label;
      selectOption.selected = option.selected;
      pageSizeSelect.append(selectOption);
    }
    pageSizeSelect.addEventListener("change", () => {
      setCurrentPage(1);
      persistSettings((currentSettings) => ({
        ...currentSettings,
        rulesPerPage: Number(pageSizeSelect.value),
      }));
    });
    pageSizeShell.append(pageSizeSelect);

    pageSizeField.append(pageSizeLabel, pageSizeShell);

    const failedOpenField = document.createElement("div");
    failedOpenField.className = "field-block";

    const failedOpenLabel = createLabelWithHelp(
      failedOpenBehaviorState.label,
      failedOpenBehaviorState.help
    );

    const failedOpenOptions = document.createElement("div");
    failedOpenOptions.className = "settings-choice-list failed-open-options";
    for (const option of failedOpenBehaviorState.options) {
      const button = document.createElement("button");
      button.className = "focus-scope-button";
      button.type = "button";
      button.disabled = isApplyingImport;
      button.textContent = option.label;
      button.setAttribute("aria-pressed", String(option.selected));
      button.addEventListener("click", () => {
        persistSettings((currentSettings) => ({
          ...currentSettings,
          failedOpenBehavior: option.value,
        }));
      });
      failedOpenOptions.append(button);
    }

    failedOpenField.append(failedOpenLabel, failedOpenOptions);

    settingsFields.append(modeField, pageSizeField, failedOpenField);
    panel.append(settingsFields, createSettingsTransferPanel(state));

    return panel;
  }

  function renderLanguageSwitch(languageState) {
    if (!languageSwitchButton || !languageState) {
      return;
    }

    languageSwitchButton.dataset.language = languageState.value;
    languageSwitchButton.setAttribute("aria-label", languageState.label);
    languageSwitchButton.setAttribute("title", languageState.label);
    for (const item of languageState.labels || []) {
      const label = languageSwitchButton.querySelector(
        `.language-switch-label-${item.value}`
      );
      if (!label) {
        continue;
      }

      label.textContent = item.label;
      label.dataset.selected = String(item.selected);
    }
  }

  return {
    createGlobalAdvancedPanel,
    renderLanguageSwitch,
  };
}
