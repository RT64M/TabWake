# TabWake

TabWake is a local-first browser extension for saving web pages and running lightweight startup or schedule rules for them. It supports Chrome and Edge desktop browsers.

Use it to open, focus, silently start, or notify for saved pages when the browser starts, when a normal browser window starts, once per day, after you return to the computer, at fixed daily times, at intervals, or after a one-time countdown. Beyond browser-start rules, TabWake brings scheduled and multi-condition timed triggers, so it can re-surface the pages that matter at any moment you need them and let you refocus on a key page exactly when it is relevant instead of digging it out of bookmarks or history. Auto-update can optionally move a saved URL to the latest matching content page when a site publishes predictable URL patterns.

Classic use scenarios:

- A morning dashboard: open your task board, calendar, and team channel at the first startup of each day or at a fixed time such as 09:00.
- A daily-publishing feed: track a blog, newsletter, or AI-daily site and let auto-update jump to today's newest issue instead of yesterday's saved link.
- Periodic check-ins: re-focus a monitoring page, CI dashboard, or market page on a custom interval (for example every 90 minutes) during the work day.
- Break reminders: use a one-time countdown or repeating interval to resurface a stretch-break or hydration page so you step away on time.
- Coming back to your desk: with "back at the computer after a long absence", TabWake re-opens or focuses the page you should resume on once you return.
- Window-by-window workspaces: open a fixed set of work pages each time a new browser window starts.

TabWake keeps configuration in browser storage. It has no account system, analytics, ads, remote code, or backend server.

## Install

Store installation is the intended distribution path for regular users. Use the Chrome Web Store or Microsoft Edge Add-ons listing when available.

For development or temporary local testing:

### Chrome / Edge

1. Open the extensions page.
2. Turn on Developer mode.
3. Choose "Load unpacked".
4. Select this project folder.

## Quick Start

1. Open an `http://` or `https://` page.
2. Click the TabWake toolbar icon.
3. Click "Track this page" / "+ 添加此页".
4. Confirm the draft rule in the detail view.
5. Add startup logic, such as daily time, interval, or browser startup.
6. Choose the prompt mode: Silent, Notify, In-browser, or Cross-app.
7. Use "Run now" to test the rule once.

The popup defaults to 5 sites per page. Settings can change that to 3, 5, or 10.

## Auto-Update / 自动追踪

Auto-update is for sites whose content URLs follow a stable pattern, such as issue numbers, date paths, stable IDs, or versions. On the complete URL you click the segment(s) that change to mark the update part; when the next value cannot be auto-predicted you also fill an expected next URL. TabWake then looks for newer same-shape URLs under the same site.

Configuration is fully local and does not go online — confirming only validates the pattern and requests the site's origin permission. At trigger time TabWake fetches the prefix page above the update part and probes forward for the newest existing same-shape URL. The scan is capped at 20 forward hops, 8 seconds per request, and 15 seconds total per trigger. Because that requires site access, TabWake uses optional host permissions: installation does not request access to all websites, and the popup asks for the current site's origin only when you confirm Auto-update for that site. If permission is missing later, scheduled triggers fall back to the saved URL.

## Permissions

- `storage`: saves rules, settings, and local run records.
- `tabs`: creates, queries, activates, and reuses tabs for saved rules.
- `alarms`: runs daily fixed times, intervals, and one-time countdowns.
- `idle`: detects return from idle or locked state for configured rules.
- `notifications`: shows notification-only prompts and failed-open alerts.
- `webNavigation`: detects failed loads for tabs opened by TabWake.
- `optional_host_permissions` for `http://*/*` and `https://*/*`: requested per site only when Auto-update needs to read the prefix page above the marked update part and probe predicted same-site candidate URLs for existence (legacy rules may also read the same-site sitemap fallback).

TabWake does not upload data or collect page content. Import and export files are created and read locally by the browser.

## Behavior Guide

For the full trigger rules, prompt-mode details, Auto-update matching rules, import/export behavior, and known limitations, see the [behavior guide](docs/behavior.md).

## Privacy

TabWake keeps everything in the local browser profile and sends nothing to the developer or any third party. Each browser has its own policy covering that browser's permission model and store requirements:

- Google Chrome: [docs/privacy-policy-chrome.md](docs/privacy-policy-chrome.md)
- Microsoft Edge: [docs/privacy-policy-edge.md](docs/privacy-policy-edge.md)

## FAQ

### Why did nothing open automatically?

Make sure the rule is saved, active, and has at least one startup logic entry. Daily fixed times are not replayed if the browser was closed at that exact time.

### Why did Auto-update not open a new article?

Check that the update part is a complete URL segment, such as `issue-94` before `issue-95`. If TabWake cannot predict the next value, fill the expected next URL or switch back to Saved URL.

### What happens if a saved URL is unavailable?

TabWake shows a browser notification with the failed URL. In settings, you can keep the failed tab or close only the failed tab TabWake just opened. Detection is best effort while the current extension service worker is alive.

## 中文说明

TabWake 是一个本地优先的 Chrome、Edge 桌面浏览器扩展，用来保存网页，并按启动、定时或离开返回等规则打开、聚焦或通知这些网页。除了“浏览器启动”类规则，TabWake 还提供定时以及按多种条件触发的定时能力，可以在你需要的任何时间重新呈现关键页面，让你恰好在该页面有用的时刻重新聚焦，而不必再从收藏夹或历史记录里翻找。

经典使用场景：

- 早晨工作台：在每天首次启动或固定时间（如 09:00）自动打开任务看板、日历和团队频道。
- 每日更新内容源：追踪博客、订阅刊物或 AI 日报，用自动追踪直接跳到今天最新一期，而不是昨天保存的旧链接。
- 周期性巡检：在工作时间按自定义周期（如每 90 分钟）重新聚焦监控页、CI 看板或行情页面。
- 休息提醒：用一次性倒计时或重复周期重新弹出拉伸 / 喝水提醒页，督促自己按时离开座位。
- 回到工位时：借助“长时间离开后回到电脑时”，回来后让 TabWake 重新打开或聚焦你该继续处理的页面。
- 逐窗口工作区：每次新建浏览器窗口时打开一组固定的工作页面。

### 安装

普通用户优先通过浏览器商店安装。商店版本可用前，开发或临时测试可使用本地加载：

- Chrome / Edge：打开扩展管理页，开启开发者模式，选择“加载已解压的扩展”，再选择本项目文件夹。

### 快速使用

1. 打开一个 `http://` 或 `https://` 页面。
2. 点击工具栏里的 TabWake 图标。
3. 点击“+ 添加此页”。
4. 在详情页确认草稿规则。
5. 添加需要的启动逻辑，例如浏览器启动、每日时间、周期或一次性倒计时。
6. 选择提示方式：静默、通知、页内聚焦或跨应用。
7. 用“立即启动”测试一次。

首页默认每页显示 5 个网站，可在设置中改为 3、5 或 10。

### 自动追踪

“自动追踪”适合 URL 有稳定更新形态的网站，例如期号、日期路径、稳定 ID 或版本号。你在完整网址上点击会变化的“更新部分”;无法自动推算下一个时再手填“预期的下一个网址”，TabWake 会在同站范围内寻找形态更新的链接。

配置阶段完全本地、不联网,确认只做形态校验并申请该站点权限;触发时才抓取“更新部分”之前的前缀页并向后探测真正存在的最新网址。单次触发最多向后探测 20 跳、单请求最多 8 秒、整次联网最多 15 秒。TabWake 使用可选 host 权限：安装时不会请求读取所有网站；只有在你确认某个网站的自动追踪时，才按当前 origin 请求权限。若之后权限缺失，定时触发会回退打开固定网址。

完整行为、权限边界和已知限制见 [behavior guide](docs/behavior.md)。

### 隐私

TabWake 的全部数据都留在本地浏览器配置文件中，不会发送给开发者或任何第三方。各浏览器有各自对应的隐私政策：

- Google Chrome：[docs/privacy-policy-chrome.md](docs/privacy-policy-chrome.md)
- Microsoft Edge：[docs/privacy-policy-edge.md](docs/privacy-policy-edge.md)
