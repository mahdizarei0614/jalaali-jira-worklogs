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

        if (!table || !footerTotals) {
            console.warn('Monthly summary view missing required elements.');
            return {};
        }

        const tableController = createInteractiveTable(table, {
            columns: [
                { key: 'index', label: '#', sortable: true },
                { key: 'jalaali', label: 'Jalaali', sortable: true, filterType: 'search' },
                { key: 'weekday', label: 'Weekday', sortable: true, filterType: 'select' },
                { key: 'flags', label: 'Flags', filterType: 'search' },
                { key: 'hours', label: 'Hours', sortable: true },
            ],
            exportFileName: 'monthly-summary',
            emptyMessage: 'No worklogs for this month.',
        });

        const exportBtn = root.querySelector('[data-export-target="results"]');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => {
                tableController.exportToExcel('monthly-summary');
            });
        }

        reportStateInstance.subscribe((state) => {
            renderSummary(state);
        });

        function renderSummary(state) {
            const res = state.result;
            if (state.isFetching && !res) {
                table.style.display = 'table';
                tableController.showMessage('Loading…');
                updateFooter(null);
                if (debug) debug.textContent = '';
                return;
            }

            if (!res || !res.ok) {
                if (res) {
                    table.style.display = 'table';
                    tableController.showMessage(res.reason || 'No data available.');
                } else {
                    table.style.display = 'none';
                    tableController.showMessage('No data available.');
                }
                updateFooter(null);
                if (debug) debug.textContent = '';
                return;
            }

            const days = Array.isArray(res.days) ? res.days : [];
            table.style.display = 'table';
            const rows = days.map((d, idx) => {
                const flags = [
                    d.isFuture ? 'future' : '',
                    d.isThuFri ? 'Thu/Fri' : '',
                    d.isHoliday ? 'holiday' : '',
                    d.isWorkday === false ? 'non-workday' : ''
                ].filter(Boolean).join(', ');
                const flagsHtml = flags
                    ? `<span><small>${escapeHtml(flags)}</small></span>`
                    : '<span class="muted">—</span>';
                const hoursValue = Number(d.hours || 0);
                const jalaali = escapeHtml(d.j || '');
                const gregorian = escapeHtml(d.g || '');
                const weekday = weekdayName(d.weekday);
                return {
                    className: d.color || '',
                    cells: {
                        index: createCell(idx + 1, { sortValue: idx + 1, exportValue: idx + 1 }),
                        jalaali: createCell(jalaali, {
                            html: `<td><span class="tip" data-tip="${gregorian}">${jalaali}</span></td>`,
                            sortValue: Date.parse(d.g || '') || jalaali,
                            filterValue: jalaali,
                            exportValue: d.j || '',
                        }),
                        weekday: createCell(weekday, {
                            filterValue: weekday,
                            exportValue: weekday,
                        }),
                        flags: createCell(flags || '—', {
                            html: `<td>${flagsHtml}</td>`,
                            filterValue: flags,
                            exportValue: flags,
                        }),
                        hours: createCell(hoursValue, {
                            html: `<td>${hoursValue.toFixed(2)}</td>`,
                            sortValue: hoursValue,
                            filterValue: hoursValue,
                            exportValue: hoursValue.toFixed(2),
                        }),
                    },
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
        if (!table) {
            console.warn('Detailed worklogs view missing required elements.');
            return {};
        }

        setupIssueLinkHandler(root);

        const tableController = createInteractiveTable(table, {
            columns: [
                { key: 'index', label: '#', sortable: true },
                { key: 'date', label: 'Jalaali Date', sortable: true, filterType: 'search' },
                { key: 'type', label: 'Type', sortable: true, filterType: 'select' },
                { key: 'issue', label: 'Issue', sortable: true, filterType: 'search' },
                { key: 'summary', label: 'Summary', sortable: true, filterType: 'search' },
                { key: 'hours', label: 'Hours', sortable: true },
                { key: 'timeSpent', label: 'Time Spent', sortable: true, filterType: 'search' },
                { key: 'comment', label: 'Comment', sortable: true, filterType: 'search' },
            ],
            exportFileName: 'detailed-worklogs',
            emptyMessage: 'No worklogs found.',
        });

        const exportBtn = root.querySelector('[data-export-target="detailedWorklogsTable"]');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => {
                tableController.exportToExcel('detailed-worklogs');
            });
        }

        reportStateInstance.subscribe((state) => {
            if (state.isFetching && !state.result) {
                tableController.showMessage('Loading…');
                return;
            }

            const res = state.result;
            if (!res || !res.ok) {
                const message = res ? (res.reason || 'Unable to load worklogs.') : 'No data yet.';
                tableController.showMessage(message);
                return;
            }

            const worklogs = Array.isArray(res.worklogs) ? Array.from(new Set(res.worklogs)) : [];
            if (!worklogs.length) {
                tableController.showMessage('No worklogs found.');
                return;
            }

            const rows = worklogs.map((w, idx) => {
                const issueUrl = buildIssueUrl(res.baseUrl, w.issueKey);
                const issueCell = renderIssueLink(w.issueKey, issueUrl);
                const jalaliDate = escapeHtml(w.persianDate || '');
                const gregorianDate = escapeHtml(w.date || '');
                const issueType = escapeHtml(w.issueType || '');
                const summaryText = (w.summary || '').toString().replace(/\n/g, ' ');
                const summary = escapeHtml(summaryText);
                const commentText = (w.comment || '').toString().replace(/\n/g, ' ');
                const comment = escapeHtml(commentText);
                const hours = Number(w.hours || 0);
                const timeSpentText = w.timeSpent || '';
                const timeSpent = escapeHtml(timeSpentText);
                return {
                    className: !w.dueDate ? 'no-due-date' : '',
                    cells: {
                        index: createCell(idx + 1, { sortValue: idx + 1, exportValue: idx + 1 }),
                        date: createCell(jalaliDate, {
                            html: `<td><span class="tip" data-tip="${gregorianDate}">${jalaliDate}</span></td>`,
                            sortValue: Date.parse(w.date || '') || jalaliDate,
                            filterValue: jalaliDate,
                            exportValue: jalaliDate,
                        }),
                        type: createCell(issueType, {
                            filterValue: issueType,
                            exportValue: issueType,
                        }),
                        issue: createCell(w.issueKey || '', {
                            html: `<td>${issueCell}</td>`,
                            sortValue: (w.issueKey || '').toString(),
                            filterValue: (w.issueKey || '').toString(),
                            exportValue: w.issueKey || '',
                        }),
                        summary: createCell(summary, {
                            html: `<td>${summary}</td>`,
                            filterValue: summaryText,
                            exportValue: summaryText,
                        }),
                        hours: createCell(hours, {
                            html: `<td>${hours.toFixed(2)}</td>`,
                            sortValue: hours,
                            filterValue: hours,
                            exportValue: hours.toFixed(2),
                        }),
                        timeSpent: createCell(timeSpent, {
                            html: `<td>${timeSpent}</td>`,
                            filterValue: timeSpentText,
                            exportValue: timeSpentText,
                        }),
                        comment: createCell(comment, {
                            html: `<td>${comment}</td>`,
                            filterValue: commentText,
                            exportValue: commentText,
                        }),
                    },
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

        if (!table) {
            console.warn('Due issues view missing required elements.');
            return {};
        }

        setupIssueLinkHandler(root);

        const tableController = createInteractiveTable(table, {
            columns: [
                { key: 'index', label: '#', sortable: true },
                { key: 'dueDate', label: 'Due Date (Jalaali)', sortable: true },
                { key: 'type', label: 'Type', sortable: true, filterType: 'select' },
                { key: 'issue', label: 'Issue', sortable: true, filterType: 'search' },
                { key: 'title', label: 'Title', sortable: true, filterType: 'search' },
                { key: 'sprints', label: 'Sprints', sortable: true, filterType: 'search' },
                { key: 'status', label: 'Status', sortable: true, filterType: 'select' },
                { key: 'estimate', label: 'Estimate (h)', sortable: true },
                { key: 'logged', label: 'Logged (h)', sortable: true },
                { key: 'remaining', label: 'Remaining (h)', sortable: true },
            ],
            exportFileName: 'due-issues',
            emptyMessage: 'No issues due for this month.',
        });

        const exportBtn = root.querySelector('[data-export-target="dueThisMonthTable"]');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => {
                tableController.exportToExcel('due-issues');
            });
        }

        reportStateInstance.subscribe((state) => {
            if (state.isFetching && !state.result) {
                tableController.showMessage('Loading…');
                resetFooter();
                return;
            }

            const res = state.result;
            if (!res || !res.ok) {
                const message = res ? (res.reason || 'Unable to load due issues.') : 'No data yet.';
                tableController.showMessage(message);
                resetFooter();
                return;
            }

            const issues = Array.isArray(res.dueIssuesCurrentMonth) ? res.dueIssuesCurrentMonth : [];
            if (!issues.length) {
                tableController.showMessage('—');
                resetFooter();
                return;
            }

            let totals = {
                estimate: 0,
                logged: 0,
                remaining: 0,
            };
            const rows = issues.map((issue, idx) => {
                const summaryText = (issue.summary || '').toString().replace(/\n/g, ' ');
                const summary = escapeHtml(summaryText);
                const issueUrl = buildIssueUrl(res.baseUrl, issue.issueKey);
                const issueCell = renderIssueLink(issue.issueKey, issueUrl);
                const dueJalaali = escapeHtml(issue.dueDateJalaali || issue.dueDate || '');
                const dueGregorian = escapeHtml(issue.dueDateGregorian || issue.dueDate || '');
                const issueType = escapeHtml(issue.issueType || '');
                const sprints = Array.isArray(issue.sprints) ? issue.sprints.filter(Boolean) : [];
                const sprintTextRaw = sprints.length ? sprints.join(', ') : '—';
                const sprintText = escapeHtml(sprintTextRaw);
                const statusText = issue.status || '';
                const status = escapeHtml(statusText);
                const estimateHours = Number(issue.estimateHours || 0);
                const loggedHours = Number(issue.loggedHours || 0);
                const remainingHours = Number(issue.remainingHours || 0);
                totals.estimate += estimateHours;
                totals.logged += loggedHours;
                totals.remaining += remainingHours;
                return {
                    cells: {
                        index: createCell(idx + 1, { sortValue: idx + 1, exportValue: idx + 1 }),
                        dueDate: createCell(dueJalaali, {
                            html: `<td><span class="tip" data-tip="${dueGregorian}">${dueJalaali}</span></td>`,
                            sortValue: Date.parse(issue.dueDateGregorian || issue.dueDate || '') || dueJalaali,
                            filterValue: dueJalaali,
                            exportValue: dueJalaali,
                        }),
                        type: createCell(issueType, {
                            filterValue: issueType,
                            exportValue: issue.issueType || '',
                        }),
                        issue: createCell(issue.issueKey || '', {
                            html: `<td>${issueCell}</td>`,
                            sortValue: (issue.issueKey || '').toString(),
                            filterValue: (issue.issueKey || '').toString(),
                            exportValue: issue.issueKey || '',
                        }),
                        title: createCell(summary, {
                            html: `<td>${summary}</td>`,
                            filterValue: summaryText,
                            exportValue: summaryText,
                        }),
                        sprints: createCell(sprintText, {
                            html: `<td>${sprintText}</td>`,
                            filterValue: sprintTextRaw,
                            exportValue: sprintTextRaw,
                        }),
                        status: createCell(status, {
                            html: `<td>${status}</td>`,
                            filterValue: statusText,
                            exportValue: statusText,
                        }),
                        estimate: createCell(estimateHours, {
                            html: `<td>${estimateHours.toFixed(2)}</td>`,
                            sortValue: estimateHours,
                            filterValue: estimateHours,
                            exportValue: estimateHours.toFixed(2),
                        }),
                        logged: createCell(loggedHours, {
                            html: `<td>${loggedHours.toFixed(2)}</td>`,
                            sortValue: loggedHours,
                            filterValue: loggedHours,
                            exportValue: loggedHours.toFixed(2),
                        }),
                        remaining: createCell(remainingHours, {
                            html: `<td>${remainingHours.toFixed(2)}</td>`,
                            sortValue: remainingHours,
                            filterValue: remainingHours,
                            exportValue: remainingHours.toFixed(2),
                        }),
                    },
                };
            });

            tableController.setRows(rows);

            updateFooter({
                estimate: totals.estimate.toFixed(2),
                logged: totals.logged.toFixed(2),
                remaining: totals.remaining.toFixed(2),
            });
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

        if (!table) {
            console.warn('Issues view missing required elements.');
            return {};
        }

        setupIssueLinkHandler(root);

        const tableController = createInteractiveTable(table, {
            columns: [
                { key: 'index', label: '#', sortable: true },
                { key: 'updated', label: 'Updated (Jalaali)', sortable: true },
                { key: 'due', label: 'Due Date (Jalaali)', sortable: true },
                { key: 'type', label: 'Type', sortable: true, filterType: 'select' },
                { key: 'issue', label: 'Issue', sortable: true, filterType: 'search' },
                { key: 'title', label: 'Title', sortable: true, filterType: 'search' },
                { key: 'sprints', label: 'Sprints', sortable: true, filterType: 'search' },
                { key: 'project', label: 'Project', sortable: true, filterType: 'select' },
                { key: 'board', label: 'Board', sortable: true, filterType: 'search' },
                { key: 'status', label: 'Status', sortable: true, filterType: 'select' },
                { key: 'estimate', label: 'Estimate (h)', sortable: true },
                { key: 'logged', label: 'Logged (h)', sortable: true },
                { key: 'remaining', label: 'Remaining (h)', sortable: true },
            ],
            exportFileName: 'issues-report',
            emptyMessage: 'No issues found.',
        });

        const exportBtn = root.querySelector('[data-export-target="issuesTable"]');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => {
                tableController.exportToExcel('issues-report');
            });
        }

        reportStateInstance.subscribe((state) => {
            if (state.isFetching && !state.result) {
                tableController.showMessage('Loading…');
                resetFooter();
                return;
            }

            const res = state.result;
            if (!res || !res.ok) {
                const message = res ? (res.reason || 'Unable to load issues.') : 'No data yet.';
                tableController.showMessage(message);
                resetFooter();
                return;
            }

            const issues = Array.isArray(res.assignedIssues) ? res.assignedIssues : [];
            if (!issues.length) {
                tableController.showMessage('—');
                resetFooter();
                return;
            }

            const totals = { estimate: 0, logged: 0, remaining: 0 };
            const rows = issues.map((issue, idx) => {
                const issueKey = issue.issueKey || '';
                const issueUrl = buildIssueUrl(res.baseUrl, issueKey);
                const issueCell = issueKey ? renderIssueLink(issueKey, issueUrl) : '—';
                const updatedDisplay = escapeHtml(issue.updatedJalaali || '');
                const updatedTooltip = escapeHtml(issue.updatedGregorian || '');
                const dueDisplay = escapeHtml(issue.dueDateJalaali || '');
                const dueTooltip = escapeHtml(issue.dueDateGregorian || '');
                const issueType = escapeHtml(issue.issueType || '');
                const summaryText = (issue.summary || '').toString().replace(/\n/g, ' ');
                const summary = escapeHtml(summaryText);
                const sprints = Array.isArray(issue.sprints) ? issue.sprints.filter(Boolean) : [];
                const sprintTextRaw = sprints.length ? sprints.join(', ') : '—';
                const sprintText = escapeHtml(sprintTextRaw);
                const projectName = issue.projectName || issue.projectKey || '';
                const projectText = projectName ? escapeHtml(projectName) : '—';
                const boards = Array.isArray(issue.boardNames) ? issue.boardNames.filter(Boolean) : [];
                const boardTextRaw = boards.length ? boards.join(', ') : '—';
                const boardText = escapeHtml(boardTextRaw);
                const statusText = issue.status || '';
                const status = escapeHtml(statusText);

                const estimateHours = Number(issue.estimateHours || 0);
                const loggedHours = Number(issue.loggedHours || 0);
                const remainingHours = Number(issue.remainingHours || 0);
                totals.estimate += estimateHours;
                totals.logged += loggedHours;
                totals.remaining += remainingHours;

                const updatedCell = updatedDisplay
                    ? `<span class="tip" data-tip="${updatedTooltip || updatedDisplay}">${updatedDisplay}</span>`
                    : '<span class="muted">—</span>';
                const dueCell = dueDisplay
                    ? `<span class="tip" data-tip="${dueTooltip || dueDisplay}">${dueDisplay}</span>`
                    : '<span class="muted">—</span>';

                return {
                    cells: {
                        index: createCell(idx + 1, { sortValue: idx + 1, exportValue: idx + 1 }),
                        updated: createCell(updatedDisplay || '—', {
                            html: `<td>${updatedCell}</td>`,
                            sortValue: Date.parse(issue.updatedGregorian || issue.updated || '') || updatedDisplay,
                            filterValue: updatedDisplay,
                            exportValue: updatedDisplay,
                        }),
                        due: createCell(dueDisplay || '—', {
                            html: `<td>${dueCell}</td>`,
                            sortValue: Date.parse(issue.dueDateGregorian || issue.dueDate || '') || dueDisplay,
                            filterValue: dueDisplay,
                            exportValue: dueDisplay,
                        }),
                        type: createCell(issueType, {
                            filterValue: issueType,
                            exportValue: issue.issueType || '',
                        }),
                        issue: createCell(issueKey, {
                            html: `<td>${issueCell}</td>`,
                            sortValue: issueKey,
                            filterValue: issueKey,
                            exportValue: issueKey,
                        }),
                        title: createCell(summary, {
                            html: `<td>${summary}</td>`,
                            filterValue: summaryText,
                            exportValue: summaryText,
                        }),
                        sprints: createCell(sprintText, {
                            html: `<td>${sprintText}</td>`,
                            filterValue: sprintTextRaw,
                            exportValue: sprintTextRaw,
                        }),
                        project: createCell(projectText, {
                            html: `<td>${projectText}</td>`,
                            filterValue: projectName || '—',
                            exportValue: projectName || '—',
                        }),
                        board: createCell(boardText, {
                            html: `<td>${boardText}</td>`,
                            filterValue: boardTextRaw,
                            exportValue: boardTextRaw,
                        }),
                        status: createCell(status, {
                            html: `<td>${status}</td>`,
                            filterValue: statusText,
                            exportValue: statusText,
                        }),
                        estimate: createCell(estimateHours, {
                            html: `<td>${estimateHours.toFixed(2)}</td>`,
                            sortValue: estimateHours,
                            filterValue: estimateHours,
                            exportValue: estimateHours.toFixed(2),
                        }),
                        logged: createCell(loggedHours, {
                            html: `<td>${loggedHours.toFixed(2)}</td>`,
                            sortValue: loggedHours,
                            filterValue: loggedHours,
                            exportValue: loggedHours.toFixed(2),
                        }),
                        remaining: createCell(remainingHours, {
                            html: `<td>${remainingHours.toFixed(2)}</td>`,
                            sortValue: remainingHours,
                            filterValue: remainingHours,
                            exportValue: remainingHours.toFixed(2),
                        }),
                    },
                };
            });

            tableController.setRows(rows);

            updateFooter({
                estimate: totals.estimate.toFixed(2),
                logged: totals.logged.toFixed(2),
                remaining: totals.remaining.toFixed(2),
            });
        });

        return {
            onShow: () => reportStateInstance.refresh()
        };
    }

    function initQuarterReport(root, reportStateInstance) {
        if (!root || root.dataset.controllerReady === 'true') return {};
        root.dataset.controllerReady = 'true';

        const table = root.querySelector('#quarterReportTable');
        if (!table) {
            console.warn('Quarter report view missing required elements.');
            return {};
        }

        const tableController = createInteractiveTable(table, {
            columns: [
                { key: 'season', label: 'Season', sortable: true, filterType: 'select' },
                { key: 'month1', label: 'Month 1' },
                { key: 'month2', label: 'Month 2' },
                { key: 'month3', label: 'Month 3' },
                { key: 'total', label: 'Quarter Total', sortable: true },
                { key: 'expected', label: 'Expected', sortable: true },
                { key: 'delta', label: 'Delta', sortable: true },
            ],
            exportFileName: 'quarter-report',
            emptyMessage: 'No quarter data available.',
        });

        const exportBtn = root.querySelector('[data-export-target="quarterReportTable"]');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => {
                tableController.exportToExcel('quarter-report');
            });
        }

        reportStateInstance.subscribe((state) => {
            if (state.isFetching && !state.result) {
                tableController.showMessage('Loading…');
                return;
            }

            const res = state.result;
            if (!res || !res.ok) {
                const message = res ? (res.reason || 'Unable to load quarter report.') : 'No data yet.';
                tableController.showMessage(message);
                return;
            }

            const data = res.quarterReport;
            if (!data?.ok || !Array.isArray(data.seasons) || data.seasons.length === 0) {
                tableController.showMessage('—');
                return;
            }

            const rows = data.seasons.map((season) => {
                const months = Array.isArray(season.months) ? season.months.slice(0, 3) : [];
                while (months.length < 3) {
                    months.push(null);
                }

                const monthCells = months.map((month) => {
                    if (!month) {
                        const html = '<td><div class="quarter-month"><span class="muted">—</span></div></td>';
                        return createCell('—', {
                            html,
                            filterValue: '—',
                            exportValue: '—',
                        });
                    }
                    const label = escapeHtml(month.label || `Month ${month.jMonth}`);
                    if (!month.ok) {
                        const reason = escapeHtml(month.reason || 'No data');
                        const html = `<td><div class="quarter-month"><strong>${label}</strong><span class="muted">${reason}</span></div></td>`;
                        return createCell(reason, {
                            html,
                            filterValue: `${label} ${reason}`,
                            exportValue: `${month.label || `Month ${month.jMonth}`}: ${month.reason || 'No data'}`,
                        });
                    }
                    const delta = Number.parseFloat(month.delta || 0) || 0;
                    const deltaCls = delta >= 0 ? 'delta-pos' : 'delta-neg';
                    const totalHours = formatHours(month.totalHours);
                    const expectedHours = formatHours(month.expectedHours);
                    const html = `
                        <td>
                            <div class="quarter-month">
                                <strong>${label}</strong>
                                <div>${totalHours} h</div>
                                <div class="muted">Exp ${expectedHours} h</div>
                                <div class="${deltaCls}">${delta.toFixed(2)} h</div>
                            </div>
                        </td>
                    `;
                    const exportText = `${month.label || `Month ${month.jMonth}`}: ${totalHours} h (Exp ${expectedHours} h, Δ ${delta.toFixed(2)} h)`;
                    return createCell(exportText, {
                        html,
                        filterValue: exportText,
                        exportValue: exportText,
                    });
                });

                const totals = season.totals || {};
                const totalHours = Number.parseFloat(totals.totalHours || 0) || 0;
                const expectedHours = Number.parseFloat(totals.expectedHours || 0) || 0;
                const totalDelta = Number.parseFloat(totals.delta || 0) || 0;
                const totalDeltaCls = totalDelta >= 0 ? 'delta-pos' : 'delta-neg';

                return {
                    cells: {
                        season: createCell(season.label || 'Season', {
                            html: `<td><strong>${escapeHtml(season.label || 'Season')}</strong></td>`,
                            filterValue: season.label || 'Season',
                            exportValue: season.label || 'Season',
                        }),
                        month1: monthCells[0],
                        month2: monthCells[1],
                        month3: monthCells[2],
                        total: createCell(totalHours, {
                            html: `<td>${formatHours(totalHours)} h</td>`,
                            sortValue: totalHours,
                            filterValue: totalHours,
                            exportValue: formatHours(totalHours),
                        }),
                        expected: createCell(expectedHours, {
                            html: `<td>${formatHours(expectedHours)} h</td>`,
                            sortValue: expectedHours,
                            filterValue: expectedHours,
                            exportValue: formatHours(expectedHours),
                        }),
                        delta: createCell(totalDelta, {
                            html: `<td class="${totalDeltaCls}">${totalDelta.toFixed(2)} h</td>`,
                            sortValue: totalDelta,
                            filterValue: totalDelta,
                            exportValue: totalDelta.toFixed(2),
                        }),
                    },
                };
            });

            tableController.setRows(rows);
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

    function createCell(value, options = {}) {
        const {
            html = null,
            sortValue = null,
            filterValue = null,
            exportValue = null,
        } = options;
        const resolved = value ?? '';
        let cellHtml;
        if (html != null) {
            const trimmed = String(html).trim();
            cellHtml = trimmed.startsWith('<td') ? trimmed : `<td>${trimmed}</td>`;
        } else {
            cellHtml = `<td>${escapeHtml(resolved)}</td>`;
        }
        const sortVal = sortValue != null ? sortValue : resolved;
        const filterVal = filterValue != null ? filterValue : resolved;
        const exportVal = exportValue != null ? exportValue : resolved;
        return {
            html: cellHtml,
            sortValue: sortVal,
            filterValue: filterVal,
            exportValue: exportVal,
        };
    }

    function createInteractiveTable(table, config = {}) {
        const tbody = table?.querySelector('tbody');
        if (!table || !tbody) {
            throw new Error('createInteractiveTable requires a table with a tbody.');
        }
        const columns = Array.isArray(config.columns) ? config.columns.slice() : [];
        const columnCount = columns.length || table.querySelectorAll('thead th').length || 1;
        const headerCells = Array.from(table.querySelectorAll('thead th')).slice(0, columnCount);
        const columnLookup = new Map();
        const columnFilters = new Map();
        const state = {
            originalRows: [],
            sortKey: null,
            sortDirection: null,
            filters: {},
            message: null,
        };
        const emptyMessage = config.emptyMessage || 'No data available.';
        const noResultsMessage = config.noResultsMessage || 'No matching records.';
        const exportFileName = config.exportFileName || 'table-export';

        columns.forEach((col, index) => {
            columnLookup.set(col.key, { ...col, index });
        });

        enhanceHeader();

        function enhanceHeader() {
            headerCells.forEach((th, index) => {
                const column = columns[index];
                if (!th || !column) return;
                const label = column.label || th.textContent.trim();
                th.textContent = '';
                th.dataset.columnKey = column.key;
                th.dataset.sort = '';
                const wrapper = document.createElement('div');
                wrapper.className = 'table-head-cell';
                if (column.sortable) {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.className = 'table-sort-button';
                    button.innerHTML = `<span class="table-sort-label">${label}</span><span class="table-sort-indicator" aria-hidden="true"></span>`;
                    button.addEventListener('click', () => toggleSort(column.key));
                    wrapper.appendChild(button);
                } else {
                    const span = document.createElement('span');
                    span.className = 'table-head-label';
                    span.textContent = label;
                    wrapper.appendChild(span);
                }
                if (column.filterType === 'select') {
                    const select = document.createElement('select');
                    select.className = 'table-filter-select';
                    select.innerHTML = '<option value="">All</option>';
                    select.addEventListener('change', () => {
                        state.filters[column.key] = select.value;
                        render();
                    });
                    columnFilters.set(column.key, { type: 'select', control: select });
                    wrapper.appendChild(select);
                } else if (column.filterType === 'search') {
                    const input = document.createElement('input');
                    input.type = 'search';
                    input.placeholder = 'Filter…';
                    input.className = 'table-filter-input';
                    input.addEventListener('input', () => {
                        state.filters[column.key] = input.value.trim().toLowerCase();
                        render();
                    });
                    columnFilters.set(column.key, { type: 'search', control: input });
                    wrapper.appendChild(input);
                }
                th.appendChild(wrapper);
            });
        }

        function toggleSort(key) {
            if (state.sortKey === key) {
                if (state.sortDirection === 'asc') {
                    state.sortDirection = 'desc';
                } else if (state.sortDirection === 'desc') {
                    state.sortKey = null;
                    state.sortDirection = null;
                } else {
                    state.sortDirection = 'asc';
                }
            } else {
                state.sortKey = key;
                state.sortDirection = 'asc';
            }
            render();
        }

        function renderMessage(message) {
            tbody.innerHTML = '';
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = columnCount;
            td.textContent = message;
            tr.appendChild(td);
            tbody.appendChild(tr);
            updateSortIndicators();
        }

        function render() {
            if (state.message) {
                renderMessage(state.message);
                return;
            }
            const filtered = applyFilters(state.originalRows);
            const sorted = applySort(filtered);
            if (!sorted.length) {
                if (state.originalRows.length) {
                    renderMessage(noResultsMessage);
                } else {
                    renderMessage(emptyMessage);
                }
                return;
            }
            const fragment = document.createDocumentFragment();
            sorted.forEach((row) => {
                const tr = document.createElement('tr');
                if (row && typeof row.className === 'string' && row.className) {
                    tr.className = row.className;
                }
                if (row && row.dataset && typeof row.dataset === 'object') {
                    Object.entries(row.dataset).forEach(([attr, val]) => {
                        if (attr && val != null) {
                            tr.dataset[attr] = val;
                        }
                    });
                }
                tr.innerHTML = columns.map((col) => {
                    const cell = row?.cells?.[col.key];
                    if (cell && cell.html) {
                        return cell.html;
                    }
                    return '<td></td>';
                }).join('');
                fragment.appendChild(tr);
            });
            tbody.innerHTML = '';
            tbody.appendChild(fragment);
            updateSortIndicators();
        }

        function updateSortIndicators() {
            headerCells.forEach((th) => {
                if (th) th.dataset.sort = '';
            });
            if (!state.sortKey || !state.sortDirection) return;
            const column = columnLookup.get(state.sortKey);
            if (!column) return;
            const th = headerCells[column.index];
            if (th) {
                th.dataset.sort = state.sortDirection;
            }
        }

        function applyFilters(rows) {
            return columns.reduce((acc, column) => {
                const filterVal = state.filters[column.key];
                if (!filterVal) {
                    return acc;
                }
                if (column.filterType === 'select') {
                    return acc.filter((row) => {
                        const cell = row?.cells?.[column.key];
                        const value = cell?.filterValue;
                        return String(value ?? '').trim() === filterVal;
                    });
                }
                if (column.filterType === 'search') {
                    const term = filterVal.toLowerCase();
                    if (!term) {
                        return acc;
                    }
                    return acc.filter((row) => {
                        const cell = row?.cells?.[column.key];
                        const value = cell?.filterValue ?? cell?.exportValue ?? '';
                        return String(value ?? '').toLowerCase().includes(term);
                    });
                }
                return acc;
            }, rows.slice());
        }

        function normaliseSortValue(val) {
            if (val == null) return null;
            if (val instanceof Date) return val.getTime();
            if (typeof val === 'number') return Number.isNaN(val) ? null : val;
            const num = Number(val);
            if (!Number.isNaN(num) && String(val).trim() !== '') {
                return num;
            }
            return String(val).toLowerCase();
        }

        function applySort(rows) {
            if (!state.sortKey || !state.sortDirection) {
                return rows.slice();
            }
            const column = columnLookup.get(state.sortKey);
            if (!column) {
                return rows.slice();
            }
            const direction = state.sortDirection === 'desc' ? -1 : 1;
            const comparator = typeof column.comparator === 'function' ? column.comparator : null;
            return rows.slice().sort((a, b) => {
                const cellA = a?.cells?.[column.key];
                const cellB = b?.cells?.[column.key];
                const aVal = cellA?.sortValue ?? cellA?.filterValue ?? cellA?.exportValue ?? null;
                const bVal = cellB?.sortValue ?? cellB?.filterValue ?? cellB?.exportValue ?? null;
                if (comparator) {
                    return comparator(aVal, bVal, a, b) * direction;
                }
                const normA = normaliseSortValue(aVal);
                const normB = normaliseSortValue(bVal);
                if (normA == null && normB == null) return 0;
                if (normA == null) return 1;
                if (normB == null) return -1;
                if (typeof normA === 'number' && typeof normB === 'number') {
                    return (normA - normB) * direction;
                }
                if (normA === normB) return 0;
                return normA > normB ? direction : -direction;
            });
        }

        function updateFilterOptions() {
            columns.forEach((column) => {
                const filter = columnFilters.get(column.key);
                if (!filter || filter.type !== 'select') return;
                const select = filter.control;
                const current = state.filters[column.key] ?? '';
                const values = new Set();
                state.originalRows.forEach((row) => {
                    const cell = row?.cells?.[column.key];
                    const value = String(cell?.filterValue ?? '').trim();
                    if (value) {
                        values.add(value);
                    }
                });
                const sorted = Array.from(values).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }));
                select.innerHTML = '';
                const optionAll = document.createElement('option');
                optionAll.value = '';
                optionAll.textContent = 'All';
                select.appendChild(optionAll);
                sorted.forEach((value) => {
                    const opt = document.createElement('option');
                    opt.value = value;
                    opt.textContent = value;
                    select.appendChild(opt);
                });
                if (current && sorted.includes(current)) {
                    select.value = current;
                    state.filters[column.key] = current;
                } else {
                    select.value = '';
                    state.filters[column.key] = '';
                }
            });
        }

        function setRows(rows) {
            state.originalRows = Array.isArray(rows) ? rows.slice() : [];
            state.message = null;
            updateFilterOptions();
            render();
        }

        function showMessage(message) {
            state.message = message;
            renderMessage(message);
        }

        function exportToExcel(filename) {
            const rows = applySort(applyFilters(state.originalRows));
            const safeName = (filename || exportFileName || 'table-export').toString().trim().replace(/[^a-z0-9-_]+/gi, '_') || 'table-export';
            const headerHtml = `<tr>${columns.map((col) => `<th>${escapeHtml(col.exportLabel || col.label || '')}</th>`).join('')}</tr>`;
            const bodyHtml = rows.map((row) => {
                return `<tr>${columns.map((col) => {
                    const cell = row?.cells?.[col.key];
                    const value = cell?.exportValue;
                    const text = value == null ? '' : (typeof value === 'number' ? value.toString() : String(value));
                    return `<td>${escapeHtml(text)}</td>`;
                }).join('')}</tr>`;
            }).join('');
            const html = `<!DOCTYPE html><html><head><meta charset="utf-8" /></head><body><table>${headerHtml}${bodyHtml}</table></body></html>`;
            const blob = new Blob([html], { type: 'application/vnd.ms-excel' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = `${safeName}.xls`;
            document.body.appendChild(link);
            link.click();
            setTimeout(() => {
                URL.revokeObjectURL(link.href);
                link.remove();
            }, 0);
        }

        return {
            setRows,
            showMessage,
            exportToExcel,
        };
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
