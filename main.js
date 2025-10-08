(async () => {
    const Store = (await import('electron-store')).default;

    const { app, BrowserWindow, ipcMain, Notification, Tray, Menu, nativeImage } = require('electron');
    const path = require('path');
    const axios = require('axios');
    const keytar = require('keytar');
    const cron = require('node-cron');
    const moment = require('moment-jalaali');

    const STORE = new Store({ name: 'settings' });
    const SERVICE_NAME = 'alo-worklog';
    const TOKEN_ACCOUNT = 'jira-access-token';

    const TEHRAN_TZ = 'Asia/Tehran';
    const TEHRAN_OFFSET_MIN = 210; // +03:30
    const DAILY_REMINDER_TIMES = ['17:00', '18:00', '19:00'];

    const STATIC_JALALI_HOLIDAYS = [
        '1404/01/01',
        '1404/01/02',
        '1404/01/03',
        '1404/01/04',
        '1404/01/11',
        '1404/01/12',
        '1404/01/13',
        '1404/02/04',
        '1404/03/14',
        '1404/03/15',
        '1404/03/16',
        '1404/03/24',
        '1404/04/14',
        '1404/04/15',
        '1404/05/23',
        '1404/05/31',
        '1404/06/02',
        '1404/06/10',
        '1404/06/19',
        '1404/09/03',
        '1404/10/13',
        '1404/10/27',
        '1404/11/15',
        '1404/11/22',
        '1404/12/20',
        '1404/12/29',
        '1405/01/01',
        '1405/01/02',
        '1405/01/03',
        '1405/01/04',
        '1405/01/12',
        '1405/01/13',
        '1405/01/25',
        '1405/03/07',
        '1405/03/14',
        '1405/03/15',
        '1405/04/04',
        '1405/04/05',
        '1405/05/13',
        '1405/05/21',
        '1405/05/23',
        '1405/05/31',
        '1405/06/09',
        '1405/08/23',
        '1405/10/02',
        '1405/10/16',
        '1405/11/04',
        '1405/11/22',
        '1405/12/10',
        '1405/12/19',
        '1405/12/20',
        '1405/12/29',
    ];

    let mainWindow;
    let tray;
    const lastUI = { jYear: null, jMonth: null, username: null };

    const mtNow = () => moment().utcOffset(TEHRAN_OFFSET_MIN);
    const mj = (jYear, jMonth, jDay) =>
        moment(`${jYear}/${jMonth}/${jDay}`, 'jYYYY/jM/jD', true).utcOffset(TEHRAN_OFFSET_MIN);

    function currentJalaaliMonth() {
        const now = mtNow();
        return { jYear: now.jYear(), jMonth: now.jMonth() + 1 };
    }

    function jMonthRange(jYear, jMonth) {
        const anchor = mj(jYear, jMonth, 1);
        if (!anchor.isValid()) return { start: null, end: null };
        const start = anchor.clone().startOf('day');
        const end   = anchor.clone().endOf('jMonth').endOf('day');
        return { start, end };
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

    function buildHolidaysSetFromStatic(jYear, jMonth) {
        const set = new Set();
        for (const s of STATIC_JALALI_HOLIDAYS) {
            let m = moment(s, 'jYYYY/jMM/jDD', true);
            if (!m.isValid()) m = moment(s, 'jYYYY/jM/jD', true);
            if (m.isValid() && m.jYear() === jYear && (m.jMonth() + 1) === jMonth) set.add(m.jDate());
        }
        return set;
    }

    function buildHeaders(_baseUrl, tokenRaw) {
        const h = { Accept: 'application/json', 'Content-Type': 'application/json' };
        if (!tokenRaw) return h;
        if (/^(Bearer|Basic)\s/i.test(tokenRaw)) h.Authorization = tokenRaw;
        else h.Authorization = `Bearer ${tokenRaw}`;
        return h;
    }

    async function searchIssuesWithWorklogsPaged(baseUrl, headers, jql) {
        const issues = [];
        let startAt = 0;
        const maxResults = 100;
        while (true) {
            const { data } = await axios.get(`${baseUrl}/rest/api/latest/search`, {
                headers,
                params: { jql, startAt, maxResults, fields: 'key,summary,worklog' }
            });
            if (Array.isArray(data?.issues)) issues.push(...data.issues);
            const total = data?.total ?? issues.length;
            startAt += data?.maxResults ?? maxResults;
            if (startAt >= total) break;
        }
        return issues;
    }

    async function getFullIssueWorklogs(baseUrl, headers, issueKey, initialContainer) {
        const collected = Array.isArray(initialContainer?.worklogs) ? [...initialContainer.worklogs] : [];
        const total = initialContainer?.total ?? collected.length;
        let startAt = collected.length;
        const maxResults = 100;
        if (total <= collected.length) return collected;

        while (startAt < total) {
            const { data } = await axios.get(
                `${baseUrl}/rest/api/latest/issue/${encodeURIComponent(issueKey)}/worklog`,
                { headers, params: { startAt, maxResults } }
            );
            const got = Array.isArray(data?.worklogs) ? data.worklogs.length : 0;
            if (!got) break;
            collected.push(...data.worklogs);
            startAt += got;
        }
        return collected;
    }

    async function whoAmI() {
        const baseUrl = (STORE.get('jiraBaseUrl', '') || '').trim().replace(/\/+$/, '');
        const token = await keytar.getPassword(SERVICE_NAME, TOKEN_ACCOUNT);
        if (!baseUrl || !token) return { ok: false, reason: 'Missing Jira base URL or token.' };

        const headers = buildHeaders(baseUrl, token);
        try {
            const { data } = await axios.get(`${baseUrl}/rest/api/latest/myself`, { headers });
            const username =
                data?.name ||
                data?.emailAddress ||
                data?.accountId ||
                data?.displayName ||
                '';

            return {
                ok: true,
                username,
                raw: {
                    name: data?.name,
                    emailAddress: data?.emailAddress,
                    accountId: data?.accountId,
                    displayName: data?.displayName,
                }
            };
        } catch (e) {
            const msg = e?.response ? `${e.response.status} ${e.response.statusText}` : (e?.message || 'whoami failed');
            return { ok: false, reason: msg };
        }
    }

    function authorMatches(author, username) {
        if (!author || !username) return false;
        return author.name === username || author.emailAddress === username;
    }

    function authorKey(author) {
        return author?.accountId || author?.name || author?.emailAddress || '';
    }

    function worklogKey(issueKey, wl) {
        // Prefer Jira’s stable id if available
        const id = wl.id || wl.worklogId;
        if (id) return `id:${issueKey}#${id}`;

        // Fallback fingerprint if no id provided
        const a = authorKey(wl.author);
        const started = wl.started || '';
        const secs = wl.timeSpentSeconds ?? wl.timeSpentInSeconds ?? 0;
        return `fp:${issueKey}|${a}|${started}|${secs}`;
    }

    function buildReportRows(issue, fullWorklogs, username, seen) {
        const rows = [];
        for (const log of fullWorklogs) {
            if (!authorMatches(log.author, username)) continue;

            // ---- DEDUPE ----
            const k = worklogKey(issue.key, log);
            if (seen.has(k)) continue;
            seen.add(k);
            // ----------------

            const date = String(log.started).split('T')[0]; // 'YYYY-MM-DD'
            rows.push({
                worklogId: log.id || null, // keep for reference
                issueKey: issue.key,
                summary: issue?.fields?.summary,
                date,
                timeSpent: log.timeSpent,
                hours: +(log.timeSpentSeconds / 3600).toFixed(2),
                comment: log.comment || ''
            });
        }
        return rows;
    }

    function classifyDay({ isWorkday, isFuture, hours }) {
        if (!isWorkday || isFuture) return 'gray';
        if (hours === 0) return 'red';
        if (hours < 6 || hours > 6) return 'yellow';
        return 'green';
    }

    function resolveTargetMonth(opts) {
        const yStr = toAsciiDigits(opts?.jYear);
        const mStr = toAsciiDigits(opts?.jMonth);
        let y = Number.parseInt(yStr, 10);
        let m = Number.parseInt(mStr, 10);
        if (Number.isFinite(y) && m >= 1 && m <= 12) {
            STORE.set('selectedJYear', y);
            STORE.set('selectedJMonth', m);
            return { jYear: y, jMonth: m, source: 'opts' };
        }
        const ys = STORE.get('selectedJYear');
        const ms = STORE.get('selectedJMonth');
        if (Number.isFinite(ys) && ms >= 1 && ms <= 12) return { jYear: ys, jMonth: ms, source: 'stored-month' };
        const { jYear, jMonth } = currentJalaaliMonth();
        return { jYear, jMonth, source: 'current' };
    }

    async function computeScan(opts) {
        const baseUrl = (STORE.get('jiraBaseUrl', '') || '').trim().replace(/\/+$/, '');
        const token = await keytar.getPassword(SERVICE_NAME, TOKEN_ACCOUNT);
        const username = (opts && opts.username) || lastUI.username;

        if (!baseUrl || !token) return { ok: false, reason: 'Missing Jira base URL or token.' };
        if (!username) return { ok: false, reason: 'No Jira username selected in UI.' };

        const { jYear, jMonth, source } = resolveTargetMonth(opts);
        const { start, end } = jMonthRange(jYear, jMonth);
        if (!start || !end) return { ok: false, reason: 'Failed to construct selected Jalaali month range.' };

        const fromYMD = start.format('YYYY-MM-DD');
        const toYMD   = end.format('YYYY-MM-DD');
        const nowG    = mtNow();

        const headers = buildHeaders(baseUrl, token);
        const jql = `worklogAuthor = "${username}" AND worklogDate >= "${fromYMD}" AND worklogDate <= "${toYMD}"`;

        const issues = await searchIssuesWithWorklogsPaged(baseUrl, headers, jql);

        // ---- Build detailed report rows (like your script) ----
        let report = [];
        const seenWorklogKeys = new Set(); // <--- add this

        for (const issue of issues) {
            const initial = issue?.fields?.worklog ?? {};
            const fullWls = await getFullIssueWorklogs(baseUrl, headers, issue.key, initial);
            report.push(...buildReportRows(issue, fullWls, username, seenWorklogKeys)); // pass set
        }

        // Filter + sort + add Persian date (exactly like your approach)
        report = report
            .filter(r =>
                moment(r.date, 'YYYY-MM-DD', true).isSameOrBefore(moment(toYMD, 'YYYY-MM-DD')) &&
                moment(r.date, 'YYYY-MM-DD', true).isSameOrAfter(moment(fromYMD, 'YYYY-MM-DD'))
            )
            .sort((a, b) => moment(a.date, 'YYYY-MM-DD').diff(moment(b.date, 'YYYY-MM-DD')))
            .map(r => ({
                ...r,
                persianDate: moment(r.date, 'YYYY-MM-DD', true).format('jYYYY/jMM/jDD')
            }));

        // ---- Summary (like your calculateSummary) ----
        const totalWorklogs = report.length;
        const totalLoggedHours = +report.reduce((sum, entry) => sum + Number(entry.hours), 0).toFixed(2);

        const dailyTotalsMap = {};
        for (const entry of report) {
            dailyTotalsMap[entry.date] = (dailyTotalsMap[entry.date] || 0) + Number(entry.hours);
        }
        const dailySummary = Object.entries(dailyTotalsMap)
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([date, hours]) => ({ date, hours: (+hours).toFixed(2) }));

        // ---- Build calendar days (colors etc.) ----
        const holidayDays = buildHolidaysSetFromStatic(jYear, jMonth);
        const daysInMonth = mj(jYear, jMonth, 1).endOf('jMonth').jDate();

        // daily totals for coloring
        const dailyTotalsForCalendar = { ...dailyTotalsMap };

        const days = [];
        for (let jDay = 1; jDay <= daysInMonth; jDay++) {
            const g = mj(jYear, jMonth, jDay);
            const gKey = g.format('YYYY-MM-DD');
            const weekday = g.weekday();
            const isThuFri = (weekday === 4 || weekday === 5);
            const isHoliday = holidayDays.has(jDay);
            const isFuture = g.isAfter(nowG, 'day');
            const isWorkday = !(isThuFri || isHoliday);
            const hours = +(dailyTotalsForCalendar[gKey] || 0);
            const color = classifyDay({ isWorkday, isFuture, hours });

            days.push({
                j: g.format('jYYYY/jMM/jDD'),
                g: gKey,
                weekday,
                isHoliday,
                isThuFri,
                isFuture,
                isWorkday,
                hours: +hours.toFixed(2),
                color
            });
        }

        const totalHours = +days.reduce((s, d) => s + d.hours, 0).toFixed(2);
        const workdaysAll = days.filter(d => d.isWorkday).length;
        const workdaysUntilNow = days.filter(d => d.isWorkday && !d.isFuture).length;
        const expectedByNowHours = 6 * workdaysUntilNow;
        const expectedByEndMonthHours = 6 * workdaysAll;

        const deficits = days.filter(d => d.isWorkday && !d.isFuture && d.hours < 6);

        return {
            ok: true,
            jYear,
            jMonth,
            jMonthLabel: mj(jYear, jMonth, 1).format('jYYYY/jMM'),
            jql,
            days,
            deficits,
            totalHours,
            expectedByNowHours,
            expectedByEndMonthHours,
            // NEW: expose script-style objects
            worklogs: report,
            summary: {
                totalWorklogs,
                totalHours: totalLoggedHours.toFixed(2),
                dailySummary
            }
        };
    }

    // ===== Notifications / scheduling, auth, routing, IPC (unchanged from your last working version) =====
    // ... keep the rest of your file exactly as in your latest working build ...
    // (For brevity here, do not remove your existing login, logout, tray, and IPC handlers.)

    // --- Everything below is identical to your last working version ---
    async function tokenExists() {
        const t = await keytar.getPassword(SERVICE_NAME, TOKEN_ACCOUNT);
        return !!t;
    }
    async function loadLogin() { await mainWindow.loadFile(path.join(__dirname, 'renderer', 'login.html')); }
    async function loadMain()  { await mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html')); }

    function sendNotification(deficits, jYear, jMonth) {
        const title = `Worklog < 6h — ${mj(jYear, jMonth, 1).format('jYYYY/jMM')}`;
        const body = deficits.length
            ? deficits.slice(0, 10).map(d => `${d.j} (${d.hours}h)`).join(', ') + (deficits.length > 10 ? `, +${deficits.length - 10} more` : '')
            : 'All good! No missing/short days this Jalaali month.';
        new Notification({ title, body, urgency: 'normal' }).show();
    }
    async function notifyNow() {
        if (!lastUI.username || !(await tokenExists())) return;
        const { jYear, jMonth } = currentJalaaliMonth();
        const res = await computeScan({ jYear, jMonth, username: lastUI.username });
        if (res.ok) {
            sendNotification(res.deficits, res.jYear, res.jMonth);
            mainWindow?.webContents.send('scan-result', res);
        }
    }
    function scheduleDailyReminders() {
        DAILY_REMINDER_TIMES.forEach(t => {
            const [hh, mm] = t.split(':').map(Number);
            const expr = `0 ${mm} ${hh} * * *`;
            cron.schedule(expr, async () => {
                if (!lastUI.username || !(await tokenExists())) return;
                const { jYear, jMonth } = currentJalaaliMonth();
                const res = await computeScan({ jYear, jMonth, username: lastUI.username });
                if (res.ok) sendNotification(res.deficits, res.jYear, res.jMonth);
            }, { timezone: TEHRAN_TZ });
        });
    }

    function createWindow() {
        mainWindow = new BrowserWindow({
            width: 1500,
            height: 1170,
            fullscreenable: true,
            webPreferences: { preload: path.join(__dirname, 'preload.js') },
            title: 'Alo Worklogs',
        });
        tokenExists().then(exists => exists ? loadMain() : loadLogin());
    }
    function createTray() {
        const image = nativeImage.createFromBuffer(Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQImWP8////AwAI/AL+8lD7XwAAAABJRU5ErkJggg==',
            'base64'
        ));
        tray = new Tray(image);
        const menu = Menu.buildFromTemplate([
            { label: 'Open', click: () => mainWindow?.show() },
            { type: 'separator' },
            { label: 'Scan Now (Current Month)', click: async () => notifyNow().catch(console.error) },
            { type: 'separator' },
            { label: 'Quit', click: () => app.quit() },
        ]);
        tray.setToolTip('Alo Worklogs');
        tray.setContextMenu(menu);
    }

    app.whenReady().then(() => {
        createWindow();
        createTray();
        scheduleDailyReminders();
    });
    app.on('window-all-closed', (e) => { if (process.platform !== 'darwin') e.preventDefault(); });
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

    ipcMain.handle('auth:whoami', async () => whoAmI());

    ipcMain.handle('settings:get', async () => {
        const baseUrl = STORE.get('jiraBaseUrl', '');
        const { jYear, jMonth } = currentJalaaliMonth();
        const selY = STORE.get('selectedJYear') ?? jYear;
        const selM = STORE.get('selectedJMonth') ?? jMonth;
        return { baseUrl, defaultJYear: selY, defaultJMonth: selM };
    });
    ipcMain.handle('settings:save', async (_evt, { baseUrl }) => {
        if (typeof baseUrl === 'string') STORE.set('jiraBaseUrl', baseUrl.trim().replace(/\/+$/, ''));
        return { ok: true };
    });
    ipcMain.handle('ui:update-selection', (_evt, { jYear, jMonth, username }) => {
        const y = Number.parseInt(toAsciiDigits(jYear), 10);
        const m = Number.parseInt(toAsciiDigits(jMonth), 10);
        if (Number.isFinite(y) && m >= 1 && m <= 12) {
            STORE.set('selectedJYear', y);
            STORE.set('selectedJMonth', m);
            lastUI.jYear = y; lastUI.jMonth = m;
        }
        if (typeof username === 'string' && username.trim()) lastUI.username = username.trim();
        return { ok: true, lastUI };
    });
    ipcMain.handle('auth:has', async () => ({ has: await (async () => !!(await keytar.getPassword(SERVICE_NAME, TOKEN_ACCOUNT)))() }));
    ipcMain.handle('auth:authorize', async (_evt, { token }) => {
        if (!token || !token.trim()) return { ok: false, reason: 'Empty token' };
        await keytar.setPassword(SERVICE_NAME, TOKEN_ACCOUNT, token.trim());
        await (async () => mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html')))();
        return { ok: true };
    });
    ipcMain.handle('auth:logout', async () => {
        await keytar.deletePassword(SERVICE_NAME, TOKEN_ACCOUNT);
        lastUI.username = null;
        await (async () => mainWindow.loadFile(path.join(__dirname, 'renderer', 'login.html')))();
        return { ok: true };
    });

    ipcMain.handle('scan:now', (_evt, opts) => computeScan(opts || {}));
})();
