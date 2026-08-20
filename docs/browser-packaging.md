# Browser Packaging Guide

This guide describes how to build TabWake's browser packages from this
repository. Each browser is a separate artifact even though they share the same
runtime code.

The extension has no build step: the source is plain ES modules that browsers
load directly. The packaging script only selects the runtime files, applies the
per-browser manifest, and writes a ZIP.

## Package Model

- Chrome package: `output/store-packages/tabwake-chrome-<version>.zip`
- Edge package: `output/store-packages/tabwake-edge-<version>.zip`
- Shared runtime source: `_locales/`, `icons/`, `popup/`, and the required runtime files under `src/`
- Chrome manifest override: `packaging/chrome/manifest.override.json`
- Edge manifest override: `packaging/edge/manifest.override.json`

The ZIP root must directly contain `manifest.json`. Do not zip the project
folder, the `output/` folder, or a staging folder as the top-level directory.

## Commands

Build only the Chrome package:

```sh
npm run package:chrome
```

Build only the Edge package:

```sh
npm run package:edge
```

Build all packages:

```sh
npm run package:stores
```

The packaging script produces deterministic archives: building the same source
twice yields byte-identical ZIPs.

## Version Consistency

`package.json` is the version source used in the ZIP filenames. Update
`package.json.version` first, then set `manifest.json` to exactly the same
value. Every `package:*` command rejects a source-version mismatch before
creating a package.

## Included Runtime Files

The packaging script copies only the shared runtime whitelist, including
`src/background.js` and every `src/background/` submodule it statically imports:

- `_locales/`
- `icons/`
- `popup/`
- `src/alarm-names.js`
- `src/background.js`
- `src/background/`
- `src/extension-api.js`
- `src/latest-content.js`
- `src/latest-url-rules.js`
- `src/rules.js`
- `src/storage.js`
- `src/url-utils.js`

## Excluded Files

The package must not include repository or development-only files:

- `.git/`
- `docs/`
- `scripts/`

## Browser Differences

Chrome and Edge use the same Chromium Manifest V3 runtime path:

- `manifest.json`
- `src/background.js` as a module service worker

Add future browser-specific differences through the manifest override files
rather than forking shared runtime source, unless there is a proven API or
policy difference that overrides and runtime feature detection cannot handle.
