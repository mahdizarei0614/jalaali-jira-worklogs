# Renderer Guidelines

These rules apply to the Angular application inside `renderer/`.

## Architectural expectations
- The renderer is an Angular 20 standalone application. Keep features organised inside `src/app/features/<feature-name>` with dedicated components, routing, and SCSS modules.
- Use Angular signals for state (`signal`, `computed`, `model`, `input`, `output`) and avoid legacy `@Input()`/`EventEmitter` patterns unless bridging with third-party libraries.
- Provide feature routes via lazy `loadComponent` entries inside `app.routes.ts`. Shared UI primitives (cards, sidebar, pipes) live under `src/app/shared/`.

## Styling
- Author component styles in SCSS next to each component. Prefer logical properties and respect RTL copy when adding Persian text.
- Global tokens belong in `src/styles.scss`. Reuse colour variables and avoid inline styles.

## IPC & data access
- Access privileged Electron APIs exclusively through `IpcService` so the preload contract remains centralised. Capture failures in user-facing signals and log meaningful errors to the console.
- Remote configuration (`data.json`) is fetched through Angular's `HttpClient`. Handle empty or malformed payloads gracefully.

## Testing & QA
- Exercise navigation across all lazy routes after changing router structure. Verify signal-based forms still update `ReportStateService` correctly.
- When adding IPC calls, simulate both success and failure paths to ensure loading/error signals resolve.
