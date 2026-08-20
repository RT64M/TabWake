# TabWake Privacy Policy — Microsoft Edge

Effective date: 2026-08-18

This policy covers the TabWake extension distributed through Microsoft Edge Add-ons for Microsoft Edge desktop on Windows, macOS, and Linux.

TabWake is a local-first browser extension for saving web pages and running startup or schedule rules for them. It has no account system, no backend server, and no remote sync.

## Summary

TabWake does not collect, transmit, sell, or share user data. Everything the extension stores stays in the local Edge profile.

## Data Stored Locally

TabWake stores the following in Edge extension storage:

- Saved site names and saved HTTP(S) URLs.
- Startup and schedule rules selected by the user.
- Extension settings such as prompt mode, rows per page, open-failure handling, and language.
- Local run records used to avoid duplicate daily triggers.

This data stays in the user's Edge profile unless the user exports it through the extension settings.

## Data Export and Import

TabWake can export rules and settings to a JSON file chosen by the user, and can import a JSON file selected by the user.

Import and export files are created, selected, and read locally by the browser. TabWake does not upload these files to any server.

## Network Requests

TabWake does not use a remote service and does not send user configuration to the developer or to any third party.

The extension makes network requests only for the optional Auto-update feature. When a rule uses Auto-update mode, TabWake asks Edge for optional host permission for that site's origin. After the user grants permission, TabWake may request:

- The prefix page above the marked update part for that rule.
- A bounded series of existence checks (HEAD requests with GET fallback) for predicted candidate URLs on the same site, limited to 20 forward hops, 8 seconds per request, and a 15 second total budget per run.
- For legacy rules saved before the update-part model, the same site's `sitemap.xml` fallback.

These requests go directly from the user's browser to the website the user configured, happen only when a rule is triggered, and are used only to find the newest URL matching the user's saved URL pattern. No network request is made while the user is configuring a rule.

## Data Not Collected

TabWake does not collect, sell, share, or transfer:

- Personally identifiable information.
- Authentication credentials.
- Financial or payment information.
- Health information.
- Personal communications.
- Browsing history beyond the URLs the user explicitly saved.
- Page content for analytics or profiling.

No data is transmitted to the developer, to Microsoft, or to any third party.

## Permissions

TabWake requests only the permissions needed for its user-facing features:

- `storage`: save rules, settings, and local run records.
- `tabs`: query, create, activate, and reuse tabs for saved rules.
- `alarms`: run scheduled daily, interval, and countdown rules.
- `idle`: detect return from idle or locked state for configured rules.
- `notifications`: show notification-only prompts and failed-open notifications.
- `webNavigation`: detect failed loads for tabs opened by TabWake.
- `optional_host_permissions` for `http://*/*` and `https://*/*`: not requested at install time. Requested per origin only when the user confirms Auto-update for that specific site, so TabWake can read the prefix page above the marked update part and probe predicted same-site candidate URLs for existence.

## Remote Code

TabWake does not load or execute remote code. All JavaScript is packaged inside the published extension.

## Third Parties

TabWake does not include analytics, advertising SDKs, tracking pixels, remote code loaders, or third-party data processors.

## Changes

Material changes to this policy will be published in this file with an updated effective date, alongside the corresponding extension release.

## Contact

For support or privacy questions, open an issue at <https://github.com/RT64M/TabWake/issues>.
