# Agent Guidelines for `jira-worklogs-electron`

## Repository overview
This project is an Electron application for interacting with Jira worklogs. The codebase uses plain JavaScript with Node.js and Electron.

## Coding conventions
- Prefer descriptive variable and function names. Avoid abbreviations unless they are Jira-specific terms.
- Keep functions small and focused. Extract helpers when logic becomes complex or is reused.
- Use modern JavaScript syntax (e.g., `const`/`let`, arrow functions) unless a specific Electron API requires otherwise.
- When interacting with the DOM, query elements once and reuse references where practical.
- Document non-trivial logic with inline comments to aid maintainability.

## File organization
- Application entry points live at the repository root (`main.js`, `preload.js`).
- Renderer-specific logic is inside the `renderer/` directory. Group related components into their own subfolders when adding new UI elements.
- Shared configuration or utility code should live in a top-level `utils/` directory if needed (create it if it does not exist).

## Testing and validation
- After modifying application logic, run `npm test` if tests are available, or `npm run lint` if you add linting scripts.
- If no automated checks cover your change, describe in the PR message how you manually validated it.

## Commit and PR expectations
- Write clear, imperative commit messages (e.g., "Add worklog filtering by project").
- Summaries in PR descriptions should cover the feature or fix, along with manual/automated verification steps.
- Follow the repository's existing indentation style (two spaces in renderer HTML/CSS, two spaces in JavaScript).

## Additional notes
- If you add new environment variables, document them in `README.md`.
- For UI changes, capture a screenshot with the provided tooling whenever feasible.

