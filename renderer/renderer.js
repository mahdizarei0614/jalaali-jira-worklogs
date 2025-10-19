(async function () {
    const $ = (selector, root = document) => root.querySelector(selector);
    const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

    class TableEnhancer {
        constructor(table, options = {}) {
            this.table = table || null;
            this.tbody = this.table?.querySelector('tbody') || null;
            this.columns = Array.isArray(options.columns) ? options.columns.map((col, index) => ({
                ...col,
                key: col?.key || `col-${index}`
            })) : [];
            this.exportFileName = options.exportFileName || (this.table?.id || 'table-data');
            this.exportLabel = options.exportLabel || 'Export Excel';
            this.onVisibleRowsChanged = typeof options.onVisibleRowsChanged === 'function'
                ? options.onVisibleRowsChanged
                : null;
            this.rowsData = [];
            this.visibleRows = [];
            this.filters = new Map();
            this.sortState = { index: null, direction: null };
            this.columnIndexByKey = new Map();
            this.headerButtons = [];
            this.filterSelects = [];
            this.toolbar = null;
            this.exportButton = null;
            if (!this.table || !this.tbody || !this.columns.length) {
                return;
            }
            this.setupToolbar();
            this.setupHeaders();
        }

        setupToolbar() {
            const wrap = this.table.closest('.table-wrap');
            if (!wrap) return;
            let toolbar = wrap.querySelector('.table-toolbar');
            if (!toolbar) {
                toolbar = document.createElement('div');
                toolbar.className = 'table-toolbar';
                const actions = document.createElement('div');
                actions.className = 'table-toolbar__actions';
                toolbar.appendChild(actions);
                wrap.insertBefore(toolbar, this.table);
            }
            const actions = toolbar.querySelector('.table-toolbar__actions') || toolbar;
            const exportBtn = document.createElement('button');
            exportBtn.type = 'button';
            exportBtn.className = 'btn btn-outline btn-sm';
            exportBtn.textContent = this.exportLabel;
            exportBtn.addEventListener('click', () => this.exportVisibleRows());
            actions.appendChild(exportBtn);
            this.toolbar = toolbar;
            this.exportButton = exportBtn;
            this.updateExportButtonState();
        }

        setupHeaders() {
            const thead = this.table.querySelector('thead');
            if (!thead) return;
            const headerCells = Array.from(thead.querySelectorAll('th'));
            headerCells.forEach((th, index) => {
                const column = this.columns[index] || {};
                const label = (column.label || th.textContent || '').trim();
                column.label = label;
                this.columns[index] = column;
                this.columnIndexByKey.set(column.key, index);
                th.innerHTML = '';
                th.dataset.columnKey = column.key;
                if (column.sortable) {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.className = 'table-sort-button';
                    button.dataset.direction = '';
                    const labelSpan = document.createElement('span');
                    labelSpan.textContent = label;
                    const indicator = document.createElement('span');
                    indicator.className = 'sort-indicator';
                    indicator.textContent = '↕';
                    button.append(labelSpan, indicator);
                    button.addEventListener('click', () => this.toggleSort(index));
                    th.appendChild(button);
                    this.headerButtons[index] = button;
                } else {
                    const span = document.createElement('span');
                    span.textContent = label;
                    span.className = 'table-sort-label';
                    th.appendChild(span);
                    this.headerButtons[index] = null;
                }
                if (column.filterable) {
                    const select = document.createElement('select');
                    select.className = 'table-filter';
                    select.dataset.columnKey = column.key;
                    select.innerHTML = '<option value="">All</option>';
                    select.addEventListener('change', () => {
                        const value = select.value;
                        if (value) {
                            this.filters.set(column.key, value);
                        } else {
                            this.filters.delete(column.key);
                        }
                        this.applySortAndFilter();
                    });
                    th.appendChild(select);
                    this.filterSelects[index] = select;
                } else {
                    this.filterSelects[index] = null;
                }
            });
        }

        refresh() {
            if (!this.tbody) return;
            const rows = Array.from(this.tbody.querySelectorAll('tr'));
            if (!rows.length) {
                this.clear();
                return;
            }
            // Detect message rows (single cell with colspan)
            if (rows.length === 1) {
                const single = rows[0];
                if (single.cells.length <= 1 || single.cells[0]?.colSpan > 1) {
                    this.clear();
                    return;
                }
            }
            this.rowsData = rows.map((tr, index) => {
                const cells = this.columns.map((column, colIdx) => this.extractCellData(tr.cells[colIdx], column));
                return {
                    element: tr,
                    cells,
                    originalIndex: index
                };
            });
            this.buildFilterOptions();
            this.applySortAndFilter();
        }

        clear() {
            this.rowsData = [];
            this.visibleRows = [];
            this.filters.clear();
            this.filterSelects.forEach((select) => {
                if (select) {
                    select.innerHTML = '<option value="">All</option>';
                    select.value = '';
                }
            });
            this.sortState = { index: null, direction: null };
            this.updateSortIndicators();
            this.updateExportButtonState();
        }

        buildFilterOptions() {
            this.filterSelects.forEach((select, index) => {
                if (!select) return;
                const column = this.columns[index];
                const values = new Set();
                this.rowsData.forEach((row) => {
                    const cell = row.cells[index];
                    if (!cell) return;
                    const value = cell.filterValue;
                    if (value !== '' && value != null) {
                        values.add(String(value));
                    }
                });
                const sorted = TableEnhancer.sortFilterValues(Array.from(values), column?.type);
                const previous = select.value;
                select.innerHTML = '<option value="">All</option>';
                sorted.forEach((value) => {
                    const option = document.createElement('option');
                    option.value = value;
                    option.textContent = value;
                    select.appendChild(option);
                });
                if (previous && values.has(previous)) {
                    select.value = previous;
                    this.filters.set(column.key, previous);
                } else {
                    select.value = '';
                    this.filters.delete(column.key);
                }
            });
        }

        applySortAndFilter() {
            if (!this.rowsData.length) {
                this.visibleRows = [];
                this.updateExportButtonState();
                this.updateSortIndicators();
                return;
            }
            const visible = [];
            const hidden = [];
            this.rowsData.forEach((row) => {
                let matches = true;
                this.filters.forEach((value, key) => {
                    if (!matches) return;
                    const colIndex = this.getColumnIndex(key);
                    if (colIndex == null) return;
                    const cell = row.cells[colIndex];
                    const cellValue = cell?.filterValue ?? '';
                    if (value && cellValue !== value) {
                        matches = false;
                    }
                });
                if (matches) {
                    visible.push(row);
                } else {
                    hidden.push(row);
                }
            });

            let sortedRows = visible;
            if (this.sortState.index != null && this.sortState.direction) {
                const column = this.columns[this.sortState.index] || {};
                const direction = this.sortState.direction === 'asc' ? 1 : -1;
                sortedRows = visible.slice().sort((a, b) => {
                    const cellA = a.cells[this.sortState.index];
                    const cellB = b.cells[this.sortState.index];
                    const result = TableEnhancer.compareValues(cellA?.sortValue, cellB?.sortValue, column.type);
                    if (result === 0) {
                        return a.originalIndex - b.originalIndex;
                    }
                    return result * direction;
                });
            } else {
                sortedRows = visible.slice().sort((a, b) => a.originalIndex - b.originalIndex);
            }

            sortedRows.forEach((row) => {
                row.element.style.display = '';
                this.tbody.appendChild(row.element);
            });
            hidden.forEach((row) => {
                row.element.style.display = 'none';
                this.tbody.appendChild(row.element);
            });

            this.visibleRows = sortedRows;
            this.updateSequenceColumns();
            this.updateExportButtonState();
            this.updateSortIndicators();

            if (this.onVisibleRowsChanged) {
                const snapshots = sortedRows.map((row) => this.createRowSnapshot(row));
                this.onVisibleRowsChanged(snapshots, this);
            }
        }

        updateSequenceColumns() {
            const sequenceColumns = this.columns
                .map((column, index) => (column?.isSequence ? index : null))
                .filter((index) => index != null);
            if (!sequenceColumns.length) return;
            this.visibleRows.forEach((row, visibleIndex) => {
                sequenceColumns.forEach((colIndex) => {
                    const cell = row.cells[colIndex];
                    if (!cell?.td) return;
                    const label = String(visibleIndex + 1);
                    cell.td.textContent = label;
                    cell.text = label;
                    cell.filterValue = label;
                    cell.exportValue = label;
                    cell.sortValue = visibleIndex + 1;
                });
            });
        }

        updateExportButtonState() {
            if (this.exportButton) {
                this.exportButton.disabled = this.visibleRows.length === 0;
            }
        }

        updateSortIndicators() {
            this.headerButtons.forEach((button, index) => {
                if (!button) return;
                const isActive = this.sortState.index === index && this.sortState.direction;
                const direction = isActive ? this.sortState.direction : '';
                button.dataset.direction = direction || '';
                const indicator = button.querySelector('.sort-indicator');
                if (indicator) {
                    indicator.textContent = direction === 'asc' ? '▲' : direction === 'desc' ? '▼' : '↕';
                }
            });
        }

        toggleSort(index) {
            if (this.sortState.index !== index) {
                this.sortState = { index, direction: 'asc' };
            } else if (this.sortState.direction === 'asc') {
                this.sortState.direction = 'desc';
            } else if (this.sortState.direction === 'desc') {
                this.sortState = { index: null, direction: null };
            } else {
                this.sortState.direction = 'asc';
            }
            this.applySortAndFilter();
        }

        getColumnIndex(key) {
            if (this.columnIndexByKey.has(key)) return this.columnIndexByKey.get(key);
            return null;
        }

        exportVisibleRows() {
            if (!this.visibleRows.length) return;
            const headers = this.columns.map((column) => escapeHtml(column.label || ''));
            const rowsHtml = this.visibleRows.map((row) => {
                const cellsHtml = this.columns.map((column, index) => {
                    const cell = row.cells[index];
                    const value = cell ? (cell.exportValue ?? cell.text ?? '') : '';
                    return `<td>${escapeHtml(value)}</td>`;
                }).join('');
                return `<tr>${cellsHtml}</tr>`;
            }).join('');
            const tableHtml = `<table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rowsHtml}</tbody></table>`;
            const blob = new Blob(['\ufeff' + tableHtml], { type: 'application/vnd.ms-excel' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `${this.exportFileName}.xls`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }

        extractCellData(td, column = {}) {
            if (!td) {
                return { td: null, text: '', sortValue: '', filterValue: '', exportValue: '', numericValue: null };
            }
            const dataset = td.dataset || {};
            const text = (td.textContent || '').trim();
            const sortRaw = dataset.sortValue ?? text;
            const filterRaw = dataset.filterValue ?? text;
            const exportRaw = dataset.exportValue ?? text;
            const numericRaw = dataset.numericValue;
            const sortValue = TableEnhancer.parseSortValue(sortRaw, column.type);
            const filterValue = String(filterRaw ?? '').trim();
            const exportValue = String(exportRaw ?? '').trim();
            const numericValue = numericRaw != null ? Number(numericRaw) : (column.type === 'number' ? TableEnhancer.parseNumber(sortRaw) : null);
            return { td, text, sortValue, filterValue, exportValue, numericValue };
        }

        createRowSnapshot(row) {
            const byKey = {};
            this.columns.forEach((column, index) => {
                if (!column?.key) return;
                byKey[column.key] = row.cells[index];
            });
            return {
                cells: row.cells.slice(),
                byKey
            };
        }

        static parseSortValue(raw, type) {
            if (raw == null) return '';
            if (type === 'number') {
                return TableEnhancer.parseNumber(raw);
            }
            if (type === 'date') {
                const ts = Number(Date.parse(raw));
                return Number.isFinite(ts) ? ts : raw;
            }
            return String(raw).toLowerCase();
        }

        static parseNumber(raw) {
            const num = Number(raw);
            return Number.isFinite(num) ? num : 0;
        }

        static compareValues(a, b, type) {
            if (type === 'number') {
                const av = Number(a);
                const bv = Number(b);
                if (Number.isFinite(av) && Number.isFinite(bv)) return av - bv;
            }
            if (type === 'date') {
                const av = Number(a);
                const bv = Number(b);
                if (Number.isFinite(av) && Number.isFinite(bv)) return av - bv;
            }
            const as = String(a ?? '').toLowerCase();
            const bs = String(b ?? '').toLowerCase();
            if (as < bs) return -1;
            if (as > bs) return 1;
            return 0;
        }

        static sortFilterValues(values, type) {
            if (!Array.isArray(values)) return [];
            const copy = values.slice();
            if (type === 'number') {
                copy.sort((a, b) => Number(a) - Number(b));
            } else {
                copy.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
            }
            return copy;
        }
    }

    const GITHUB_USER = 'mahdizarei0614';
    const GITHUB_REPO = 'jira-worklogs-electron';

    async function loadRemoteData() {
        const url = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/data.json?ref=main&_=${Date.now()}`;
        try {
            const response = await fetch(url, {
                headers: {
                    Accept: 'application/vnd.github.v3.raw',
                },
                cache: 'no-store',
            });
            if (!response.ok) {
                throw new Error(`Failed to fetch data.json (${response.status})`);
            }
            return await response.json();
        } catch (error) {
            console.error('Unable to load data.json', error);
            return {};
        }
    }

    const remoteData = await loadRemoteData();
    const TEAM_DATA = Array.isArray(remoteData?.teams) ? remoteData.teams : [];
    if (TEAM_DATA.length === 0) {
        console.warn('Team data is empty. Please ensure data.json is populated correctly.');
    }
    const TEAM_OPTIONS = TEAM_DATA.map(({ value, label }) => ({ value, text: label }));
    const TEAM_VALUES = TEAM_OPTIONS.map((option) => option.value);
    const TEAM_USERS = new Map();
    const USER_TEAM = new Map();
    TEAM_DATA.forEach(({ value, users }) => {
        const list = Array.isArray(users)
            ? users.map((user) => normalizeUserOption(user)).filter(Boolean)
            : [];
        TEAM_USERS.set(value, list);
        list.forEach((user) => {
            USER_TEAM.set(user.value, value);
        });
    });
    const TEAM_VALUE_SET = new Set(TEAM_VALUES);
    const DEFAULT_TEAM = TEAM_OPTIONS[0]?.value || null;
    const ADMIN_TEAM_ACCESS = new Map(Object.entries(remoteData?.adminTeamAccess || {}).map(([username, teams]) => {
        const normalizedUser = (username || '').trim();
        if (!normalizedUser) {
            return null;
        }
        const normalizedTeams = Array.isArray(teams)
            ? teams.map((team) => (team || '').trim()).filter(Boolean)
            : [];
        return [normalizedUser, normalizedTeams];
    }).filter(Boolean));
    const PERSIAN_MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
    const routeHooks = new Map();

    function getAdminTeamsForUser(username) {
        const key = (username || '').trim();
        if (!key) return [];
        const teams = ADMIN_TEAM_ACCESS.get(key);
        if (!teams || teams.length === 0) {
            return [];
        }
        let allowAll = false;
        const requested = new Set();
        teams.forEach((team) => {
            const value = (team || '').trim();
            if (!value) {
                return;
            }
            if (value === '*' || value.toLowerCase() === 'all') {
                allowAll = true;
                return;
            }
            if (TEAM_VALUE_SET.has(value)) {
                requested.add(value);
            }
        });
        if (allowAll) {
            return TEAM_VALUES.slice();
        }
        if (requested.size === 0) {
            return [];
        }
        return TEAM_VALUES.filter((value) => requested.has(value));
    }

    function normalizeUserOption(user) {
        if (!user) return null;
        const value = (user.value || '').trim();
        if (!value) return null;
        const text = (user.text || '').trim();
        return { value, text: text || value };
    }

    function ensureUserInTeamMap(team, user) {
        if (!team) return;
        const normalized = normalizeUserOption(user);
        if (!normalized) return;
        const existing = TEAM_USERS.get(team);
        if (!existing) {
            TEAM_USERS.set(team, [normalized]);
        } else if (!existing.some((item) => item.value === normalized.value)) {
            existing.push(normalized);
        }
        USER_TEAM.set(normalized.value, team);
    }

    function findTeamForUser(username) {
        if (!username) return null;
        return USER_TEAM.get(username) || null;
    }

    function getTeamUsers(team) {
        if (!team) return [];
        return TEAM_USERS.get(team) || [];
    }

    const routeTitle = $('#viewTitle');
    const defaultTitle = routeTitle?.textContent || 'Alo Worklogs';
    const navItems = $$('[data-route]');
    const viewNodes = new Map(
        $$('[data-route-view]').map((el) => {
            const route = el.getAttribute('data-route-view');
            return route ? [route, el] : null;
        }).filter(Boolean)
    );

    async function loadTemplateForView(el) {
        const templatePath = el.getAttribute('data-template');
        if (!templatePath || el.dataset.loaded === 'true') {
            return;
        }
        try {
            let html;
            if (typeof window.appApi?.loadViewTemplate === 'function') {
                html = await window.appApi.loadViewTemplate(templatePath);
            } else {
                const res = await fetch(new URL(templatePath, window.location.href));
                if (!res.ok) {
                    throw new Error(`Failed to load template: ${templatePath} (${res.status})`);
                }
                html = await res.text();
            }
            el.innerHTML = html;
            el.dataset.loaded = 'true';
        } catch (err) {
            console.error(err);
            el.innerHTML = '<div class="muted">Unable to load view.</div>';
            el.dataset.loaded = 'error';
        }
    }

    await Promise.all(Array.from(viewNodes.values()).map(loadTemplateForView));

    const routeLabels = {};
    viewNodes.forEach((el, key) => {
        const label = el.getAttribute('data-route-title');
        if (label) {
            routeLabels[key] = label;
        }
    });
    navItems.forEach((btn) => {
        const route = btn.dataset.route;
        if (!route) return;
        if (!routeLabels[route]) {
            const label = btn.dataset.routeLabel || btn.textContent.trim();
            if (label) {
                routeLabels[route] = label;
            }
        }
    });

    const initialActive = Array.from(viewNodes.entries()).find(([, el]) => el.classList.contains('is-active'));
    const defaultRoute = initialActive ? initialActive[0] : (navItems[0]?.dataset.route || 'monthly-summary');
    let activeRoute = null;

    function setRoute(route, { pushState = true } = {}) {
        if (!viewNodes.has(route)) {
            route = defaultRoute;
        }
        if (route === activeRoute) {
            if (pushState && window.location.hash.replace(/^#/, '') !== route) {
                window.location.hash = route;
            }
            return route;
        }

        viewNodes.forEach((el, key) => {
            el.classList.toggle('is-active', key === route);
        });

        navItems.forEach((btn) => {
            if (!btn) return;
            const isActive = btn.dataset.route === route;
            btn.classList.toggle('is-active', isActive);
            if (isActive) {
                btn.setAttribute('aria-current', 'page');
            } else {
                btn.removeAttribute('aria-current');
            }
        });

        if (routeTitle) {
            routeTitle.textContent = routeLabels[route] || defaultTitle;
        }

        if (document.body) {
            document.body.dataset.route = route;
        }

        const previousRoute = activeRoute;
        activeRoute = route;

        if (pushState) {
            window.location.hash = route;
        }

        const hook = routeHooks.get(route);
        if (typeof hook === 'function') {
            try {
                hook({ route, previous: previousRoute });
            } catch (err) {
                console.error('Route activation hook failed', err);
            }
        }

        return route;
    }

    function syncFromHash() {
        const hash = (window.location.hash || '').replace(/^#/, '');
        return setRoute(hash || defaultRoute, { pushState: false });
    }

    navItems.forEach((btn) => {
        btn.addEventListener('click', () => {
            const route = btn.dataset.route;
            setRoute(route);
        });
    });

    window.addEventListener('hashchange', syncFromHash);
    syncFromHash();

    const themeToggleBtn = $('#themeToggle');
    if (themeToggleBtn && window.themeController) {
        const labelNode = themeToggleBtn.querySelector('[data-theme-label]');
        const iconNode = themeToggleBtn.querySelector('.theme-toggle__icon');
        const updateToggle = (theme) => {
            const isDark = theme === 'dark';
            themeToggleBtn.setAttribute('aria-pressed', String(isDark));
            if (labelNode) {
                labelNode.textContent = isDark ? 'Light mode' : 'Dark mode';
            }
            if (iconNode) {
                iconNode.textContent = isDark ? '☀️' : '🌙';
            }
        };

        window.themeController.subscribe(updateToggle);
        updateToggle(window.themeController.getTheme());

        themeToggleBtn.addEventListener('click', () => {
            window.themeController.toggle();
        });
    }

    if (typeof window.appRouter !== 'object' || window.appRouter === null) {
        window.appRouter = {};
    }
    Object.assign(window.appRouter, {
        navigate: (route, options) => setRoute(route, options),
        current: () => activeRoute,
        routes: () => Array.from(viewNodes.keys()),
        defaultRoute,
        titleFor: (route) => routeLabels[route] || null
    });

    const reportState = createReportState();
    initLoadingOverlay(reportState);
    const settingsPromise = loadSettings();
    const userSelectContext = initUserSelect($('#sidebarUserSelect'), reportState);

    await initSelectionControls(reportState, settingsPromise);

    await Promise.all([
        registerController('monthly-summary', (node) => initMonthlySummary(node, reportState)),
        registerController('detailed-worklogs', (node) => initDetailedWorklogs(node, reportState)),
        registerController('due-issues', (node) => initDueIssues(node, reportState)),
        registerController('issues', (node) => initIssuesReport(node, reportState)),
        registerController('quarter-report', (node) => initQuarterReport(node, reportState)),
        registerController('configurations', (node) => initConfigurations(node, reportState, userSelectContext, settingsPromise))
    ]);

    if (activeRoute && routeHooks.has(activeRoute)) {
        try {
            routeHooks.get(activeRoute)({ route: activeRoute, previous: null, reason: 'initial' });
        } catch (err) {
            console.error('Initial route activation failed', err);
        }
    }

    const logoutBtn = $('#logout');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            try {
                await window.appApi.logout();
            } catch (err) {
                console.error('Failed to logout', err);
            }
        });
    }

    async function registerController(route, initFn) {
        const node = viewNodes.get(route);
        if (!node || typeof initFn !== 'function') return;
        try {
            const hooks = await Promise.resolve(initFn(node));
            if (hooks && typeof hooks.onShow === 'function') {
                routeHooks.set(route, hooks.onShow);
            }
        } catch (err) {
            console.error(`Failed to initialise controller for route "${route}"`, err);
        }
    }

    function createReportState() {
        const listeners = new Set();
        const state = {
            selection: {
                team: null,
                jYear: null,
                jMonth: null,
                username: null,
                timeOffHours: 0
            },
            result: null,
            isFetching: false,
            lastError: null,
            pendingRefresh: null,
            subscribe(listener) {
                if (typeof listener !== 'function') return () => {};
                listeners.add(listener);
                try {
                    listener(snapshot());
                } catch (err) {
                    console.error('Listener execution failed', err);
                }
                return () => listeners.delete(listener);
            },
            notify() {
                const snap = snapshot();
                listeners.forEach((listener) => {
                    try {
                        listener(snap);
                    } catch (err) {
                        console.error('Listener execution failed', err);
                    }
                });
            },
            getSelection() {
                return { ...state.selection };
            },
            async pushSelection() {
                if (typeof window.appApi?.updateSelection !== 'function') return;
                const { jYear, jMonth, username } = state.selection;
                if (!Number.isFinite(jYear) || !Number.isFinite(jMonth) || !username) return;
                try {
                    await window.appApi.updateSelection({ jYear, jMonth, username });
                } catch (err) {
                    console.error('Failed to push selection', err);
                }
            },
            setSelection(update, options = {}) {
                const { pushSelection = false, refresh = false, silent = false, clearResult = false } = options;
                let changed = false;
                if (update && typeof update === 'object') {
                    for (const [key, value] of Object.entries(update)) {
                        if (!(key in state.selection)) continue;
                        if (value === undefined) continue;
                        if (state.selection[key] !== value) {
                            state.selection[key] = value;
                            changed = true;
                        }
                    }
                }
                if (clearResult) {
                    state.result = null;
                    state.lastError = null;
                    state.isFetching = false;
                    state.pendingRefresh = null;
                }
                if ((changed || clearResult) && !silent) {
                    state.notify();
                }
                let chain = Promise.resolve();
                if (pushSelection) {
                    chain = chain.then(() => state.pushSelection());
                }
                if (refresh) {
                    chain = chain.then(() => state.refresh());
                }
                return chain;
            },
            async refresh(options = {}) {
                const { force = false } = options;
                if (state.pendingRefresh && !force) {
                    return state.pendingRefresh;
                }
                const { jYear, jMonth, username } = state.selection;
                if (!Number.isFinite(jYear) || !Number.isFinite(jMonth) || !username) {
                    return null;
                }
                if (typeof window.appApi?.scanNow !== 'function') {
                    console.warn('scanNow API is not available.');
                    return null;
                }
                const selectionSnapshot = { jYear, jMonth, username };
                const run = (async () => {
                    state.result = null;
                    state.lastError = null;
                    state.isFetching = true;
                    state.notify();
                    const matchesSelection = () => (
                        state.selection.jYear === selectionSnapshot.jYear &&
                        state.selection.jMonth === selectionSnapshot.jMonth &&
                        state.selection.username === selectionSnapshot.username
                    );
                    try {
                        await state.pushSelection();
                        const res = await window.appApi.scanNow({ jYear, jMonth, username });
                        if (matchesSelection()) {
                            state.result = res;
                            state.lastError = res?.ok ? null : (res?.reason || null);
                        }
                        return res;
                    } catch (err) {
                        console.error('Failed to refresh report', err);
                        if (matchesSelection()) {
                            state.lastError = err;
                        }
                        throw err;
                    } finally {
                        if (state.pendingRefresh === run) {
                            state.isFetching = false;
                        }
                        state.notify();
                    }
                })();
                state.pendingRefresh = run;
                run.finally(() => {
                    if (state.pendingRefresh === run) {
                        state.pendingRefresh = null;
                    }
                });
                return run;
            }
        };

        if (typeof window.appApi?.onScanResult === 'function') {
            window.appApi.onScanResult((res) => {
                if (!res) return;
                const { jYear, jMonth, username } = state.selection;
                const resYear = Number.parseInt(res.jYear, 10);
                const resMonth = Number.parseInt(res.jMonth, 10);
                const resUsername = (res.username || res?.selection?.username || '').trim();
                const usernameMatches = !username || !resUsername || resUsername === username;
                if (resYear === jYear && resMonth === jMonth && usernameMatches) {
                    state.result = res;
                    state.lastError = res?.ok ? null : (res?.reason || null);
                    state.notify();
                }
            });
        }

        function snapshot() {
            return {
                selection: { ...state.selection },
                result: state.result,
                isFetching: state.isFetching,
                lastError: state.lastError
            };
        }

        return state;
    }

    function initUserSelect(selectEl, reportStateInstance) {
        const teamSelectEl = $('#sidebarTeamSelect');

        if (!selectEl) {
            return {
                enforceUserVisibility: async () => {},
                ready: Promise.resolve(),
                selectEl: null,
                teamSelectEl: null
            };
        }

        if (!teamSelectEl) {
            const fallbackUsers = getTeamUsers(DEFAULT_TEAM);
            selectEl.innerHTML = fallbackUsers.map((u) => `<option value="${u.value}">${u.text}</option>`).join('');
            const initialValue = selectEl.value || fallbackUsers[0]?.value || '';
            if (initialValue) {
                reportStateInstance.setSelection({ username: initialValue }, { silent: true });
            }
            selectEl.addEventListener('change', () => {
                const username = selectEl.value || null;
                if (!username) {
                    reportStateInstance.setSelection({ username: null }, { clearResult: true });
                    return;
                }
                reportStateInstance.setSelection({ username }, { pushSelection: true, refresh: true });
            });
            return {
                enforceUserVisibility: async () => {},
                ready: Promise.resolve(),
                selectEl,
                teamSelectEl: null
            };
        }

        let lastTeamOptionsKey = null;
        function renderTeamSelectOptions(allowedTeams = null) {
            let values = Array.isArray(allowedTeams) ? allowedTeams.filter(Boolean) : null;
            let key;
            if (!values) {
                key = '__ALL__';
            } else if (values.length === 0) {
                key = '__EMPTY__';
            } else {
                key = values.join('|');
            }
            if (key === lastTeamOptionsKey) {
                return;
            }
            const options = ['<option value="">Select a team…</option>'];
            if (!values) {
                TEAM_OPTIONS.forEach((team) => {
                    options.push(`<option value="${team.value}">${team.text}</option>`);
                });
            } else {
                const allowedSet = new Set(values);
                TEAM_OPTIONS.forEach((team) => {
                    if (allowedSet.has(team.value)) {
                        options.push(`<option value="${team.value}">${team.text}</option>`);
                    }
                });
            }
            teamSelectEl.innerHTML = options.join('');
            lastTeamOptionsKey = key;
        }

        renderTeamSelectOptions();

        const initialSelection = reportStateInstance.getSelection();
        const initialTeam = (initialSelection.team && TEAM_USERS.has(initialSelection.team))
            ? initialSelection.team
            : '';
        teamSelectEl.value = initialTeam;
        renderUserOptions(initialTeam, initialSelection.username || '');

        teamSelectEl.addEventListener('change', async () => {
            const team = teamSelectEl.value || '';
            renderUserOptions(team, '');
            await reportStateInstance.setSelection({ team: team || null, username: null }, { clearResult: true });
        });

        selectEl.addEventListener('change', async () => {
            const username = selectEl.value || null;
            if (!username) {
                await reportStateInstance.setSelection({ username: null }, { clearResult: true });
                return;
            }
            await reportStateInstance.setSelection({ username }, { pushSelection: true, refresh: true });
        });

        reportStateInstance.subscribe((state) => {
            const selection = state.selection || {};
            const { team, username } = selection;
            if (team && TEAM_USERS.has(team) && teamSelectEl.value !== team) {
                teamSelectEl.value = team;
                renderUserOptions(team, username || '');
                return;
            }
            if (team && TEAM_USERS.has(team)) {
                const users = getTeamUsers(team);
                if (username && !users.some((u) => u.value === username)) {
                    ensureUserInTeamMap(team, { value: username, text: username });
                    renderUserOptions(team, username);
                    return;
                }
            } else if (!team) {
                if (teamSelectEl.value !== '') {
                    teamSelectEl.value = '';
                }
                renderUserOptions('', username || '');
            }
            const desiredValue = username || '';
            if (selectEl.value !== desiredValue) {
                selectEl.value = desiredValue;
            }
        });

        async function enforceUserVisibility() {
            if (typeof window.appApi?.whoami !== 'function') return;
            try {
                const who = await window.appApi.whoami();
                if (!who?.ok) {
                    return;
                }
                const self = (who.username || '').trim();
                if (!self) return;
                const displayName = (who.raw?.displayName || '').trim() || self;

                const currentSelection = reportStateInstance.getSelection();
                const adminTeams = getAdminTeamsForUser(self);
                const isAdmin = adminTeams.length > 0;
                let teamForSelf = findTeamForUser(self) || '';
                if (teamForSelf) {
                    ensureUserInTeamMap(teamForSelf, { value: self, text: displayName });
                }

                if (!isAdmin) {
                    renderTeamSelectOptions();
                    if (!teamForSelf) {
                        teamForSelf = teamSelectEl.value || DEFAULT_TEAM || TEAM_OPTIONS[0]?.value || '';
                        if (teamForSelf) {
                            ensureUserInTeamMap(teamForSelf, { value: self, text: displayName });
                        }
                    }
                    if (teamForSelf) {
                        teamSelectEl.value = teamForSelf;
                        renderUserOptions(teamForSelf, self);
                        teamSelectEl.disabled = true;
                        selectEl.disabled = true;
                        await reportStateInstance.setSelection(
                            { team: teamForSelf, username: self },
                            { pushSelection: true, refresh: true, clearResult: true }
                        );
                    }
                } else {
                    renderTeamSelectOptions(adminTeams);
                    teamSelectEl.disabled = false;
                    selectEl.disabled = false;
                    let activeTeam = currentSelection.team && adminTeams.includes(currentSelection.team)
                        ? currentSelection.team
                        : '';
                    if (!activeTeam && adminTeams.length > 0) {
                        activeTeam = adminTeams[0];
                    }
                    if (teamSelectEl.value !== activeTeam) {
                        teamSelectEl.value = activeTeam;
                    }
                    const selectedUser = currentSelection.username || selectEl.value || '';
                    const isUserInTeam = activeTeam
                        ? getTeamUsers(activeTeam).some((user) => user.value === selectedUser)
                        : false;
                    renderUserOptions(activeTeam, isUserInTeam ? selectedUser : '');
                    const shouldUpdateSelection = (currentSelection.team || '') !== (activeTeam || '')
                        || (selectedUser && !isUserInTeam);
                    if (shouldUpdateSelection) {
                        await reportStateInstance.setSelection(
                            {
                                team: activeTeam || null,
                                username: isUserInTeam ? selectedUser : null
                            },
                            {
                                pushSelection: true,
                                refresh: Boolean(isUserInTeam && selectedUser),
                                clearResult: !isUserInTeam
                            }
                        );
                    }
                }
            } catch (err) {
                console.error('Failed to determine user visibility', err);
            }
        }

        const ready = enforceUserVisibility();

        return { enforceUserVisibility, ready, selectEl, teamSelectEl };

        function renderUserOptions(team, selectedUser) {
            const normalizedTeam = team || '';
            const users = normalizedTeam ? getTeamUsers(normalizedTeam) : [];
            const options = ['<option value="">Select a user…</option>'];
            users.forEach((u) => {
                options.push(`<option value="${u.value}">${u.text}</option>`);
            });
            selectEl.innerHTML = options.join('');
            if (selectedUser && users.some((u) => u.value === selectedUser)) {
                selectEl.value = selectedUser;
            } else {
                selectEl.value = '';
            }
        }
    }

    function initLoadingOverlay(reportStateInstance) {
        const overlay = $('#loadingOverlay');
        if (!overlay || typeof reportStateInstance?.subscribe !== 'function') {
            return;
        }
        const panel = overlay.querySelector('.loading-overlay__panel');
        const setActive = (active) => {
            const isActive = !!active;
            overlay.classList.toggle('is-active', isActive);
            overlay.setAttribute('aria-hidden', isActive ? 'false' : 'true');
            if (panel) {
                panel.setAttribute('aria-busy', isActive ? 'true' : 'false');
            }
        };
        let currentState = false;
        reportStateInstance.subscribe((state) => {
            const shouldShow = Boolean(state?.isFetching);
            if (shouldShow === currentState) {
                return;
            }
            currentState = shouldShow;
            setActive(shouldShow);
        });
    }

    async function initSelectionControls(reportStateInstance, settingsPromise) {
        const yearSelect = $('#sidebarJYear');
        const monthSelect = $('#sidebarJMonth');
        const timeOffSelect = $('#sidebarTimeOffHours');

        if (!yearSelect || !monthSelect || !timeOffSelect) {
            return;
        }

        const settings = await Promise.resolve(settingsPromise).catch(() => ({}));

        const settingsYear = parseJalaaliInt(settings?.defaultJYear);
        const settingsMonth = parseJalaaliInt(settings?.defaultJMonth);
        const settingsTimeOff = Number.parseFloat(settings?.defaultTimeOffHours);

        const currentYear = getCurrentJalaaliYear();
        const baseYear = settingsYear ?? currentYear ?? 1400;
        const years = buildYearRange(baseYear, settingsYear, currentYear);
        yearSelect.innerHTML = years.map((year) => `<option value="${year}">${year}</option>`).join('');
        ensureOption(yearSelect, baseYear);

        const currentMonth = getCurrentJalaaliMonth();
        const initialMonth = Number.isFinite(settingsMonth) && settingsMonth >= 1 && settingsMonth <= 12
            ? settingsMonth
            : (currentMonth ?? 1);
        monthSelect.innerHTML = PERSIAN_MONTHS.map((name, idx) => `<option value="${idx + 1}">${name}</option>`).join('');
        ensureOption(monthSelect, initialMonth, PERSIAN_MONTHS[initialMonth - 1] || String(initialMonth));
        monthSelect.value = String(initialMonth);

        const timeOffOptions = buildTimeOffOptions();
        timeOffSelect.innerHTML = timeOffOptions.map(({ value, label }) => `<option value="${value}">${label}</option>`).join('');
        const initialTimeOff = Number.isFinite(settingsTimeOff) && settingsTimeOff >= 0 ? settingsTimeOff : 0;
        ensureTimeOffOption(timeOffSelect, initialTimeOff);
        timeOffSelect.value = timeOffKey(initialTimeOff);

        yearSelect.value = String(baseYear);

        await reportStateInstance.setSelection({
            jYear: baseYear,
            jMonth: initialMonth,
            timeOffHours: initialTimeOff
        }, { silent: true });

        yearSelect.addEventListener('change', async () => {
            const parsed = parseJalaaliInt(yearSelect.value);
            await reportStateInstance.setSelection({ jYear: parsed }, { pushSelection: true, refresh: true });
        });

        monthSelect.addEventListener('change', async () => {
            const parsed = parseJalaaliInt(monthSelect.value);
            await reportStateInstance.setSelection({ jMonth: parsed }, { pushSelection: true, refresh: true });
        });

        timeOffSelect.addEventListener('change', async () => {
            const parsed = Number.parseFloat(timeOffSelect.value);
            const clean = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
            ensureTimeOffOption(timeOffSelect, clean);
            timeOffSelect.value = timeOffKey(clean);
            await reportStateInstance.setSelection({ timeOffHours: clean }, { refresh: true });
        });

        reportStateInstance.subscribe((state) => {
            const selection = state.selection || {};
            if (Number.isFinite(selection.jYear)) {
                ensureOption(yearSelect, selection.jYear);
                if (yearSelect.value !== String(selection.jYear)) {
                    yearSelect.value = String(selection.jYear);
                }
            }
            if (Number.isFinite(selection.jMonth)) {
                ensureOption(monthSelect, selection.jMonth, PERSIAN_MONTHS[selection.jMonth - 1] || String(selection.jMonth));
                if (monthSelect.value !== String(selection.jMonth)) {
                    monthSelect.value = String(selection.jMonth);
                }
            }
            const timeOff = Number.parseFloat(selection.timeOffHours);
            if (Number.isFinite(timeOff) && timeOff >= 0) {
                ensureTimeOffOption(timeOffSelect, timeOff);
                const key = timeOffKey(timeOff);
                if (timeOffSelect.value !== key) {
                    timeOffSelect.value = key;
                }
            }
        });

        function ensureOption(selectEl, value, label = String(value)) {
            const valueStr = String(value);
            if (![...selectEl.options].some((opt) => opt.value === valueStr)) {
                const opt = document.createElement('option');
                opt.value = valueStr;
                opt.textContent = label;
                selectEl.appendChild(opt);
            }
        }

        function ensureTimeOffOption(selectEl, value) {
            const key = timeOffKey(value);
            if (![...selectEl.options].some((opt) => opt.value === key)) {
                const opt = document.createElement('option');
                opt.value = key;
                opt.textContent = displayTimeOffLabel(value);
                selectEl.appendChild(opt);
            }
        }
    }

    async function initMonthlySummary(root, reportStateInstance) {
        if (!root || root.dataset.controllerReady === 'true') return {};
        root.dataset.controllerReady = 'true';

        const table = root.querySelector('#results');
        const tbody = table?.querySelector('tbody');
        const footerTotals = root.querySelector('#footerTotals');
        const debug = root.querySelector('#debug');

        if (!table || !tbody || !footerTotals) {
            console.warn('Monthly summary view missing required elements.');
            return {};
        }

        const tableEnhancer = new TableEnhancer(table, {
            exportFileName: 'monthly-summary',
            columns: [
                { key: 'index', label: '#', sortable: false, isSequence: true },
                { key: 'jalaali', label: 'Jalaali', sortable: true, filterable: true, type: 'date' },
                { key: 'weekday', label: 'Weekday', sortable: true, filterable: true },
                { key: 'flags', label: 'Flags', sortable: true, filterable: true },
                { key: 'hours', label: 'Hours', sortable: true, type: 'number' }
            ]
        });

        reportStateInstance.subscribe((state) => {
            renderSummary(state);
        });

        function renderSummary(state) {
            const res = state.result;
            if (state.isFetching && !res) {
                table.style.display = 'table';
                setTableMessage(tbody, 5, 'Loading…');
                updateFooter(null);
                tableEnhancer.clear();
                if (debug) debug.textContent = '';
                return;
            }

            if (!res || !res.ok) {
                if (res) {
                    table.style.display = 'table';
                    setTableMessage(tbody, 5, res.reason || 'No data available.');
                } else {
                    table.style.display = 'none';
                    tbody.innerHTML = '';
                }
                updateFooter(null);
                tableEnhancer.clear();
                if (debug) debug.textContent = '';
                return;
            }

            const days = Array.isArray(res.days) ? res.days : [];
            table.style.display = 'table';
            tbody.innerHTML = '';
            days.forEach((d, idx) => {
                const tr = document.createElement('tr');
                tr.className = d.color || '';
                const flags = [
                    d.isFuture ? 'future' : '',
                    d.isThuFri ? 'Thu/Fri' : '',
                    d.isHoliday ? 'holiday' : '',
                    d.isWorkday === false ? 'non-workday' : ''
                ].filter(Boolean).join(', ');
                const gregorian = escapeHtml(d.g || '');
                const jalaali = escapeHtml(d.j || '');
                const weekday = escapeHtml(weekdayName(d.weekday));
                const flagsText = escapeHtml(flags);
                const hoursValue = Number(d.hours || 0);
                const hoursText = Number.isFinite(hoursValue) ? hoursValue.toFixed(2) : '0.00';
                const sortValue = Number.isFinite(Date.parse(d.g)) ? String(Date.parse(d.g)) : gregorian || jalaali;
                tr.innerHTML = `
                    <td data-sort-value="${idx + 1}" data-export-value="${idx + 1}">${idx + 1}</td>
                    <td data-sort-value="${escapeHtml(sortValue)}" data-filter-value="${jalaali}" data-export-value="${jalaali}"><span class="tip" data-tip="${gregorian}">${jalaali}</span></td>
                    <td data-sort-value="${weekday}" data-filter-value="${weekday}" data-export-value="${weekday}">${weekday}</td>
                    <td data-sort-value="${flagsText}" data-filter-value="${flagsText}" data-export-value="${flagsText}"><small>${flagsText}</small></td>
                    <td data-sort-value="${hoursValue}" data-export-value="${hoursText}" data-numeric-value="${hoursValue}">${hoursText}</td>
                `;
                tbody.appendChild(tr);
            });

            tableEnhancer.refresh();
            updateFooter(state);
            if (debug) {
                const selection = reportStateInstance.getSelection();
                debug.textContent = JSON.stringify({
                    username: selection.username,
                    selection: {
                        jYear: selection.jYear,
                        jMonth: selection.jMonth
                    },
                    jql: res.jql,
                    month: res.jMonthLabel,
                    timeOffHours: selection.timeOffHours,
                    totals: {
                        totalHours: res.totalHours,
                        expectedByNowHours: res.expectedByNowHours,
                        expectedByEndMonthHours: res.expectedByEndMonthHours
                    },
                    worklogsRows: res.worklogs?.length ?? 0,
                    deficitsSample: Array.isArray(res.deficits) ? res.deficits.slice(0, 10) : []
                }, null, 2);
            }
        }

        function updateFooter(state) {
            if (!state || !state.result || !state.result.ok) {
                footerTotals.innerHTML = `<div class="footer-grid"><span class="pill">Totals here…</span></div>`;
                return;
            }
            const res = state.result;
            const selection = state.selection || {};
            const total = +(res.totalHours ?? 0);
            const expectedNow = +(res.expectedByNowHours ?? 0);
            const expectedEnd = +(res.expectedByEndMonthHours ?? 0);
            const timeOff = Math.max(0, Number.parseFloat(selection.timeOffHours ?? 0) || 0);
            const adjusted = total + timeOff;
            const deltaEnd = adjusted - expectedEnd;
            const deltaCls = deltaEnd >= 0 ? 'delta-pos' : 'delta-neg';
            const deltaLabel = deltaEnd >= 0 ? 'Surplus vs end' : 'Shortfall vs end';

            footerTotals.innerHTML = `
                <div class="footer-grid">
                    <span class="pill"><strong>Month:</strong> ${res.jMonthLabel}</span>
                    <span class="pill"><strong>Total:</strong> ${total.toFixed(2)} h</span>
                    <span class="pill"><strong>Time-off:</strong> ${timeOff.toFixed(2)} h</span>
                    <span class="pill"><strong>Adjusted:</strong> ${adjusted.toFixed(2)} h</span>
                    <span class="pill"><strong>Now:</strong> ${expectedNow.toFixed(2)} h</span>
                    <span class="pill"><strong>End:</strong> ${expectedEnd.toFixed(2)} h</span>
                    <span class="pill ${deltaCls}"><strong>${deltaLabel}:</strong> ${deltaEnd.toFixed(2)} h</span>
                </div>
            `;
        }

        return {
            onShow: () => reportStateInstance.refresh()
        };
    }

    async function initConfigurations(root, reportStateInstance, userSelectCtx, settingsPromise) {
        if (!root || root.dataset.controllerReady === 'true') return {};
        root.dataset.controllerReady = 'true';

        const baseUrl = root.querySelector('#configBaseUrl');
        const baseUrlWrap = root.querySelector('#configBaseUrlWrap');
        const saveBtn = root.querySelector('#configSave');

        if (!baseUrl || !baseUrlWrap || !saveBtn) {
            console.warn('Configurations view missing required elements.');
            return {};
        }

        const settings = await Promise.resolve(settingsPromise).catch(() => ({}));
        baseUrl.value = settings?.baseUrl || '';
        updateBaseUrlUI();

        baseUrl.addEventListener('input', updateBaseUrlUI);
        baseUrl.addEventListener('blur', () => {
            baseUrl.value = stripTrailingSlash(sanitizeUrl(baseUrl.value));
            updateBaseUrlUI();
        });

        saveBtn.addEventListener('click', async () => {
            baseUrl.value = stripTrailingSlash(sanitizeUrl(baseUrl.value));
            updateBaseUrlUI();
            if (typeof window.appApi?.saveSettings === 'function') {
                try {
                    await window.appApi.saveSettings({ baseUrl: baseUrl.value });
                } catch (err) {
                    console.error('Failed to save settings', err);
                }
            } else {
                console.warn('saveSettings API is not available.');
            }
            if (userSelectCtx?.enforceUserVisibility) {
                await userSelectCtx.enforceUserVisibility();
            }
            await reportStateInstance.refresh({ force: true });
        });

        function updateBaseUrlUI() {
            const value = sanitizeUrl(baseUrl.value);
            baseUrlWrap.classList.remove('is-valid', 'is-invalid');
            if (!value) return;
            if (isLikelyUrl(value)) {
                baseUrlWrap.classList.add('is-valid');
            } else {
                baseUrlWrap.classList.add('is-invalid');
            }
        }

        return {};
    }

    function initDetailedWorklogs(root, reportStateInstance) {
        if (!root || root.dataset.controllerReady === 'true') return {};
        root.dataset.controllerReady = 'true';

        const table = root.querySelector('#detailedWorklogsTable');
        const tbody = table?.querySelector('tbody');
        if (!table || !tbody) {
            console.warn('Detailed worklogs view missing required elements.');
            return {};
        }

        const tableEnhancer = new TableEnhancer(table, {
            exportFileName: 'detailed-worklogs',
            columns: [
                { key: 'index', label: '#', sortable: false, isSequence: true },
                { key: 'jalaaliDate', label: 'Jalaali Date', sortable: true, filterable: true, type: 'date' },
                { key: 'type', label: 'Type', sortable: true, filterable: true },
                { key: 'issue', label: 'Issue', sortable: true },
                { key: 'summary', label: 'Summary', sortable: true },
                { key: 'hours', label: 'Hours', sortable: true, type: 'number' },
                { key: 'timeSpent', label: 'Time Spent', sortable: true },
                { key: 'comment', label: 'Comment', sortable: true }
            ]
        });

        setupIssueLinkHandler(root);

        reportStateInstance.subscribe((state) => {
            if (state.isFetching && !state.result) {
                tableEnhancer.clear();
                setTableMessage(tbody, 8, 'Loading…');
                return;
            }

            const res = state.result;
            if (!res || !res.ok) {
                tableEnhancer.clear();
                const message = res ? (res.reason || 'Unable to load worklogs.') : 'No data yet.';
                setTableMessage(tbody, 8, message);
                return;
            }

            const worklogs = Array.isArray(res.worklogs) ? res.worklogs : [];
            if (!worklogs.length) {
                tableEnhancer.clear();
                setTableMessage(tbody, 8, 'No worklogs found.');
                return;
            }

            tbody.innerHTML = '';
            Array.from(new Set(worklogs)).forEach((w, idx) => {
                const tr = document.createElement('tr');
                const issueUrl = buildIssueUrl(res.baseUrl, w.issueKey);
                const issueCell = renderIssueLink(w.issueKey, issueUrl);
                const jalaliDate = escapeHtml(w.persianDate || '');
                const gregorianDate = escapeHtml(w.date || '');
                const issueType = escapeHtml(w.issueType || '');
                const issueKey = escapeHtml((w.issueKey || '').toString().trim());
                const summaryRaw = (w.summary || '').toString().replace(/\n/g, ' ');
                const summary = escapeHtml(summaryRaw);
                const hoursValue = Number(w.hours || 0);
                const hoursText = Number.isFinite(hoursValue) ? hoursValue.toFixed(2) : '0.00';
                const timeSpent = escapeHtml((w.timeSpent || '').toString());
                const commentRaw = (w.comment || '').toString().replace(/\n/g, ' ');
                const comment = escapeHtml(commentRaw);
                const sortTimestamp = Number.isFinite(Date.parse(w.date)) ? String(Date.parse(w.date)) : gregorianDate || jalaliDate;
                tr.innerHTML = `
                    <td data-sort-value="${idx + 1}" data-export-value="${idx + 1}">${idx + 1}</td>
                    <td data-sort-value="${escapeHtml(sortTimestamp)}" data-filter-value="${jalaliDate}" data-export-value="${jalaliDate}"><span class="tip" data-tip="${gregorianDate}">${jalaliDate}</span></td>
                    <td data-sort-value="${issueType}" data-filter-value="${issueType}" data-export-value="${issueType}">${issueType || '—'}</td>
                    <td data-sort-value="${issueKey}" data-filter-value="${issueKey}" data-export-value="${issueKey}">${issueCell || '—'}</td>
                    <td data-sort-value="${summary}" data-export-value="${summary}">${summary || '—'}</td>
                    <td data-sort-value="${hoursValue}" data-export-value="${hoursText}" data-numeric-value="${hoursValue}">${hoursText}</td>
                    <td data-sort-value="${timeSpent}" data-filter-value="${timeSpent}" data-export-value="${timeSpent}">${timeSpent}</td>
                    <td data-sort-value="${comment}" data-export-value="${comment}">${comment || '—'}</td>
                `;
                if (!w.dueDate) {
                    tr.classList.add('no-due-date');
                }
                tbody.appendChild(tr);
            });
            tableEnhancer.refresh();
        });

        return {
            onShow: () => reportStateInstance.refresh()
        };
    }

    function initDueIssues(root, reportStateInstance) {
        if (!root || root.dataset.controllerReady === 'true') return {};
        root.dataset.controllerReady = 'true';

        const table = root.querySelector('#dueThisMonthTable');
        const tbody = table?.querySelector('tbody');
        const tfoot = table?.querySelector('tfoot');
        const footerCells = {
            estimate: tfoot?.querySelector('[data-footer-field="estimate"]') || null,
            logged: tfoot?.querySelector('[data-footer-field="logged"]') || null,
            remaining: tfoot?.querySelector('[data-footer-field="remaining"]') || null,
        };

        function resetFooter() {
            if (!tfoot) return;
            Array.from(tfoot.querySelectorAll('td')).forEach((cell) => {
                if (!cell.dataset.footerField) {
                    cell.textContent = '—';
                }
            });
            Object.values(footerCells).forEach((cell) => {
                if (cell) cell.textContent = '—';
            });
        }

        function updateFooter(totals) {
            if (!tfoot) return;
            resetFooter();
            if (!totals) return;
            if (footerCells.estimate) footerCells.estimate.textContent = totals.estimate;
            if (footerCells.logged) footerCells.logged.textContent = totals.logged;
            if (footerCells.remaining) footerCells.remaining.textContent = totals.remaining;
        }

        if (!table || !tbody) {
            console.warn('Due issues view missing required elements.');
            return {};
        }

        const tableEnhancer = new TableEnhancer(table, {
            exportFileName: 'due-issues',
            columns: [
                { key: 'index', label: '#', sortable: false, isSequence: true },
                { key: 'dueDate', label: 'Due Date (Jalaali)', sortable: true, filterable: true, type: 'date' },
                { key: 'type', label: 'Type', sortable: true, filterable: true },
                { key: 'issue', label: 'Issue', sortable: true },
                { key: 'title', label: 'Title', sortable: true },
                { key: 'sprints', label: 'Sprints', sortable: true },
                { key: 'status', label: 'Status', sortable: true, filterable: true },
                { key: 'estimate', label: 'Estimate (h)', sortable: true, type: 'number' },
                { key: 'logged', label: 'Logged (h)', sortable: true, type: 'number' },
                { key: 'remaining', label: 'Remaining (h)', sortable: true, type: 'number' }
            ],
            onVisibleRowsChanged: (rows) => {
                if (!rows.length) {
                    resetFooter();
                    return;
                }
                const totals = rows.reduce((acc, row) => {
                    acc.estimate += Number(row.byKey.estimate?.numericValue ?? 0);
                    acc.logged += Number(row.byKey.logged?.numericValue ?? 0);
                    acc.remaining += Number(row.byKey.remaining?.numericValue ?? 0);
                    return acc;
                }, { estimate: 0, logged: 0, remaining: 0 });
                updateFooter({
                    estimate: totals.estimate.toFixed(2),
                    logged: totals.logged.toFixed(2),
                    remaining: totals.remaining.toFixed(2)
                });
            }
        });

        setupIssueLinkHandler(root);

        reportStateInstance.subscribe((state) => {
            if (state.isFetching && !state.result) {
                setTableMessage(tbody, 10, 'Loading…');
                resetFooter();
                tableEnhancer.clear();
                return;
            }

            const res = state.result;
            if (!res || !res.ok) {
                const message = res ? (res.reason || 'Unable to load due issues.') : 'No data yet.';
                setTableMessage(tbody, 10, message);
                resetFooter();
                tableEnhancer.clear();
                return;
            }

            const issues = Array.isArray(res.dueIssuesCurrentMonth) ? res.dueIssuesCurrentMonth : [];
            if (!issues.length) {
                setTableMessage(tbody, 10, '—');
                resetFooter();
                tableEnhancer.clear();
                return;
            }

            tbody.innerHTML = '';
            issues.forEach((issue, idx) => {
                const summary = (issue.summary || '').toString().replace(/\n/g, ' ');
                const tr = document.createElement('tr');
                const issueUrl = buildIssueUrl(res.baseUrl, issue.issueKey);
                const issueCell = renderIssueLink(issue.issueKey, issueUrl);
                const dueJalaali = escapeHtml(issue.dueDateJalaali || issue.dueDate || '');
                const dueGregorian = escapeHtml(issue.dueDateGregorian || issue.dueDate || '');
                const issueType = escapeHtml(issue.issueType || '');
                const sprints = Array.isArray(issue.sprints) ? issue.sprints.filter(Boolean) : [];
                const sprintText = escapeHtml(sprints.length ? sprints.join(', ') : '—');
                const estimateHours = Number(issue.estimateHours || 0);
                const loggedHours = Number(issue.loggedHours || 0);
                const remainingHours = Number(issue.remainingHours || 0);
                const estimateText = Number.isFinite(estimateHours) ? estimateHours.toFixed(2) : '0.00';
                const loggedText = Number.isFinite(loggedHours) ? loggedHours.toFixed(2) : '0.00';
                const remainingText = Number.isFinite(remainingHours) ? remainingHours.toFixed(2) : '0.00';
                const issueKey = escapeHtml((issue.issueKey || '').toString().trim());
                const status = escapeHtml(issue.status || '');
                const sortTimestamp = Number.isFinite(Date.parse(issue.dueDateGregorian || issue.dueDate))
                    ? String(Date.parse(issue.dueDateGregorian || issue.dueDate))
                    : dueGregorian || dueJalaali;
                tr.innerHTML = `
                    <td data-sort-value="${idx + 1}" data-export-value="${idx + 1}">${idx + 1}</td>
                    <td data-sort-value="${escapeHtml(sortTimestamp)}" data-filter-value="${dueJalaali}" data-export-value="${dueJalaali}"><span class="tip" data-tip="${dueGregorian}">${dueJalaali}</span></td>
                    <td data-sort-value="${issueType}" data-filter-value="${issueType}" data-export-value="${issueType}">${issueType || '—'}</td>
                    <td data-sort-value="${issueKey}" data-filter-value="${issueKey}" data-export-value="${issueKey}">${issueCell || '—'}</td>
                    <td data-sort-value="${escapeHtml(summary)}" data-export-value="${escapeHtml(summary)}">${escapeHtml(summary) || '—'}</td>
                    <td data-sort-value="${sprintText}" data-export-value="${sprintText}">${sprintText}</td>
                    <td data-sort-value="${status}" data-filter-value="${status}" data-export-value="${status}">${status || '—'}</td>
                    <td data-sort-value="${estimateHours}" data-export-value="${estimateText}" data-numeric-value="${estimateHours}">${estimateText}</td>
                    <td data-sort-value="${loggedHours}" data-export-value="${loggedText}" data-numeric-value="${loggedHours}">${loggedText}</td>
                    <td data-sort-value="${remainingHours}" data-export-value="${remainingText}" data-numeric-value="${remainingHours}">${remainingText}</td>
                `;
                tbody.appendChild(tr);
            });
            tableEnhancer.refresh();
        });

        return {
            onShow: () => reportStateInstance.refresh()
        };
    }

    function initIssuesReport(root, reportStateInstance) {
        if (!root || root.dataset.controllerReady === 'true') return {};
        root.dataset.controllerReady = 'true';

        const table = root.querySelector('#issuesTable');
        const tbody = table?.querySelector('tbody');
        const tfoot = table?.querySelector('tfoot');
        const footerCells = {
            estimate: tfoot?.querySelector('[data-footer-field="estimate"]') || null,
            logged: tfoot?.querySelector('[data-footer-field="logged"]') || null,
            remaining: tfoot?.querySelector('[data-footer-field="remaining"]') || null,
        };

        function resetFooter() {
            if (!tfoot) return;
            Array.from(tfoot.querySelectorAll('td')).forEach((cell) => {
                if (!cell.dataset.footerField) {
                    cell.textContent = '—';
                }
            });
            Object.values(footerCells).forEach((cell) => {
                if (cell) cell.textContent = '—';
            });
        }

        function updateFooter(totals) {
            if (!tfoot) return;
            resetFooter();
            if (!totals) return;
            if (footerCells.estimate) footerCells.estimate.textContent = totals.estimate;
            if (footerCells.logged) footerCells.logged.textContent = totals.logged;
            if (footerCells.remaining) footerCells.remaining.textContent = totals.remaining;
        }

        if (!table || !tbody) {
            console.warn('Issues view missing required elements.');
            return {};
        }

        const tableEnhancer = new TableEnhancer(table, {
            exportFileName: 'issues',
            columns: [
                { key: 'index', label: '#', sortable: false, isSequence: true },
                { key: 'updated', label: 'Updated (Jalaali)', sortable: true, filterable: true, type: 'date' },
                { key: 'dueDate', label: 'Due Date (Jalaali)', sortable: true, filterable: true, type: 'date' },
                { key: 'type', label: 'Type', sortable: true, filterable: true },
                { key: 'issue', label: 'Issue', sortable: true },
                { key: 'title', label: 'Title', sortable: true },
                { key: 'sprints', label: 'Sprints', sortable: true },
                { key: 'project', label: 'Project', sortable: true },
                { key: 'board', label: 'Board', sortable: true },
                { key: 'status', label: 'Status', sortable: true, filterable: true },
                { key: 'estimate', label: 'Estimate (h)', sortable: true, type: 'number' },
                { key: 'logged', label: 'Logged (h)', sortable: true, type: 'number' },
                { key: 'remaining', label: 'Remaining (h)', sortable: true, type: 'number' }
            ],
            onVisibleRowsChanged: (rows) => {
                if (!rows.length) {
                    resetFooter();
                    return;
                }
                const totals = rows.reduce((acc, row) => {
                    acc.estimate += Number(row.byKey.estimate?.numericValue ?? 0);
                    acc.logged += Number(row.byKey.logged?.numericValue ?? 0);
                    acc.remaining += Number(row.byKey.remaining?.numericValue ?? 0);
                    return acc;
                }, { estimate: 0, logged: 0, remaining: 0 });
                updateFooter({
                    estimate: totals.estimate.toFixed(2),
                    logged: totals.logged.toFixed(2),
                    remaining: totals.remaining.toFixed(2)
                });
            }
        });

        setupIssueLinkHandler(root);

        reportStateInstance.subscribe((state) => {
            if (state.isFetching && !state.result) {
                setTableMessage(tbody, 13, 'Loading…');
                resetFooter();
                tableEnhancer.clear();
                return;
            }

            const res = state.result;
            if (!res || !res.ok) {
                const message = res ? (res.reason || 'Unable to load issues.') : 'No data yet.';
                setTableMessage(tbody, 13, message);
                resetFooter();
                tableEnhancer.clear();
                return;
            }

            const issues = Array.isArray(res.assignedIssues) ? res.assignedIssues : [];
            if (!issues.length) {
                setTableMessage(tbody, 13, 'No issues found.');
                resetFooter();
                tableEnhancer.clear();
                return;
            }

            tbody.innerHTML = '';

            issues.forEach((issue, idx) => {
                const tr = document.createElement('tr');
                const issueKey = issue.issueKey || '';
                const issueUrl = buildIssueUrl(res.baseUrl, issueKey);
                const issueCell = issueKey ? renderIssueLink(issueKey, issueUrl) : '—';
                const updatedDisplay = escapeHtml(issue.updatedJalaali || '');
                const updatedTooltip = escapeHtml(issue.updatedGregorian || '');
                const dueDisplay = escapeHtml(issue.dueDateJalaali || '');
                const dueTooltip = escapeHtml(issue.dueDateGregorian || '');
                const issueType = escapeHtml(issue.issueType || '');
                const summary = escapeHtml((issue.summary || '').toString().replace(/\n/g, ' '));
                const sprints = Array.isArray(issue.sprints) ? issue.sprints.filter(Boolean) : [];
                const sprintText = escapeHtml(sprints.length ? sprints.join(', ') : '—');
                const projectName = issue.projectName || issue.projectKey || '';
                const projectText = projectName ? escapeHtml(projectName) : '—';
                const boards = Array.isArray(issue.boardNames) ? issue.boardNames.filter(Boolean) : [];
                const boardText = boards.length ? escapeHtml(boards.join(', ')) : '—';
                const status = escapeHtml(issue.status || '');

                const estimateHours = Number(issue.estimateHours || 0);
                const loggedHours = Number(issue.loggedHours || 0);
                const remainingHours = Number(issue.remainingHours || 0);
                const estimateText = Number.isFinite(estimateHours) ? estimateHours.toFixed(2) : '0.00';
                const loggedText = Number.isFinite(loggedHours) ? loggedHours.toFixed(2) : '0.00';
                const remainingText = Number.isFinite(remainingHours) ? remainingHours.toFixed(2) : '0.00';
                const updatedSort = Number.isFinite(Date.parse(issue.updatedGregorian))
                    ? String(Date.parse(issue.updatedGregorian))
                    : updatedTooltip || updatedDisplay;
                const dueSort = Number.isFinite(Date.parse(issue.dueDateGregorian))
                    ? String(Date.parse(issue.dueDateGregorian))
                    : dueTooltip || dueDisplay;
                const issueKeySafe = escapeHtml(issueKey);

                const updatedCell = updatedDisplay
                    ? `<span class="tip" data-tip="${updatedTooltip || updatedDisplay}">${updatedDisplay}</span>`
                    : '<span class="muted">—</span>';
                const dueCell = dueDisplay
                    ? `<span class="tip" data-tip="${dueTooltip || dueDisplay}">${dueDisplay}</span>`
                    : '<span class="muted">—</span>';

                tr.innerHTML = `
                    <td data-sort-value="${idx + 1}" data-export-value="${idx + 1}">${idx + 1}</td>
                    <td data-sort-value="${escapeHtml(updatedSort)}" data-filter-value="${updatedDisplay}" data-export-value="${updatedDisplay}">${updatedCell}</td>
                    <td data-sort-value="${escapeHtml(dueSort)}" data-filter-value="${dueDisplay}" data-export-value="${dueDisplay}">${dueCell}</td>
                    <td data-sort-value="${issueType}" data-filter-value="${issueType}" data-export-value="${issueType}">${issueType || '—'}</td>
                    <td data-sort-value="${issueKeySafe}" data-filter-value="${issueKeySafe}" data-export-value="${issueKeySafe}">${issueCell}</td>
                    <td data-sort-value="${summary}" data-export-value="${summary}">${summary || '—'}</td>
                    <td data-sort-value="${sprintText}" data-export-value="${sprintText}">${sprintText}</td>
                    <td data-sort-value="${projectText}" data-export-value="${projectText}">${projectText}</td>
                    <td data-sort-value="${boardText}" data-export-value="${boardText}">${boardText}</td>
                    <td data-sort-value="${status}" data-filter-value="${status}" data-export-value="${status}">${status || '—'}</td>
                    <td data-sort-value="${estimateHours}" data-export-value="${estimateText}" data-numeric-value="${estimateHours}">${estimateText}</td>
                    <td data-sort-value="${loggedHours}" data-export-value="${loggedText}" data-numeric-value="${loggedHours}">${loggedText}</td>
                    <td data-sort-value="${remainingHours}" data-export-value="${remainingText}" data-numeric-value="${remainingHours}">${remainingText}</td>
                `;
                tbody.appendChild(tr);
            });
            tableEnhancer.refresh();
        });

        return {
            onShow: () => reportStateInstance.refresh()
        };
    }

    function initQuarterReport(root, reportStateInstance) {
        if (!root || root.dataset.controllerReady === 'true') return {};
        root.dataset.controllerReady = 'true';

        const table = root.querySelector('#quarterReportTable');
        const tbody = table?.querySelector('tbody');
        if (!table || !tbody) {
            console.warn('Quarter report view missing required elements.');
            return {};
        }

        const tableEnhancer = new TableEnhancer(table, {
            exportFileName: 'quarter-report',
            columns: [
                { key: 'season', label: 'Season', sortable: true, filterable: true },
                { key: 'month1', label: 'Month 1', sortable: true },
                { key: 'month2', label: 'Month 2', sortable: true },
                { key: 'month3', label: 'Month 3', sortable: true },
                { key: 'total', label: 'Quarter Total', sortable: true, type: 'number' },
                { key: 'expected', label: 'Expected', sortable: true, type: 'number' },
                { key: 'delta', label: 'Delta', sortable: true, type: 'number' }
            ]
        });

        reportStateInstance.subscribe((state) => {
            if (state.isFetching && !state.result) {
                setTableMessage(tbody, 7, 'Loading…');
                tableEnhancer.clear();
                return;
            }

            const res = state.result;
            if (!res || !res.ok) {
                const message = res ? (res.reason || 'Unable to load quarter report.') : 'No data yet.';
                setTableMessage(tbody, 7, message);
                tableEnhancer.clear();
                return;
            }

            const data = res.quarterReport;
            if (!data?.ok || !Array.isArray(data.seasons) || data.seasons.length === 0) {
                setTableMessage(tbody, 7, '—');
                tableEnhancer.clear();
                return;
            }

            tbody.innerHTML = '';
            data.seasons.forEach((season) => {
                const tr = document.createElement('tr');
                const months = Array.isArray(season.months) ? season.months.slice(0, 3) : [];
                while (months.length < 3) {
                    months.push(null);
                }
                const monthCells = months.map((month) => {
                    if (!month) {
                        return {
                            html: '<td data-sort-value="" data-export-value="—"><div class="quarter-month"><span class="muted">—</span></div></td>'
                        };
                    }
                    const label = month.label || `Month ${month.jMonth}`;
                    if (!month.ok) {
                        const reason = month.reason || 'No data';
                        const exportValue = `${label} – ${reason}`;
                        return {
                            html: `<td data-sort-value="${escapeHtml(label)}" data-export-value="${escapeHtml(exportValue)}"><div class="quarter-month"><strong>${label}</strong><span class="muted">${reason}</span></div></td>`
                        };
                    }
                    const delta = Number.parseFloat(month.delta || 0) || 0;
                    const deltaCls = delta >= 0 ? 'delta-pos' : 'delta-neg';
                    const totalHours = Number.parseFloat(month.totalHours || 0) || 0;
                    const expectedHours = Number.parseFloat(month.expectedHours || 0) || 0;
                    const exportValue = `${label}: ${formatHours(totalHours)} h (Exp ${formatHours(expectedHours)} h, Δ ${delta.toFixed(2)} h)`;
                    return {
                        html: `<td data-sort-value="${totalHours}" data-export-value="${escapeHtml(exportValue)}"><div class="quarter-month"><strong>${label}</strong><div>${formatHours(totalHours)} h</div><div class="muted">Exp ${formatHours(expectedHours)} h</div><div class="${deltaCls}">${delta.toFixed(2)} h</div></div></td>`
                    };
                });
                const totals = season.totals || {};
                const totalDelta = Number.parseFloat(totals.delta || 0) || 0;
                const totalDeltaCls = totalDelta >= 0 ? 'delta-pos' : 'delta-neg';
                const quarterTotal = Number.parseFloat(totals.totalHours || 0) || 0;
                const expectedHours = Number.parseFloat(totals.expectedHours || 0) || 0;
                tr.innerHTML = `
                    <td data-sort-value="${escapeHtml(season.label || 'Season')}" data-filter-value="${escapeHtml(season.label || 'Season')}" data-export-value="${escapeHtml(season.label || 'Season')}"><strong>${season.label || 'Season'}</strong></td>
                    ${monthCells.map((cell) => cell.html).join('')}
                    <td data-sort-value="${quarterTotal}" data-export-value="${formatHours(totals.totalHours)}" data-numeric-value="${quarterTotal}">${formatHours(totals.totalHours)} h</td>
                    <td data-sort-value="${expectedHours}" data-export-value="${formatHours(totals.expectedHours)}" data-numeric-value="${expectedHours}">${formatHours(totals.expectedHours)} h</td>
                    <td data-sort-value="${totalDelta}" data-export-value="${totalDelta.toFixed(2)}" data-numeric-value="${totalDelta}" class="${totalDeltaCls}">${totalDelta.toFixed(2)} h</td>
                `;
                tbody.appendChild(tr);
            });
            tableEnhancer.refresh();
        });

        return {
            onShow: () => reportStateInstance.refresh()
        };
    }

    function buildYearRange(baseYear, ...extra) {
        const values = new Set();
        const core = Number.isFinite(baseYear) ? baseYear : 1400;
        const start = Math.max(1300, core - 5);
        const end = Math.max(core + 5, start);
        for (let year = start; year <= end; year += 1) {
            values.add(year);
        }
        [baseYear, ...extra].forEach((val) => {
            if (Number.isFinite(val)) {
                values.add(val);
            }
        });
        return Array.from(values).sort((a, b) => a - b);
    }

    function buildTimeOffOptions() {
        const options = [];
        const maxHalfHours = 80 * 2;
        for (let i = 0; i <= maxHalfHours; i += 1) {
            const value = i / 2;
            options.push({ value: timeOffKey(value), label: displayTimeOffLabel(value) });
        }
        return options;
    }

    function timeOffKey(val) {
        const num = Number.isFinite(val) ? Math.max(0, val) : 0;
        return (Math.round(num * 100) / 100).toFixed(2);
    }

    function displayTimeOffLabel(val) {
        const num = Number.isFinite(val) ? Math.max(0, val) : 0;
        const normalised = Math.round(num * 100) / 100;
        return Number.isInteger(normalised) ? normalised.toFixed(0) : normalised.toFixed(1);
    }

    function getCurrentJalaaliYear() {
        try {
            const formatter = new Intl.DateTimeFormat('en-US-u-ca-persian', { year: 'numeric' });
            return parseJalaaliInt(formatter.format(new Date()));
        } catch (err) {
            return null;
        }
    }

    function getCurrentJalaaliMonth() {
        try {
            const formatter = new Intl.DateTimeFormat('en-US-u-ca-persian', { month: 'numeric' });
            return parseJalaaliInt(formatter.format(new Date()));
        } catch (err) {
            return null;
        }
    }

    async function loadSettings() {
        if (typeof window.appApi?.getSettings === 'function') {
            try {
                const settings = await window.appApi.getSettings();
                return settings || {};
            } catch (err) {
                console.error('Failed to load settings', err);
            }
        }
        return {};
    }

    function setupIssueLinkHandler(root) {
        if (!root || root.dataset.issueLinkHandlerAttached === 'true') return;
        root.addEventListener('click', (event) => {
            const link = event.target?.closest?.('a[data-issue-url]');
            if (!link) return;
            event.preventDefault();
            const url = link.dataset.issueUrl || link.getAttribute('href');
            if (!url) return;
            if (typeof window.appApi?.openExternal === 'function') {
                Promise.resolve(window.appApi.openExternal(url))
                    .then((res) => {
                        if (!res || res.ok !== true) {
                            window.open(url, '_blank', 'noopener,noreferrer');
                        }
                    })
                    .catch((err) => {
                        console.error('Failed to open external URL via app API', err);
                        window.open(url, '_blank', 'noopener,noreferrer');
                    });
            } else {
                window.open(url, '_blank', 'noopener,noreferrer');
            }
        });
        root.dataset.issueLinkHandlerAttached = 'true';
    }

    function renderIssueLink(issueKey, issueUrl) {
        const label = escapeHtml(issueKey ?? '');
        if (!label) return '';
        if (!issueUrl) return label;
        const safeUrl = escapeHtml(issueUrl);
        return `<a href="${safeUrl}" class="issue-link" data-issue-url="${safeUrl}" target="_blank" rel="noreferrer noopener">${label}</a>`;
    }

    function buildIssueUrl(baseUrl, issueKey) {
        const safeBase = stripTrailingSlash(sanitizeUrl(baseUrl || ''));
        const key = typeof issueKey === 'string' ? issueKey.trim() : String(issueKey ?? '').trim();
        if (!safeBase || !key) return null;
        if (!isLikelyUrl(safeBase)) return null;
        try {
            return `${safeBase}/browse/${encodeURIComponent(key)}`;
        } catch (err) {
            return `${safeBase}/browse/${key}`;
        }
    }

    function escapeHtml(value) {
        const str = String(value ?? '');
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
        return str.replace(/[&<>"']/g, (ch) => map[ch] || ch);
    }

    function setTableMessage(tbody, columns, message) {
        if (!tbody) return;
        tbody.innerHTML = '';
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = columns;
        td.textContent = message;
        tr.appendChild(td);
        tbody.appendChild(tr);
    }

    function parseJalaaliInt(val) {
        const parsed = Number.parseInt(toAsciiDigits(val), 10);
        return Number.isFinite(parsed) ? parsed : null;
    }

    function toAsciiDigits(val) {
        if (val == null) return '';
        const s = String(val);
        const map = {
            '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
            '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9'
        };
        return s.replace(/[0-9\u06F0-\u06F9\u0660-\u0669]/g, (ch) => map[ch] ?? ch);
    }

    function formatHours(val) {
        const num = Number.parseFloat(val);
        if (!Number.isFinite(num)) return '0.00';
        return num.toFixed(2);
    }

    function weekdayName(w) {
        const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        return names[w] || String(w ?? '');
    }

    function sanitizeUrl(u) {
        return (u || '').trim();
    }

    function stripTrailingSlash(u) {
        return u.replace(/\/+$/, '');
    }

    function isLikelyUrl(u) {
        return /^https?:\/\/[^/\s]+\.[^/\s]+/i.test(u);
    }
})();
