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
    const tableControllers = new WeakMap();

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
        const footerTotals = root.querySelector('#footerTotals');
        const debug = root.querySelector('#debug');

        if (!table || !table.querySelector('tbody') || !footerTotals) {
            console.warn('Monthly summary view missing required elements.');
            return {};
        }

        const tableController = createTableController(table, {
            exportFileName: 'monthly-summary',
            emptyMessage: 'No data available.',
            noMatchMessage: 'No rows match the current filters.',
        });
        setupTableExportButton(root, 'results', tableController);

        reportStateInstance.subscribe((state) => {
            renderSummary(state);
        });

        function renderSummary(state) {
            const res = state.result;
            if (state.isFetching && !res) {
                table.style.display = 'table';
                tableController.showPlaceholder('Loading…');
                updateFooter(null);
                if (debug) debug.textContent = '';
                return;
            }

            if (!res || !res.ok) {
                if (res) {
                    table.style.display = 'table';
                    tableController.showPlaceholder(res.reason || 'No data available.');
                } else {
                    table.style.display = 'none';
                    tableController.showPlaceholder('Select a user and month to see worklogs.');
                }
                updateFooter(null);
                if (debug) debug.textContent = '';
                return;
            }

            const days = Array.isArray(res.days) ? res.days : [];
            table.style.display = 'table';
            if (!days.length) {
                tableController.showPlaceholder('No data available.');
                updateFooter(state);
                if (debug) debug.textContent = '';
                return;
            }

            const rows = days.map((d, idx) => {
                const flags = [
                    d.isFuture ? 'future' : '',
                    d.isThuFri ? 'Thu/Fri' : '',
                    d.isHoliday ? 'holiday' : '',
                    d.isWorkday === false ? 'non-workday' : ''
                ].filter(Boolean).join(', ');
                const jalali = escapeHtml(d.j || '');
                const gregorian = escapeHtml(d.g || '');
                const hoursValue = Number(d.hours || 0);
                return {
                    className: d.color || '',
                    cells: [
                        { text: idx + 1, sortValue: idx + 1 },
                        {
                            html: `<span class="tip" data-tip="${gregorian}">${jalali}</span>`,
                            sortValue: safeDateValue(d.g) ?? idx,
                            filterValue: jalali,
                            exportValue: jalali,
                        },
                        {
                            text: weekdayName(d.weekday),
                            filterValue: weekdayName(d.weekday),
                        },
                        { text: flags, filterValue: flags },
                        {
                            text: hoursValue.toFixed(2),
                            sortValue: hoursValue,
                            exportValue: hoursValue.toFixed(2),
                        },
                    ],
                };
            });

            tableController.setRows(rows);

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
        if (!table || !table.querySelector('tbody')) {
            console.warn('Detailed worklogs view missing required elements.');
            return {};
        }

        setupIssueLinkHandler(root);

        const tableController = createTableController(table, {
            exportFileName: 'detailed-worklogs',
            emptyMessage: 'No worklogs found.',
            noMatchMessage: 'No worklogs match the current filters.',
        });
        setupTableExportButton(root, 'detailedWorklogsTable', tableController);

        reportStateInstance.subscribe((state) => {
            if (state.isFetching && !state.result) {
                tableController.showPlaceholder('Loading…');
                return;
            }

            const res = state.result;
            if (!res || !res.ok) {
                const message = res ? (res.reason || 'Unable to load worklogs.') : 'No data yet.';
                tableController.showPlaceholder(message);
                return;
            }

            const worklogs = Array.isArray(res.worklogs) ? res.worklogs : [];
            if (!worklogs.length) {
                tableController.showPlaceholder('No worklogs found.');
                return;
            }

            const uniqueWorklogs = Array.from(new Set(worklogs));
            const rows = uniqueWorklogs.map((w, idx) => {
                const issueUrl = buildIssueUrl(res.baseUrl, w.issueKey);
                const issueCell = renderIssueLink(w.issueKey, issueUrl) || '<span class="muted">—</span>';
                const jalaliDate = escapeHtml(w.persianDate || '');
                const gregorianDate = escapeHtml(w.date || '');
                const issueType = (w.issueType || '').toString().trim();
                const summaryText = (w.summary || '').toString().replace(/\n/g, ' ').trim();
                const hoursValue = Number(w.hours || 0);
                const timeSpentDisplay = (w.timeSpent || '').toString();
                const timeSpentSeconds = Number.isFinite(Number(w.timeSpentSeconds))
                    ? Number(w.timeSpentSeconds)
                    : parseDurationToSeconds(timeSpentDisplay);
                const commentText = (w.comment || '').toString().replace(/\n/g, ' ').trim();
                return {
                    className: w.dueDate ? '' : 'no-due-date',
                    cells: [
                        { text: idx + 1, sortValue: idx + 1 },
                        {
                            html: `<span class="tip" data-tip="${gregorianDate}">${jalaliDate}</span>`,
                            sortValue: safeDateValue(w.date || w.gregorianDate) ?? idx,
                            filterValue: jalaliDate,
                            exportValue: jalaliDate,
                        },
                        {
                            text: issueType,
                            filterValue: issueType,
                            exportValue: issueType,
                        },
                        {
                            html: issueCell,
                            sortValue: (w.issueKey || '').toLowerCase(),
                            exportValue: w.issueKey || '',
                        },
                        {
                            text: summaryText,
                            exportValue: summaryText,
                        },
                        {
                            text: hoursValue.toFixed(2),
                            sortValue: hoursValue,
                            exportValue: hoursValue.toFixed(2),
                        },
                        {
                            text: timeSpentDisplay,
                            sortValue: timeSpentSeconds ?? timeSpentDisplay,
                            exportValue: timeSpentDisplay,
                        },
                        {
                            text: commentText,
                            exportValue: commentText,
                        },
                    ],
                };
            });

            tableController.setRows(rows);
        });

        return {
            onShow: () => reportStateInstance.refresh()
        };
    }

    function initDueIssues(root, reportStateInstance) {
        if (!root || root.dataset.controllerReady === 'true') return {};
        root.dataset.controllerReady = 'true';

        const table = root.querySelector('#dueThisMonthTable');
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

        if (!table || !table.querySelector('tbody')) {
            console.warn('Due issues view missing required elements.');
            return {};
        }

        setupIssueLinkHandler(root);

        const tableController = createTableController(table, {
            exportFileName: 'due-issues',
            emptyMessage: 'No due issues found.',
            noMatchMessage: 'No due issues match the current filters.',
            onRender: (rows) => {
                if (!rows || rows.length === 0) {
                    updateFooter(null);
                    return;
                }
                const totals = rows.reduce((acc, row) => {
                    const estimate = Number(row.cells[7]?.sortValue ?? row.cells[7]?.exportValue ?? 0);
                    const logged = Number(row.cells[8]?.sortValue ?? row.cells[8]?.exportValue ?? 0);
                    const remaining = Number(row.cells[9]?.sortValue ?? row.cells[9]?.exportValue ?? 0);
                    acc.estimate += Number.isFinite(estimate) ? estimate : 0;
                    acc.logged += Number.isFinite(logged) ? logged : 0;
                    acc.remaining += Number.isFinite(remaining) ? remaining : 0;
                    return acc;
                }, { estimate: 0, logged: 0, remaining: 0 });
                updateFooter({
                    estimate: totals.estimate.toFixed(2),
                    logged: totals.logged.toFixed(2),
                    remaining: totals.remaining.toFixed(2),
                });
            },
        });
        setupTableExportButton(root, 'dueThisMonthTable', tableController);

        reportStateInstance.subscribe((state) => {
            if (state.isFetching && !state.result) {
                tableController.showPlaceholder('Loading…');
                return;
            }

            const res = state.result;
            if (!res || !res.ok) {
                const message = res ? (res.reason || 'Unable to load due issues.') : 'No data yet.';
                tableController.showPlaceholder(message);
                return;
            }

            const issues = Array.isArray(res.dueIssuesCurrentMonth) ? res.dueIssuesCurrentMonth : [];
            if (!issues.length) {
                tableController.showPlaceholder('—');
                return;
            }

            const rows = issues.map((issue, idx) => {
                const summary = (issue.summary || '').toString().replace(/\n/g, ' ').trim();
                const issueUrl = buildIssueUrl(res.baseUrl, issue.issueKey);
                const issueCell = renderIssueLink(issue.issueKey, issueUrl) || '<span class="muted">—</span>';
                const dueJalaali = escapeHtml(issue.dueDateJalaali || issue.dueDate || '');
                const dueGregorian = escapeHtml(issue.dueDateGregorian || issue.dueDate || '');
                const issueType = (issue.issueType || '').toString().trim();
                const sprints = Array.isArray(issue.sprints) ? issue.sprints.filter(Boolean) : [];
                const sprintText = sprints.length ? sprints.join(', ') : '—';
                const status = (issue.status || '').toString().trim();
                const estimateHours = Number(issue.estimateHours || 0);
                const loggedHours = Number(issue.loggedHours || 0);
                const remainingHours = Number(issue.remainingHours || 0);
                return {
                    cells: [
                        { text: idx + 1, sortValue: idx + 1 },
                        {
                            html: `<span class="tip" data-tip="${dueGregorian}">${dueJalaali}</span>`,
                            sortValue: safeDateValue(issue.dueDateGregorian || issue.dueDate) ?? idx,
                            filterValue: dueJalaali,
                            exportValue: dueJalaali,
                        },
                        {
                            text: issueType,
                            filterValue: issueType,
                            exportValue: issueType,
                        },
                        {
                            html: issueCell,
                            sortValue: (issue.issueKey || '').toLowerCase(),
                            exportValue: issue.issueKey || '',
                        },
                        { text: summary, exportValue: summary },
                        { text: sprintText, exportValue: sprintText },
                        {
                            text: status,
                            filterValue: status,
                            exportValue: status,
                        },
                        {
                            text: estimateHours.toFixed(2),
                            sortValue: estimateHours,
                            exportValue: estimateHours.toFixed(2),
                        },
                        {
                            text: loggedHours.toFixed(2),
                            sortValue: loggedHours,
                            exportValue: loggedHours.toFixed(2),
                        },
                        {
                            text: remainingHours.toFixed(2),
                            sortValue: remainingHours,
                            exportValue: remainingHours.toFixed(2),
                        },
                    ],
                };
            });

            tableController.setRows(rows);
        });

        return {
            onShow: () => reportStateInstance.refresh()
        };
    }

    function initIssuesReport(root, reportStateInstance) {
        if (!root || root.dataset.controllerReady === 'true') return {};
        root.dataset.controllerReady = 'true';

        const table = root.querySelector('#issuesTable');
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

        if (!table || !table.querySelector('tbody')) {
            console.warn('Issues view missing required elements.');
            return {};
        }

        setupIssueLinkHandler(root);

        const tableController = createTableController(table, {
            exportFileName: 'issues-report',
            emptyMessage: 'No issues found.',
            noMatchMessage: 'No issues match the current filters.',
            onRender: (rows) => {
                if (!rows || rows.length === 0) {
                    updateFooter(null);
                    return;
                }
                const totals = rows.reduce((acc, row) => {
                    const estimate = Number(row.cells[10]?.sortValue ?? row.cells[10]?.exportValue ?? 0);
                    const logged = Number(row.cells[11]?.sortValue ?? row.cells[11]?.exportValue ?? 0);
                    const remaining = Number(row.cells[12]?.sortValue ?? row.cells[12]?.exportValue ?? 0);
                    acc.estimate += Number.isFinite(estimate) ? estimate : 0;
                    acc.logged += Number.isFinite(logged) ? logged : 0;
                    acc.remaining += Number.isFinite(remaining) ? remaining : 0;
                    return acc;
                }, { estimate: 0, logged: 0, remaining: 0 });
                updateFooter({
                    estimate: totals.estimate.toFixed(2),
                    logged: totals.logged.toFixed(2),
                    remaining: totals.remaining.toFixed(2),
                });
            },
        });
        setupTableExportButton(root, 'issuesTable', tableController);

        reportStateInstance.subscribe((state) => {
            if (state.isFetching && !state.result) {
                tableController.showPlaceholder('Loading…');
                return;
            }

            const res = state.result;
            if (!res || !res.ok) {
                const message = res ? (res.reason || 'Unable to load issues.') : 'No data yet.';
                tableController.showPlaceholder(message);
                return;
            }

            const issues = Array.isArray(res.assignedIssues) ? res.assignedIssues : [];
            if (!issues.length) {
                tableController.showPlaceholder('No issues found.');
                return;
            }

            const rows = issues.map((issue, idx) => {
                const issueKey = issue.issueKey || '';
                const issueUrl = buildIssueUrl(res.baseUrl, issueKey);
                const issueCell = issueKey ? renderIssueLink(issueKey, issueUrl) : '<span class="muted">—</span>';
                const updatedDisplay = escapeHtml(issue.updatedJalaali || '');
                const updatedTooltip = escapeHtml(issue.updatedGregorian || '');
                const dueDisplay = escapeHtml(issue.dueDateJalaali || '');
                const dueTooltip = escapeHtml(issue.dueDateGregorian || '');
                const issueType = (issue.issueType || '').toString().trim();
                const summaryText = (issue.summary || '').toString().replace(/\n/g, ' ').trim();
                const sprints = Array.isArray(issue.sprints) ? issue.sprints.filter(Boolean) : [];
                const sprintText = sprints.length ? sprints.join(', ') : '—';
                const projectName = (issue.projectName || issue.projectKey || '').toString().trim();
                const projectText = projectName || '—';
                const boards = Array.isArray(issue.boardNames) ? issue.boardNames.filter(Boolean) : [];
                const boardText = boards.length ? boards.join(', ') : '—';
                const status = (issue.status || '').toString().trim();

                const estimateHours = Number(issue.estimateHours || 0);
                const loggedHours = Number(issue.loggedHours || 0);
                const remainingHours = Number(issue.remainingHours || 0);

                const updatedCell = updatedDisplay
                    ? `<span class="tip" data-tip="${updatedTooltip || updatedDisplay}">${updatedDisplay}</span>`
                    : '<span class="muted">—</span>';
                const dueCell = dueDisplay
                    ? `<span class="tip" data-tip="${dueTooltip || dueDisplay}">${dueDisplay}</span>`
                    : '<span class="muted">—</span>';

                return {
                    cells: [
                        { text: idx + 1, sortValue: idx + 1 },
                        {
                            html: updatedCell,
                            sortValue: safeDateValue(issue.updatedGregorian || issue.updatedJalaali) ?? idx,
                            filterValue: updatedDisplay,
                            exportValue: updatedDisplay || '',
                        },
                        {
                            html: dueCell,
                            sortValue: safeDateValue(issue.dueDateGregorian || issue.dueDateJalaali) ?? idx,
                            filterValue: dueDisplay,
                            exportValue: dueDisplay || '',
                        },
                        {
                            text: issueType,
                            filterValue: issueType,
                            exportValue: issueType,
                        },
                        {
                            html: issueCell,
                            sortValue: issueKey.toLowerCase(),
                            exportValue: issueKey,
                        },
                        { text: summaryText, exportValue: summaryText },
                        { text: sprintText, exportValue: sprintText },
                        {
                            text: projectText,
                            filterValue: projectText,
                            exportValue: projectText,
                        },
                        {
                            text: boardText,
                            filterValue: boardText,
                            exportValue: boardText,
                        },
                        {
                            text: status,
                            filterValue: status,
                            exportValue: status,
                        },
                        {
                            text: estimateHours.toFixed(2),
                            sortValue: estimateHours,
                            exportValue: estimateHours.toFixed(2),
                        },
                        {
                            text: loggedHours.toFixed(2),
                            sortValue: loggedHours,
                            exportValue: loggedHours.toFixed(2),
                        },
                        {
                            text: remainingHours.toFixed(2),
                            sortValue: remainingHours,
                            exportValue: remainingHours.toFixed(2),
                        },
                    ],
                };
            });

            tableController.setRows(rows);
        });

        return {
            onShow: () => reportStateInstance.refresh()
        };
    }

    function initQuarterReport(root, reportStateInstance) {
        if (!root || root.dataset.controllerReady === 'true') return {};
        root.dataset.controllerReady = 'true';

        const table = root.querySelector('#quarterReportTable');
        if (!table || !table.querySelector('tbody')) {
            console.warn('Quarter report view missing required elements.');
            return {};
        }

        const tableController = createTableController(table, {
            exportFileName: 'quarter-report',
            emptyMessage: 'Select a user and month to see the quarter report.',
            noMatchMessage: 'No rows match the current filters.',
        });
        setupTableExportButton(root, 'quarterReportTable', tableController);

        reportStateInstance.subscribe((state) => {
            if (state.isFetching && !state.result) {
                tableController.showPlaceholder('Loading…');
                return;
            }

            const res = state.result;
            if (!res || !res.ok) {
                const message = res ? (res.reason || 'Unable to load quarter report.') : 'No data yet.';
                tableController.showPlaceholder(message);
                return;
            }

            const data = res.quarterReport;
            if (!data?.ok || !Array.isArray(data.seasons) || data.seasons.length === 0) {
                tableController.showPlaceholder('—');
                return;
            }

            const rows = data.seasons.map((season) => {
                const months = Array.isArray(season.months) ? season.months.slice(0, 3) : [];
                while (months.length < 3) {
                    months.push(null);
                }
                const monthCells = months.map((month) => {
                    if (!month) {
                        return {
                            html: '<div class="quarter-month"><span class="muted">—</span></div>',
                            exportValue: '—',
                        };
                    }
                    const label = month.label || `Month ${month.jMonth}`;
                    if (!month.ok) {
                        const reason = month.reason || 'No data';
                        return {
                            html: `<div class="quarter-month"><strong>${label}</strong><span class="muted">${escapeHtml(reason)}</span></div>`,
                            exportValue: `${label}: ${reason}`,
                        };
                    }
                    const delta = Number.parseFloat(month.delta || 0) || 0;
                    const deltaCls = delta >= 0 ? 'delta-pos' : 'delta-neg';
                    const totalHours = formatHours(month.totalHours);
                    const expectedHours = formatHours(month.expectedHours);
                    return {
                        html: `
                            <div class="quarter-month">
                                <strong>${escapeHtml(label)}</strong>
                                <div>${totalHours} h</div>
                                <div class="muted">Exp ${expectedHours} h</div>
                                <div class="${deltaCls}">${delta.toFixed(2)} h</div>
                            </div>
                        `,
                        exportValue: `${label}: ${totalHours}h (Exp ${expectedHours}h, Δ ${delta.toFixed(2)}h)`,
                    };
                });
                const totals = season.totals || {};
                const totalDelta = Number.parseFloat(totals.delta || 0) || 0;
                const totalDeltaCls = totalDelta >= 0 ? 'delta-pos' : 'delta-neg';
                const totalHours = Number(totals.totalHours || 0);
                const expectedHours = Number(totals.expectedHours || 0);
                return {
                    cells: [
                        {
                            text: season.label || 'Season',
                            exportValue: season.label || 'Season',
                        },
                        ...monthCells.map((cell) => ({
                            html: cell.html,
                            exportValue: cell.exportValue,
                        })),
                        {
                            text: `${formatHours(totalHours)} h`,
                            sortValue: totalHours,
                            exportValue: formatHours(totalHours),
                        },
                        {
                            text: `${formatHours(expectedHours)} h`,
                            sortValue: expectedHours,
                            exportValue: formatHours(expectedHours),
                        },
                        {
                            html: `<span class="${totalDeltaCls}">${totalDelta.toFixed(2)} h</span>`,
                            sortValue: totalDelta,
                            exportValue: totalDelta.toFixed(2),
                        },
                    ],
                };
            });

            tableController.setRows(rows);
        });

        return {
            onShow: () => reportStateInstance.refresh()
        };
    }

    function createTableController(table, options = {}) {
        if (!table) return null;
        if (tableControllers.has(table)) {
            const existing = tableControllers.get(table);
            if (options && typeof options.onRender === 'function') {
                existing.setRenderCallback(options.onRender);
            }
            if (options && options.exportFileName) {
                existing.setExportName(options.exportFileName);
            }
            return existing;
        }

        const tbody = table.querySelector('tbody');
        const headers = Array.from(table.querySelectorAll('thead th'));
        if (!tbody || !headers.length) {
            console.warn('Table controller cannot initialise without tbody/header.', table);
            const noop = {
                setRows: () => {},
                showPlaceholder: () => {},
                exportToExcel: () => {},
                resetFilters: () => {},
                setRenderCallback: () => {},
                setExportName: () => {},
                refresh: () => {},
                getVisibleRows: () => [],
            };
            tableControllers.set(table, noop);
            return noop;
        }

        const defaultSettings = {
            exportFileName: table.id || 'table-export',
            emptyMessage: 'No data available.',
            noMatchMessage: 'No records match the current filters.',
            onRender: null,
        };
        const settings = { ...defaultSettings, ...options };
        const state = {
            rows: [],
            visibleRows: [],
            sortIndex: null,
            sortDirection: 'asc',
            filters: new Map(),
            filterControls: new Map(),
            onRender: typeof settings.onRender === 'function' ? settings.onRender : null,
            exportName: ensureExcelFileName(settings.exportFileName),
            emptyMessage: settings.emptyMessage,
            noMatchMessage: settings.noMatchMessage,
            placeholderMessage: null,
        };

        const columns = headers.map((th, index) => {
            const dataset = th.dataset || {};
            const labelText = th.textContent.trim() || `Column ${index + 1}`;
            const columnType = (dataset.type || '').toLowerCase();
            const column = {
                index,
                th,
                label: labelText,
                type: columnType || 'string',
                sortable: dataset.sortable !== 'false',
                filterable: dataset.filterable === 'true',
            };
            th.textContent = '';
            const wrapper = document.createElement('div');
            wrapper.className = 'table-head-cell';
            const labelEl = document.createElement('span');
            labelEl.className = 'table-header__label';
            labelEl.textContent = labelText;
            wrapper.appendChild(labelEl);
            if (column.filterable) {
                const filterSelect = document.createElement('select');
                filterSelect.className = 'table-filter';
                filterSelect.innerHTML = '<option value="">All</option>';
                filterSelect.addEventListener('change', () => {
                    const value = filterSelect.value;
                    if (value) {
                        state.filters.set(index, value);
                    } else {
                        state.filters.delete(index);
                    }
                    state.placeholderMessage = null;
                    render();
                });
                filterSelect.addEventListener('click', (event) => {
                    event.stopPropagation();
                });
                state.filterControls.set(index, filterSelect);
                wrapper.appendChild(filterSelect);
            }
            th.appendChild(wrapper);
            if (column.sortable) {
                th.classList.add('is-sortable');
                th.dataset.sortDirection = 'none';
                th.addEventListener('click', (event) => {
                    if (event.target instanceof Element && event.target.closest('.table-filter')) {
                        return;
                    }
                    toggleSort(index);
                });
            } else {
                th.dataset.sortDirection = 'none';
            }
            return column;
        });

        function toggleSort(index) {
            if (state.sortIndex === index) {
                if (state.sortDirection === 'asc') {
                    state.sortDirection = 'desc';
                } else if (state.sortDirection === 'desc') {
                    state.sortIndex = null;
                    state.sortDirection = 'asc';
                } else {
                    state.sortDirection = 'asc';
                }
            } else {
                state.sortIndex = index;
                state.sortDirection = 'asc';
            }
            headers.forEach((header, idx) => {
                const dir = idx === state.sortIndex ? state.sortDirection : 'none';
                header.dataset.sortDirection = dir || 'none';
            });
            state.placeholderMessage = null;
            render();
        }

        function setRows(rows) {
            const normalisedRows = Array.isArray(rows)
                ? rows.map((row) => normaliseRow(row))
                : [];
            state.rows = normalisedRows;
            state.placeholderMessage = null;
            updateFilterOptions();
            render();
        }

        function showPlaceholder(message) {
            state.placeholderMessage = message || state.emptyMessage;
            state.visibleRows = [];
            headers.forEach((header) => {
                header.dataset.sortDirection = 'none';
            });
            tbody.innerHTML = '';
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = columns.length || 1;
            td.textContent = state.placeholderMessage;
            tr.appendChild(td);
            tbody.appendChild(tr);
            if (typeof state.onRender === 'function') {
                state.onRender([]);
            }
        }

        function render() {
            if (state.placeholderMessage != null) {
                return;
            }
            const filtered = applyFilters(state.rows);
            const sorted = applySort(filtered);
            state.visibleRows = sorted;
            headers.forEach((header, idx) => {
                const dir = idx === state.sortIndex ? state.sortDirection : 'none';
                header.dataset.sortDirection = dir || 'none';
            });
            tbody.innerHTML = '';
            if (!sorted.length) {
                const tr = document.createElement('tr');
                const td = document.createElement('td');
                td.colSpan = columns.length || 1;
                td.textContent = state.rows.length ? state.noMatchMessage : state.emptyMessage;
                tr.appendChild(td);
                tbody.appendChild(tr);
                if (typeof state.onRender === 'function') {
                    state.onRender([]);
                }
                return;
            }
            sorted.forEach((row) => {
                const tr = document.createElement('tr');
                if (row.className) {
                    tr.className = row.className;
                }
                row.cells.forEach((cell) => {
                    const td = document.createElement('td');
                    if (cell.html != null) {
                        td.innerHTML = cell.html;
                    } else {
                        td.textContent = cell.text != null ? cell.text : '';
                    }
                    tr.appendChild(td);
                });
                tbody.appendChild(tr);
            });
            if (typeof state.onRender === 'function') {
                state.onRender(sorted);
            }
        }

        function applyFilters(rows) {
            let result = rows;
            state.filters.forEach((value, index) => {
                if (!value) return;
                result = result.filter((row) => normaliseFilterKey(row.cells[index]?.filterValue) === value);
            });
            return result;
        }

        function applySort(rows) {
            if (state.sortIndex == null) {
                return rows.slice();
            }
            const column = columns[state.sortIndex];
            const direction = state.sortDirection === 'desc' ? -1 : 1;
            return rows.slice().sort((a, b) => {
                return compareCellValues(a.cells[state.sortIndex], b.cells[state.sortIndex], column.type) * direction;
            });
        }

        function updateFilterOptions() {
            state.filterControls.forEach((select, index) => {
                const previous = select.value;
                const options = new Map();
                state.rows.forEach((row) => {
                    const cell = row.cells[index];
                    const label = cell?.filterValue;
                    const key = normaliseFilterKey(label);
                    if (!key) return;
                    if (!options.has(key)) {
                        options.set(key, String(label ?? ''));
                    }
                });
                const entries = Array.from(options.entries()).sort((a, b) => {
                    return String(a[1] ?? '').localeCompare(String(b[1] ?? ''), undefined, { sensitivity: 'base' });
                });
                const htmlParts = ['<option value="">All</option>'];
                entries.forEach(([key, label]) => {
                    htmlParts.push(`<option value="${escapeHtml(key)}">${escapeHtml(label)}</option>`);
                });
                select.innerHTML = htmlParts.join('');
                if (previous && options.has(previous)) {
                    select.value = previous;
                    state.filters.set(index, previous);
                } else {
                    select.value = '';
                    state.filters.delete(index);
                }
            });
        }

        function normaliseRow(row) {
            const cells = Array.isArray(row?.cells) ? row.cells : [];
            return {
                className: row?.className || '',
                cells: columns.map((column, idx) => normaliseCell(cells[idx], column)),
            };
        }

        function normaliseCell(cell, column) {
            const source = cell && typeof cell === 'object' ? cell : {};
            const html = source.html != null ? String(source.html) : null;
            let text = source.text;
            if (text == null) {
                if (html != null) {
                    text = stripHtmlContent(html);
                } else if (source.value != null) {
                    text = source.value;
                } else {
                    text = '';
                }
            }
            const sortValue = source.sortValue != null ? source.sortValue : inferSortValue(text, column.type);
            const filterValue = source.filterValue != null ? source.filterValue : text;
            const exportValue = source.exportValue != null
                ? source.exportValue
                : html != null
                    ? stripHtmlContent(html)
                    : text;
            return {
                html,
                text: text != null ? String(text) : '',
                sortValue,
                filterValue,
                exportValue,
            };
        }

        function inferSortValue(value, type) {
            if (type === 'number' || type === 'duration') {
                const num = Number(value);
                return Number.isFinite(num) ? num : null;
            }
            if (type === 'date') {
                return safeDateValue(value);
            }
            return value;
        }

        function compareCellValues(cellA, cellB, type) {
            if (type === 'number' || type === 'date' || type === 'duration') {
                const a = Number(cellA?.sortValue);
                const b = Number(cellB?.sortValue);
                const validA = Number.isFinite(a);
                const validB = Number.isFinite(b);
                if (!validA && !validB) return 0;
                if (!validA) return 1;
                if (!validB) return -1;
                if (a === b) return 0;
                return a - b;
            }
            const aStr = String(cellA?.sortValue ?? cellA?.text ?? '').toLowerCase();
            const bStr = String(cellB?.sortValue ?? cellB?.text ?? '').toLowerCase();
            return aStr.localeCompare(bStr);
        }

        const controller = {
            setRows,
            showPlaceholder,
            exportToExcel() {
                const rowsForExport = state.placeholderMessage != null
                    ? []
                    : (state.visibleRows.length ? state.visibleRows : applySort(applyFilters(state.rows)));
                downloadTableDataAsExcel(columns, rowsForExport, state.exportName);
            },
            resetFilters() {
                state.filters.clear();
                state.filterControls.forEach((select) => {
                    select.value = '';
                });
                state.placeholderMessage = null;
                render();
            },
            setRenderCallback(callback) {
                state.onRender = typeof callback === 'function' ? callback : null;
                if (state.onRender) {
                    state.onRender(state.visibleRows.slice());
                }
            },
            setExportName(name) {
                if (name) {
                    state.exportName = ensureExcelFileName(name);
                }
            },
            refresh() {
                state.placeholderMessage = null;
                render();
            },
            getVisibleRows() {
                return state.visibleRows.slice();
            }
        };

        tableControllers.set(table, controller);
        return controller;
    }

    function setupTableExportButton(root, tableId, controller) {
        if (!root || !controller) return;
        const selector = `[data-export-for="${tableId}"]`;
        const button = root.querySelector(selector) || document.querySelector(selector);
        if (!button || button.dataset.exportReady === 'true') return;
        button.addEventListener('click', () => {
            try {
                controller.exportToExcel();
            } catch (err) {
                console.error('Failed to export table', err);
            }
        });
        button.dataset.exportReady = 'true';
    }

    function ensureExcelFileName(name) {
        const fallback = 'table-export';
        if (!name) return fallback;
        const base = String(name).trim().replace(/[\\/:*?"<>|]+/g, '_');
        return base || fallback;
    }

    function downloadTableDataAsExcel(columns, rows, filename) {
        const safeName = ensureExcelFileName(filename);
        const headerHtml = columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join('');
        const bodyHtml = rows.map((row) => {
            const cellsHtml = row.cells.map((cell) => `<td>${escapeHtml(cell.exportValue ?? cell.text ?? '')}</td>`).join('');
            return `<tr>${cellsHtml}</tr>`;
        }).join('');
        const tableHtml = `<table><thead><tr>${headerHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>`;
        const blob = new Blob(['\ufeff' + tableHtml], { type: 'application/vnd.ms-excel' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = safeName.toLowerCase().endsWith('.xls') ? safeName : `${safeName}.xls`;
        document.body.appendChild(link);
        link.click();
        setTimeout(() => {
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        }, 0);
    }

    function normaliseFilterKey(value) {
        if (value == null) return '';
        return toAsciiDigits(String(value)).trim().toLowerCase();
    }

    function stripHtmlContent(value) {
        if (value == null) return '';
        const helper = document.createElement('div');
        helper.innerHTML = value;
        const text = helper.textContent || helper.innerText || '';
        return text;
    }

    function parseDurationToSeconds(value) {
        if (typeof value === 'number' && Number.isFinite(value)) {
            return value;
        }
        if (typeof value !== 'string') {
            return null;
        }
        const text = value.trim();
        if (!text) {
            return null;
        }
        let total = 0;
        let matched = false;
        const pattern = /([0-9]+(?:\.[0-9]+)?)\s*(w|d|h|m|s)/gi;
        let match;
        while ((match = pattern.exec(text)) !== null) {
            matched = true;
            const amount = Number.parseFloat(match[1]);
            if (!Number.isFinite(amount)) {
                continue;
            }
            const unit = match[2].toLowerCase();
            const multiplier = unit === 'w'
                ? 604800
                : unit === 'd'
                    ? 86400
                    : unit === 'h'
                        ? 3600
                        : unit === 'm'
                            ? 60
                            : 1;
            total += amount * multiplier;
        }
        if (matched) {
            return total;
        }
        const numeric = Number.parseFloat(text);
        return Number.isFinite(numeric) ? numeric : null;
    }

    function safeDateValue(value) {
        if (!value) return null;
        if (value instanceof Date) {
            const timestamp = value.getTime();
            return Number.isFinite(timestamp) ? timestamp : null;
        }
        const normalised = toAsciiDigits(String(value).trim());
        if (!normalised) return null;
        const parsed = Date.parse(normalised);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
        const digits = normalised.replace(/[^0-9]/g, '');
        if (digits.length >= 8) {
            const year = Number.parseInt(digits.slice(0, 4), 10);
            const month = Number.parseInt(digits.slice(4, 6), 10) - 1;
            const day = Number.parseInt(digits.slice(6, 8), 10);
            const candidate = new Date(year, month >= 0 ? month : 0, day >= 1 ? day : 1);
            const timestamp = candidate.getTime();
            return Number.isFinite(timestamp) ? timestamp : null;
        }
        return null;
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
