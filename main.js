(async () => {
    const Store = (await import('electron-store')).default;

    const { app, BrowserWindow, ipcMain, Notification, Tray, Menu, nativeImage, shell } = require('electron');
    const path = require('path');
    const fs = require('fs/promises');
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

    const DEFAULT_SEARCH_FIELDS = [
        'key',
        'summary',
        'worklog',
        'duedate',
        'status',
        'issuetype',
        'timeoriginalestimate',
        'timeestimate',
        'timespent',
        'aggregatetimeestimate',
        'aggregatetimespent',
        'aggregatetimeoriginalestimate',
        'timetracking'
    ].join(',');

    async function searchIssuesPaged(baseUrl, headers, jql, fields = DEFAULT_SEARCH_FIELDS, opts = {}) {
        if (fields && typeof fields === 'object' && !Array.isArray(fields)) {
            opts = fields;
            fields = DEFAULT_SEARCH_FIELDS;
        }

        const options = opts || {};
        const issues = [];
        const names = {};
        let startAt = 0;
        const maxResults = 100;
        while (true) {
            const params = { jql, startAt, maxResults, fields };
            if (options.expand) {
                params.expand = options.expand;
            }
            const { data } = await axios.get(`${baseUrl}/rest/api/latest/search`, {
                headers,
                params
            });
            if (Array.isArray(data?.issues)) issues.push(...data.issues);
            if (options.collectNames && data?.names) {
                Object.assign(names, data.names);
            }
            const total = data?.total ?? issues.length;
            startAt += data?.maxResults ?? maxResults;
            if (startAt >= total) break;
        }

        if (options.returnMeta) {
            return { issues, names };
        }

        return issues;
    }

    function pickNumber(...values) {
        for (const val of values) {
            if (val == null) continue;
            const num = Number(val);
            if (Number.isFinite(num)) return num;
        }
        return null;
    }

    function secsToHours(secs) {
        if (!Number.isFinite(secs)) return 0;
        return +(secs / 3600).toFixed(2);
    }

    function extractTimeTracking(issue) {
        const fields = issue?.fields ?? {};
        const tt = fields.timetracking ?? {};

        let originalSeconds = pickNumber(
            tt.originalEstimateSeconds,
            fields.timeoriginalestimate,
            fields.aggregatetimeoriginalestimate
        );
        const spentSeconds = pickNumber(
            tt.timeSpentSeconds,
            fields.timespent,
            fields.aggregatetimespent
        );
        let remainingSeconds = pickNumber(
            tt.remainingEstimateSeconds,
            fields.timeestimate,
            fields.aggregatetimeestimate
        );

        if (remainingSeconds == null && originalSeconds != null && spentSeconds != null) {
            remainingSeconds = Math.max(0, originalSeconds - spentSeconds);
        }

        if (originalSeconds == null && spentSeconds != null && remainingSeconds != null) {
            originalSeconds = spentSeconds + remainingSeconds;
        }

        return {
            originalSeconds: originalSeconds ?? 0,
            spentSeconds: spentSeconds ?? 0,
            remainingSeconds: remainingSeconds ?? 0
        };
    }

    function parseSprintName(value) {
        if (!value) return null;
        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (!trimmed) return null;
            const match = trimmed.match(/name=([^,\]]+)/i);
            return (match ? match[1] : trimmed).trim() || null;
        }

        if (typeof value === 'object') {
            if (typeof value.name === 'string' && value.name.trim()) {
                return value.name.trim();
            }
            const str = String(value);
            if (str && str !== '[object Object]') {
                const match = str.match(/name=([^,\]]+)/i);
                if (match && match[1].trim()) {
                    return match[1].trim();
                }
            }
        }

        return null;
    }

    function extractSprintNames(issue) {
        const fields = issue?.fields ?? {};
        const candidates = [
            fields.customfield_10020,
            fields.customfield_10016,
            fields.customfield_10007,
            fields.sprint,
            fields.sprints
        ];

        const names = new Set();
        for (const candidate of candidates) {
            if (!candidate) continue;
            const items = Array.isArray(candidate) ? candidate : [candidate];
            for (const item of items) {
                const name = parseSprintName(item);
                if (name) {
                    names.add(name);
                }
            }
        }

        return Array.from(names);
    }

    function findFieldKeyByName(namesMap, targetName) {
        if (!namesMap || !targetName) return null;
        const target = targetName.trim().toLowerCase();
        if (!target) return null;
        for (const [key, label] of Object.entries(namesMap)) {
            if (typeof label !== 'string') continue;
            if (label.trim().toLowerCase() === target) {
                return key;
            }
        }
        return null;
    }

    function normaliseFieldValues(raw) {
        if (raw == null) return [];
        const values = Array.isArray(raw) ? raw : [raw];
        const result = new Set();
        const push = (val) => {
            if (val == null) return;
            const str = String(val).trim();
            if (str) result.add(str);
        };
        for (const item of values) {
            if (item == null) continue;
            if (Array.isArray(item)) {
                item.forEach(push);
                continue;
            }
            if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
                push(item);
                continue;
            }
            if (typeof item === 'object') {
                const candidates = [
                    item.displayName,
                    item.value,
                    item.name,
                    item.text,
                    item.label,
                    item.title,
                    item.key
                ];
                for (const candidate of candidates) {
                    if (candidate && typeof candidate === 'string') {
                        push(candidate);
                        break;
                    }
                }
                if (item.project) {
                    const projectName = item.project.name || item.project.key;
                    if (projectName) push(projectName);
                }
                continue;
            }
            push(item);
        }
        return Array.from(result);
    }

    async function fetchAssignedIssues({ baseUrl, headers, username }) {
        const jql = `assignee = "${username}" ORDER BY updated DESC`;
        const { issues, names } = await searchIssuesPaged(baseUrl, headers, jql, '*navigable', {
            expand: 'names',
            collectNames: true,
            returnMeta: true
        });

        const fieldKeys = {
            sprint: findFieldKeyByName(names, 'Sprint'),
            board: findFieldKeyByName(names, 'Board') || findFieldKeyByName(names, 'Ports'),
            projects: findFieldKeyByName(names, 'Projects')
        };

        const collected = [];
        let estimateTotal = 0;
        let loggedTotal = 0;
        let remainingTotal = 0;

        for (const issue of issues) {
            const fields = issue?.fields ?? {};
            const times = extractTimeTracking(issue);
            const estimateHours = secsToHours(times.originalSeconds);
            const loggedHours = secsToHours(times.spentSeconds);
            const remainingHours = secsToHours(times.remainingSeconds);

            estimateTotal += estimateHours;
            loggedTotal += loggedHours;
            remainingTotal += remainingHours;

            const updatedRaw = fields.updated || issue?.fields?.updated || issue?.updated;
            const updatedMoment = updatedRaw ? moment(updatedRaw) : null;
            const updatedGregorian = updatedMoment?.isValid() ? updatedMoment.format('YYYY-MM-DD HH:mm') : (updatedRaw || '');
            const updatedJalaali = updatedMoment?.isValid() ? updatedMoment.format('jYYYY/jMM/jDD HH:mm') : (updatedRaw || '');
            const updatedSort = updatedMoment?.isValid() ? updatedMoment.valueOf() : 0;

            const dueRaw = fields.duedate || issue?.fields?.duedate || null;
            let dueGregorian = '';
            let dueJalaali = '';
            if (dueRaw) {
                const dueMoment = moment(dueRaw, 'YYYY-MM-DD', true);
                if (dueMoment.isValid()) {
                    dueGregorian = dueMoment.format('YYYY-MM-DD');
                    dueJalaali = dueMoment.format('jYYYY/jMM/jDD');
                } else {
                    dueGregorian = dueRaw;
                    dueJalaali = dueRaw;
                }
            }

            const sprintValues = (() => {
                const explicitSprints = fieldKeys.sprint ? normaliseFieldValues(fields[fieldKeys.sprint]) : [];
                if (explicitSprints.length) return explicitSprints;
                return extractSprintNames(issue);
            })();
            const boardValues = (() => {
                const customBoards = fieldKeys.board ? normaliseFieldValues(fields[fieldKeys.board]) : [];
                if (customBoards.length) return customBoards;
                return normaliseFieldValues(fields.components);
            })();
            const projectValues = (() => {
                const customProjects = fieldKeys.projects ? normaliseFieldValues(fields[fieldKeys.projects]) : [];
                if (customProjects.length) return customProjects;
                if (fields.project) {
                    return normaliseFieldValues([fields.project.name || fields.project.key].filter(Boolean));
                }
                return [];
            })();

            collected.push({
                issueKey: issue.key,
                summary: fields.summary || '',
                issueType: fields.issuetype?.name || null,
                status: fields.status?.name || null,
                updated: updatedRaw || null,
                updatedGregorian,
                updatedJalaali,
                dueDate: dueRaw,
                dueDateGregorian: dueGregorian || null,
                dueDateJalaali: dueJalaali || null,
                sprints: sprintValues,
                boards: boardValues,
                projects: projectValues,
                estimateHours,
                loggedHours,
                remainingHours,
                sortKey: updatedSort
            });
        }

        collected.sort((a, b) => (b.sortKey ?? 0) - (a.sortKey ?? 0));
        collected.forEach((item) => delete item.sortKey);

        return {
            ok: true,
            issues: collected,
            totals: {
                estimate: +estimateTotal.toFixed(2),
                logged: +loggedTotal.toFixed(2),
                remaining: +remainingTotal.toFixed(2)
            },
            fieldKeys
        };
    }

    async function fetchIssuesDueThisMonth({ baseUrl, headers, username, start, end }) {
        function normalizeYMD(value) {
            if (!value) return null;
            if (moment.isMoment(value)) {
                return value.clone().format('YYYY-MM-DD');
            }
            if (typeof value === 'string' && value.trim()) {
                const strict = moment(value, 'YYYY-MM-DD', true);
                if (strict.isValid()) return strict.format('YYYY-MM-DD');
                const loose = moment(value);
                if (loose.isValid()) return loose.format('YYYY-MM-DD');
            }
            return null;
        }

        let startYMD = normalizeYMD(start);
        let endYMD = normalizeYMD(end);

        if (!startYMD || !endYMD) {
            const now = mtNow();
            startYMD = now.clone().startOf('jMonth').format('YYYY-MM-DD');
            endYMD = now.clone().endOf('jMonth').format('YYYY-MM-DD');
        }

        const jql = `assignee = "${username}" AND duedate >= "${startYMD}" AND duedate <= "${endYMD}" ORDER BY duedate`;
        const fields = [
            'key',
            'summary',
            'duedate',
            'status',
            'issuetype',
            'timeoriginalestimate',
            'timeestimate',
            'timespent',
            'aggregatetimeestimate',
            'aggregatetimespent',
            'aggregatetimeoriginalestimate',
            'timetracking',
            'customfield_10020',
            'customfield_10016',
            'customfield_10007',
            'sprint',
            'sprints'
        ].join(',');

        const issues = await searchIssuesPaged(baseUrl, headers, jql, fields);

        return issues
            .map((issue) => {
                const dueDate = issue?.fields?.duedate;
                if (!dueDate) return null;

                const times = extractTimeTracking(issue);
                const dueMoment = moment(dueDate, 'YYYY-MM-DD', true);
                const dueDateGregorian = dueMoment.isValid() ? dueMoment.format('YYYY-MM-DD') : dueDate;
                const dueDateJalaali = dueMoment.isValid() ? dueMoment.format('jYYYY/jMM/jDD') : dueDate;

                return {
                    issueKey: issue.key,
                    issueType: issue?.fields?.issuetype?.name || null,
                    summary: issue?.fields?.summary || '',
                    dueDate,
                    dueDateGregorian,
                    dueDateJalaali,
                    status: issue?.fields?.status?.name || null,
                    estimateHours: secsToHours(times.originalSeconds),
                    loggedHours: secsToHours(times.spentSeconds),
                    remainingHours: secsToHours(times.remainingSeconds),
                    sprints: extractSprintNames(issue)
                };
            })
            .filter(Boolean)
            .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
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

    async function buildMonthlyReport({ baseUrl, headers, username, jYear, jMonth, nowG, includeDetails = true }) {
        const { start, end } = jMonthRange(jYear, jMonth);
        if (!start || !end) {
            return { ok: false, reason: 'Failed to construct selected Jalaali month range.' };
        }

        const fromYMD = start.format('YYYY-MM-DD');
        const toYMD = end.format('YYYY-MM-DD');
        const jql = `worklogAuthor = "${username}" AND worklogDate >= "${fromYMD}" AND worklogDate <= "${toYMD}"`;

        const issues = await searchIssuesPaged(baseUrl, headers, jql);

        const seenWorklogKeys = new Set();
        const worklogs = [];
        const dailyTotalsMap = {};
        let totalWorklogs = 0;
        let totalLoggedHours = 0;

        for (const issue of issues) {
            const initial = issue?.fields?.worklog ?? {};
            const fullWls = await getFullIssueWorklogs(baseUrl, headers, issue.key, initial);
            for (const log of fullWls) {
                if (!authorMatches(log.author, username)) continue;

                const key = worklogKey(issue.key, log);
                if (seenWorklogKeys.has(key)) continue;
                seenWorklogKeys.add(key);

                const startedRaw = typeof log.started === 'string' ? log.started : '';
                const date = startedRaw.split('T')[0];
                if (!date) continue;

                const dateMoment = moment(date, 'YYYY-MM-DD', true);
                if (!dateMoment.isValid()) continue;
                if (dateMoment.isBefore(start, 'day') || dateMoment.isAfter(end, 'day')) continue;

                const hoursRaw = log.timeSpentSeconds ?? log.timeSpentInSeconds ?? 0;
                const hours = Number.isFinite(hoursRaw) ? hoursRaw / 3600 : 0;

                totalWorklogs += 1;
                totalLoggedHours += hours;
                dailyTotalsMap[date] = (dailyTotalsMap[date] || 0) + hours;

                if (includeDetails) {
                    worklogs.push({
                        worklogId: log.id || null,
                        issueKey: issue.key,
                        issueType: issue?.fields?.issuetype?.name || null,
                        summary: issue?.fields?.summary,
                        date,
                        persianDate: dateMoment.format('jYYYY/jMM/jDD'),
                        timeSpent: log.timeSpent,
                        hours: +(hours).toFixed(2),
                        comment: log.comment || '',
                        dueDate: issue?.fields?.duedate || null,
                        status: issue?.fields?.status?.name || null
                    });
                }
            }
        }

        let dueIssuesCurrentMonth = [];
        let assignedIssuesReport = null;

        if (includeDetails) {
            worklogs.sort((a, b) => moment(a.date, 'YYYY-MM-DD').diff(moment(b.date, 'YYYY-MM-DD')));
            try {
                dueIssuesCurrentMonth = await fetchIssuesDueThisMonth({
                    baseUrl,
                    headers,
                    username,
                    start: fromYMD,
                    end: toYMD
                });
            } catch (err) {
                console.error('Failed to fetch due issues for selected month:', err);
                dueIssuesCurrentMonth = [];
            }
            try {
                assignedIssuesReport = await fetchAssignedIssues({
                    baseUrl,
                    headers,
                    username
                });
            } catch (err) {
                console.error('Failed to fetch assigned issues for user:', err);
                assignedIssuesReport = {
                    ok: false,
                    reason: 'Unable to load issues.'
                };
            }
        }

        const dailySummary = Object.entries(dailyTotalsMap)
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([date, hours]) => ({ date, hours: (+hours).toFixed(2) }));

        const holidayDays = buildHolidaysSetFromStatic(jYear, jMonth);
        const daysInMonth = mj(jYear, jMonth, 1).endOf('jMonth').jDate();
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

        const totalHours = +days.reduce((sum, d) => sum + d.hours, 0).toFixed(2);
        const workdaysAll = days.filter(d => d.isWorkday).length;
        const workdaysUntilNow = days.filter(d => d.isWorkday && !d.isFuture).length;
        const expectedByNowHours = 6 * workdaysUntilNow;
        const expectedByEndMonthHours = 6 * workdaysAll;

        const result = {
            ok: true,
            jYear,
            jMonth,
            jMonthLabel: mj(jYear, jMonth, 1).format('jYYYY/jMM'),
            jql,
            totalHours,
            expectedByNowHours,
            expectedByEndMonthHours,
            summary: {
                totalWorklogs,
                totalHours: (+totalLoggedHours).toFixed(2),
                dailySummary
            }
        };

        if (includeDetails) {
            const deficits = days.filter(d => d.isWorkday && !d.isFuture && d.hours < 6);
            result.days = days;
            result.deficits = deficits;
            result.worklogs = worklogs;
            result.dueIssuesCurrentMonth = dueIssuesCurrentMonth;
            result.assignedIssuesReport = assignedIssuesReport;
        }

        result.baseUrl = baseUrl;

        return result;
    }

    const SEASONS = [
        { id: 'spring', label: 'Spring', months: [1, 2, 3] },
        { id: 'summer', label: 'Summer', months: [4, 5, 6] },
        { id: 'autumn', label: 'Autumn', months: [7, 8, 9] },
        { id: 'winter', label: 'Winter', months: [10, 11, 12] }
    ];

    async function buildQuarterReport({ baseUrl, headers, username, jYear, nowG, monthCache }) {
        const seasons = [];

        for (const season of SEASONS) {
            const months = [];
            let quarterTotal = 0;
            let quarterExpected = 0;

            for (const jMonth of season.months) {
                const cacheKey = `${jYear}-${jMonth}`;
                let monthData = monthCache.get(cacheKey);
                if (!monthData) {
                    monthData = await buildMonthlyReport({
                        baseUrl,
                        headers,
                        username,
                        jYear,
                        jMonth,
                        nowG,
                        includeDetails: false
                    });
                    monthCache.set(cacheKey, monthData);
                }

                if (!monthData?.ok) {
                    months.push({
                        ok: false,
                        jYear,
                        jMonth,
                        label: mj(jYear, jMonth, 1).format('jMMMM'),
                        totalHours: 0,
                        expectedHours: 0,
                        delta: 0,
                        reason: monthData?.reason || 'No data'
                    });
                    continue;
                }

                const totalHours = +(monthData.totalHours ?? 0);
                const expectedHours = +(monthData.expectedByEndMonthHours ?? 0);
                quarterTotal += totalHours;
                quarterExpected += expectedHours;

                months.push({
                    ok: true,
                    jYear,
                    jMonth,
                    label: monthData.jMonthLabel,
                    totalHours,
                    expectedHours,
                    delta: +(totalHours - expectedHours).toFixed(2)
                });
            }

            const totalsRounded = {
                totalHours: +quarterTotal.toFixed(2),
                expectedHours: +quarterExpected.toFixed(2)
            };
            totalsRounded.delta = +(totalsRounded.totalHours - totalsRounded.expectedHours).toFixed(2);

            seasons.push({
                id: season.id,
                label: `${season.label} ${jYear}`,
                months,
                totals: totalsRounded
            });
        }

        return { ok: true, jYear, seasons };
    }

    async function computeScan(opts) {
        const baseUrl = (STORE.get('jiraBaseUrl', '') || '').trim().replace(/\/+$/, '');
        const token = await keytar.getPassword(SERVICE_NAME, TOKEN_ACCOUNT);
        const username = (opts && opts.username) || lastUI.username;

        if (!baseUrl || !token) return { ok: false, reason: 'Missing Jira base URL or token.' };
        if (!username) return { ok: false, reason: 'No Jira username selected in UI.' };

        const { jYear, jMonth } = resolveTargetMonth(opts);
        const nowG = mtNow();
        const headers = buildHeaders(baseUrl, token);

        const monthCache = new Map();
        const monthResult = await buildMonthlyReport({
            baseUrl,
            headers,
            username,
            jYear,
            jMonth,
            nowG,
            includeDetails: true
        });

        if (!monthResult?.ok) {
            return monthResult;
        }

        monthCache.set(`${jYear}-${jMonth}`, monthResult);
        const quarterReport = await buildQuarterReport({
            baseUrl,
            headers,
            username,
            jYear,
            nowG,
            monthCache
        });

        return { ...monthResult, quarterReport };
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

    function sanitizeExternalUrl(url) {
        if (!url || typeof url !== 'string') return null;
        const trimmed = url.trim();
        if (!trimmed) return null;
        try {
            const parsed = new URL(trimmed);
            if (!/^https?:$/i.test(parsed.protocol)) return null;
            return parsed.toString();
        } catch (err) {
            return null;
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

    ipcMain.handle('views:load', async (_evt, relPath) => {
        if (typeof relPath !== 'string') {
            throw new Error('Invalid view path');
        }
        const normalized = path.normalize(relPath);
        const baseDir = path.join(__dirname, 'renderer');
        const resolved = path.resolve(baseDir, normalized);
        if (path.relative(baseDir, resolved).startsWith('..')) {
            throw new Error('Invalid view path');
        }
        return fs.readFile(resolved, 'utf8');
    });

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

    ipcMain.handle('app:open-external', async (_evt, payload) => {
        const rawUrl = typeof payload === 'string' ? payload : payload?.url;
        const safeUrl = sanitizeExternalUrl(rawUrl);
        if (!safeUrl) {
            return { ok: false, reason: 'Invalid URL' };
        }

        try {
            await shell.openExternal(safeUrl);
            return { ok: true };
        } catch (err) {
            console.error('Failed to open external URL', err);
            return { ok: false, reason: err?.message || 'Unable to open URL' };
        }
    });

    ipcMain.handle('scan:now', (_evt, opts) => computeScan(opts || {}));
})();
