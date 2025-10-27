# Renderer Guidelines

These instructions apply to every file within `renderer/`.

## Layout and structure
- Views live under `renderer/views/` and are loaded dynamically via the `views:load` IPC handler. When adding a view, provide a unique `data-route` entry point in the sidebar and register a `<section data-route-view="<route>">` in `renderer/index.html` that points to your HTML template via `data-template`.
- Group feature-specific assets (HTML template, controller module, styles) into a subfolder once they grow beyond a single file. Shared tokens (color variables, typography) belong in the global stylesheet embedded in `index.html`.
- Preserve RTL-friendly markup. Prefer semantic containers (`<nav>`, `<main>`, `<section>`, `<button>`) to maintain accessibility, logical order, and keyboard navigation.
- Navigation accordions rely on `data-nav-group`, `data-nav-toggle`, and `data-nav-content` attributes. Follow the existing structure so the expand/collapse logic continues to work and stays accessible.

## Routing lifecycle & controllers
- Use the built-in selector helpers (`$`, `$$`) and router utilities exposed inside `renderer.js`. Register controllers with `registerController(route, initFn)`; the `initFn` receives the view root node and should return an object containing optional lifecycle hooks (e.g., `{ onShow }`).
- `routeHooks` stores one `onShow` handler per route. Keep these functions idempotent—guard event listener registration and clean up timers/observers when the route is hidden. If you spin up `MutationObserver`/`ResizeObserver`, return a disposer from your init function so the router can tear it down when needed.
- Defer DOM queries until a route is actually shown. Controllers should scope selectors to the provided view node to avoid cross-view coupling.
- When adding new top-level routes, update the sidebar (`renderer/index.html`) with matching `data-route` and `data-nav-parents` attributes so breadcrumbs and auto-expansion continue to operate.

## State and data flow
- `createReportState()` is the central store for sidebar selection, API results, loading flags, and errors. Use its `setSelection`/`subscribe` methods instead of maintaining bespoke globals. Honour the options `{ pushSelection, refresh, silent, clearResult }` so IPC synchronisation (`window.appApi.updateSelection`) and background refreshes keep working.
- Treat `TEAM_DATA`, `TEAM_USERS`, `USER_TEAM`, `TEAM_LABELS`, and `TEAM_VALUE_SET` as immutable single sources of truth sourced from GitHub. If you augment team data (e.g., dynamic imports), go through helpers like `ensureUserInTeamMap` and `normalizeUserOption` to avoid duplicates.
- Admin export state lives in `adminExportState`. When adjusting full-report logic (`handleAdminFullReportExport`), continue to refresh the button via `refreshAdminExportButton()` and update access control through `updateAdminExportAvailability()` so UI stays consistent for non-admins.
- Table instrumentation is centralised in `TABLE_FEATURES`/`TABLE_FEATURE_STATES`. Register new tables through the existing helpers so exports, column resizing, and sticky headers remain uniform. Any state you attach should be serialisable for the Excel exporter.

## IPC, networking, and security
- All privileged actions (settings, scans, exports, Jira requests) must route through `window.appApi`. Wrap calls in `try/catch` and surface failures via inline status components (`[data-status]`, toasts, or `aria-live` regions) following current patterns.
- The only external HTTP request in the renderer is `loadRemoteData()` (GitHub `data.json`). If you introduce additional fetches, reuse its error handling: explicit `Accept` headers, `cache: 'no-store'`, defensive parsing, and safe fallbacks (empty arrays + warnings).
- Never log Jira tokens or other secrets. Renderer logs should omit personally identifiable data unless essential for debugging; redact usernames when possible.

## Styling, themes, and accessibility
- Prefer CSS custom properties defined on `:root`/`[data-theme]`. Theme toggles must integrate with `window.themeController` (see `theme.js`) and update both label text (`[data-theme-label]`) and icon state for screen readers.
- Maintain strong focus outlines (`box-shadow`, `border`, etc.) and ARIA attributes for interactive components. Navigation accordions expect `aria-expanded`; modal workflows (e.g., worklog calendar) must set `role="dialog"`, `aria-modal`, and trap focus.
- Respect RTL contexts: use logical CSS properties (`margin-inline`, `padding-inline`) and explicitly set `dir="rtl"`/`dir="ltr"` when mixing languages.
- Whenever you show auto-updating metrics, attach `aria-live="polite"` or `aria-live="assertive"` as appropriate so assistive tech receives updates.

## Testing and validation
- Manually verify both light and dark themes after modifying shared styles or theme toggles.
- Exercise navigation via mouse, keyboard, and (if feasible) touch. Ensure `hashchange` routing still selects the correct sidebar item, focuses the new view, and syncs `routeTitle`.
- For data-heavy views (tables, charts, calendars), test empty, partial, and large datasets. Confirm exports (`Export table`, admin full report) generate the expected filenames and XLS contents.
- When you add IPC consumers, simulate failure paths (network timeouts, 401 responses) and verify the renderer shows actionable errors without leaving spinners running indefinitely.

## Documentation expectations
- Update renderer-specific docs or onboarding notes when introducing routes, feature toggles, or sidebar structure changes. Document controller entry points so future contributors can find the correct `init*` function quickly.
- Annotate Jalali/Gregorian conversion logic in controllers with inline comments (Persian and/or English) to capture assumptions about timezone offsets and working hours.
