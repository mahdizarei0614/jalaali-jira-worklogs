(async function () {
    const $ = (selector, root = document) => root.querySelector(selector);
    const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

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
    const TEAM_LABELS = new Map(TEAM_DATA.map(({ value, label }) => [value, label || value]));
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
    const TABLE_FEATURES = new WeakMap();
    const TABLE_FEATURE_STATES = new Set();
    let tableFeatureResizeAttached = false;
    let SELF_USERNAME = null;

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
    const navItemParents = new Map();
    navItems.forEach((btn) => {
        const route = btn?.dataset?.route;
        if (!route) return;
        const parents = (btn.dataset.navParents || '')
            .split(/\s+/)
            .map((value) => value.trim())
            .filter(Boolean);
        navItemParents.set(route, parents);
        btn.dataset.navDepth = String(parents.length);
    });

    const navGroups = new Map();
    $$('[data-nav-group]').forEach((groupEl) => {
        if (!groupEl) return;
        const id = groupEl.dataset.navGroup;
        if (!id) return;
        const contentEl = groupEl.querySelector(`[data-nav-content="${id}"]`);
        const toggleEl = groupEl.querySelector(`[data-nav-toggle="${id}"]`);
        const parentId = groupEl.dataset.navParent || null;
        if (contentEl) {
            contentEl.hidden = true;
            contentEl.style.maxHeight = '0px';
        }
        if (toggleEl) {
            toggleEl.setAttribute('aria-expanded', 'false');
        }
        const state = {
            el: groupEl,
            parentId,
            toggleEl,
            contentEl,
            isOpen: false,
            isLocked: false
        };
        navGroups.set(id, state);
    });

    function suppressTransition(el) {
        if (!el) {
            return () => {};
        }
        const previous = el.style.transition;
        el.style.transition = 'none';
        // Force reflow so the transition disabling takes effect immediately.
        // eslint-disable-next-line no-unused-expressions
        el.offsetHeight;
        return () => {
            el.style.transition = previous;
        };
    }

    function setGroupOpen(id, open, { immediate = false } = {}) {
        const state = navGroups.get(id);
        if (!state) return;
        if (!open && state.isLocked) return;
        if (state.isOpen === open) return;

        const { contentEl } = state;
        const apply = () => {
            state.isOpen = open;
            state.el.classList.toggle('is-open', open);
            if (state.toggleEl) {
                state.toggleEl.setAttribute('aria-expanded', open ? 'true' : 'false');
            }
            if (!contentEl) return;
            if (open) {
                contentEl.hidden = false;
                const targetHeight = contentEl.scrollHeight;
                contentEl.style.maxHeight = `${targetHeight}px`;
                if (immediate) {
                    contentEl.style.maxHeight = 'none';
                } else {
                    const handleEnd = (event) => {
                        if (event.target !== contentEl) return;
                        contentEl.style.maxHeight = 'none';
                        contentEl.removeEventListener('transitionend', handleEnd);
                    };
                    contentEl.addEventListener('transitionend', handleEnd);
                }
            } else if (immediate) {
                contentEl.style.maxHeight = '0px';
                contentEl.hidden = true;
            } else {
                const startHeight = contentEl.scrollHeight;
                contentEl.style.maxHeight = `${startHeight}px`;
                requestAnimationFrame(() => {
                    contentEl.style.maxHeight = '0px';
                });
                const handleEnd = (event) => {
                    if (event.target !== contentEl) return;
                    contentEl.hidden = true;
                    contentEl.removeEventListener('transitionend', handleEnd);
                };
                contentEl.addEventListener('transitionend', handleEnd);
            }
        };

        if (immediate && contentEl) {
            const restore = suppressTransition(contentEl);
            apply();
            // Force layout to ensure the updated max-height sticks before restoring transition.
            // eslint-disable-next-line no-unused-expressions
            contentEl.offsetHeight;
            restore();
            if (open) {
                contentEl.style.maxHeight = 'none';
            }
        } else {
            apply();
        }

        if (!open) {
            collapseDescendants(id, { immediate });
        }
    }

    function collapseDescendants(id, options = {}) {
        navGroups.forEach((state, key) => {
            if (state.parentId === id && !state.isLocked) {
                setGroupOpen(key, false, options);
            }
        });
    }

    function closeSiblingGroups(id, options = {}) {
        const state = navGroups.get(id);
        if (!state) return;
        const parentId = state.parentId || null;
        navGroups.forEach((s, key) => {
            if (key === id) return;
            if ((s.parentId || null) === parentId) {
                if (s.isLocked) {
                    if (!s.isOpen) {
                        setGroupOpen(key, true, options);
                    }
                    return;
                }
                setGroupOpen(key, false, options);
            }
        });
    }

    function handleGroupToggle(id) {
        const state = navGroups.get(id);
        if (!state) return;
        if (state.isOpen) {
            if (state.isLocked) {
                return;
            }
            setGroupOpen(id, false);
        } else {
            closeSiblingGroups(id);
            setGroupOpen(id, true);
        }
    }

    navGroups.forEach((state, id) => {
        if (state.toggleEl) {
            state.toggleEl.addEventListener('click', () => handleGroupToggle(id));
        }
    });

    function syncNavGroupsForRoute(route, { immediate = false } = {}) {
        const parents = navItemParents.get(route) || [];
        const required = new Set(parents);
        navGroups.forEach((state, id) => {
            state.isLocked = required.has(id);
            state.el.classList.toggle('has-active-child', state.isLocked);
        });
        parents.forEach((id) => {
            setGroupOpen(id, true, { immediate });
        });
        navGroups.forEach((state, id) => {
            if (!required.has(id) && !state.isLocked) {
                setGroupOpen(id, false, { immediate });
            }
        });
    }
    const viewNodes = new Map(
        $$('[data-route-view]').map((el) => {
            const route = el.getAttribute('data-route-view');
            return route ? [route, el] : null;
        }).filter(Boolean)
    );
    const adminExportButton = $('#adminFullReportBtn');
    const adminExportState = {
        isAdmin: false,
        teams: [],
        username: null,
        running: false
    };
    const ADMIN_EXPORT_DEFAULT_LABEL = adminExportButton
        ? (adminExportButton.textContent || '').trim() || 'Get Full Report'
        : 'Get Full Report';
    if (adminExportButton) {
        adminExportButton.hidden = true;
        adminExportButton.disabled = true;
    }

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

        syncNavGroupsForRoute(route, { immediate: !previousRoute });

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
    let latestReportSelection = reportState.getSelection();
    reportState.subscribe((state) => {
        latestReportSelection = state?.selection ? { ...state.selection } : {};
    });
    if (adminExportButton) {
        adminExportButton.addEventListener('click', () => {
            if (adminExportState.running) return;
            handleAdminFullReportExport(reportState);
        });
    }
    initLoadingOverlay(reportState);
    const settingsPromise = loadSettings();
    const userSelectContext = initUserSelect($('#sidebarUserSelect'), reportState);

    await initSelectionControls(reportState, settingsPromise);

    await Promise.all([
        registerController('monthly-summary', (node) => initMonthlySummary(node, reportState)),
        registerController('detailed-worklogs', (node) => initDetailedWorklogs(node, reportState)),
        registerController('due-issues', (node) => initDueIssues(node, reportState)),
        registerController('issues', (node) => initIssuesReport(node, reportState)),
        registerController('issues-worklogs', (node) => initIssuesWorklogs(node, reportState)),
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
                SELF_USERNAME = self;
                const displayName = (who.raw?.displayName || '').trim() || self;

                const currentSelection = reportStateInstance.getSelection();
                const adminTeams = getAdminTeamsForUser(self);
                const isAdmin = adminTeams.length > 0;
                updateAdminExportAvailability({ isAdmin, teams: adminTeams, username: self });
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

        ensureTableFeatures(table);

        reportStateInstance.subscribe((state) => {
            renderSummary(state);
        });

        function renderSummary(state) {
            const res = state.result;
            if (state.isFetching && !res) {
                table.style.display = 'table';
                setTableMessage(tbody, 5, 'Loading…');
                updateFooter(null);
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
                    notifyTableUpdate(table, { clearState: true });
                }
                updateFooter(null);
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
                const indexValue = idx + 1;
                const jalaliDisplay = escapeHtml(d.j || '');
                const gregorianDisplay = escapeHtml(d.g || '');
                const weekday = escapeHtml(weekdayName(d.weekday));
                const flagsValue = escapeHtml(flags || '');
                const hoursValue = Number(d.hours || 0).toFixed(2);
                tr.innerHTML = `
                    <td data-sort-value="${indexValue}" data-filter-value="${indexValue}" data-export-value="${indexValue}">${indexValue}</td>
                    <td data-sort-value="${gregorianDisplay}" data-filter-value="${jalaliDisplay}" data-export-value="${jalaliDisplay}"><span class="tip" data-tip="${gregorianDisplay}">${jalaliDisplay}</span></td>
                    <td data-sort-value="${weekday}" data-filter-value="${weekday}" data-export-value="${weekday}">${weekday}</td>
                    <td data-sort-value="${flagsValue}" data-filter-value="${flagsValue}" data-export-value="${flagsValue}"><small>${flagsValue}</small></td>
                    <td data-sort-value="${hoursValue}" data-filter-value="${hoursValue}" data-export-value="${hoursValue}">${hoursValue}</td>
                `;
                tbody.appendChild(tr);
            });

            updateFooter(state);
            notifyTableUpdate(table);
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

        ensureTableFeatures(table);

        setupIssueLinkHandler(root);

        reportStateInstance.subscribe((state) => {
            if (state.isFetching && !state.result) {
                setTableMessage(tbody, 8, 'Loading…');
                return;
            }

            const res = state.result;
            if (!res || !res.ok) {
                const message = res ? (res.reason || 'Unable to load worklogs.') : 'No data yet.';
                setTableMessage(tbody, 8, message);
                return;
            }

            const worklogs = Array.isArray(res.worklogs) ? res.worklogs : [];
            if (!worklogs.length) {
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
                const indexValue = idx + 1;
                const issueKeyValue = escapeHtml(w.issueKey || '');
                const summaryText = (w.summary || '').toString().replace(/\n/g, ' ');
                const summaryValue = escapeHtml(summaryText);
                const hoursValue = Number(w.hours || 0).toFixed(2);
                const timeSpentValue = escapeHtml(w.timeSpent || '');
                const commentText = (w.comment || '').toString().replace(/\n/g, ' ');
                const commentValue = escapeHtml(commentText);
                tr.innerHTML = `
                    <td data-sort-value="${indexValue}" data-filter-value="${indexValue}" data-export-value="${indexValue}">${indexValue}</td>
                    <td data-sort-value="${gregorianDate}" data-filter-value="${jalaliDate}" data-export-value="${jalaliDate}"><span class="tip" data-tip="${gregorianDate}">${jalaliDate}</span></td>
                    <td data-sort-value="${issueType}" data-filter-value="${issueType}" data-export-value="${issueType}">${issueType}</td>
                    <td data-sort-value="${issueKeyValue}" data-filter-value="${issueKeyValue}" data-export-value="${issueKeyValue}">${issueCell}</td>
                    <td data-sort-value="${summaryValue}" data-filter-value="${summaryValue}" data-export-value="${summaryValue}">${summaryValue}</td>
                    <td data-sort-value="${hoursValue}" data-filter-value="${hoursValue}" data-export-value="${hoursValue}">${hoursValue}</td>
                    <td data-sort-value="${timeSpentValue}" data-filter-value="${timeSpentValue}" data-export-value="${timeSpentValue}">${timeSpentValue}</td>
                    <td data-sort-value="${commentValue}" data-filter-value="${commentValue}" data-export-value="${commentValue}">${commentValue}</td>
                `;
                if (!w.dueDate) {
                    tr.classList.add('no-due-date');
                }
                tbody.appendChild(tr);
            });
            notifyTableUpdate(table);
        });

        return {
            onShow: () => reportStateInstance.refresh()
        };
    }

    function initIssuesWorklogs(root, reportStateInstance) {
        if (!root || root.dataset.controllerReady === 'true') return {};
        root.dataset.controllerReady = 'true';

        setupIssueLinkHandler(root);

        const container = root.querySelector('[data-calendar-container]');
        const calendarEl = root.querySelector('#issuesWorklogsCalendar');
        const messageEl = root.querySelector('[data-calendar-message]');
        const feedbackEl = root.querySelector('[data-calendar-feedback]');
        const modalEl = root.querySelector('[data-draft-modal]');
        const issueSelectEl = modalEl?.querySelector('[data-draft-issue-select]');
        const commentEl = modalEl?.querySelector('[data-draft-comment]');
        const confirmBtn = modalEl?.querySelector('[data-draft-confirm]');
        const cancelBtn = modalEl?.querySelector('[data-draft-cancel]');
        const statusEl = modalEl?.querySelector('[data-draft-modal-status]');
        const issueMetaEl = modalEl?.querySelector('[data-draft-issue-meta]');
        const dateLabelEl = modalEl?.querySelector('[data-draft-date]');
        const timeLabelEl = modalEl?.querySelector('[data-draft-time]');
        const durationLabelEl = modalEl?.querySelector('[data-draft-duration]');

        if (!container || !calendarEl || !messageEl) {
            console.warn('Issues worklogs view missing required elements.');
            return {};
        }
        if (!modalEl || !issueSelectEl || !commentEl || !confirmBtn || !cancelBtn) {
            console.warn('Issues worklogs draft modal missing required elements.');
        }

        const fullCalendarGlobal = window.FullCalendar || null;
        const CalendarCtor = fullCalendarGlobal?.Calendar;
        if (typeof CalendarCtor !== 'function') {
            messageEl.textContent = 'Calendar component failed to load.';
            container.classList.add('is-message-visible');
            return {};
        }

        const momentRef = window.moment || null;
        if (momentRef?.loadPersian) {
            try {
                momentRef.loadPersian({ usePersianDigits: false, dialect: 'persian-modern' });
            } catch (err) {
                console.warn('Failed to initialise Persian locale for moment.', err);
            }
        }
        function createMoment(input, format) {
            if (!momentRef) return null;
            if (input == null || input === '') return null;
            const instance = format
                ? momentRef(input, format, true)
                : momentRef(input);
            if (!instance?.isValid()) {
                return null;
            }
            if (typeof instance.locale === 'function') {
                instance.locale('fa');
            }
            return instance;
        }

        const selectionSnapshot = typeof reportStateInstance.getSelection === 'function'
            ? reportStateInstance.getSelection()
            : {};
        const initialMoment = createMoment(
            `${selectionSnapshot?.jYear ?? ''}/${selectionSnapshot?.jMonth ?? ''}/1`,
            'jYYYY/jM/jD'
        );
        const initialDate = initialMoment ? initialMoment.toDate() : undefined;

        let calendar = null;
        let eventSource = null;
        let lastSelectionKey = null;
        let lastSelectionUsername = selectionSnapshot?.username || null;
        let feedbackTimeout = null;
        let modalEscapeHandler = null;
        let currentBaseUrl = null;

        const draftState = {
            event: null,
            eventId: null,
            data: null,
            selection: null,
            isSaving: false,
            fetchToken: 0,
            issuesByKey: new Map()
        };

        function formatDurationLabel(seconds) {
            const totalMinutes = Math.max(1, Math.round(Number(seconds || 0) / 60));
            const hours = Math.floor(totalMinutes / 60);
            const minutes = totalMinutes % 60;
            const parts = [];
            if (hours) parts.push(`${hours}h`);
            if (minutes) parts.push(`${minutes}m`);
            if (!parts.length) parts.push('1m');
            return parts.join(' ');
        }

        function getDurationSecondsBetween(start, end) {
            if (!(start instanceof Date) || !(end instanceof Date)) return 60;
            const diffMs = Math.max(0, end.getTime() - start.getTime());
            return Math.max(60, Math.round(diffMs / 1000));
        }

        function cloneDate(value) {
            if (!(value instanceof Date)) return null;
            return new Date(value.getTime());
        }

        function showFeedback(text, type = 'info', options = {}) {
            if (!feedbackEl) return;
            const { autoHide = true, duration = 6000 } = options;
            feedbackEl.textContent = text;
            if (type) {
                feedbackEl.dataset.type = type;
            } else if (feedbackEl.dataset) {
                delete feedbackEl.dataset.type;
            }
            feedbackEl.hidden = false;
            if (feedbackTimeout) {
                clearTimeout(feedbackTimeout);
                feedbackTimeout = null;
            }
            if (autoHide) {
                feedbackTimeout = window.setTimeout(() => {
                    clearFeedback();
                }, duration);
            }
        }

        function clearFeedback() {
            if (!feedbackEl) return;
            feedbackEl.hidden = true;
            feedbackEl.textContent = '';
            if (feedbackEl.dataset) {
                delete feedbackEl.dataset.type;
            }
            if (feedbackTimeout) {
                clearTimeout(feedbackTimeout);
                feedbackTimeout = null;
            }
        }

        function showMessage(text) {
            messageEl.textContent = text;
            container.classList.add('is-message-visible');
        }

        function hideMessage() {
            container.classList.remove('is-message-visible');
        }

        function setModalStatus(message, type = 'info') {
            if (!statusEl) return;
            if (!message) {
                statusEl.hidden = true;
                statusEl.textContent = '';
                if (statusEl.dataset) {
                    delete statusEl.dataset.type;
                }
                return;
            }
            statusEl.textContent = message;
            statusEl.dataset.type = type;
            statusEl.hidden = false;
        }

        function clearModalStatus() {
            setModalStatus('', null);
        }

        function updateIssueMeta(issue) {
            if (!issueMetaEl) return;
            if (!issue) {
                issueMetaEl.hidden = true;
                issueMetaEl.textContent = '';
                return;
            }
            const parts = [];
            if (issue.status) {
                parts.push(`Status: ${issue.status}`);
            }
            if (Number.isFinite(issue.remainingHours)) {
                parts.push(`Remaining: ${Number(issue.remainingHours).toFixed(2)}h`);
            }
            if (Number.isFinite(issue.estimateHours)) {
                parts.push(`Estimate: ${Number(issue.estimateHours).toFixed(2)}h`);
            }
            if (Array.isArray(issue.sprints) && issue.sprints.length) {
                parts.push(`Sprint: ${issue.sprints.join(', ')}`);
            }
            issueMetaEl.textContent = parts.join(' • ');
            issueMetaEl.hidden = parts.length === 0;
        }

        function updateConfirmButtonState() {
            if (!confirmBtn) return;
            const hasIssue = issueSelectEl && !issueSelectEl.disabled && issueSelectEl.value;
            confirmBtn.disabled = !hasIssue || draftState.isSaving;
        }

        function updateModalSummary() {
            if (!draftState.selection) {
                if (dateLabelEl) dateLabelEl.textContent = '';
                if (timeLabelEl) timeLabelEl.textContent = '';
                if (durationLabelEl) durationLabelEl.textContent = '';
                return;
            }
            const start = cloneDate(draftState.selection.start);
            const end = cloneDate(draftState.selection.end || draftState.selection.start);
            const startMoment = createMoment(start);
            const endMoment = createMoment(end);
            if (dateLabelEl) {
                if (startMoment) {
                    dateLabelEl.textContent = startMoment.format('jYYYY/jMM/jDD dddd');
                } else if (start) {
                    dateLabelEl.textContent = new Intl.DateTimeFormat('fa-IR', { dateStyle: 'full' }).format(start);
                } else {
                    dateLabelEl.textContent = '';
                }
            }
            if (timeLabelEl) {
                if (startMoment && endMoment) {
                    timeLabelEl.textContent = `${startMoment.format('HH:mm')} – ${endMoment.format('HH:mm')}`;
                } else if (start && end) {
                    const timeFormatter = new Intl.DateTimeFormat('fa-IR', { hour: '2-digit', minute: '2-digit' });
                    timeLabelEl.textContent = `${timeFormatter.format(start)} – ${timeFormatter.format(end)}`;
                } else {
                    timeLabelEl.textContent = '';
                }
            }
            if (durationLabelEl) {
                const seconds = start && end ? getDurationSecondsBetween(start, end) : 60;
                durationLabelEl.textContent = `Duration: ${formatDurationLabel(seconds)}`;
            }
        }

        function resetDraftForm() {
            if (issueSelectEl) {
                issueSelectEl.disabled = true;
                issueSelectEl.innerHTML = '<option value="">Loading issues…</option>';
                issueSelectEl.value = '';
            }
            if (commentEl) {
                commentEl.value = '';
            }
            draftState.issuesByKey = new Map();
            updateConfirmButtonState();
            updateIssueMeta(null);
            clearModalStatus();
        }

        function openDraftModal() {
            if (!modalEl) return;
            modalEl.hidden = false;
            modalEl.setAttribute('aria-hidden', 'false');
            if (!modalEscapeHandler) {
                modalEscapeHandler = (evt) => {
                    if (evt.key === 'Escape') {
                        evt.preventDefault();
                        closeDraftModal({ cancel: true });
                        clearDraft({ keepFeedback: true });
                    }
                };
                document.addEventListener('keydown', modalEscapeHandler);
            }
            if (typeof window.setTimeout === 'function') {
                window.setTimeout(() => {
                    issueSelectEl?.focus();
                }, 50);
            }
        }

        function closeDraftModal(options = {}) {
            if (!modalEl) return;
            const { cancel = false } = options;
            modalEl.hidden = true;
            modalEl.setAttribute('aria-hidden', 'true');
            if (modalEscapeHandler) {
                document.removeEventListener('keydown', modalEscapeHandler);
                modalEscapeHandler = null;
            }
            if (cancel) {
                draftState.selection = null;
            }
        }

        async function loadDraftIssues() {
            if (!issueSelectEl) return;
            const selection = typeof reportStateInstance.getSelection === 'function'
                ? reportStateInstance.getSelection()
                : {};
            const username = (selection?.username || '').trim();
            const requestId = ++draftState.fetchToken;
            issueSelectEl.disabled = true;
            issueSelectEl.innerHTML = '<option value="">Loading issues…</option>';
            updateConfirmButtonState();
            updateIssueMeta(null);
            setModalStatus('Loading active sprint issues…', 'info');
            try {
                if (typeof window.appApi?.getActiveSprintIssues !== 'function') {
                    throw new Error('API unavailable');
                }
                const res = await window.appApi.getActiveSprintIssues({ username });
                if (draftState.fetchToken !== requestId) {
                    return;
                }
                if (!res?.ok) {
                    issueSelectEl.innerHTML = '<option value="">No issues available</option>';
                    issueSelectEl.disabled = true;
                    setModalStatus(res?.reason || 'Unable to load active sprint issues.', 'error');
                    updateConfirmButtonState();
                    return;
                }
                const issues = Array.isArray(res.issues) ? res.issues : [];
                draftState.issuesByKey = new Map(issues.map((issue) => [issue.issueKey, issue]));
                if (!issues.length) {
                    issueSelectEl.innerHTML = '<option value="">No active sprint issues found</option>';
                    issueSelectEl.disabled = true;
                    setModalStatus('No active sprint issues were found for you.', 'info');
                } else {
                    const options = ['<option value="">Select an issue…</option>'];
                    issues.forEach((issue) => {
                        const key = escapeHtml(issue.issueKey || '');
                        const summary = escapeHtml((issue.summary || '').toString());
                        options.push(`<option value="${key}">${key} — ${summary}</option>`);
                    });
                    issueSelectEl.innerHTML = options.join('');
                    issueSelectEl.disabled = false;
                    clearModalStatus();
                }
                updateConfirmButtonState();
            } catch (err) {
                if (draftState.fetchToken !== requestId) return;
                console.error('Failed to load active sprint issues', err);
                issueSelectEl.innerHTML = '<option value="">Unable to load issues</option>';
                issueSelectEl.disabled = true;
                setModalStatus('Unable to load active sprint issues.', 'error');
                updateConfirmButtonState();
            }
        }

        function canCreateDraft() {
            if (!SELF_USERNAME) return false;
            const selection = typeof reportStateInstance.getSelection === 'function'
                ? reportStateInstance.getSelection()
                : {};
            const username = (selection?.username || '').trim();
            return Boolean(username) && username === SELF_USERNAME;
        }

        function setDraftSaving(flag) {
            draftState.isSaving = !!flag;
            if (draftState.event) {
                draftState.event.setExtendedProp('isDraftSaving', draftState.isSaving);
            }
            updateConfirmButtonState();
        }

        function clearDraft(options = {}) {
            const { keepFeedback = false } = options;
            draftState.fetchToken += 1;
            if (draftState.event) {
                try {
                    draftState.event.remove();
                } catch (err) {
                    console.warn('Failed to remove draft event', err);
                }
            }
            draftState.event = null;
            draftState.eventId = null;
            draftState.data = null;
            draftState.selection = null;
            draftState.isSaving = false;
            draftState.issuesByKey = new Map();
            if (!keepFeedback) {
                clearFeedback();
            }
            closeDraftModal({ cancel: true });
            updateConfirmButtonState();
            updateIssueMeta(null);
            updateModalSummary();
        }

        function updateDraftEventProps(event, issue, comment) {
            if (!event) return;
            const start = event.start ? cloneDate(event.start) : null;
            const end = event.end ? cloneDate(event.end) : start;
            const durationSeconds = start && end ? getDurationSecondsBetween(start, end) : 60;
            const durationText = formatDurationLabel(durationSeconds);
            const issueKey = issue?.issueKey || draftState.data?.issueKey || '';
            const summary = issue?.summary || draftState.data?.issue?.summary || '';
            const status = issue?.status ?? draftState.data?.issue?.status ?? null;
            const remainingHours = Number.isFinite(issue?.remainingHours)
                ? issue.remainingHours
                : Number.isFinite(draftState.data?.issue?.remainingHours)
                    ? draftState.data.issue.remainingHours
                    : null;
            const estimateHours = Number.isFinite(issue?.estimateHours)
                ? issue.estimateHours
                : Number.isFinite(draftState.data?.issue?.estimateHours)
                    ? draftState.data.issue.estimateHours
                    : null;
            event.setExtendedProp('isDraft', true);
            event.setExtendedProp('issueKey', issueKey);
            event.setExtendedProp('summary', summary);
            event.setExtendedProp('comment', comment || '');
            event.setExtendedProp('durationSeconds', durationSeconds);
            event.setExtendedProp('durationText', durationText);
            event.setExtendedProp('status', status);
            event.setExtendedProp('remainingHours', remainingHours);
            event.setExtendedProp('estimateHours', estimateHours);
            event.setExtendedProp('issueUrl', currentBaseUrl ? buildIssueUrl(currentBaseUrl, issueKey) : null);
            event.setExtendedProp('isDraftSaving', draftState.isSaving);
            if (!Array.isArray(event.classNames) || !event.classNames.includes('calendar-event--draft')) {
                const existing = Array.isArray(event.classNames) ? event.classNames : [];
                event.setProp('classNames', [...new Set([...existing, 'calendar-event--draft'])]);
            }
        }

        function handleDraftEventChange(event) {
            if (!event?.extendedProps?.isDraft) {
                return;
            }
            draftState.selection = {
                start: cloneDate(event.start),
                end: cloneDate(event.end || event.start)
            };
            const issue = draftState.data?.issue || draftState.issuesByKey.get(draftState.data?.issueKey) || null;
            updateDraftEventProps(event, issue, draftState.data?.comment || '');
            updateModalSummary();
        }

        async function handleDraftConfirm() {
            if (!draftState.event || !draftState.data) return;
            if (draftState.isSaving) return;
            const event = draftState.event;
            const start = event.start ? cloneDate(event.start) : null;
            const end = event.end ? cloneDate(event.end) : start;
            if (!start || !end) {
                showFeedback('Unable to determine the selected time range.', 'error');
                return;
            }
            const issueKey = draftState.data.issueKey;
            if (!issueKey) {
                showFeedback('No issue is associated with this draft.', 'error');
                return;
            }
            const selection = typeof reportStateInstance.getSelection === 'function'
                ? reportStateInstance.getSelection()
                : {};
            const username = (selection?.username || '').trim();
            if (!username) {
                showFeedback('Select a user first.', 'error');
                return;
            }
            if (typeof window.appApi?.addWorklog !== 'function') {
                showFeedback('Worklog API is unavailable.', 'error');
                return;
            }
            const durationSeconds = getDurationSecondsBetween(start, end);
            setDraftSaving(true);
            try {
                const res = await window.appApi.addWorklog({
                    issueKey,
                    comment: draftState.data.comment || '',
                    start: start.toISOString(),
                    durationSeconds,
                    username
                });
                if (!res?.ok) {
                    setDraftSaving(false);
                    showFeedback(res?.reason || 'Failed to add worklog.', 'error', { autoHide: false });
                    return;
                }
                showFeedback('Worklog added successfully. Refreshing…', 'success');
                clearDraft({ keepFeedback: true });
                await reportStateInstance.refresh({ force: true });
            } catch (err) {
                console.error('Failed to add worklog', err);
                setDraftSaving(false);
                showFeedback('Failed to add worklog. Please try again.', 'error', { autoHide: false });
            }
        }

        function handleDraftCancel() {
            clearDraft();
            showFeedback('Draft discarded.', 'info');
        }

        function handleCalendarSelect(selectionInfo) {
            const cal = ensureCalendar();
            cal.unselect();
            if (!canCreateDraft()) {
                showFeedback('Worklog drafts are only available for your own user.', 'error');
                return;
            }
            clearDraft({ keepFeedback: true });
            const start = cloneDate(selectionInfo.start);
            const end = cloneDate(selectionInfo.end || selectionInfo.start);
            draftState.selection = { start, end };
            updateModalSummary();
            resetDraftForm();
            openDraftModal();
            loadDraftIssues();
        }

        function ensureCalendar() {
            if (calendar) return calendar;
            calendar = new CalendarCtor(calendarEl, {
                initialView: 'timeGridWeek',
                initialDate,
                firstDay: 6,
                height: 'auto',
                expandRows: true,
                stickyHeaderDates: true,
                headerToolbar: { start: 'prev,next today', center: 'title', end: '' },
                buttonText: { today: 'امروز' },
                nowIndicator: true,
                slotLabelFormat: { hour: '2-digit', minute: '2-digit', meridiem: false },
                eventTimeFormat: { hour: '2-digit', minute: '2-digit', meridiem: false },
                dayHeaderContent: (args) => formatDayHeader(args.date),
                titleFormat: () => '',
                datesSet: (info) => updateToolbarTitle(info.start, info.end),
                eventContent: (arg) => renderEventContent(arg.event),
                eventDidMount: (info) => applyEventMetadata(info.el, info.event.extendedProps),
                selectable: true,
                selectMirror: true,
                selectOverlap: true,
                editable: false,
                select: handleCalendarSelect,
                eventDrop: (info) => handleDraftEventChange(info.event),
                eventResize: (info) => handleDraftEventChange(info.event)
            });
            calendar.render();
            updateToolbarTitle(calendar.view.currentStart, calendar.view.currentEnd);
            return calendar;
        }

        function formatDayHeader(date) {
            const m = createMoment(date);
            if (m) {
                const html = `
                    <div class="calendar-day-header">
                        <span class="calendar-day-header__name">${escapeHtml(m.format('dddd'))}</span>
                        <span class="calendar-day-header__date">${escapeHtml(m.format('jD'))}</span>
                    </div>
                `;
                return { html };
            }
            const text = new Intl.DateTimeFormat('fa-IR', { weekday: 'short', day: 'numeric' }).format(date);
            return { text };
        }

        function updateToolbarTitle(start, end) {
            const titleEl = container.querySelector('.fc-toolbar-title');
            if (!titleEl) return;
            const startMoment = createMoment(start);
            const endMoment = createMoment(end)?.subtract(1, 'day');
            if (startMoment && endMoment) {
                titleEl.textContent = `${startMoment.format('jYYYY jMMMM jD')} — ${endMoment.format('jYYYY jMMMM jD')}`;
                return;
            }
            const formatter = new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium' });
            const inclusiveEnd = new Date(end.getTime() - 1);
            titleEl.textContent = `${formatter.format(start)} — ${formatter.format(inclusiveEnd)}`;
        }

        function renderEventContent(event) {
            const props = event.extendedProps || {};
            if (props.isDraft) {
                return renderDraftEventContent(event, props);
            }
            const pieces = [];
            if (props.issueKey) {
                const issueLabel = escapeHtml(props.issueKey);
                if (props.issueUrl) {
                    const safeUrl = escapeHtml(props.issueUrl);
                    pieces.push(`<a href="${safeUrl}" data-issue-url="${safeUrl}" class="calendar-event__issue" target="_blank" rel="noreferrer noopener">${issueLabel}</a>`);
                } else {
                    pieces.push(`<span class="calendar-event__issue">${issueLabel}</span>`);
                }
            }
            if (props.summary) {
                pieces.push(`<span class="calendar-event__summary">${escapeHtml(props.summary)}</span>`);
            }
            if (props.hoursText) {
                pieces.push(`<span class="calendar-event__hours">${escapeHtml(`${props.hoursText} h`)}</span>`);
            }
            if (!pieces.length) {
                pieces.push(`<span class="calendar-event__summary">${escapeHtml(event.title || '')}</span>`);
            }
            const html = `
                <div class="calendar-event__content">
                    ${pieces.join('<span class="calendar-event__separator">•</span>')}
                </div>
            `;
            return { html };
        }

        function renderDraftEventContent(event, props) {
            const eventId = escapeHtml(event.id || 'draft');
            const issueKey = props.issueKey ? escapeHtml(props.issueKey) : 'Draft';
            const summaryHtml = props.summary ? `<span class="calendar-event__summary">${escapeHtml(props.summary)}</span>` : '';
            const issueLabel = props.issueUrl
                ? `<a href="${escapeHtml(props.issueUrl)}" data-issue-url="${escapeHtml(props.issueUrl)}" class="calendar-event__issue" target="_blank" rel="noreferrer noopener">${issueKey}</a>`
                : `<span class="calendar-event__issue">${issueKey}</span>`;
            const metaParts = [];
            if (props.durationText) metaParts.push(escapeHtml(props.durationText));
            if (props.status) metaParts.push(escapeHtml(props.status));
            if (Number.isFinite(props.remainingHours)) {
                metaParts.push(escapeHtml(`Remaining ${Number(props.remainingHours).toFixed(2)}h`));
            }
            if (Number.isFinite(props.estimateHours)) {
                metaParts.push(escapeHtml(`Estimate ${Number(props.estimateHours).toFixed(2)}h`));
            }
            const metaHtml = metaParts.length
                ? `<div class="calendar-event__draft-meta">${metaParts.join('<span class="calendar-event__separator">•</span>')}</div>`
                : '';
            const commentText = props.comment
                ? escapeHtml(props.comment.toString().replace(/\r?\n/g, ' '))
                : '';
            const commentHtml = commentText
                ? `<div class="calendar-event__draft-comment">${commentText}</div>`
                : '';
            const disabledAttr = props.isDraftSaving ? ' disabled' : '';
            const html = `
                <div class="calendar-event__content calendar-event__content--draft">
                    <div class="calendar-event__draft-main">
                        <div class="calendar-event__draft-summary">
                            <span class="calendar-event__draft-badge">Draft</span>
                            ${issueLabel}
                            ${summaryHtml}
                        </div>
                        ${metaHtml}
                        ${commentHtml}
                    </div>
                    <div class="calendar-event__draft-actions" data-draft-actions data-draft-event-id="${eventId}">
                        <button type="button" class="calendar-event__draft-button calendar-event__draft-button--confirm" data-draft-action="confirm"${disabledAttr} title="Add worklog">✓</button>
                        <button type="button" class="calendar-event__draft-button" data-draft-action="cancel"${disabledAttr} title="Discard draft">✕</button>
                    </div>
                </div>
            `;
            return { html };
        }

        function applyEventMetadata(el, props = {}) {
            if (!el) return;
            const tooltipParts = [];
            if (props.isDraft) {
                if (props.durationText) tooltipParts.push(props.durationText);
                if (props.comment) tooltipParts.push(props.comment);
            } else {
                if (props.jalaaliDate) tooltipParts.push(props.jalaaliDate);
                if (props.timeSpent) tooltipParts.push(props.timeSpent);
                if (props.comment) tooltipParts.push(props.comment);
            }
            if (tooltipParts.length) {
                el.setAttribute('title', tooltipParts.join('\n'));
            }
        }

        function selectionKeyOf(sel) {
            if (!sel) return '';
            const { jYear, jMonth } = sel;
            if (!Number.isFinite(jYear) || !Number.isFinite(jMonth)) return '';
            return `${jYear}-${jMonth}`;
        }

        function clearEvents() {
            if (calendar && eventSource) {
                try {
                    eventSource.remove();
                } catch (err) {
                    console.warn('Failed to remove calendar event source', err);
                }
                eventSource = null;
            }
            if (draftState.event) {
                clearDraft({ keepFeedback: true });
            }
        }

        function setEvents(events) {
            const cal = ensureCalendar();
            cal.batchRendering(() => {
                if (eventSource) {
                    try {
                        eventSource.remove();
                    } catch (err) {
                        console.warn('Failed to remove calendar event source', err);
                    }
                    eventSource = null;
                }
                if (Array.isArray(events) && events.length) {
                    eventSource = cal.addEventSource(events);
                }
            });
        }

        function buildEvents(worklogs, baseUrl) {
            if (!Array.isArray(worklogs) || worklogs.length === 0) {
                return [];
            }
            const uniqueWorklogs = Array.from(new Set(worklogs));
            return uniqueWorklogs.map((worklog, idx) => {
                let startMoment = createMoment(worklog?.date || worklog?.started);
                if (!startMoment && worklog?.persianDate) {
                    startMoment = createMoment(worklog.persianDate, 'jYYYY/jM/jD');
                }
                if (!startMoment) {
                    return null;
                }
                const hoursValue = Number.parseFloat(worklog?.hours);
                const hours = Number.isFinite(hoursValue) ? hoursValue : 0;
                const durationHours = hours > 0 ? hours : 0.25;
                const endMoment = startMoment.clone().add(durationHours, 'hours');
                const summary = (worklog?.summary || '').toString().replace(/\s+/g, ' ').trim();
                const issueKey = (worklog?.issueKey || '').toString().trim();
                const titleParts = [issueKey, summary].filter(Boolean);
                const hoursText = Number.isFinite(hoursValue) ? formatHours(hoursValue) : null;
                return {
                    id: String(worklog?.worklogId ?? worklog?.id ?? `worklog-${idx}`),
                    title: titleParts.join(' — ') || (worklog?.persianDate || ''),
                    start: startMoment.toISOString(),
                    end: endMoment.toISOString(),
                    allDay: false,
                    extendedProps: {
                        issueKey,
                        summary,
                        comment: (worklog?.comment || '').toString(),
                        timeSpent: worklog?.timeSpent || '',
                        jalaaliDate: worklog?.persianDate || '',
                        hours,
                        hoursText,
                        issueUrl: buildIssueUrl(baseUrl, issueKey)
                    }
                };
            }).filter(Boolean);
        }

        if (issueSelectEl) {
            issueSelectEl.addEventListener('change', () => {
                const issue = draftState.issuesByKey.get(issueSelectEl.value) || null;
                if (!draftState.data) {
                    draftState.data = {
                        issueKey: issue?.issueKey || issueSelectEl.value,
                        issue,
                        comment: commentEl?.value || ''
                    };
                } else {
                    draftState.data.issueKey = issue?.issueKey || issueSelectEl.value;
                    draftState.data.issue = issue;
                }
                updateIssueMeta(issue);
                updateConfirmButtonState();
            });
        }
        if (commentEl) {
            commentEl.addEventListener('input', () => {
                if (!draftState.data) {
                    draftState.data = { issueKey: issueSelectEl?.value || '', issue: draftState.issuesByKey.get(issueSelectEl?.value) || null, comment: commentEl.value || '' };
                } else {
                    draftState.data.comment = commentEl.value || '';
                }
                if (draftState.event) {
                    const issue = draftState.data.issue || draftState.issuesByKey.get(draftState.data.issueKey) || null;
                    updateDraftEventProps(draftState.event, issue, draftState.data.comment);
                }
            });
        }
        if (confirmBtn) {
            confirmBtn.addEventListener('click', () => {
                if (!issueSelectEl || issueSelectEl.disabled || !issueSelectEl.value) {
                    setModalStatus('Please select an issue to continue.', 'error');
                    return;
                }
                const issue = draftState.issuesByKey.get(issueSelectEl.value) || null;
                draftState.data = {
                    issueKey: issue?.issueKey || issueSelectEl.value,
                    issue,
                    comment: commentEl?.value || ''
                };
                if (!draftState.selection) {
                    const cal = ensureCalendar();
                    const viewStart = cal?.view?.currentStart ? cloneDate(cal.view.currentStart) : new Date();
                    draftState.selection = {
                        start: viewStart,
                        end: new Date(viewStart.getTime() + 3600000)
                    };
                }
                const cal = ensureCalendar();
                const start = cloneDate(draftState.selection.start);
                const end = cloneDate(draftState.selection.end || draftState.selection.start);
                if (!draftState.event) {
                    const eventId = `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                    draftState.event = cal.addEvent({
                        id: eventId,
                        start,
                        end,
                        allDay: false,
                        display: 'block',
                        editable: true,
                        startEditable: true,
                        durationEditable: true,
                        classNames: ['calendar-event--draft'],
                        extendedProps: { isDraft: true }
                    });
                    draftState.eventId = eventId;
                } else {
                    draftState.event.setDates(start, end, { maintainDuration: false });
                }
                updateDraftEventProps(draftState.event, draftState.data.issue, draftState.data.comment);
                closeDraftModal();
                showFeedback('Draft created. Adjust the block as needed, then confirm to log your work.', 'info', { autoHide: false });
            });
        }
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                closeDraftModal({ cancel: true });
                clearDraft();
            });
        }
        if (modalEl) {
            modalEl.addEventListener('click', (evt) => {
                if (evt.target && evt.target.matches('[data-draft-modal-close]')) {
                    evt.preventDefault();
                    closeDraftModal({ cancel: true });
                    clearDraft();
                }
            });
        }

        container.addEventListener('click', (evt) => {
            const actionBtn = evt.target.closest('[data-draft-action]');
            if (!actionBtn) return;
            evt.preventDefault();
            evt.stopPropagation();
            const wrap = actionBtn.closest('[data-draft-actions]');
            const eventId = wrap?.getAttribute('data-draft-event-id');
            if (!eventId || !draftState.event || draftState.event.id !== eventId) {
                return;
            }
            const action = actionBtn.getAttribute('data-draft-action');
            if (action === 'confirm') {
                handleDraftConfirm();
            } else if (action === 'cancel') {
                handleDraftCancel();
            }
        });

        showMessage('Select a user and month to see worklogs.');

        reportStateInstance.subscribe((state) => {
            const selection = state?.selection || {};
            const selectionKey = selectionKeyOf(selection);
            const selectionUsername = (selection?.username || '').trim() || null;

            if (selectionUsername !== lastSelectionUsername) {
                lastSelectionUsername = selectionUsername;
                if (selectionUsername !== SELF_USERNAME) {
                    clearDraft({ keepFeedback: true });
                }
            }

            if (selectionKey && selectionKey !== lastSelectionKey) {
                lastSelectionKey = selectionKey;
                clearDraft({ keepFeedback: true });
                const targetMoment = createMoment(`${selection.jYear}/${selection.jMonth}/1`, 'jYYYY/jM/jD');
                if (targetMoment) {
                    const cal = ensureCalendar();
                    cal.gotoDate(targetMoment.toDate());
                    updateToolbarTitle(cal.view.currentStart, cal.view.currentEnd);
                }
            } else if (!selectionKey) {
                lastSelectionKey = null;
            }

            if (!selectionKey || !selection?.username) {
                currentBaseUrl = null;
                clearEvents();
                showMessage('Select a user and month to see worklogs.');
                return;
            }

            if (state.isFetching && !state.result) {
                currentBaseUrl = null;
                clearEvents();
                showMessage('Loading…');
                return;
            }

            const res = state.result;
            if (!res || !res.ok) {
                currentBaseUrl = null;
                clearEvents();
                const message = res ? (res.reason || 'Unable to load worklogs.') : 'No data yet.';
                showMessage(message);
                return;
            }

            currentBaseUrl = res.baseUrl || null;
            const events = buildEvents(res.worklogs, res.baseUrl);
            if (!events.length) {
                clearEvents();
                showMessage('No worklogs found for this period.');
                return;
            }

            setEvents(events);
            if (draftState.event) {
                const issue = draftState.data?.issue || draftState.issuesByKey.get(draftState.data?.issueKey) || null;
                updateDraftEventProps(draftState.event, issue, draftState.data?.comment || '');
            }
            hideMessage();
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

        ensureTableFeatures(table);

        setupIssueLinkHandler(root);

        reportStateInstance.subscribe((state) => {
            if (state.isFetching && !state.result) {
                setTableMessage(tbody, 10, 'Loading…');
                resetFooter();
                return;
            }

            const res = state.result;
            if (!res || !res.ok) {
                const message = res ? (res.reason || 'Unable to load due issues.') : 'No data yet.';
                setTableMessage(tbody, 10, message);
                resetFooter();
                return;
            }

            const issues = Array.isArray(res.dueIssuesCurrentMonth) ? res.dueIssuesCurrentMonth : [];
            if (!issues.length) {
                setTableMessage(tbody, 10, '—');
                resetFooter();
                return;
            }

            tbody.innerHTML = '';
            let totals = {
                estimate: 0,
                logged: 0,
                remaining: 0,
            };
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
                const statusText = escapeHtml(issue.status || '');
                const summaryValue = escapeHtml(summary);
                const indexValue = idx + 1;
                const issueKeySafe = escapeHtml(issue.issueKey || '');
                totals.estimate += estimateHours;
                totals.logged += loggedHours;
                totals.remaining += remainingHours;
                tr.innerHTML = `
                    <td data-sort-value="${indexValue}" data-filter-value="${indexValue}" data-export-value="${indexValue}">${indexValue}</td>
                    <td data-sort-value="${dueGregorian}" data-filter-value="${dueJalaali}" data-export-value="${dueJalaali}"><span class="tip" data-tip="${dueGregorian}">${dueJalaali}</span></td>
                    <td data-sort-value="${issueType}" data-filter-value="${issueType}" data-export-value="${issueType}">${issueType}</td>
                    <td data-sort-value="${issueKeySafe}" data-filter-value="${issueKeySafe}" data-export-value="${issueKeySafe}">${issueCell}</td>
                    <td data-sort-value="${summaryValue}" data-filter-value="${summaryValue}" data-export-value="${summaryValue}">${summaryValue}</td>
                    <td data-sort-value="${sprintText}" data-filter-value="${sprintText}" data-export-value="${sprintText}">${sprintText}</td>
                    <td data-sort-value="${statusText}" data-filter-value="${statusText}" data-export-value="${statusText}">${statusText}</td>
                    <td data-sort-value="${estimateHours.toFixed(2)}" data-filter-value="${estimateHours.toFixed(2)}" data-export-value="${estimateHours.toFixed(2)}">${estimateHours.toFixed(2)}</td>
                    <td data-sort-value="${loggedHours.toFixed(2)}" data-filter-value="${loggedHours.toFixed(2)}" data-export-value="${loggedHours.toFixed(2)}">${loggedHours.toFixed(2)}</td>
                    <td data-sort-value="${remainingHours.toFixed(2)}" data-filter-value="${remainingHours.toFixed(2)}" data-export-value="${remainingHours.toFixed(2)}">${remainingHours.toFixed(2)}</td>
                `;
                tbody.appendChild(tr);
            });

            updateFooter({
                estimate: totals.estimate.toFixed(2),
                logged: totals.logged.toFixed(2),
                remaining: totals.remaining.toFixed(2),
            });
            notifyTableUpdate(table);
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

        ensureTableFeatures(table);

        setupIssueLinkHandler(root);

        reportStateInstance.subscribe((state) => {
            if (state.isFetching && !state.result) {
                setTableMessage(tbody, 13, 'Loading…');
                resetFooter();
                return;
            }

            const res = state.result;
            if (!res || !res.ok) {
                const message = res ? (res.reason || 'Unable to load issues.') : 'No data yet.';
                setTableMessage(tbody, 13, message);
                resetFooter();
                return;
            }

            const issues = Array.isArray(res.assignedIssues) ? res.assignedIssues : [];
            if (!issues.length) {
                setTableMessage(tbody, 13, 'No issues found.');
                resetFooter();
                return;
            }

            tbody.innerHTML = '';
            const totals = { estimate: 0, logged: 0, remaining: 0 };

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
                totals.estimate += estimateHours;
                totals.logged += loggedHours;
                totals.remaining += remainingHours;
                const indexValue = idx + 1;
                const issueKeySafe = escapeHtml(issueKey || '');
                const updatedSort = updatedTooltip || updatedDisplay;
                const dueSort = dueTooltip || dueDisplay;
                const estimateText = estimateHours.toFixed(2);
                const loggedText = loggedHours.toFixed(2);
                const remainingText = remainingHours.toFixed(2);

                const updatedCell = updatedDisplay
                    ? `<span class="tip" data-tip="${updatedTooltip || updatedDisplay}">${updatedDisplay}</span>`
                    : '<span class="muted">—</span>';
                const dueCell = dueDisplay
                    ? `<span class="tip" data-tip="${dueTooltip || dueDisplay}">${dueDisplay}</span>`
                    : '<span class="muted">—</span>';

                tr.innerHTML = `
                    <td data-sort-value="${indexValue}" data-filter-value="${indexValue}" data-export-value="${indexValue}">${indexValue}</td>
                    <td data-sort-value="${updatedSort}" data-filter-value="${updatedDisplay}" data-export-value="${updatedDisplay}">${updatedCell}</td>
                    <td data-sort-value="${dueSort}" data-filter-value="${dueDisplay}" data-export-value="${dueDisplay}">${dueCell}</td>
                    <td data-sort-value="${issueType}" data-filter-value="${issueType}" data-export-value="${issueType}">${issueType}</td>
                    <td data-sort-value="${issueKeySafe}" data-filter-value="${issueKeySafe}" data-export-value="${issueKeySafe}">${issueCell}</td>
                    <td data-sort-value="${summary}" data-filter-value="${summary}" data-export-value="${summary}">${summary}</td>
                    <td data-sort-value="${sprintText}" data-filter-value="${sprintText}" data-export-value="${sprintText}">${sprintText}</td>
                    <td data-sort-value="${projectText}" data-filter-value="${projectText}" data-export-value="${projectText}">${projectText}</td>
                    <td data-sort-value="${boardText}" data-filter-value="${boardText}" data-export-value="${boardText}">${boardText}</td>
                    <td data-sort-value="${status}" data-filter-value="${status}" data-export-value="${status}">${status}</td>
                    <td data-sort-value="${estimateText}" data-filter-value="${estimateText}" data-export-value="${estimateText}">${estimateText}</td>
                    <td data-sort-value="${loggedText}" data-filter-value="${loggedText}" data-export-value="${loggedText}">${loggedText}</td>
                    <td data-sort-value="${remainingText}" data-filter-value="${remainingText}" data-export-value="${remainingText}">${remainingText}</td>
                `;
                tbody.appendChild(tr);
            });

            updateFooter({
                estimate: totals.estimate.toFixed(2),
                logged: totals.logged.toFixed(2),
                remaining: totals.remaining.toFixed(2),
            });
            notifyTableUpdate(table);
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

        ensureTableFeatures(table);

        reportStateInstance.subscribe((state) => {
            if (state.isFetching && !state.result) {
                setTableMessage(tbody, 7, 'Loading…');
                return;
            }

            const res = state.result;
            if (!res || !res.ok) {
                const message = res ? (res.reason || 'Unable to load quarter report.') : 'No data yet.';
                setTableMessage(tbody, 7, message);
                return;
            }

            const data = res.quarterReport;
            if (!data?.ok || !Array.isArray(data.seasons) || data.seasons.length === 0) {
                setTableMessage(tbody, 7, '—');
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
                            html: '<div class="quarter-month"><span class="muted">—</span></div>',
                            sort: '',
                            filter: '—'
                        };
                    }
                    const label = month.label || `Month ${month.jMonth}`;
                    if (!month.ok) {
                        const reason = month.reason || 'No data';
                        return {
                            html: `<div class="quarter-month"><strong>${label}</strong><span class="muted">${reason}</span></div>`,
                            sort: label,
                            filter: `${label} - ${reason}`
                        };
                    }
                    const totalHours = Number.parseFloat(month.totalHours || 0) || 0;
                    const expectedHours = Number.parseFloat(month.expectedHours || 0) || 0;
                    const delta = Number.parseFloat(month.delta || 0) || 0;
                    const deltaCls = delta >= 0 ? 'delta-pos' : 'delta-neg';
                    return {
                        html: `
                            <div class="quarter-month">
                                <strong>${label}</strong>
                                <div>${formatHours(totalHours)} h</div>
                                <div class="muted">Exp ${formatHours(expectedHours)} h</div>
                                <div class="${deltaCls}">${delta.toFixed(2)} h</div>
                            </div>
                        `,
                        sort: totalHours.toFixed(2),
                        filter: `${label} (${formatHours(totalHours)} h)`
                    };
                });
                const totals = season.totals || {};
                const totalDelta = Number.parseFloat(totals.delta || 0) || 0;
                const totalDeltaCls = totalDelta >= 0 ? 'delta-pos' : 'delta-neg';
                tr.innerHTML = `
                    <td data-sort-value="${escapeHtml(season.label || 'Season')}" data-filter-value="${escapeHtml(season.label || 'Season')}" data-export-value="${escapeHtml(season.label || 'Season')}"><strong>${season.label || 'Season'}</strong></td>
                    ${monthCells.map((cell) => `<td data-sort-value="${escapeHtml(cell.sort)}" data-filter-value="${escapeHtml(cell.filter)}" data-export-value="${escapeHtml(cell.filter)}">${cell.html}</td>`).join('')}
                    <td data-sort-value="${formatHours(totals.totalHours)}" data-filter-value="${formatHours(totals.totalHours)}" data-export-value="${formatHours(totals.totalHours)}">${formatHours(totals.totalHours)} h</td>
                    <td data-sort-value="${formatHours(totals.expectedHours)}" data-filter-value="${formatHours(totals.expectedHours)}" data-export-value="${formatHours(totals.expectedHours)}">${formatHours(totals.expectedHours)} h</td>
                    <td data-sort-value="${totalDelta.toFixed(2)}" data-filter-value="${totalDelta.toFixed(2)}" data-export-value="${totalDelta.toFixed(2)}" class="${totalDeltaCls}">${totalDelta.toFixed(2)} h</td>
                `;
                tbody.appendChild(tr);
            });
            notifyTableUpdate(table);
        });

        return {
            onShow: () => reportStateInstance.refresh()
        };
    }

    function notifyTableUpdate(table, options = {}) {
        if (!table) return;
        refreshTableFeatures(table, options);
    }

    function refreshTableFeatures(table, options = {}) {
        const state = ensureTableFeatures(table);
        if (!state) return;

        updateFilterRowOffset(state);

        const tbody = table.tBodies?.[0];
        const dataRows = tbody
            ? Array.from(tbody.rows).filter((row) => row && row.dataset.tableMessage !== 'true' && row.dataset.filterMessage !== 'true')
            : [];

        state.rawRows = dataRows;

        if (options.clearState) {
            state.filters.clear();
            state.sort.column = null;
            state.sort.direction = 'asc';
            state.columnMeta.forEach((meta) => {
                if (meta?.control) {
                    if (meta.type === 'select') {
                        meta.control.value = '';
                    } else {
                        meta.control.value = '';
                    }
                }
            });
        }

        const hasData = dataRows.length > 0;
        state.columnMeta.forEach((meta) => {
            if (!meta?.control) return;
            meta.control.disabled = !hasData;
        });
        if (state.exportButton) {
            state.exportButton.disabled = !hasData;
        }

        if (!hasData) {
            removeFilterMessage(state);
            updateSortIndicators(state);
            state.displayRows = [];
            return;
        }

        const columnValues = new Map();
        dataRows.forEach((row) => {
            Array.from(row.cells).forEach((cell, index) => {
                const value = getCellFilterValue(cell);
                if (!value) return;
                if (!columnValues.has(index)) {
                    columnValues.set(index, new Set());
                }
                columnValues.get(index).add(value);
            });
        });

        state.columnMeta.forEach((meta, index) => {
            if (!meta) return;
            const values = Array.from(columnValues.get(index) || []);
            values.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
            ensureFilterControlType(state, meta, values);
            if (meta.type === 'select') {
                updateSelectOptions(state, meta, values);
            }
        });

        updateSortIndicators(state);
        applyFiltersAndSort(state);
    }

    function ensureTableFeatures(table) {
        if (!table) return null;
        let state = TABLE_FEATURES.get(table);
        if (state) return state;

        const thead = table.tHead;
        if (!thead || !thead.rows.length) return null;

        const headerRow = thead.rows[0];
        const columns = Array.from(headerRow.cells);
        if (!columns.length) return null;

        state = {
            table,
            wrap: table.closest('.table-wrap') || null,
            headerRow,
            columnMeta: [],
            filters: new Map(),
            sort: { column: null, direction: 'asc' },
            rawRows: [],
            displayRows: [],
            filterRow: null,
            filterMessageRow: null,
            exportButton: null,
            exportName: table.dataset.exportName || table.id || 'table',
        };

        TABLE_FEATURES.set(table, state);
        TABLE_FEATURE_STATES.add(state);
        if (!tableFeatureResizeAttached) {
            tableFeatureResizeAttached = true;
            window.addEventListener('resize', () => {
                TABLE_FEATURE_STATES.forEach((featureState) => updateFilterRowOffset(featureState));
            });
        }

        setupTableToolbar(state);
        setupHeaderInteractions(state, columns);
        setupFilterRow(state, columns);

        return state;
    }

    function setupTableToolbar(state) {
        const { wrap, table } = state;
        if (!wrap) return;
        let toolbar = wrap.querySelector(':scope > .table-toolbar');
        if (!toolbar) {
            toolbar = document.createElement('div');
            toolbar.className = 'table-toolbar';
            wrap.insertBefore(toolbar, wrap.firstChild);
        }
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn btn-outline table-export-btn';
        button.textContent = 'Export to Excel';
        button.disabled = true;
        button.addEventListener('click', () => exportTableToExcel(state));
        toolbar.appendChild(button);
        state.exportButton = button;
    }

    function setupHeaderInteractions(state, columns) {
        columns.forEach((th, index) => {
            th.classList.add('table-sortable');
            th.dataset.sortIndex = String(index);
            th.addEventListener('click', (event) => {
                if (event.defaultPrevented) return;
                if (event.target && event.target.closest('.table-filter-control')) return;
                handleSortRequest(state, index);
            });
        });
    }

    function setupFilterRow(state, columns) {
        const filterRow = document.createElement('tr');
        filterRow.className = 'table-filter-row';
        columns.forEach((th, index) => {
            const filterCell = document.createElement('th');
            filterCell.className = 'table-filter-cell';
            const meta = {
                index,
                header: (th.textContent || '').trim(),
                preferSelect: /(status|type|project|board|sprint|season|month|weekday|flags)/i.test((th.textContent || '').trim()),
                type: 'text',
                control: null,
                cell: filterCell,
            };
            state.columnMeta[index] = meta;
            const control = document.createElement('input');
            control.type = 'text';
            control.placeholder = 'Filter…';
            control.className = 'table-filter-control';
            control.disabled = true;
            control.addEventListener('input', () => handleFilterChange(state, meta, control.value));
            filterCell.appendChild(control);
            meta.control = control;
            filterRow.appendChild(filterCell);
        });
        const thead = state.headerRow.parentElement;
        if (thead && !Array.from(thead.rows).includes(filterRow)) {
            thead.appendChild(filterRow);
        }
        state.filterRow = filterRow;
        updateFilterRowOffset(state);
    }

    function updateFilterRowOffset(state) {
        if (!state || !state.table || !state.headerRow || !state.headerRow.isConnected) return;
        const headerHeight = Math.max(0, state.headerRow.getBoundingClientRect().height);
        if (headerHeight > 0) {
            state.table.style.setProperty('--table-filter-offset', `${Math.round(headerHeight)}px`);
        }
    }

    function handleSortRequest(state, columnIndex) {
        if (!state.rawRows.length) return;
        if (state.sort.column !== columnIndex) {
            state.sort.column = columnIndex;
            state.sort.direction = 'asc';
        } else if (state.sort.direction === 'asc') {
            state.sort.direction = 'desc';
        } else {
            state.sort.column = null;
            state.sort.direction = 'asc';
        }
        updateSortIndicators(state);
        applyFiltersAndSort(state);
    }

    function updateSortIndicators(state) {
        const { headerRow, sort } = state;
        Array.from(headerRow.cells).forEach((th, index) => {
            if (sort.column === index) {
                th.dataset.sortDirection = sort.direction;
                th.classList.add('is-sorted');
            } else {
                th.dataset.sortDirection = '';
                th.classList.remove('is-sorted');
            }
        });
    }

    function handleFilterChange(state, meta, rawValue) {
        const value = (rawValue || '').trim();
        if (!value) {
            state.filters.delete(meta.index);
        } else if (meta.type === 'select') {
            state.filters.set(meta.index, value);
        } else {
            state.filters.set(meta.index, value.toLowerCase());
        }
        applyFiltersAndSort(state);
    }

    function ensureFilterControlType(state, meta, values) {
        const numericOnly = values.length > 0 && values.every((val) => /^-?\d+(?:\.\d+)?$/.test(val));
        const shouldSelect = meta.preferSelect || (!numericOnly && values.length > 0 && values.length <= 15);
        if (shouldSelect && meta.type !== 'select') {
            replaceFilterControl(state, meta, 'select');
        } else if (!shouldSelect && meta.type !== 'text') {
            replaceFilterControl(state, meta, 'text');
        }
    }

    function replaceFilterControl(state, meta, type) {
        if (!meta?.cell) return;
        const previousValue = meta.control ? meta.control.value : '';
        const cell = meta.cell;
        cell.innerHTML = '';
        let control;
        if (type === 'select') {
            control = document.createElement('select');
            control.className = 'table-filter-control';
            control.disabled = meta.control?.disabled ?? true;
            control.addEventListener('change', () => handleFilterChange(state, meta, control.value));
        } else {
            control = document.createElement('input');
            control.type = 'text';
            control.placeholder = 'Filter…';
            control.className = 'table-filter-control';
            control.disabled = meta.control?.disabled ?? true;
            control.addEventListener('input', () => handleFilterChange(state, meta, control.value));
        }
        cell.appendChild(control);
        meta.control = control;
        meta.type = type;
        if (type === 'text') {
            control.value = previousValue || '';
            if (control.value) {
                handleFilterChange(state, meta, control.value);
            }
        }
    }

    function updateSelectOptions(state, meta, values) {
        if (!meta?.control) return;
        const select = meta.control;
        const previous = select.value;
        select.innerHTML = '';
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'All';
        select.appendChild(option);
        values.forEach((val) => {
            const opt = document.createElement('option');
            opt.value = val;
            opt.textContent = val;
            select.appendChild(opt);
        });
        let restoreValue = '';
        if (values.includes(previous)) {
            restoreValue = previous;
        } else {
            const lowerMap = new Map(values.map((val) => [val.toLowerCase(), val]));
            const matched = lowerMap.get((previous || '').toLowerCase());
            if (matched) {
                restoreValue = matched;
            }
        }
        if (restoreValue) {
            select.value = restoreValue;
            state.filters.set(meta.index, restoreValue);
        } else {
            select.value = '';
            state.filters.delete(meta.index);
        }
    }

    function applyFiltersAndSort(state) {
        const rows = state.rawRows || [];
        if (!rows.length) return;
        const activeFilters = Array.from(state.filters.entries());
        const filtered = rows.filter((row) => {
            return activeFilters.every(([index, value]) => {
                const cell = row.cells[index];
                if (!cell) return true;
                const cellValue = getCellFilterValue(cell);
                if (!value) return true;
                const meta = state.columnMeta[index];
                if (meta?.type === 'select') {
                    return cellValue === value;
                }
                return cellValue.toLowerCase().includes(value);
            });
        });

        const { column, direction } = state.sort;
        let sorted = filtered;
        if (Number.isInteger(column)) {
            sorted = filtered.slice().sort((a, b) => {
                const cellA = a.cells[column];
                const cellB = b.cells[column];
                const valueA = getCellSortValue(cellA);
                const valueB = getCellSortValue(cellB);
                return compareSortValues(valueA, valueB, direction);
            });
        }

        const tbody = state.table.tBodies?.[0];
        if (!tbody) return;

        tbody.innerHTML = '';
        sorted.forEach((row) => tbody.appendChild(row));
        state.displayRows = sorted;

        if (!sorted.length) {
            showFilterMessage(state);
        } else {
            removeFilterMessage(state);
        }
    }

    function compareSortValues(a, b, direction) {
        const dir = direction === 'desc' ? -1 : 1;
        const numA = Number.parseFloat(a);
        const numB = Number.parseFloat(b);
        const bothNumeric = Number.isFinite(numA) && Number.isFinite(numB);
        if (bothNumeric) {
            if (numA === numB) return 0;
            return numA > numB ? dir : -dir;
        }
        const strA = String(a ?? '').toLowerCase();
        const strB = String(b ?? '').toLowerCase();
        if (strA === strB) return 0;
        return strA > strB ? dir : -dir;
    }

    function showFilterMessage(state) {
        const tbody = state.table.tBodies?.[0];
        if (!tbody) return;
        if (!state.filterMessageRow) {
            const tr = document.createElement('tr');
            tr.dataset.filterMessage = 'true';
            const td = document.createElement('td');
            td.colSpan = state.headerRow.cells.length;
            td.textContent = 'No rows match the current filters.';
            tr.appendChild(td);
            state.filterMessageRow = tr;
        }
        if (!tbody.contains(state.filterMessageRow)) {
            tbody.appendChild(state.filterMessageRow);
        }
    }

    function removeFilterMessage(state) {
        if (!state.filterMessageRow) return;
        const tbody = state.table.tBodies?.[0];
        if (tbody && tbody.contains(state.filterMessageRow)) {
            tbody.removeChild(state.filterMessageRow);
        }
    }

    function getCellFilterValue(cell) {
        if (!cell) return '';
        return (cell.dataset.filterValue || cell.dataset.sortValue || cell.dataset.exportValue || cell.textContent || '').trim();
    }

    function getCellSortValue(cell) {
        if (!cell) return '';
        const value = cell.dataset.sortValue;
        if (value != null) return value;
        return (cell.textContent || '').trim();
    }

    function getCellExportValue(cell) {
        if (!cell) return '';
        return (cell.dataset.exportValue || cell.dataset.filterValue || cell.textContent || '').trim();
    }

    function buildTableExportData(state) {
        if (!state || !state.table || !state.headerRow) return null;
        const table = state.table;
        const rows = state.displayRows && state.displayRows.length ? state.displayRows : state.rawRows;
        if (!rows || !rows.length) return null;
        const headerCells = Array.from(state.headerRow.cells).map((cell) => (cell.textContent || '').trim());
        const bodyRowsHtml = rows
            .map((row) => {
                const cells = Array.from(row.cells)
                    .map((cell) => `<td>${escapeForExcel(getCellExportValue(cell))}</td>`)
                    .join('');
                return `<tr>${cells}</tr>`;
            })
            .join('');
        let footerHtml = '';
        if (table.tFoot && table.tFoot.rows.length) {
            footerHtml = Array.from(table.tFoot.rows)
                .map((row) => {
                    const cells = Array.from(row.cells)
                        .map((cell) => `<td>${escapeForExcel((cell.textContent || '').trim())}</td>`)
                        .join('');
                    return `<tr>${cells}</tr>`;
                })
                .join('');
            footerHtml = `<tfoot>${footerHtml}</tfoot>`;
        }
        const headerHtml = `<tr>${headerCells.map((text) => `<th>${escapeForExcel(text)}</th>`).join('')}</tr>`;
        const tableHtml = `<table><thead>${headerHtml}</thead><tbody>${bodyRowsHtml}</tbody>${footerHtml}</table>`;
        const selection = latestReportSelection || {};
        const selectedYearMonth = formatJalaaliYearMonth(selection.jYear, selection.jMonth);
        const usernamePart = sanitizeFilenamePart(selection.username, 'unknown-user');
        const exportName = state.exportName || table.dataset.exportName || table.id || 'table';
        const tableNamePart = sanitizeFilenamePart(exportName, 'table');
        const fileName = `${selectedYearMonth}_${usernamePart}_${tableNamePart}.xls`;
        return {
            fileName,
            content: `\ufeff${tableHtml}`,
            tableNamePart,
            selectedYearMonth,
            usernamePart,
            exportName,
        };
    }

    function exportTableToExcel(state) {
        const exportData = buildTableExportData(state);
        if (!exportData) return;
        const blob = new Blob([exportData.content], { type: 'application/vnd.ms-excel' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = exportData.fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(url), 0);
    }

    function collectAllTableExports() {
        const exports = [];
        TABLE_FEATURE_STATES.forEach((state) => {
            const data = buildTableExportData(state);
            if (data) {
                exports.push(data);
            }
        });
        return exports;
    }

    function refreshAdminExportButton() {
        if (!adminExportButton) return;
        const hasAccess = adminExportState.isAdmin && adminExportState.teams.length > 0;
        if (!hasAccess) {
            adminExportButton.hidden = true;
            adminExportButton.disabled = true;
            adminExportButton.textContent = ADMIN_EXPORT_DEFAULT_LABEL;
            return;
        }
        adminExportButton.hidden = false;
        adminExportButton.disabled = adminExportState.running;
        if (!adminExportState.running) {
            adminExportButton.textContent = ADMIN_EXPORT_DEFAULT_LABEL;
        }
    }

    function updateAdminExportAvailability({ isAdmin, teams, username }) {
        const list = Array.isArray(teams) ? teams.filter((team) => TEAM_VALUE_SET.has(team)) : [];
        adminExportState.isAdmin = Boolean(isAdmin && list.length > 0);
        adminExportState.teams = adminExportState.isAdmin ? list : [];
        adminExportState.username = adminExportState.isAdmin ? (username || null) : null;
        if (!adminExportState.isAdmin) {
            adminExportState.running = false;
        }
        refreshAdminExportButton();
    }

    async function handleAdminFullReportExport(reportStateInstance) {
        if (!adminExportButton || !adminExportState.isAdmin || adminExportState.teams.length === 0) {
            return;
        }

        adminExportState.running = true;
        adminExportButton.hidden = false;
        adminExportButton.disabled = true;
        adminExportButton.textContent = 'Preparing…';

        const originalSelection = reportStateInstance.getSelection();
        const { jYear, jMonth, timeOffHours } = originalSelection;

        if (!Number.isFinite(jYear) || !Number.isFinite(jMonth)) {
            window.alert('Please choose a valid Jalaali year and month before exporting the full report.');
            adminExportState.running = false;
            refreshAdminExportButton();
            return;
        }

        const teamValues = adminExportState.teams.slice();
        if (!teamValues.length) {
            window.alert('No teams are available for export.');
            adminExportState.running = false;
            refreshAdminExportButton();
            return;
        }

        const entries = [];
        const errors = [];
        const preservedTimeOff = Number.isFinite(timeOffHours) && timeOffHours >= 0 ? timeOffHours : 0;

        try {
            for (const teamValue of teamValues) {
                const teamLabel = TEAM_LABELS.get(teamValue) || teamValue;
                const teamDir = sanitizeFilenamePart(teamLabel, sanitizeFilenamePart(teamValue, 'team'));
                const users = getTeamUsers(teamValue).filter((user) => user && user.value);
                if (!users.length) continue;

                for (const user of users) {
                    const username = (user.value || '').trim();
                    if (!username) continue;
                    const userDir = sanitizeFilenamePart(username, 'user');
                    const selectionUpdate = {
                        team: teamValue,
                        username,
                        jYear,
                        jMonth,
                        timeOffHours: preservedTimeOff,
                    };
                    const res = await reportStateInstance.setSelection(selectionUpdate, { refresh: true, pushSelection: false });
                    await waitForRender();

                    if (!res || res.ok === false) {
                        const reason = res?.reason || 'Unable to load data';
                        errors.push({ team: teamLabel, username, reason });
                        entries.push({
                            path: `${teamDir}/${userDir}/error.txt`,
                            content: `Failed to generate reports for ${username}: ${reason}`,
                        });
                        continue;
                    }

                    const tableExports = collectAllTableExports();
                    if (!tableExports.length) {
                        entries.push({
                            path: `${teamDir}/${userDir}/no-data.txt`,
                            content: 'No report data available for this selection.',
                        });
                        continue;
                    }

                    tableExports.forEach((tableData) => {
                        const periodPart = sanitizeFilenamePart(tableData.selectedYearMonth, 'period');
                        const reportPart = sanitizeFilenamePart(tableData.tableNamePart || tableData.exportName || 'report', 'report');
                        const fileName = `${periodPart}_${reportPart}.xls`;
                        entries.push({
                            path: `${teamDir}/${userDir}/${fileName}`,
                            content: tableData.content,
                        });
                    });
                }
            }

            if (!entries.length) {
                window.alert('No report data was generated for the selected scope.');
                return;
            }

            if (typeof window.appApi?.exportFullReport !== 'function') {
                window.alert('Export API is not available in this build.');
                return;
            }

            const defaultPeriod = sanitizeFilenamePart(formatJalaaliYearMonth(jYear, jMonth, 'reports'), 'reports');
            const defaultZipName = `${defaultPeriod}_full-report.zip`;

            const response = await window.appApi.exportFullReport({
                entries,
                defaultFileName: defaultZipName,
            });

            if (!response?.ok) {
                if (response?.reason !== 'cancelled') {
                    window.alert(`Unable to save the full report: ${response?.reason || 'Unknown error'}`);
                }
            } else if (errors.length) {
                window.alert('The full report was saved, but some users could not be exported. Check the generated folders for details.');
            }
        } catch (err) {
            console.error('Failed to generate full report', err);
            window.alert('Failed to generate the full report. Please try again.');
        } finally {
            adminExportState.running = false;
            refreshAdminExportButton();
            try {
                await reportStateInstance.setSelection(originalSelection, { refresh: true, pushSelection: true });
                await waitForRender();
            } catch (restoreErr) {
                console.error('Failed to restore original selection after export', restoreErr);
            }
        }
    }

    function waitForRender() {
        return new Promise((resolve) => {
            if (typeof requestAnimationFrame === 'function') {
                requestAnimationFrame(() => resolve());
            } else {
                setTimeout(resolve, 0);
            }
        });
    }

    function escapeForExcel(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
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
        tr.dataset.tableMessage = 'true';
        const table = tbody.closest('table');
        if (table) {
            notifyTableUpdate(table, { clearState: true });
        }
    }

    function parseJalaaliInt(val) {
        const parsed = Number.parseInt(toAsciiDigits(val), 10);
        return Number.isFinite(parsed) ? parsed : null;
    }

    function formatJalaaliYearMonth(year, month, fallback = 'unknown') {
        const parsedYear = Number.parseInt(toAsciiDigits(year), 10);
        const parsedMonth = Number.parseInt(toAsciiDigits(month), 10);
        if (!Number.isFinite(parsedYear) || !Number.isFinite(parsedMonth)) {
            return fallback;
        }
        const safeMonth = Math.min(Math.max(parsedMonth, 1), 12);
        const yearPart = String(parsedYear).padStart(4, '0');
        const monthPart = String(safeMonth).padStart(2, '0');
        return `${yearPart}${monthPart}`;
    }

    function sanitizeFilenamePart(value, fallback = 'unknown') {
        const raw = toAsciiDigits(value ?? '').trim();
        if (!raw) return fallback;
        const replaced = raw
            .replace(/\s+/g, '_')
            .replace(/[^A-Za-z0-9_.-]+/g, '_');
        const normalised = replaced.replace(/_+/g, '_').replace(/^[_.-]+|[_.-]+$/g, '');
        return normalised || fallback;
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
