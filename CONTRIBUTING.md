# Contributing

Thanks for considering a contribution to TabWake.

## About This Repository

This is the public source and release repository. It contains the complete
extension runtime plus the packaging script, which is everything needed to build
and load TabWake yourself.

The automated test suite and the release verification scripts live in the
maintainer's development tree and are not mirrored here, so there is no
`npm test` or `npm run check` in this repository. Changes are validated against
that suite before each release.

## Local Setup

No dependencies are required to run the extension; the source is plain ES
modules with no build step.

Load the repository folder as an unpacked extension in Chrome or Edge for manual
verification.

## Development Guidelines

- Keep user-facing strings in `_locales/` or the popup i18n map.
- Keep storage and URL normalization logic in `src/storage.js`.
- Keep latest-URL matching logic in `src/latest-url-rules.js` and
  `src/latest-content.js`.
- Avoid adding new permissions unless they are necessary and documented.
- Describe the behavior change and how you verified it manually; the maintainer
  will run the full test suite before merging.

## Pull Requests

For UI or extension behavior changes, manually load the unpacked extension and
verify the popup flow in a real Chromium browser, and say so in the pull
request. Include the browser and operating system you tested on.
