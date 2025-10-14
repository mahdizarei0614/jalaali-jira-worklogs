(async function () {
    const $ = (selector, root = document) => root.querySelector(selector);
    const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

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
    const routeChangeListeners = new Set();

    function emitRouteChange(route) {
        routeChangeListeners.forEach((cb) => {
            try {
                cb(route);
            } catch (err) {
                console.error(err);
            }
        });
    }

    function onRouteChange(cb) {
        if (typeof cb === 'function') {
            routeChangeListeners.add(cb);
        }
    }

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

        activeRoute = route;

        if (pushState) {
            window.location.hash = route;
        }

        emitRouteChange(route);

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

    const monthlyModule = createMonthlyModule({ onRouteChange });
    const controllers = {
        'monthly-summary': (root) => monthlyModule.initSummary(root),
        'detailed-worklogs': (root) => monthlyModule.initDetailedWorklogs(root),
        'due-issues': (root) => monthlyModule.initDueIssues(root),
        'quarter-report': (root) => monthlyModule.initQuarterReport(root)
    };

    const initTasks = [];
    for (const [route, init] of Object.entries(controllers)) {
        const node = viewNodes.get(route);
        if (node && typeof init === 'function') {
            initTasks.push(Promise.resolve(init(node)));
        }
    }
    await Promise.all(initTasks);

    const logoutBtn = $('#logout');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            await window.appApi.logout();
        });
    }

    function createMonthlyModule({ onRouteChange }) {
        const monthlyRoutes = new Set(['monthly-summary', 'detailed-worklogs', 'due-issues', 'quarter-report']);
        const usernameSelect = document.querySelector('#sidebarUserSelect');
        const persianMonths = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
        const userMap = [
            { text: 'رضا محمدخان', value: 'r.mohammadkhan' },
            { text: 'محمدمهدی زارعی', value: 'Momahdi.Zarei' },
            { text: 'فرید ذوالقدر', value: 'zolghadr.farid' },
            { text: 'نیلوفر صمدزادگان', value: 'n.samadzadegan' },
            { text: 'یحیی کنگی', value: 'y.kangi' },
            { text: 'امیرحسین فاطمی', value: 'a.fatemi' },
            { text: 'ابراهیم علیپور', value: 'e.alipour' },
            { text: 'ریحانه اخگری', value: 'r.akhgari' }
        ];
        const ADMIN_USERS = new Set(['Momahdi.Zarei', 'r.mohammadkhan']);

        let summary = null;
        let worklogs = null;
        let dueIssues = null;
        let quarter = null;
        let currentSelection = null;
        let lastFetchedSelection = null;
        let lastResult = null;
        let fetching = false;
        let refetchQueued = false;
        let lastRequestedRoute = 'monthly-summary';

        ensureUserOptions();

        if (usernameSelect) {
            usernameSelect.addEventListener('change', async () => {
                await pushSelection();
                queueFetch('selection-change');
            });
        }

        if (typeof onRouteChange === 'function') {
            onRouteChange((route) => {
                if (!monthlyRoutes.has(route)) return;
                if (!summary) return; // wait until summary init finishes
                queueFetch('route-change', { route });
            });
        }

        window.appApi.onScanResult((res) => {
            if (!res?.ok) return;
            if (!summary) return;
            const cur = readSelectionFromInputs();
            if (!cur) return;
            if (res.jYear === cur.jYear && res.jMonth === cur.jMonth) {
                lastResult = res;
                lastFetchedSelection = { ...cur };
                renderAll();
            }
        });

        function ensureUserOptions() {
            if (!usernameSelect) return;
            if (usernameSelect.dataset.initialized === 'true') return;
            usernameSelect.innerHTML = userMap.map((u) => `<option value="${u.value}">${u.text}</option>`).join('');
            usernameSelect.dataset.initialized = 'true';
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

        function sanitizeUrl(u) { return (u || '').trim(); }
        function stripTrailingSlash(u) { return u.replace(/\/+$/, ''); }
        function isLikelyUrl(u) { return /^https?:\/\/[^/\s]+\.[^/\s]+/i.test(u); }

        function formatHours(val) {
            const num = Number.parseFloat(val);
            if (!Number.isFinite(num)) return '0.00';
            return num.toFixed(2);
        }

        const weekdayName = (w) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][w] || String(w);

        function readSelectionFromInputs() {
            if (!summary) return null;
            const year = Number.parseInt(toAsciiDigits(summary.jYear.value), 10);
            const month = Number.parseInt(toAsciiDigits(summary.jMonth.value), 10);
            const username = usernameSelect?.value?.trim();
            if (!Number.isFinite(year) || !Number.isFinite(month) || !username) {
                return null;
            }
            return { jYear: year, jMonth: month, username };
        }

        async function enforceUserVisibility() {
            if (!usernameSelect) return;
            try {
                const who = await window.appApi.whoami();
                if (!who?.ok) {
                    return;
                }
                const self = (who.username || '').trim();
                if (!self) return;

                if (![...usernameSelect.options].some((o) => o.value === self)) {
                    const opt = document.createElement('option');
                    opt.value = self;
                    opt.textContent = (who.raw?.displayName || self);
                    usernameSelect.appendChild(opt);
                }

                if (ADMIN_USERS.has(self)) {
                    usernameSelect.disabled = false;
                } else {
                    usernameSelect.value = self;
                    usernameSelect.disabled = true;
                }
            } catch (err) {
                console.error(err);
            }
        }

        async function pushSelection() {
            const selection = readSelectionFromInputs();
            if (!selection) {
                return null;
            }
            currentSelection = selection;
            await window.appApi.updateSelection(selection);
            return selection;
        }

        function needsRefetch() {
            if (!currentSelection) return false;
            if (!lastFetchedSelection) return true;
            return (
                currentSelection.jYear !== lastFetchedSelection.jYear ||
                currentSelection.jMonth !== lastFetchedSelection.jMonth ||
                currentSelection.username !== lastFetchedSelection.username
            );
        }

        function queueFetch(reason, { route } = {}) {
            if (!summary) return;
            if (!currentSelection) {
                currentSelection = readSelectionFromInputs();
            }
            if (!currentSelection) return;

            const forceFetch = reason === 'route-change';
            if (route) {
                lastRequestedRoute = route;
            }

            if (!needsRefetch() && !forceFetch) {
                if (lastResult) {
                    if (route) renderRoute(route);
                    else renderRoute(lastRequestedRoute);
                }
                return;
            }

            if (fetching) {
                refetchQueued = true;
                return;
            }

            fetching = true;
            window.appApi.scanNow({ ...currentSelection }).then((res) => {
                lastResult = res;
                lastFetchedSelection = { ...currentSelection };
                renderAll();
            }).catch((err) => {
                console.error(err);
            }).finally(() => {
                fetching = false;
                if (refetchQueued) {
                    refetchQueued = false;
                    queueFetch('refetch', { route: lastRequestedRoute });
                }
            });
        }

        function renderAll() {
            if (summary) renderSummary(lastResult);
            if (worklogs) renderWorklogs(lastResult);
            if (dueIssues) renderDueIssues(lastResult);
            if (quarter) renderQuarterReport(lastResult?.quarterReport);
        }

        function renderRoute(route) {
            switch (route) {
                case 'monthly-summary':
                    if (summary) renderSummary(lastResult);
                    break;
                case 'detailed-worklogs':
                    if (worklogs) renderWorklogs(lastResult);
                    break;
                case 'due-issues':
                    if (dueIssues) renderDueIssues(lastResult);
                    break;
                case 'quarter-report':
                    if (quarter) renderQuarterReport(lastResult?.quarterReport);
                    break;
                default:
                    break;
            }
        }

        function renderSummary(res) {
            if (!summary) return;
            const { table, tbody, footerTotals, timeOffHours } = summary;
            if (!table || !tbody || !footerTotals) return;

            if (!res?.ok || !Array.isArray(res.days)) {
                table.style.display = 'none';
                tbody.innerHTML = '';
                footerTotals.innerHTML = '<div class="footer-grid"><span class="pill">Totals here…</span></div>';
                return;
            }

            tbody.innerHTML = '';
            res.days.forEach((d, idx) => {
                const tr = document.createElement('tr');
                tr.className = d.color || '';
                const flags = [
                    d.isFuture ? 'future' : '',
                    d.isThuFri ? 'Thu/Fri' : '',
                    d.isHoliday ? 'holiday' : '',
                    !d.isWorkday ? 'non-workday' : ''
                ].filter(Boolean).join(', ');
                tr.innerHTML = `
        <td>${idx + 1}</td>
        <td><span class="tip" data-tip="${d.g}">${d.j}</span></td>
        <td>${weekdayName(d.weekday)}</td>
        <td><small>${flags}</small></td>
        <td>${Number.parseFloat(d.hours).toFixed(2)}</td>
      `;
                tbody.appendChild(tr);
            });
            table.style.display = 'table';

            const total = +(res.totalHours ?? 0);
            const expectedNow = +(res.expectedByNowHours ?? 0);
            const expectedEnd = +(res.expectedByEndMonthHours ?? 0);
            const timeOff = Math.max(0, parseFloat(timeOffHours?.value || '0')) || 0;
            const adjusted = +(total + timeOff);
            const deltaEnd = +(adjusted - expectedEnd);
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

        function renderWorklogs(res) {
            if (!worklogs) return;
            const { tbody } = worklogs;
            if (!tbody) return;
            tbody.innerHTML = '';
            if (!res?.ok || !Array.isArray(res.worklogs) || res.worklogs.length === 0) {
                const tr = document.createElement('tr');
                tr.innerHTML = '<td colspan="8">—</td>';
                tbody.appendChild(tr);
                return;
            }

            Array.from(new Set(res.worklogs)).forEach((w, idx) => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
          <td>${idx + 1}</td>
          <td>${w.persianDate || ''}</td>
          <td>${w.date || ''}</td>
          <td>${w.issueKey || ''}</td>
          <td>${(w.summary || '').toString().replace(/\n/g, ' ')}</td>
          <td>${Number(w.hours).toFixed(2)}</td>
          <td>${w.timeSpent || ''}</td>
          <td>${(w.comment || '').toString().replace(/\n/g, ' ')}</td>
        `;
                if (!w.dueDate) {
                    tr.classList.add('no-due-date');
                }
                tbody.appendChild(tr);
            });
        }

        function renderDueIssues(res) {
            if (!dueIssues) return;
            const { tbody } = dueIssues;
            if (!tbody) return;

            const issues = Array.isArray(res?.dueIssuesCurrentMonth) ? res.dueIssuesCurrentMonth : [];
            if (!issues.length) {
                tbody.innerHTML = '<tr><td colspan="8">—</td></tr>';
                return;
            }

            tbody.innerHTML = '';
            issues.forEach((issue, idx) => {
                const tr = document.createElement('tr');
                const summary = (issue.summary || '').toString().replace(/\n/g, ' ');
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
        }

        function renderQuarterReport(data) {
            if (!quarter) return;
            const { tbody } = quarter;
            if (!tbody) return;

            if (!data?.ok || !Array.isArray(data.seasons) || data.seasons.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7">—</td></tr>';
                return;
            }

            tbody.innerHTML = '';
            data.seasons.forEach((season) => {
                const tr = document.createElement('tr');
                const monthsHtml = (season.months || []).map((month) => {
                    const label = month.label || `Month ${month.jMonth}`;
                    if (!month.ok) {
                        return `<div class="quarter-month"><strong>${label}</strong><span class="muted">${month.reason || 'No data'}</span></div>`;
                    }
                    const delta = Number.parseFloat(month.delta || 0);
                    const deltaCls = delta >= 0 ? 'delta-pos' : 'delta-neg';
                    const deltaVal = `${delta.toFixed(2)} h`;
                    return `
                        <div class="quarter-month">
                            <strong>${label}</strong>
                            <div>${formatHours(month.totalHours)} h</div>
                            <div class="muted">Exp ${formatHours(month.expectedHours)} h</div>
                            <div class="${deltaCls}">${deltaVal}</div>
                        </div>
                    `;
                });

                while (monthsHtml.length < 3) {
                    monthsHtml.push('<div class="quarter-month"><span class="muted">—</span></div>');
                }

                const totals = season.totals || {};
                const totalDelta = Number.parseFloat(totals.delta || 0);
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
        }

        return {
            initSummary: async (root) => {
                if (!root || root.dataset.controllerReady === 'true') return;
                root.dataset.controllerReady = 'true';

                const baseUrl = root.querySelector('#baseUrl');
                const baseUrlWrap = root.querySelector('#baseUrlWrap');
                const jYear = root.querySelector('#jYear');
                const jMonth = root.querySelector('#jMonth');
                const timeOffHours = root.querySelector('#timeOffHours');
                const table = root.querySelector('#results');
                const tbody = table?.querySelector('tbody');
                const footerTotals = root.querySelector('#footerTotals');
                const saveBtn = root.querySelector('#save');

                if (!baseUrl || !baseUrlWrap || !jYear || !jMonth || !timeOffHours || !table || !tbody || !footerTotals || !saveBtn) {
                    console.warn('Monthly summary view missing required elements.');
                    return;
                }

                summary = { root, baseUrl, baseUrlWrap, jYear, jMonth, timeOffHours, table, tbody, footerTotals, saveBtn };

                jMonth.innerHTML = persianMonths.map((name, idx) => `<option value="${idx + 1}">${name}</option>`).join('');

                const updateBaseUrlUI = () => {
                    const v = sanitizeUrl(baseUrl.value);
                    baseUrlWrap.classList.remove('is-valid', 'is-invalid');
                    if (!v) return;
                    if (isLikelyUrl(v)) baseUrlWrap.classList.add('is-valid');
                    else baseUrlWrap.classList.add('is-invalid');
                };
                baseUrl.addEventListener('input', updateBaseUrlUI);
                baseUrl.addEventListener('blur', () => {
                    baseUrl.value = stripTrailingSlash(sanitizeUrl(baseUrl.value));
                    updateBaseUrlUI();
                });

                const settings = await window.appApi.getSettings();
                baseUrl.value = settings.baseUrl || '';
                updateBaseUrlUI();
                jYear.value = settings.defaultJYear || '';
                jMonth.value = settings.defaultJMonth || 1;

                await enforceUserVisibility();
                if (!usernameSelect.disabled && !usernameSelect.value) {
                    usernameSelect.value = userMap[0]?.value || '';
                }

                await pushSelection();

                jYear.addEventListener('input', async () => {
                    const caret = jYear.selectionStart;
                    jYear.value = toAsciiDigits(jYear.value).replace(/[^\d]/g, '');
                    try { jYear.setSelectionRange(caret, caret); } catch (err) { /* ignore */ }
                    await pushSelection();
                    queueFetch('selection-change');
                });

                jMonth.addEventListener('change', async () => {
                    await pushSelection();
                    queueFetch('selection-change');
                });

                timeOffHours.addEventListener('input', () => {
                    renderSummary(lastResult);
                });

                saveBtn.addEventListener('click', async () => {
                    baseUrl.value = stripTrailingSlash(sanitizeUrl(baseUrl.value));
                    updateBaseUrlUI();
                    await window.appApi.saveSettings({ baseUrl: baseUrl.value });
                    await enforceUserVisibility();
                    await pushSelection();
                    queueFetch('settings-saved');
                });

                queueFetch('initial');
            },
            initDetailedWorklogs: (root) => {
                if (!root || root.dataset.controllerReady === 'true') return;
                root.dataset.controllerReady = 'true';
                const table = root.querySelector('#detailedWorklogsTable');
                const tbody = table?.querySelector('tbody');
                if (!table || !tbody) {
                    console.warn('Detailed worklogs view missing table.');
                    return;
                }
                worklogs = { root, table, tbody };
                renderWorklogs(lastResult);
            },
            initDueIssues: (root) => {
                if (!root || root.dataset.controllerReady === 'true') return;
                root.dataset.controllerReady = 'true';
                const table = root.querySelector('#dueThisMonthTable');
                const tbody = table?.querySelector('tbody');
                if (!table || !tbody) {
                    console.warn('Due issues view missing table.');
                    return;
                }
                dueIssues = { root, table, tbody };
                renderDueIssues(lastResult);
            },
            initQuarterReport: (root) => {
                if (!root || root.dataset.controllerReady === 'true') return;
                root.dataset.controllerReady = 'true';
                const table = root.querySelector('#quarterReportTable');
                const tbody = table?.querySelector('tbody');
                if (!table || !tbody) {
                    console.warn('Quarter report view missing table.');
                    return;
                }
                quarter = { root, table, tbody };
                renderQuarterReport(lastResult?.quarterReport);
            }
        };
    }
})();
