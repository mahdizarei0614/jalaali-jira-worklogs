(async function () {
    const $ = (s) => document.querySelector(s);
    const routeTitle = $('#viewTitle');
    const defaultTitle = routeTitle?.textContent || 'Alo Worklogs';
    const navItems = Array.from(document.querySelectorAll('[data-route]'));
    const viewNodes = new Map(
        Array.from(document.querySelectorAll('[data-route-view]'))
            .map((el) => {
                const route = el.getAttribute('data-route-view');
                return route ? [route, el] : null;
            })
            .filter(Boolean)
    );
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

    const baseUrl = $('#baseUrl');
    const baseUrlWrap = $('#baseUrlWrap');
    const usernameSelect = $('#usernameSelect');
    const jYear = $('#jYear');
    const jMonth = $('#jMonth');
    const timeOffHours = $('#timeOffHours');
    const table = $('#results');
    const tbody = table.querySelector('tbody');
    const footerTotals = $('#footerTotals');
    const debug = $('#debug');
    const worklogsWrap = $('#worklogsWrap');
    const detailedBody = $('#detailedWorklogsTable tbody');

    const weekdayName = (w) => ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][w] || String(w);
    const persianMonths = ['فروردین','اردیبهشت','خرداد','تیر','مرداد','شهریور','مهر','آبان','آذر','دی','بهمن','اسفند'];

    const userMap = [
        { text: 'رضا محمدخان',       value: 'r.mohammadkhan' },
        { text: 'محمدمهدی زارعی',  value: 'Momahdi.Zarei' },
        { text: 'فرید ذوالقدر',     value: 'zolghadr.farid' },
        { text: 'نیلوفر صمدزادگان', value: 'n.samadzadegan' },
        { text: 'یحیی کنگی',        value: 'y.kangi' },
        { text: 'امیرحسین فاطمی',    value: 'a.fatemi' },
        { text: 'ابراهیم علیپور',    value: 'e.alipour' },
        { text: 'ریحانه اخگری',      value: 'r.akhgari' },
    ];
    usernameSelect.innerHTML = userMap.map(u => `<option value="${u.value}">${u.text}</option>`).join('');
    jMonth.innerHTML = persianMonths.map((name, idx) => `<option value="${idx + 1}">${name}</option>`).join('');

    const ADMIN_USERS = new Set(['Momahdi.Zarei', 'r.mohammadkhan']);

    async function enforceUserVisibility() {
        const who = await window.appApi.whoami();
        if (!who?.ok) {
            // If we can’t resolve identity yet, keep current state (user can still save baseUrl then scan)
            return;
        }
        const self = (who.username || '').trim();
        if (!self) return;

        // Ensure the current user exists in the dropdown (if not in predefined map)
        if (![...usernameSelect.options].some(o => o.value === self)) {
            const opt = document.createElement('option');
            opt.value = self;
            opt.textContent = (who.raw?.displayName || self);
            usernameSelect.appendChild(opt);
        }

        if (ADMIN_USERS.has(self)) {
            usernameSelect.disabled = false; // admins can choose anyone
        } else {
            usernameSelect.value = self;     // lock to self
            usernameSelect.disabled = true;
        }

        // push selection so main knows which username to scan for
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
            '۰':'0','۱':'1','۲':'2','۳':'3','۴':'4','۵':'5','۶':'6','۷':'7','۸':'8','۹':'9',
            '٠':'0','١':'1','٢':'2','٣':'3','٤':'4','٥':'5','٦':'6','٧':'7','٨':'8','٩':'9'
        };
        return s.replace(/[0-9\u06F0-\u06F9\u0660-\u0669]/g, ch => map[ch] ?? ch);
    }

    // Base URL validation UI
    function sanitizeUrl(u){ return (u || '').trim(); }
    function stripTrailingSlash(u){ return u.replace(/\/+$/,''); }
    function isLikelyUrl(u){ return /^https?:\/\/[^/\s]+\.[^/\s]+/i.test(u); }
    function updateBaseUrlUI(){
        const v = sanitizeUrl(baseUrl.value);
        baseUrlWrap.classList.remove('is-valid','is-invalid');
        if (!v) return; // neutral
        if (isLikelyUrl(v)) baseUrlWrap.classList.add('is-valid');
        else baseUrlWrap.classList.add('is-invalid');
    }
    baseUrl.addEventListener('input', updateBaseUrlUI);
    baseUrl.addEventListener('blur', () => {
        baseUrl.value = stripTrailingSlash(sanitizeUrl(baseUrl.value));
        updateBaseUrlUI();
    });

    // Load settings & defaults
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
        try { jYear.setSelectionRange(caret, caret); } catch {}
        await pushSelection();
        updateFooter();
    });
    jMonth.addEventListener('change', async () => { await pushSelection(); updateFooter(); });
    usernameSelect.addEventListener('change', pushSelection);

    $('#save').addEventListener('click', async () => {
        baseUrl.value = stripTrailingSlash(sanitizeUrl(baseUrl.value));
        updateBaseUrlUI();
        await window.appApi.saveSettings({ baseUrl: baseUrl.value });
        await enforceUserVisibility();
    });
    document.getElementById('logout').addEventListener('click', async () => {
        await window.appApi.logout();
    });

    let lastResult = null;

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
          <td>${(w.summary || '').toString().replace(/\n/g,' ')}</td>
          <td>${Number(w.hours).toFixed(2)}</td>
          <td>${w.timeSpent || ''}</td>
          <td>${(w.comment || '').toString().replace(/\n/g,' ')}</td>
        `;
                detailedBody.appendChild(tr);
            });
        } else {
            const tr = document.createElement('tr');
            tr.innerHTML = `<td colspan="8">—</td>`;
            detailedBody.appendChild(tr);
        }
        worklogsWrap.style.display = 'block';
    }

    function render(res) {
        lastResult = res;

        if (!res?.ok) {
            table.style.display = 'none';
            tbody.innerHTML = '';
            worklogsWrap.style.display = 'none';
            updateFooter();
            return;
        }

        // Calendar table (NO odd/even striping; status colors only)
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

        // Detailed Worklogs
        renderWorklogs(res);

        // Footer
        updateFooter();
    }

    document.getElementById('scan').addEventListener('click', async () => {
        const jy = Number.parseInt(toAsciiDigits(jYear.value), 10);
        const jm = Number.parseInt(toAsciiDigits(jMonth.value), 10);
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

    await pushSelection(); // initial
})();
