# View Templates Guidelines

These rules apply to every file within `renderer/views/`.

## HTML authoring
- Templates are injected into the `<section data-route-view>` shells declared in `renderer/index.html`. Start each file with a single wrapping container (typically `<div class="app">`) and keep the markup declarative—no inline `<script>` tags and only minimal scoped styles when absolutely necessary.
- Mirror sidebar hierarchy with headings. Use `<h1>` for the main title, `<h2>`/`<h3>` for subsections, and supplement charts/tables with visually hidden labels (add or reuse a utility such as `.sr-only`) when titles are not descriptive enough.
- Reuse shared utility classes (`.app`, `.card`, `.section-title`, `.muted`, `.table-wrap`, etc.) so both light and dark themes pick up the correct variables. Document any new utility class in the renderer docs or stylesheet before shipping.
- Navigation-specific wiring (sidebar buttons, `data-route` attributes, aria relationships) lives in `renderer/index.html`, not inside view templates. Views should only contain content and hooks consumed by controllers.

## Data hooks and placeholders
- Represent dynamic content with semantic hooks: `data-bind-*`, `data-field`, `[data-empty-state]`, `data-export-name`, or controller-specific selectors (e.g., `data-calendar-container`, `data-worklog-modal`). Avoid hard-coded example data; controllers populate these nodes at runtime.
- Tables intended for export must include `data-export-name` (matching controller expectations) and proper `<thead>`, `<tbody>`, `<tfoot>` structure. Leave placeholder rows empty so `TABLE_FEATURES` can inject data safely.
- When surfacing Jalali and Gregorian values together, wrap them in separate elements or use `<span data-field="jalaali">` / `<span data-field="gregorian">` so controllers can toggle visibility and format each locale independently.
- Provide explicit empty states. Use `[data-empty-state]` wrappers or dedicated `<div class="empty">` blocks toggled by controllers. Keep messaging concise and, where applicable, bilingual.

## Accessibility, modals, and interactive regions
- Declare `role="status"` + `aria-live` on elements that receive async updates (e.g., `.calendar-message`, summary totals). Match the urgency to the content—default to `aria-live="polite"` unless the update is critical.
- Complex widgets (calendar modal, accordion tables) need accessible structure: dialogs must set `role="dialog"`, `aria-modal="true"`, and expose labelled headings; accordions require `aria-expanded` toggles tied to the collapsible content via `aria-controls`.
- For tables, include `scope="col"`/`scope="row"` on `<th>` cells and describe units (hours, days) in header text. If you provide summary rows, wrap them in `<tfoot>` so assistive tech distinguishes them from body rows.
- Respect RTL/LTR mixes—set `dir` attributes on blocks containing Persian text versus raw Jira keys, and prefer logical CSS properties (`margin-inline`) in inline styles.

## Contribution checklist
Before finalising a view change:
1. Validate the layout in both themes and at multiple viewport widths (≥1024px desktop baseline, test up to 1440px+).
2. Confirm controllers populate every placeholder and no mock/lorem content remains.
3. Trigger exports or interactive flows tied to the view (table downloads, modal submissions) to ensure selectors still match and ARIA attributes stay correct.
4. Update relevant screenshots or documentation snippets that showcase the modified view.
