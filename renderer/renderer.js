(async function () {
    const $ = (selector, root = document) => root.querySelector(selector);
    const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

    const TEAM_DATA = [
        {
            value: 'frontend',
            label: 'Frontend Team',
            users: [
                { text: 'رضا محمدخان', value: 'r.mohammadkhan' },
                { text: 'محمدمهدی زارعی', value: 'Momahdi.Zarei' },
                { text: 'فرید ذوالقدر', value: 'zolghadr.farid' },
                { text: 'نیلوفر صمدزادگان', value: 'n.samadzadegan' },
                { text: 'یحیی کنگی', value: 'y.kangi' },
                { text: 'امیرحسین فاطمی', value: 'a.fatemi' },
                { text: 'ابراهیم علیپور', value: 'e.alipour' },
                { text: 'ریحانه اخگری', value: 'r.akhgari' }
            ]
        },
        {
            value: 'backend',
            label: 'Backend Team',
            users: [
                { text: 'John Doe', value: 'john.doe' }
            ]
        }
    ];
    const TEAM_OPTIONS = TEAM_DATA.map(({ value, label }) => ({ value, text: label }));
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
    const DEFAULT_TEAM = TEAM_OPTIONS[0]?.value || null;
    const ADMIN_USERS = new Set(['Momahdi.Zarei', 'r.mohammadkhan']);
    const PERSIAN_MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
    const routeHooks = new Map();

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
    const loadingOverlay = $('#loadingOverlay');
    if (loadingOverlay) {
        reportState.subscribe((state) => {
            const visible = Boolean(state.isFetching);
            loadingOverlay.classList.toggle('is-visible', visible);
            loadingOverlay.setAttribute('aria-hidden', String(!visible));
        });
    }
    const settingsPromise = loadSettings();
    const userSelectContext = initUserSelect($('#sidebarUserSelect'), reportState);

    await initSelectionControls(reportState, settingsPromise);

    await Promise.all([
        registerController('monthly-summary', (node) => initMonthlySummary(node, reportState)),
        registerController('detailed-worklogs', (node) => initDetailedWorklogs(node, reportState)),
        registerController('due-issues', (node) => initDueIssues(node, reportState)),
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
                        let nextValue = value;
                        if ((key === 'team' || key === 'username') && (nextValue === '' || nextValue == null)) {
                            nextValue = null;
                        }
                        if (state.selection[key] !== nextValue) {
                            state.selection[key] = nextValue;
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

        const teamOptions = ['<option value="">Select a team…</option>'];
        TEAM_OPTIONS.forEach((team) => {
            teamOptions.push(`<option value="${team.value}">${team.text}</option>`);
        });
        teamSelectEl.innerHTML = teamOptions.join('');

        const initialSelection = reportStateInstance.getSelection();
        const knownInitialTeam = initialSelection.team && TEAM_USERS.has(initialSelection.team)
            ? initialSelection.team
            : '';
        const inferredTeam = !knownInitialTeam && initialSelection.username
            ? findTeamForUser(initialSelection.username)
            : '';
        const initialTeam = knownInitialTeam || inferredTeam || '';
        teamSelectEl.value = initialTeam;
        if (initialTeam && initialTeam !== initialSelection.team) {
            reportStateInstance.setSelection({ team: initialTeam }, { silent: true });
        }

        const activeTeam = teamSelectEl.value || '';
        const availableUsers = getTeamUsers(activeTeam);
        const initialUser = (initialSelection.username && availableUsers.some((u) => u.value === initialSelection.username))
            ? initialSelection.username
            : '';
        renderUserOptions(activeTeam, initialUser);
        if (initialUser && initialUser !== initialSelection.username) {
            reportStateInstance.setSelection({ username: initialUser }, { silent: true });
        }

        teamSelectEl.addEventListener('change', async () => {
            const team = teamSelectEl.value;
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
            if (!team) {
                if (teamSelectEl.value !== '') {
                    teamSelectEl.value = '';
                }
                renderUserOptions('', '');
                if (selectEl.value !== '') {
                    selectEl.value = '';
                }
                return;
            }

            if (!TEAM_USERS.has(team)) {
                const existingOption = Array.from(teamSelectEl.options).some((opt) => opt.value === team);
                if (!existingOption) {
                    const opt = document.createElement('option');
                    opt.value = team;
                    opt.textContent = team;
                    teamSelectEl.appendChild(opt);
                }
            }

            if (teamSelectEl.value !== team) {
                teamSelectEl.value = team;
                renderUserOptions(team, username || '');
                return;
            }

            const users = getTeamUsers(team);
            if (username && !users.some((u) => u.value === username)) {
                ensureUserInTeamMap(team, { value: username, text: username });
                renderUserOptions(team, username);
                return;
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

                const isAdmin = ADMIN_USERS.has(self);
                const teamForSelf = findTeamForUser(self) || '';
                if (teamForSelf) {
                    ensureUserInTeamMap(teamForSelf, { value: self, text: displayName });
                }

                const currentSelection = reportStateInstance.getSelection();

                if (!isAdmin) {
                    const fallbackTeam = teamForSelf || currentSelection.team || TEAM_OPTIONS[0]?.value || '';
                    if (fallbackTeam) {
                        const hasOption = Array.from(teamSelectEl.options).some((opt) => opt.value === fallbackTeam);
                        if (!hasOption) {
                            const opt = document.createElement('option');
                            opt.value = fallbackTeam;
                            const label = TEAM_OPTIONS.find((team) => team.value === fallbackTeam)?.text || fallbackTeam;
                            opt.textContent = label;
                            teamSelectEl.appendChild(opt);
                        }
                        teamSelectEl.value = fallbackTeam;
                        renderUserOptions(fallbackTeam, self);
                    } else {
                        renderUserOptions('', '');
                    }
                    teamSelectEl.disabled = true;
                    selectEl.disabled = true;
                    await reportStateInstance.setSelection({ team: fallbackTeam || null, username: self }, { pushSelection: true, refresh: true, clearResult: true });
                } else {
                    teamSelectEl.disabled = false;
                    selectEl.disabled = false;
                    const activeTeam = currentSelection.team && TEAM_USERS.has(currentSelection.team)
                        ? currentSelection.team
                        : (teamSelectEl.value && TEAM_USERS.has(teamSelectEl.value) ? teamSelectEl.value : '');
                    if (activeTeam) {
                        if (teamSelectEl.value !== activeTeam) {
                            teamSelectEl.value = activeTeam;
                        }
                        renderUserOptions(activeTeam, currentSelection.username || selectEl.value || '');
                    } else {
                        teamSelectEl.value = '';
                        renderUserOptions('', '');
                        if (selectEl.value !== '') {
                            selectEl.value = '';
                        }
                    }
                }
            } catch (err) {
                console.error('Failed to determine user visibility', err);
            }
        }

        const ready = enforceUserVisibility();

        return { enforceUserVisibility, ready, selectEl, teamSelectEl };

        function renderUserOptions(team, selectedUser) {
            const users = getTeamUsers(team);
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
                tr.innerHTML = `
                    <td>${idx + 1}</td>
                    <td><span class="tip" data-tip="${d.g}">${d.j}</span></td>
                    <td>${weekdayName(d.weekday)}</td>
                    <td><small>${flags}</small></td>
                    <td>${Number(d.hours || 0).toFixed(2)}</td>
                `;
                tbody.appendChild(tr);
            });

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
                tr.innerHTML = `
                    <td>${idx + 1}</td>
                    <td>${w.persianDate || ''}</td>
                    <td>${w.date || ''}</td>
                    <td>${w.issueKey || ''}</td>
                    <td>${(w.summary || '').toString().replace(/\n/g, ' ')}</td>
                    <td>${Number(w.hours || 0).toFixed(2)}</td>
                    <td>${w.timeSpent || ''}</td>
                    <td>${(w.comment || '').toString().replace(/\n/g, ' ')}</td>
                `;
                if (!w.dueDate) {
                    tr.classList.add('no-due-date');
                }
                tbody.appendChild(tr);
            });
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
        if (!table || !tbody) {
            console.warn('Due issues view missing required elements.');
            return {};
        }

        reportStateInstance.subscribe((state) => {
            if (state.isFetching && !state.result) {
                setTableMessage(tbody, 8, 'Loading…');
                return;
            }

            const res = state.result;
            if (!res || !res.ok) {
                const message = res ? (res.reason || 'Unable to load due issues.') : 'No data yet.';
                setTableMessage(tbody, 8, message);
                return;
            }

            const issues = Array.isArray(res.dueIssuesCurrentMonth) ? res.dueIssuesCurrentMonth : [];
            if (!issues.length) {
                setTableMessage(tbody, 8, '—');
                return;
            }

            tbody.innerHTML = '';
            issues.forEach((issue, idx) => {
                const summary = (issue.summary || '').toString().replace(/\n/g, ' ');
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${idx + 1}</td>
                    <td>${issue.dueDate || ''}</td>
                    <td>${issue.issueKey || ''}</td>
                    <td>${summary}</td>
                    <td>${issue.status || ''}</td>
                    <td>${Number(issue.estimateHours || 0).toFixed(2)}</td>
                    <td>${Number(issue.loggedHours || 0).toFixed(2)}</td>
                    <td>${Number(issue.remainingHours || 0).toFixed(2)}</td>
                `;
                tbody.appendChild(tr);
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
        const tbody = table?.querySelector('tbody');
        if (!table || !tbody) {
            console.warn('Quarter report view missing required elements.');
            return {};
        }

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
                const monthsHtml = months.map((month) => {
                    if (!month) {
                        return '<div class="quarter-month"><span class="muted">—</span></div>';
                    }
                    const label = month.label || `Month ${month.jMonth}`;
                    if (!month.ok) {
                        const reason = month.reason || 'No data';
                        return `<div class="quarter-month"><strong>${label}</strong><span class="muted">${reason}</span></div>`;
                    }
                    const delta = Number.parseFloat(month.delta || 0) || 0;
                    const deltaCls = delta >= 0 ? 'delta-pos' : 'delta-neg';
                    return `
                        <div class="quarter-month">
                            <strong>${label}</strong>
                            <div>${formatHours(month.totalHours)} h</div>
                            <div class="muted">Exp ${formatHours(month.expectedHours)} h</div>
                            <div class="${deltaCls}">${delta.toFixed(2)} h</div>
                        </div>
                    `;
                });
                const totals = season.totals || {};
                const totalDelta = Number.parseFloat(totals.delta || 0) || 0;
                const totalDeltaCls = totalDelta >= 0 ? 'delta-pos' : 'delta-neg';
                tr.innerHTML = `
                    <td><strong>${season.label || 'Season'}</strong></td>
                    ${monthsHtml.map((html) => `<td>${html}</td>`).join('')}
                    <td>${formatHours(totals.totalHours)} h</td>
                    <td>${formatHours(totals.expectedHours)} h</td>
                    <td class="${totalDeltaCls}">${totalDelta.toFixed(2)} h</td>
                `;
                tbody.appendChild(tr);
            });
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
