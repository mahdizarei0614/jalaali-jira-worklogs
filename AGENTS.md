# Agent Guidelines for `jalaali-jira-worklogs`

These instructions apply to the entire repository unless a more specific `AGENTS.md` overrides them.

## Architecture snapshot
- **Main process (`main.js`)** bootstraps Electron, owns the single `BrowserWindow`, tray menu, cron reminders, credential storage via `keytar`, and every Jira HTTP request. The heavy report builders (`computeScan`, `buildMonthlyReport`, `buildQuarterReport`, `fetchWorklogsRange`) live here and lean on `moment-jalaali` for Tehran-aware calculations.
- **Preload (`preload.js`)** defines the only bridge into privileged APIs. Every new capability must be plumbed as `ipcMain.handle(...)` + preload exposure (`window.appApi`). Never reach into Node APIs from the renderer directly.
- **Renderer (`renderer/`)** is a vanilla browser runtime that fetches GitHub-hosted configuration (`data.json`), renders route-based views, and synchronises selection/report state via IPC.
- **Shared assets** such as `data.json` are requested at runtime from GitHub. Treat them as a stable contract between the renderer and upstream editors—breaking changes require versioning guidance in docs and PRs.

## Runbook & tooling expectations
- Use the Node version bundled with the pinned Electron release (currently Electron 37.x via `devDependencies`). If you must document a local Node version, align it with the runtime that Electron bundles (Node 20 at the time of writing).
- `npm install` triggers `electron-builder install-app-deps`; keep native module rebuilds reproducible (e.g., when adding `node-ffi`-style packages).
- Runtime checks:
  - `npm run start` launches the development app and is the minimum verification after touching lifecycle, IPC, or renderer boot code.
  - `npm run dist` / `npm run dist:portable` produce signed Windows artefacts; run at least one packaging command when modifying builder config.
- Capture manual QA notes in PRs: authenticated Jira flows, offline GitHub data fetch fallback, light/dark theme validation, cron reminder triggers.

## Data contracts (`data.json` and runtime stores)
- Renderer bootstrap expects `data.json` to expose:
  ```json
  {
    "teams": [
      { "value": "frontend", "label": "Frontend Team", "users": [ { "text": "…", "value": "…" } ] }
    ],
    "adminTeamAccess": { "username": ["frontend", "*"] }
  }
  ```
  Each user entry is normalised through `normalizeUserOption` and cached inside `TEAM_USERS`/`USER_TEAM` maps. Preserve `{ value, text }` keys when you extend the schema.
- Treat `adminTeamAccess` as *username → team IDs*. The renderer allows wildcard (`*`/`all`) and validates that the referenced teams exist. Document any new fields in this file before merging.
- Main-process helpers persist the last selected `{ jYear, jMonth, username }` in `electron-store`. If you add new persisted keys, namespace them (`settings.someFeature`) and document defaults.

## Main-process responsibilities
- **HTTP access**: use `buildHeaders` for auth headers and `searchIssuesPaged` for Jira pagination. That helper already handles max-results loops; reuse it instead of hand-rolling pagination.
- **Caching**: honour the existing caches (`PROJECT_BOARD_CACHE`, the `monthCache` Map passed into `buildQuarterReport`, and the per-request Sets used in `buildMonthlyReport`). Clear caches deliberately when inputs change.
- **Report builders**:
  - `computeScan` orchestrates `buildMonthlyReport` and enriches it with deficit summaries. Preserve its `{ ok, reason }` contract because renderers surface these messages directly.
  - `buildMonthlyReport` merges Jalali/Gregorian calendars, holidays (`STATIC_JALALI_HOLIDAYS` + Thu/Fri), and user worklogs. Any extension must still return deterministic `totalHours`, `days`, and `summary.totalHours` strings formatted via `.toFixed(2)`.
  - `buildQuarterReport` reuses `buildMonthlyReport` results; additional fields must remain additive to the existing `{ seasons, totals }` structure so the renderer’s cards continue to parse them.
  - `fetchWorklogsRange` underpins Excel/ZIP exports. Keep its `{ worklogs: [...] }` payload stable and sorted chronologically.
- **Exports**: `reports:full-export` packages entries into a zip via `JSZip`. Always sanitize filenames with `sanitizeZipSegment`/`sanitizeZipFileName`, honour the user’s chosen destination, and surface cancellation as `{ ok: false, reason: 'cancelled' }`.
- **IPC surface**: when adding handlers mirror the existing naming scheme. Current channels include:
  - Jira data: `jira:active-sprint-issues`, `worklogs:range`, `scan:now`.
  - Auth: `auth:has`, `auth:authorize`, `auth:logout`, `auth:whoami`.
  - Settings/UI: `settings:get`, `settings:save`, `ui:update-selection`, `views:load`, `app:open-external`.
  Document payload shape and error modes inline so renderer developers can adapt quickly.
- **Scheduling & notifications**: `scheduleDailyReminders` and `notifyNow` rely on the same computation pipeline. If you change cron schedules (`DAILY_REMINDER_TIMES`) or the threshold logic (`classifyDay`), update renderer messaging and QA steps accordingly.

## Renderer handshake
- `window.appApi` is the only approved bridge. Any new capability must be exposed in preload and validated against the renderer call sites (see `renderer/renderer.js` and controllers under `renderer/`).
- `views:load` returns HTML from `renderer/views/`. Keep templates side-effect free—JavaScript should live in controllers so the handler can safely cache content.
- The renderer fetches `data.json` from GitHub on boot. Provide graceful fallbacks (empty arrays, warnings) when introducing new required fields.

## Coding conventions
- Prefer explicit, self-documenting names. Jira-specific abbreviations (e.g., `JQL`, `WL`) are acceptable when matching public Jira APIs.
- Keep helper layout intact (top-level `function` declarations grouped by concern). New helpers should be pure/idempotent where possible to simplify testing and caching.
- Promise-based async flows only—no callbacks. Always catch and `console.error` with actionable messages (include HTTP status codes and the Jira key when possible).
- Time manipulation must go through `moment`/`moment-jalaali` helpers (`mtNow`, `mj`) so Tehran offsets remain correct. Never use `new Date()` for comparisons.
- IPC channel names stay namespaced (`jira:*`, `auth:*`, `reports:*`, etc.). Add discoverability comments or a central export when expanding the surface area.
- Any disk IO or export path must sanitize user-controlled strings using the existing helpers. If you need new sanitisation rules, extend those helpers rather than bypassing them.

## File and module organization
- Entry points remain at the repo root (`main.js`, `preload.js`). Only introduce new root modules when the logic is cross-cutting (e.g., telemetry, shared validation).
- Renderer views belong in `renderer/views/` and are lazy-loaded by `views:load`. Keep assets collocated per feature (HTML + controller + styles) once a view gains complexity.
- Consider a `shared/` folder only when logic truly needs to run in both main and renderer contexts. Renderer-only utilities stay under `renderer/` to avoid bloating the main bundle.
- Configuration-like JSON belongs beside consumers and must spell out its schema here or in a dedicated README entry before merge.

## Testing, validation, and QA notes
- Minimum manual pass after behavioural changes: log in, trigger `Scan Now` (tray menu), open Monthly Summary, Quarterly Report, and Issues Worklogs views, and attempt an export (`Export table` + admin full export if available).
- For report math changes, regression-test Jalali boundary cases: start/end of month, static holidays in `STATIC_JALALI_HOLIDAYS`, and Tehran DST transitions. Capture observed vs expected totals in the PR.
- When expanding Jira API usage, dry-run against a staging project and include anonymised sample responses in the PR if possible. The renderer surfaces API errors verbatim; ensure they’re user-friendly.
- If you wire new build scripts or QA commands, record them both here and in `package.json`.

## Documentation and security expectations
- Document every new environment variable, IPC contract, and npm script in `README.md` (or a focused doc) with usage examples and fallbacks.
- Treat `keytar` secrets as sensitive: never log tokens, redact personally identifiable Jira data in errors, and avoid storing credentials outside secure storage.
- Updating `data.json`? Describe schema changes, defaults, and migration steps in the PR body. Keep strings UTF-8 encoded—no HTML entities unless necessary.
- UI/UX changes should include refreshed screenshots or GIFs, especially when navigation, theming, or layout shifts.
- Provide `.env.example` updates instead of committing live credentials or machine-specific paths.

## Git hygiene and PR workflow
- Write imperative, present-tense commits (`Add sprint cache invalidation for board view`).
- Keep PRs narrow. If a patch spans main + renderer, spell out the coupling (e.g., new IPC message required by a controller change).
- List manual validation steps, new cron jobs, background processes, and screenshots/logs in the PR body to help reviewers reproduce.

## Accessibility and internationalization
- Preserve RTL friendliness. When adding strings, prefer Persian copy where the rest of the UI already localises; fall back to English only when no translation exists.
- Show Jalali and Gregorian numbers together where it impacts worklogs, due dates, or exports. Use helper formatting to avoid locale drift.
- Notifications must remain concise and follow the `sendNotification` format for consistency and translation readiness.

## Operational notes
- GitHub requests for `data.json` are unauthenticated; throttle retries and debounce refresh logic to stay within rate limits.
- Tray/menu assets belong under `resources/` and must be wired through `nativeImage`. Document any path changes for packagers.
- Cron reminders default to Tehran evenings (`DAILY_REMINDER_TIMES`). When editing them, add validation (renderer + main) so users can’t persist invalid crons.
- Respect Electron security best practices: `nodeIntegration` stays disabled in renderer windows; all privileged access goes through IPC + preload.
