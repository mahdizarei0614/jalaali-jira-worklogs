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
    const defaultRoute = initialActive ? initialActive[0] : (navItems[0]?.dataset.route || 'profile');
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

        activeRoute = route;

        if (pushState) {
            window.location.hash = route;
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

    const controllers = {
        profile: initProfile,
        'monthly-report': initMonthlyReport
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

    async function initProfile(root) {
        if (!root || root.dataset.controllerReady === 'true') return;
        root.dataset.controllerReady = 'true';
    }

    async function initMonthlyReport(root) {
        if (!root || root.dataset.controllerReady === 'true') return;
        root.dataset.controllerReady = 'true';

        const baseUrl = root.querySelector('#baseUrl');
        const baseUrlWrap = root.querySelector('#baseUrlWrap');
        const usernameSelect = root.querySelector('#usernameSelect');
        const jYear = root.querySelector('#jYear');
        const jMonth = root.querySelector('#jMonth');
        const timeOffHours = root.querySelector('#timeOffHours');
        const table = root.querySelector('#results');
        const tbody = table?.querySelector('tbody');
        const footerTotals = root.querySelector('#footerTotals');
        const worklogsWrap = root.querySelector('#worklogsWrap');
        const detailedBody = root.querySelector('#detailedWorklogsTable tbody');
        const quarterCard = root.querySelector('#quarterReport');
        const quarterMeta = root.querySelector('#quarterMeta');
        const quarterStatus = root.querySelector('#quarterStatus');
        const quarterTableBody = root.querySelector('#quarterTableBody');
        const quarterTotalLogged = root.querySelector('#quarterTotalLogged');
        const quarterTotalExpected = root.querySelector('#quarterTotalExpected');
        const quarterTotalDelta = root.querySelector('#quarterTotalDelta');
        const quarterTotalDeficits = root.querySelector('#quarterTotalDeficits');
        const debug = root.querySelector('#debug');
        const saveBtn = root.querySelector('#save');
        const scanBtn = root.querySelector('#scan');

        if (!baseUrl || !baseUrlWrap || !usernameSelect || !jYear || !jMonth || !timeOffHours || !table || !tbody || !footerTotals || !worklogsWrap || !detailedBody || !quarterCard || !quarterMeta || !quarterStatus || !quarterTableBody || !quarterTotalLogged || !quarterTotalExpected || !quarterTotalDelta || !quarterTotalDeficits || !saveBtn || !scanBtn) {
            console.warn('Monthly report view missing required elements.');
            return;
        }

        const weekdayName = (w) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][w] || String(w);
        const persianMonths = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
        const persianSeasons = ['بهار', 'تابستان', 'پاییز', 'زمستان'];
        const formatHours = (val) => `${(Number(val ?? 0)).toFixed(2)} h`;
        const formatSignedHours = (val) => {
            const num = Number(val ?? 0);
            const sign = num > 0 ? '+' : '';
            return `${sign}${num.toFixed(2)} h`;
        };

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

        function getQuarterInfo(jYearVal, jMonthVal) {
            const y = Number(jYearVal);
            const m = Number(jMonthVal);
            if (!Number.isFinite(y) || !Number.isFinite(m)) return null;
            const index = Math.max(0, Math.min(3, Math.floor((m - 1) / 3)));
            const startMonth = index * 3 + 1;
            const months = [0, 1, 2].map((offset) => startMonth + offset);
            const rangeNames = months.map((monthNum) => persianMonths[(monthNum - 1 + 12) % 12]);
            const label = `${persianSeasons[index] || 'Quarter'} ${y}`;
            const rangeLabel = rangeNames.length ? `${rangeNames[0]} – ${rangeNames[2]}` : '';
            return { index, startMonth, endMonth: startMonth + 2, label, rangeLabel };
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

        jYear.addEventListener('input', async () => {
            const caret = jYear.selectionStart;
            jYear.value = toAsciiDigits(jYear.value).replace(/[^\d]/g, '');
            try { jYear.setSelectionRange(caret, caret); } catch (err) { /* ignore */ }
            await pushSelection();
            updateFooter();
            resetQuarter();
        });
        jMonth.addEventListener('change', async () => {
            await pushSelection();
            updateFooter();
            resetQuarter();
        });
        usernameSelect.addEventListener('change', async () => {
            await pushSelection();
            resetQuarter();
        });

        saveBtn.addEventListener('click', async () => {
            baseUrl.value = stripTrailingSlash(sanitizeUrl(baseUrl.value));
            updateBaseUrlUI();
            await window.appApi.saveSettings({ baseUrl: baseUrl.value });
            await enforceUserVisibility();
        });

        let lastResult = null;
        let quarterCacheKey = null;
        let quarterCacheData = null;
        let quarterRequestCounter = 0;

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
            if (debug) {
                debug.textContent = JSON.stringify({
                    username: usernameSelect.value,
                    sent: { jYear: parseInt(toAsciiDigits(jYear.value), 10), jMonth: parseInt(toAsciiDigits(jMonth.value), 10) },
                    jql: lastResult.jql,
                    month: lastResult.jMonthLabel,
                    timeOffHours: timeOff,
                    totals: {
                        totalHours: total,
                        expectedByNowHours: expectedNow,
                        expectedByEndMonthHours: expectedEnd,
                        adjustedLoggedPlusTimeOff: adjusted,
                        deltaVsEnd: deltaEnd
                    },
                    worklogsRows: lastResult.worklogs?.length ?? 0,
                    deficitsSample: lastResult.deficits.slice(0, 10)
                }, null, 2);
            }
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
          <td>${Number(w.hours).toFixed(2)}</td>
          <td>${w.timeSpent || ''}</td>
          <td>${(w.comment || '').toString().replace(/\n/g, ' ')}</td>
        `;
                    detailedBody.appendChild(tr);
                });
            } else {
                const tr = document.createElement('tr');
                tr.innerHTML = '<td colspan="8">—</td>';
                detailedBody.appendChild(tr);
            }
            worklogsWrap.style.display = 'block';
        }

        function resetQuarter(message = 'Quarter overview will appear after scanning.') {
            quarterCacheKey = null;
            quarterCacheData = null;
            quarterRequestCounter += 1;
            quarterTableBody.innerHTML = '';
            quarterTotalLogged.textContent = '—';
            quarterTotalExpected.textContent = '—';
            quarterTotalDelta.textContent = '—';
            quarterTotalDelta.classList.remove('delta-pos', 'delta-neg');
            quarterTotalDeficits.textContent = '—';
            quarterMeta.textContent = message;
            quarterStatus.textContent = '';
            quarterCard.style.display = 'none';
        }

        function setQuarterLoading(info) {
            const metaParts = [];
            if (info?.label) metaParts.push(info.label);
            if (info?.rangeLabel) metaParts.push(info.rangeLabel);
            quarterMeta.textContent = metaParts.join(' • ') || 'Quarter Report';
            quarterStatus.textContent = 'Loading quarter report…';
            quarterTableBody.innerHTML = '';
            quarterTotalLogged.textContent = '—';
            quarterTotalExpected.textContent = '—';
            quarterTotalDelta.textContent = '—';
            quarterTotalDelta.classList.remove('delta-pos', 'delta-neg');
            quarterTotalDeficits.textContent = '—';
            quarterCard.style.display = 'block';
        }

        function renderQuarterError(message, info) {
            const metaParts = [];
            if (info?.label) metaParts.push(info.label);
            if (info?.rangeLabel) metaParts.push(info.rangeLabel);
            quarterMeta.textContent = metaParts.join(' • ') || 'Quarter Report';
            quarterStatus.textContent = message;
            quarterTableBody.innerHTML = '';
            quarterTotalLogged.textContent = '—';
            quarterTotalExpected.textContent = '—';
            quarterTotalDelta.textContent = '—';
            quarterTotalDelta.classList.remove('delta-pos', 'delta-neg');
            quarterTotalDeficits.textContent = '—';
            quarterCard.style.display = 'block';
        }

        function renderQuarterReport(data) {
            if (!data?.ok) return;
            const metaParts = [];
            if (data.quarter?.label) metaParts.push(data.quarter.label);
            if (data.quarter?.rangeLabel) metaParts.push(data.quarter.rangeLabel);
            quarterMeta.textContent = metaParts.join(' • ') || 'Quarter Report';
            quarterStatus.textContent = '';
            quarterTableBody.innerHTML = '';
            data.months.forEach((month) => {
                const tr = document.createElement('tr');
                const deltaClass = Number(month.deltaHours) >= 0 ? 'delta-pos' : 'delta-neg';
                tr.innerHTML = `
          <td>${month.monthName || month.monthLabel}</td>
          <td>${formatHours(month.totalHours)}</td>
          <td>${formatHours(month.expectedHours)}</td>
          <td class="${deltaClass}">${formatSignedHours(month.deltaHours)}</td>
          <td>${Number(month.deficitDays ?? 0)}</td>
        `;
                quarterTableBody.appendChild(tr);
            });
            quarterTotalLogged.textContent = formatHours(data.totals?.totalHours);
            quarterTotalExpected.textContent = formatHours(data.totals?.expectedHours);
            const totalDeltaClass = Number(data.totals?.deltaHours) >= 0 ? 'delta-pos' : 'delta-neg';
            quarterTotalDelta.textContent = formatSignedHours(data.totals?.deltaHours);
            quarterTotalDelta.classList.remove('delta-pos', 'delta-neg');
            quarterTotalDelta.classList.add(totalDeltaClass);
            quarterTotalDeficits.textContent = `${Number(data.totals?.deficitDays ?? 0)}`;
            quarterCard.style.display = 'block';
            quarterCacheData = data;
        }

        async function loadQuarterForResult(res) {
            if (!res?.ok) {
                resetQuarter();
                return;
            }
            const jy = Number(res.jYear);
            const jm = Number(res.jMonth);
            const username = usernameSelect.value;
            const info = getQuarterInfo(jy, jm);
            const totalKeyPart = Number.isFinite(Number(res.totalHours)) ? `::${Number(res.totalHours).toFixed(2)}` : '';
            const expectedKeyPart = Number.isFinite(Number(res.expectedByEndMonthHours)) ? `::${Number(res.expectedByEndMonthHours).toFixed(2)}` : '';
            const key = info
                ? `${username}::${jy}::${info.index}${totalKeyPart}${expectedKeyPart}`
                : `${username}::${jy}::${jm}${totalKeyPart}${expectedKeyPart}`;
            if (quarterCacheKey === key && quarterCacheData) {
                renderQuarterReport(quarterCacheData);
                return;
            }
            const requestId = ++quarterRequestCounter;
            setQuarterLoading(info);
            try {
                const qRes = await window.appApi.scanQuarter({ jYear: jy, jMonth: jm, username });
                if (requestId !== quarterRequestCounter) return;
                if (qRes?.ok) {
                    quarterCacheKey = key;
                    quarterCacheData = qRes;
                    renderQuarterReport(qRes);
                } else {
                    quarterCacheKey = null;
                    quarterCacheData = null;
                    renderQuarterError(qRes?.reason || 'Unable to load quarter report.', qRes?.quarter || info);
                }
            } catch (err) {
                if (requestId !== quarterRequestCounter) return;
                quarterCacheKey = null;
                quarterCacheData = null;
                const msg = err?.message ? `Unable to load quarter report: ${err.message}` : 'Unable to load quarter report.';
                renderQuarterError(msg, info);
            }
        }

        function render(res) {
            lastResult = res;

            if (!res?.ok) {
                table.style.display = 'none';
                tbody.innerHTML = '';
                worklogsWrap.style.display = 'none';
                updateFooter();
                resetQuarter();
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
            updateFooter();
            loadQuarterForResult(res);
        }

        scanBtn.addEventListener('click', async () => {
            const jy = Number.parseInt(toAsciiDigits(jYear.value), 10);
            const jm = Number.parseInt(toAsciiDigits(jMonth.value), 10);
            resetQuarter('Quarter overview will load after the monthly report completes.');
            await pushSelection();
            const res = await window.appApi.scanNow({ jYear: jy, jMonth: jm, username: usernameSelect.value });
            render(res);
        });

        timeOffHours.addEventListener('input', updateFooter);

        window.appApi.onScanResult((res) => {
            if (!res?.ok) return;
            const curY = Number.parseInt(toAsciiDigits(jYear.value), 10);
            const curM = Number.parseInt(toAsciiDigits(jMonth.value), 10);
            if (res.jYear === curY && res.jMonth === curM) render(res);
        });

        resetQuarter();
        await pushSelection();
    }
})();
