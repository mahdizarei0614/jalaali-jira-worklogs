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
    const defaultRoute = initialActive ? initialActive[0] : (navItems[0]?.dataset.route || 'monthly-overview');
    let activeRoute = null;
    const routeListeners = new Set();

    function notifyRouteChange(route) {
        routeListeners.forEach((listener) => {
            try {
                listener(route);
            } catch (err) {
                console.error(err);
            }
        });
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

        notifyRouteChange(route);

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
        titleFor: (route) => routeLabels[route] || null,
        onChange: (listener) => {
            if (typeof listener === 'function') {
                routeListeners.add(listener);
                return () => routeListeners.delete(listener);
            }
            return () => {};
        }
    });

    const controllers = {
        'monthly-overview': initReportsController,
        'detailed-worklogs': initReportsController,
        'due-issues': initReportsController,
        'quarter-report': initReportsController
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

    async function initReportsController(root) {
        if (!root) return;
        if (initReportsController.ready) return;
        initReportsController.ready = true;

        const baseUrl = document.querySelector('#baseUrl');
        const baseUrlWrap = document.querySelector('#baseUrlWrap');
        const usernameSelect = document.querySelector('#sidebarUsernameSelect');
        const jYear = document.querySelector('#jYear');
        const jMonth = document.querySelector('#jMonth');
        const timeOffHours = document.querySelector('#timeOffHours');
        const table = document.querySelector('#results');
        const tbody = table?.querySelector('tbody');
        const footerTotals = document.querySelector('#footerTotals');
        const detailedBody = document.querySelector('#detailedWorklogsTable tbody');
        const dueThisMonthBody = document.querySelector('#dueThisMonthTable tbody');
        const quarterTableBody = document.querySelector('#quarterReportTable tbody');
        const saveBtn = document.querySelector('#save');

        if (!baseUrl || !baseUrlWrap || !usernameSelect || !jYear || !jMonth || !timeOffHours || !table || !tbody || !footerTotals || !detailedBody || !dueThisMonthBody || !quarterTableBody || !saveBtn) {
            console.warn('Report views missing required elements.');
            return;
        }

        const formatHours = (val) => {
            const num = Number.parseFloat(val);
            if (!Number.isFinite(num)) return '0.00';
            return num.toFixed(2);
        };

        const weekdayName = (w) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][w] || String(w);
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
        usernameSelect.innerHTML = userMap.map((u) => `<option value="${u.value}">${u.text}</option>`).join('');
        jMonth.innerHTML = persianMonths.map((name, idx) => `<option value="${idx + 1}">${name}</option>`).join('');

        const ADMIN_USERS = new Set(['Momahdi.Zarei', 'r.mohammadkhan']);

        function toAsciiDigits(val) {
            if (val == null) return '';
            const s = String(val);
            const map = {
                '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
                '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9'
            };
            return s.replace(/[0-9\u06F0-\u06F9\u0660-\u0669]/g, (ch) => map[ch] ?? ch);
        }

        async function enforceUserVisibility() {
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

            await window.appApi.updateSelection({
                jYear: parseInt(toAsciiDigits(jYear.value), 10),
                jMonth: parseInt(toAsciiDigits(jMonth.value), 10),
                username: usernameSelect.value
            });
        }

        function sanitizeUrl(u) { return (u || '').trim(); }
        function stripTrailingSlash(u) { return u.replace(/\/+$/, ''); }
        function isLikelyUrl(u) { return /^https?:\/\/[^/\s]+\.[^/\s]+/i.test(u); }
        function updateBaseUrlUI() {
            const v = sanitizeUrl(baseUrl.value);
            baseUrlWrap.classList.remove('is-valid', 'is-invalid');
            if (!v) return;
            if (isLikelyUrl(v)) baseUrlWrap.classList.add('is-valid');
            else baseUrlWrap.classList.add('is-invalid');
        }
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
        usernameSelect.value = userMap[0].value;
        await enforceUserVisibility();

        async function pushSelection() {
            await window.appApi.updateSelection({
                jYear: parseInt(toAsciiDigits(jYear.value), 10),
                jMonth: parseInt(toAsciiDigits(jMonth.value), 10),
                username: usernameSelect.value
            });
        }

        let lastResult = null;
        let fetchTimer = null;
        let inFlightKey = null;

        function updateFooter() {
            if (!lastResult?.ok) {
                footerTotals.innerHTML = `<div class="footer-grid"><span class="pill">Totals here…</span></div>`;
                return;
            }
            const total = +(lastResult.totalHours ?? 0);
            const expectedNow = +(lastResult.expectedByNowHours ?? 0);
            const expectedEnd = +(lastResult.expectedByEndMonthHours ?? 0);
            const timeOff = Math.max(0, parseFloat(timeOffHours.value || '0')) || 0;
            const adjusted = +(total + timeOff);
            const deltaEnd = +(adjusted - expectedEnd);
            const deltaCls = deltaEnd >= 0 ? 'delta-pos' : 'delta-neg';
            const deltaLabel = deltaEnd >= 0 ? 'Surplus vs end' : 'Shortfall vs end';

            footerTotals.innerHTML = `
      <div class="footer-grid">
        <span class="pill"><strong>Month:</strong> ${lastResult.jMonthLabel}</span>
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
            detailedBody.innerHTML = '';
            if (Array.isArray(res.worklogs) && res.worklogs.length) {
                Array.from(new Set(res.worklogs)).forEach((w, idx) => {
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
          <td>${idx + 1}</td>
          <td>${w.persianDate || ''}</td>
          <td>${w.date || ''}</td>
          <td>${w.issueKey || ''}</td>
          <td>${(w.summary || '').toString().replace(/\n/g, ' ')}</td>
          <td>${Number.parseFloat(w.hours ?? 0).toFixed(2)}</td>
          <td>${w.timeSpent || ''}</td>
          <td>${(w.comment || '').toString().replace(/\n/g, ' ')}</td>
        `;
                    if (!w.dueDate) {
                        tr.classList.add('no-due-date');
                    }
                    detailedBody.appendChild(tr);
                });
            } else {
                const tr = document.createElement('tr');
                tr.innerHTML = '<td colspan="8">—</td>';
                detailedBody.appendChild(tr);
            }
        }

        function renderDueIssues(res) {
            const issues = Array.isArray(res?.dueIssuesCurrentMonth) ? res.dueIssuesCurrentMonth : [];
            dueThisMonthBody.innerHTML = '';
            if (!issues.length) {
                dueThisMonthBody.innerHTML = '<tr><td colspan="8">—</td></tr>';
                return;
            }

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
                dueThisMonthBody.appendChild(tr);
            });
        }

        function renderQuarterReport(data) {
            if (!data?.ok || !Array.isArray(data.seasons) || data.seasons.length === 0) {
                quarterTableBody.innerHTML = '<tr><td colspan="7">—</td></tr>';
                return;
            }

            quarterTableBody.innerHTML = '';
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
                quarterTableBody.appendChild(tr);
            });
        }

        function render(res) {
            lastResult = res;

            if (!res?.ok) {
                table.style.display = 'none';
                tbody.innerHTML = '';
                detailedBody.innerHTML = '<tr><td colspan="8">—</td></tr>';
                dueThisMonthBody.innerHTML = '<tr><td colspan="8">—</td></tr>';
                quarterTableBody.innerHTML = '<tr><td colspan="7">—</td></tr>';
                updateFooter();
                return;
            }

            tbody.innerHTML = '';
            res.days.forEach((d, idx) => {
                const tr = document.createElement('tr');
                tr.className = d.color;
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
        <td>${d.hours.toFixed(2)}</td>
      `;
                tbody.appendChild(tr);
            });
            table.style.display = 'table';

            renderWorklogs(res);
            renderDueIssues(res);
            renderQuarterReport(res.quarterReport);
            updateFooter();
        }

        function getSelection() {
            return {
                jYear: Number.parseInt(toAsciiDigits(jYear.value), 10),
                jMonth: Number.parseInt(toAsciiDigits(jMonth.value), 10),
                username: usernameSelect.value
            };
        }

        async function fetchAndRender() {
            const selection = getSelection();
            if (!Number.isInteger(selection.jYear) || !Number.isInteger(selection.jMonth) || !selection.username) {
                return;
            }
            const requestKey = `${selection.jYear}-${selection.jMonth}-${selection.username}`;
            inFlightKey = requestKey;
            try {
                const res = await window.appApi.scanNow(selection);
                if (inFlightKey === requestKey) {
                    render(res);
                }
            } catch (err) {
                console.error('Failed to fetch report:', err);
            } finally {
                if (inFlightKey === requestKey) {
                    inFlightKey = null;
                }
            }
        }

        function scheduleFetch() {
            if (fetchTimer) {
                clearTimeout(fetchTimer);
            }
            fetchTimer = setTimeout(() => {
                fetchTimer = null;
                fetchAndRender().catch((err) => console.error(err));
            }, 250);
        }

        jYear.addEventListener('input', async () => {
            const caret = jYear.selectionStart;
            jYear.value = toAsciiDigits(jYear.value).replace(/[^\d]/g, '');
            try { jYear.setSelectionRange(caret, caret); } catch (err) { /* ignore */ }
            await pushSelection();
            updateFooter();
            scheduleFetch('year-input');
        });
        jMonth.addEventListener('change', async () => {
            await pushSelection();
            updateFooter();
            scheduleFetch('month-change');
        });
        usernameSelect.addEventListener('change', async () => {
            await pushSelection();
            scheduleFetch('user-change');
        });

        saveBtn.addEventListener('click', async () => {
            baseUrl.value = stripTrailingSlash(sanitizeUrl(baseUrl.value));
            updateBaseUrlUI();
            await window.appApi.saveSettings({ baseUrl: baseUrl.value });
            await enforceUserVisibility();
            scheduleFetch('save');
        });

        timeOffHours.addEventListener('input', updateFooter);

        window.appApi.onScanResult((res) => {
            if (!res?.ok) return;
            const selection = getSelection();
            if (res.jYear === selection.jYear && res.jMonth === selection.jMonth && res.username === selection.username) {
                render(res);
            }
        });

        await pushSelection();
        scheduleFetch('initial');
        window.appRouter.onChange(() => scheduleFetch('route-change'));
    }
})();
