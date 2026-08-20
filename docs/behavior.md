# TabWake Behavior Guide

This document records the detailed runtime behavior for TabWake. The README stays focused on installation and quick use; this guide is the longer reference.

## Rule Identity

- TabWake saves HTTP(S) URLs after removing query and hash. For example, `https://example.com/a?x=1#top` is saved as `https://example.com/a`.
- Different paths under the same origin can be separate rules. The same cleaned `targetUrl` maps to one rule.
- The home list shows site name, saved URL fallback, strategy summary, and each active site's nearest predictable next startup when one exists.
- The home list defaults to 5 sites per page. Settings allow 3, 5, or 10.
- Draft rules are not saved until confirmed. Leaving a draft shows an inline confirmation inside the popup.
- Deleting a rule uses an inline confirmation and removes all startup logic for that rule.

## Open Targets

Each rule opens either:

- Saved URL: the rule's saved `targetUrl`.
- Auto-update: at trigger time, the newest same-shape URL found under the same site, based on the update part you marked on the URL.

Auto-update treats "latest" as a URL pattern question, not a page freshness question. It does not use page update time or sitemap `lastmod` as freshness signals.

Configuration is fully local and does not go online. On the complete URL you click the segment(s) that change to mark the **update part** (one or more consecutive segments, for example `issue-94` or `2026/05/24`). When TabWake cannot auto-predict the next value, you fill an **expected next URL** that must match the current URL shape. Confirming only validates locally and requests the site's host permission for later use.

At trigger time (and only then), TabWake fetches the prefix page above the update part, collects same-origin candidates, takes the highest by the update part, then probes forward for newer same-shape URLs (HEAD, falling back to GET) until one does not exist or a limit is reached, and opens the newest existing URL. One trigger is capped at 20 forward hops, 8 seconds per request, and 15 seconds total for the prefix fetch plus probes.

Candidate URLs must:

- Stay on the same origin as the saved URL.
- Keep every segment outside the update part identical.
- Match the shape of the update part. The matcher can compare issue numbers, single-date paths, multi-segment date paths, stable ID segments, and semantic versions such as `v1.2.3` or `v1.0.0-rc.1`.

If host permission is missing, scheduled Auto-update does not fetch anything and falls back to the saved URL.

## Optional Host Permissions

TabWake declares `http://*/*` and `https://*/*` as `optional_host_permissions`, not install-time host permissions.

- Installation does not ask for access to all websites.
- When a user confirms Auto-update for a site, the popup requests that site's origin pattern, such as `https://example.com/*`.
- If the user denies the request, the draft is kept and Auto-update is not saved.
- If permission is later revoked, scheduled Auto-update resolution does not fetch the page and falls back to the saved URL.

## Prompt Modes

Rules use prompt modes to decide how the target is opened:

- Silent: open or reuse the target without activating the tab or focusing the window.
- Notify: show a browser notification; open or reuse the target only after notification click.
- In-browser: focus inside the browser without bringing the browser window forward from another app.
- Cross-app: focus the browser window from any app.

The Chinese UI labels are "静默 / 通知 / 页内聚焦 / 跨应用".

Settings include "Prompt mode scope" / "提示方式生效范围":

- Per site: one prompt mode for the whole rule.
- Per startup logic: each logic entry can choose its own prompt mode.

Browser-process startup and browser-window startup allow only Silent or Notify when configured directly. If other prompt modes are encountered for those startup-only triggers, they fall back to Silent.

## Startup Logic

One rule can enable multiple startup logic entries.

- Browser startup runs once per browser profile/process startup.
- Browser window startup runs for each normal browser window that is created, including the first normal window during a full browser start. Opening a new tab is not treated as browser-window startup.
- First startup daily runs once per local calendar day. A run only counts as handled when opening or notifying succeeds; if the run fails (for example the tab cannot be created), the day is not marked and a later qualifying trigger on the same day may retry.
- Daily fixed times support multiple `HH:MM` entries.
- Interval combines hours and minutes into one repeating interval.
- One-shot countdown computes one absolute run time when saved and removes itself after it runs successfully.
- Back at computer triggers once after the computer has been away for the rule's configured duration and becomes active again.

Saving configuration does not immediately open a page. The rule runs on the next matching trigger, or when the user chooses Run now.

Run now executes the current target once and does not update first-daily or daily-time run history. Run now also works for paused rules as a manual test; automatic triggers only run enabled rules.

## Alarm Behavior

TabWake uses browser alarms for daily fixed times, intervals, and one-shot countdowns.

- Interval alarms preserve their scheduled phase when the rule name and period are unchanged. Rebuilding alarms after a service worker restart or unrelated rule save does not reset an unchanged interval alarm.
- If an interval period changes, TabWake recreates that alarm with the new period.
- Daily fixed-time alarms are allowed to arrive up to 5 minutes after their scheduled time and still run.
- Daily fixed times missed while the browser was not running are not replayed on the next startup.
- One-shot countdown alarms are removed after a successful run.

## Idle And Return Behavior

Back-at-computer logic is configured per rule and defaults to 6 hours when added.

First startup daily also has an internal long-idle threshold of 360 minutes. If the browser stays open across days, returning from idle or locked state after that threshold can trigger the same daily deduplication path.

Chromium may report idle earlier than long TabWake durations because the browser caps its internal idle detection interval. TabWake still waits for the full configured duration before running first-daily long-idle or back-at-computer rules.

When no idle-based rules are configured, TabWake resets the browser idle detection interval to the maximum supported interval so idle events do not keep waking the extension unnecessarily.

## Tab Reuse

If a matching target is already open, TabWake reuses that tab instead of creating a duplicate.

- Saved URL mode reuses tabs with the same origin and matching saved path range.
- Auto-update mode reuses the exact resolved latest URL when possible.
- Existing reused tabs are never automatically closed by failed-open handling.

## Failed-Open Handling

When a newly opened TabWake tab fails to load, TabWake shows a browser notification and follows the setting:

- Keep the failed tab.
- Close only the failed tab TabWake just opened.

Clicking the notification opens the failed URL again.

This detection is best effort. The pending opened-tab map is held in the current Manifest V3 service worker's memory, so if the service worker is stopped before the navigation failure is observed, TabWake may not show the failed-open notification or close the tab.

Navigations the user cancels themselves (for example navigating away or pressing stop while the tab is still loading) are not treated as failed opens: no notification is shown and the tab is never closed.

Rule run records are written by the background after a trigger finishes. If the popup saves an edit at the same moment a trigger is running, the background re-reads the latest rules just before writing its run record, so only a write landing in that final few-millisecond window could be lost. This residual race is accepted as a known limitation.

## Import And Export

Export creates one local JSON backup file containing rules and settings. Import reads a user-selected JSON file and shows a preview before applying it.

- Replace imports only the file's rules and removes current rules that are not in the file.
- Merge keeps current rules that are not in the file and overwrites matching saved URLs.
- Import/export does not transfer first-daily run history, daily-time run history, idle state, or active one-shot countdown trigger times.
- Imported one-shot countdowns are disabled so they do not fire unexpectedly on another browser or device.

## Linux Notes

Chrome and Edge use the Chromium Manifest V3 service worker path.

Windows and macOS are the primary validation targets. Linux notification, idle, and window-focus behavior depends on the desktop environment and notification service, so Linux validation is best effort.

## 中文摘要

TabWake 会保存去掉查询参数和 hash 后的 HTTP(S) 网址。每条规则可选择“固定网址”或“自动追踪”，并通过启动逻辑决定何时触发。

“自动追踪”统一使用这个术语。你只需在完整网址上点击会变化的“更新部分”（可连续多段，如 `issue-94` 或 `2026/05/24`）；无法自动推算下一个时再手填“预期的下一个网址”。配置阶段完全本地、不联网，只做本地校验并申请该站点 host 权限。触发时才在同站抓取前缀页并按形态向后探测（HEAD 回退 GET）真正存在的最新链接；单次触发最多 20 跳、单请求最多 8 秒、整次联网最多 15 秒。不读取外部服务，不用页面更新时间或 sitemap `lastmod` 判断新旧。安装时不会请求读取所有网站；权限缺失时回退打开固定网址。

“提示方式生效范围”可设为按网站生效或按启动逻辑生效。四档提示方式为“静默 / 通知 / 页内聚焦 / 跨应用”。

周期 alarm 在名称和周期未变时保留原有相位；每日固定时间允许按计划时间迟到 5 分钟内执行，但浏览器未运行而真正错过的每日时间不会补执行。打开失败检测依赖当前 service worker 内存，属于 best-effort。
