(async () => {
    const Store = (await import('electron-store')).default;

    const { app, BrowserWindow, ipcMain, Notification, Tray, Menu, nativeImage, shell, dialog } = require('electron');
    const path = require('path');
    const fs = require('fs/promises');
    const axios = require('axios');
    const keytar = require('keytar');
    const cron = require('node-cron');
    const JSZip = require('jszip');
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
    const PROJECT_BOARD_CACHE = new Map();

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

    async function getJiraAuthContext() {
        const baseUrl = (STORE.get('jiraBaseUrl', '') || '').trim().replace(/\/+$/, '');
        const token = await keytar.getPassword(SERVICE_NAME, TOKEN_ACCOUNT);
        if (!baseUrl || !token) {
            return { ok: false, reason: 'Missing Jira base URL or token.' };
        }
        const headers = buildHeaders(baseUrl, token);
        return { ok: true, baseUrl, token, headers };
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

    async function searchIssuesPaged(baseUrl, headers, jql, fields = DEFAULT_SEARCH_FIELDS) {
        const issues = [];
        let startAt = 0;
        const maxResults = 100;
        while (true) {
            const { data } = await axios.get(`${baseUrl}/rest/api/latest/search`, {
                headers,
                params: { jql, startAt, maxResults, fields }
            });
            if (Array.isArray(data?.issues)) issues.push(...data.issues);
            const total = data?.total ?? issues.length;
            startAt += data?.maxResults ?? maxResults;
            if (startAt >= total) break;
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

    async function fetchBoardsForProject({ baseUrl, headers, projectKey }) {
        if (!baseUrl || !projectKey) return [];
        const cacheKey = `${baseUrl}::${projectKey}`;
        const cached = PROJECT_BOARD_CACHE.get(cacheKey);
        if (Array.isArray(cached)) {
            return cached;
        }
        if (cached && typeof cached.then === 'function') {
            try {
                return await cached;
            } catch (err) {
                return [];
            }
        }

        const promise = (async () => {
            try {
                const names = [];
                let startAt = 0;
                const maxResults = 50;
                while (true) {
                    const { data } = await axios.get(`${baseUrl}/rest/agile/1.0/board`, {
                        headers,
                        params: { projectKeyOrId: projectKey, startAt, maxResults }
                    });
                    const values = Array.isArray(data?.values) ? data.values : [];
                    for (const board of values) {
                        const name = typeof board?.name === 'string' ? board.name.trim() : '';
                        if (name) names.push(name);
                    }
                    const total = Number.isFinite(data?.total) ? data.total : null;
                    startAt += values.length;
                    if (values.length === 0) {
                        break;
                    }
                    if (total != null && startAt >= total) {
                        break;
                    }
                    if (total == null && values.length < maxResults) {
                        break;
                    }
                }
                const unique = Array.from(new Set(names));
                PROJECT_BOARD_CACHE.set(cacheKey, unique);
                return unique;
            } catch (err) {
                const reason = err?.response?.status
                    ? `${err.response.status} ${err.response.statusText}`
                    : (err?.message || err);
                console.error(`Failed to fetch boards for project ${projectKey}:`, reason);
                PROJECT_BOARD_CACHE.set(cacheKey, []);
                return [];
            }
        })();

        PROJECT_BOARD_CACHE.set(cacheKey, promise);

        const result = await promise;
        if (Array.isArray(result)) {
            return result;
        }
        return [];
    }

    async function fetchAssignedIssues({ baseUrl, headers, username }) {
        if (!baseUrl || !username) return [];

        const fields = [
            'key',
            'summary',
            'duedate',
            'status',
            'issuetype',
            'project',
            'updated',
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

        const jql = `assignee = "${username}" ORDER BY updated DESC`;
        const issues = await searchIssuesPaged(baseUrl, headers, jql, fields);

        const projectKeys = new Set();
        for (const issue of issues) {
            const key = issue?.fields?.project?.key;
            if (key) projectKeys.add(key);
        }

        const boardMap = new Map();
        await Promise.all(Array.from(projectKeys).map(async (projectKey) => {
            const names = await fetchBoardsForProject({ baseUrl, headers, projectKey });
            boardMap.set(projectKey, names);
        }));

        const normalized = issues.map((issue) => {
            const fields = issue?.fields ?? {};
            const times = extractTimeTracking(issue);
            const projectKey = fields.project?.key || null;
            const projectName = fields.project?.name || null;
            const dueDate = fields.duedate || null;
            let dueDateGregorian = dueDate;
            let dueDateJalaali = dueDate;
            if (dueDate) {
                const dueMoment = moment(dueDate, 'YYYY-MM-DD', true);
                if (dueMoment.isValid()) {
                    dueDateGregorian = dueMoment.format('YYYY-MM-DD');
                    dueDateJalaali = dueMoment.format('jYYYY/jMM/jDD');
                }
            }

            const updatedRaw = fields.updated || null;
            let updatedGregorian = updatedRaw;
            let updatedJalaali = updatedRaw;
            let updatedMs = Number.NEGATIVE_INFINITY;
            if (updatedRaw) {
                const updatedMoment = moment(updatedRaw);
                if (updatedMoment.isValid()) {
                    const localized = updatedMoment.clone().utcOffset(TEHRAN_OFFSET_MIN);
                    updatedGregorian = localized.format('YYYY-MM-DD HH:mm');
                    updatedJalaali = localized.format('jYYYY/jMM/jDD HH:mm');
                    updatedMs = localized.valueOf();
                }
            }

            return {
                issueKey: issue?.key || null,
                issueType: fields.issuetype?.name || null,
                summary: fields.summary || '',
                dueDate,
                dueDateGregorian,
                dueDateJalaali,
                status: fields.status?.name || null,
                estimateHours: secsToHours(times.originalSeconds),
                loggedHours: secsToHours(times.spentSeconds),
                remainingHours: secsToHours(times.remainingSeconds),
                sprints: extractSprintNames(issue),
                projectKey,
                projectName,
                boardNames: boardMap.get(projectKey) || [],
                updated: updatedRaw,
                updatedGregorian,
                updatedJalaali,
                updatedMs
            };
        }).filter((entry) => entry.issueKey);

        normalized.sort((a, b) => {
            const aMs = Number.isFinite(a.updatedMs) ? a.updatedMs : Number.NEGATIVE_INFINITY;
            const bMs = Number.isFinite(b.updatedMs) ? b.updatedMs : Number.NEGATIVE_INFINITY;
            return bMs - aMs;
        });

        return normalized.map(({ updatedMs, ...rest }) => rest);
    }

    async function fetchActiveSprintIssues({ baseUrl, headers, username }) {
        if (!baseUrl || !username) {
            return [];
        }
        const jql = `assignee = "${username}" AND sprint in openSprints() ORDER BY updated DESC`;
        const fields = [
            'key',
            'summary',
            'status',
            'timetracking',
            'timeoriginalestimate',
            'timeestimate',
            'timespent',
            'aggregatetimeestimate',
            'aggregatetimespent',
            'aggregatetimeoriginalestimate',
            'project'
        ].join(',');

        const issues = await searchIssuesPaged(baseUrl, headers, jql, fields);

        return issues
            .map((issue) => {
                const key = issue?.key || '';
                if (!key) return null;
                const fieldsData = issue?.fields ?? {};
                const times = extractTimeTracking(issue);
                return {
                    issueKey: key,
                    summary: fieldsData.summary || '',
                    status: fieldsData.status?.name || null,
                    estimateHours: secsToHours(times.originalSeconds),
                    loggedHours: secsToHours(times.spentSeconds),
                    remainingHours: secsToHours(times.remainingSeconds),
                    projectKey: fieldsData.project?.key || null,
                    projectName: fieldsData.project?.name || null
                };
            })
            .filter(Boolean);
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

    function formatWorklogStarted(start) {
        if (!start) return null;
        const m = moment(start);
        if (!m.isValid()) return null;
        return m.format('YYYY-MM-DDTHH:mm:ss.SSSZZ');
    }

    function buildWorklogCommentDoc(text) {
        const raw = (text ?? '').toString();
        if (!raw.trim()) {
            return {
                type: 'doc',
                version: 1,
                content: [{ type: 'paragraph', content: [] }]
            };
        }
        const lines = raw.split(/\r?\n/);
        const content = [];
        lines.forEach((line, idx) => {
            const trimmed = line.replace(/\s+$/g, '');
            if (trimmed) {
                content.push({ type: 'text', text: trimmed });
            }
            if (idx < lines.length - 1) {
                content.push({ type: 'hardBreak' });
            }
        });
        if (!content.length) {
            content.push({ type: 'text', text: raw.trim() });
        }
        return {
            type: 'doc',
            version: 1,
            content: [{ type: 'paragraph', content }]
        };
    }

    function shouldUseAdfComments(baseUrl) {
        if (!baseUrl) return false;
        try {
            const { hostname } = new URL(baseUrl);
            const host = hostname.toLowerCase();
            return (
                host.endsWith('.atlassian.net') ||
                host.endsWith('.jira.com') ||
                host.endsWith('.jira-dev.com')
            );
        } catch (err) {
            return false;
        }
    }

    function buildWorklogFailureLog(issueKey, attempts) {
        const lastAttempt = attempts?.length ? attempts[attempts.length - 1] : null;
        const log = {
            success: false,
            issueKey,
            attempts: Array.isArray(attempts) ? attempts : []
        };
        if (lastAttempt?.request) {
            log.request = lastAttempt.request;
        }
        if (lastAttempt?.response) {
            log.response = lastAttempt.response;
        }
        return log;
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
                const startedMoment = startedRaw ? moment(startedRaw) : null;
                const startedTime = startedMoment?.isValid() ? startedMoment.format('HH:mm') : null;

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
                        started: startedRaw || null,
                        startedTime,
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
        let assignedIssues = [];

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
                assignedIssues = await fetchAssignedIssues({
                    baseUrl,
                    headers,
                    username
                });
            } catch (err) {
                console.error('Failed to fetch assigned issues:', err);
                assignedIssues = [];
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
            result.assignedIssues = assignedIssues;
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

    async function fetchWorklogsRange(opts = {}) {
        const username = (opts?.username || '').trim();
        if (!username) {
            return { ok: false, reason: 'No Jira username provided.' };
        }

        const rawStart = opts?.start ?? opts?.from ?? opts?.rangeStart ?? null;
        const rawEnd = opts?.end ?? opts?.to ?? opts?.rangeEnd ?? null;
        if (!rawStart || !rawEnd) {
            return { ok: false, reason: 'Missing start or end of range.' };
        }

        const startMoment = moment(rawStart);
        const endMomentExclusive = moment(rawEnd);
        if (!startMoment.isValid() || !endMomentExclusive.isValid()) {
            return { ok: false, reason: 'Invalid range provided.' };
        }

        const startDay = startMoment.clone().startOf('day');
        let endDay = endMomentExclusive.clone().subtract(1, 'millisecond').endOf('day');
        if (!endDay.isValid() || endDay.isBefore(startDay)) {
            endDay = startDay.clone().endOf('day');
        }

        const auth = await getJiraAuthContext();
        if (!auth.ok) {
            return auth;
        }

        const fromYMD = startDay.format('YYYY-MM-DD');
        const toYMD = endDay.format('YYYY-MM-DD');
        const jql = `worklogAuthor = "${username}" AND worklogDate >= "${fromYMD}" AND worklogDate <= "${toYMD}"`;

        let issues;
        try {
            issues = await searchIssuesPaged(auth.baseUrl, auth.headers, jql);
        } catch (err) {
            console.error('Failed to search issues for worklog range', err);
            return { ok: false, reason: err?.message || 'Unable to load worklogs.' };
        }

        const seenWorklogKeys = new Set();
        const worklogs = [];

        for (const issue of issues) {
            try {
                const initial = issue?.fields?.worklog ?? {};
                const fullWorklogs = await getFullIssueWorklogs(auth.baseUrl, auth.headers, issue.key, initial);
                for (const log of fullWorklogs) {
                    if (!authorMatches(log.author, username)) continue;

                    const key = worklogKey(issue.key, log);
                    if (seenWorklogKeys.has(key)) continue;

                    const startedRaw = typeof log.started === 'string' ? log.started : '';
                    const date = startedRaw.split('T')[0];
                    if (!date) continue;

                    const dateMoment = moment(date, 'YYYY-MM-DD', true);
                    if (!dateMoment.isValid()) continue;
                    if (dateMoment.isBefore(startDay, 'day') || dateMoment.isAfter(endDay, 'day')) continue;

                    seenWorklogKeys.add(key);

                    const hoursRaw = log.timeSpentSeconds ?? log.timeSpentInSeconds ?? 0;
                    const hours = Number.isFinite(hoursRaw) ? hoursRaw / 3600 : 0;
                    const startedMoment = startedRaw ? moment(startedRaw) : null;
                    const startedTime = startedMoment?.isValid() ? startedMoment.format('HH:mm') : null;

                    worklogs.push({
                        worklogId: log.id || null,
                        issueKey: issue.key,
                        issueType: issue?.fields?.issuetype?.name || null,
                        summary: issue?.fields?.summary,
                        date,
                        started: startedRaw || null,
                        startedTime,
                        persianDate: dateMoment.format('jYYYY/jMM/jDD'),
                        timeSpent: log.timeSpent,
                        hours: +hours.toFixed(2),
                        comment: log.comment || '',
                        dueDate: issue?.fields?.duedate || null,
                        status: issue?.fields?.status?.name || null
                    });
                }
            } catch (err) {
                console.error('Failed to load worklogs for issue', issue?.key, err);
            }
        }

        worklogs.sort((a, b) => {
            const aMoment = a.started ? moment(a.started) : moment(a.date, 'YYYY-MM-DD');
            const bMoment = b.started ? moment(b.started) : moment(b.date, 'YYYY-MM-DD');
            return aMoment.valueOf() - bMoment.valueOf();
        });

        return {
            ok: true,
            username,
            range: { from: fromYMD, to: toYMD },
            baseUrl: auth.baseUrl,
            worklogs
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
    let rendererIndexFile = null;
    async function resolveRendererEntry() {
        if (rendererIndexFile) return rendererIndexFile;
        const distRoot = path.join(__dirname, 'renderer', 'dist');
        const candidates = [
            path.join(distRoot, 'browser', 'index.html'),
            path.join(distRoot, 'index.html'),
        ];
        for (const candidate of candidates) {
            try {
                await fs.access(candidate);
                rendererIndexFile = candidate;
                return rendererIndexFile;
            } catch (err) {
                // continue searching
            }
        }
        rendererIndexFile = path.join(__dirname, 'renderer', 'src', 'index.html');
        return rendererIndexFile;
    }
    async function loadLogin() {
        const entry = await resolveRendererEntry();
        await mainWindow.loadFile(entry, { hash: '#/auth' });
    }
    async function loadMain()  {
        const entry = await resolveRendererEntry();
        await mainWindow.loadFile(entry, { hash: '#/dashboard' });
    }

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

    function sanitizeZipSegment(name, fallback = 'item') {
        const raw = (name ?? '').toString();
        const cleaned = raw.replace(/[\0]/g, '').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_');
        const normalised = cleaned.replace(/_+/g, '_').replace(/^_+|_+$/g, '');
        return normalised || fallback;
    }

    function sanitizeZipFileName(name) {
        const segment = sanitizeZipSegment(name, 'full-report');
        return segment.toLowerCase().endsWith('.zip') ? segment : `${segment}.zip`;
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

    ipcMain.handle('jira:active-sprint-issues', async (_evt, payload) => {
        const username = (payload?.username || '').trim();
        const auth = await getJiraAuthContext();
        if (!auth.ok) {
            return auth;
        }
        const who = await whoAmI();
        if (!who?.ok) {
            return { ok: false, reason: who?.reason || 'Unable to determine current user.' };
        }
        const selfUser = (who.username || '').trim();
        if (!username || username !== selfUser) {
            return { ok: false, reason: 'You can only view active sprint issues for your own user.' };
        }
        try {
            const issues = await fetchActiveSprintIssues({ baseUrl: auth.baseUrl, headers: auth.headers, username });
            return { ok: true, issues };
        } catch (err) {
            const reason = err?.response?.status
                ? `${err.response.status} ${err.response.statusText}`
                : (err?.message || 'Failed to load active sprint issues.');
            return { ok: false, reason };
        }
    });

    ipcMain.handle('jira:create-worklog', async (_evt, payload) => {
        const issueKey = (payload?.issueKey || '').trim();
        const started = payload?.started;
        const seconds = Number(payload?.timeSpentSeconds);
        const comment = (payload?.comment || '').toString();
        const username = (payload?.username || '').trim();

        const auth = await getJiraAuthContext();
        if (!auth.ok) {
            return auth;
        }

        const who = await whoAmI();
        if (!who?.ok) {
            return { ok: false, reason: who?.reason || 'Unable to determine current user.' };
        }
        const selfUser = (who.username || '').trim();
        if (!selfUser || !username || selfUser !== username) {
            return { ok: false, reason: 'You can only add worklogs for your own user.' };
        }
        if (!issueKey) {
            return { ok: false, reason: 'Missing issue key.' };
        }
        const startedFormatted = formatWorklogStarted(started);
        if (!startedFormatted) {
            return { ok: false, reason: 'Invalid start time provided.' };
        }
        if (!Number.isFinite(seconds)) {
            return { ok: false, reason: 'Invalid worklog duration.' };
        }
        const timeSpentSeconds = Math.max(60, Math.round(seconds));
        const worklogUrl = `${auth.baseUrl}/rest/api/latest/issue/${encodeURIComponent(issueKey)}/worklog`;
        const attemptHistory = [];
        const submitWorklog = async (requestBody, label) => {
            try {
                const response = await axios.post(worklogUrl, requestBody, { headers: auth.headers });
                const data = response?.data;
                const worklogId = data?.id ?? data?.worklogId ?? null;
                const entry = {
                    label,
                    request: {
                        url: worklogUrl,
                        body: requestBody
                    },
                    response: {
                        status: response?.status,
                        statusText: response?.statusText,
                        data
                    },
                    success: worklogId != null
                };
                if (worklogId == null) {
                    attemptHistory.push(entry);
                    const err = new Error('Worklog create response missing id.');
                    err.response = response;
                    err.__worklogLogged = true;
                    throw err;
                }
                attemptHistory.push(entry);
                return { response, worklogId, body: requestBody };
            } catch (error) {
                if (!error?.__worklogLogged) {
                    attemptHistory.push({
                        label,
                        success: false,
                        request: {
                            url: worklogUrl,
                            body: requestBody
                        },
                        response: {
                            status: error?.response?.status,
                            statusText: error?.response?.statusText,
                            data: error?.response?.data,
                            message: error?.message
                        }
                    });
                    if (error && typeof error === 'object') {
                        error.__worklogLogged = true;
                    }
                }
                throw error;
            }
        };

        const rawComment = typeof comment === 'string' ? comment : '';
        const trimmedComment = rawComment.trim();
        const hasComment = !!trimmedComment;
        const baseBody = {
            started: startedFormatted,
            timeSpentSeconds
        };
        const useAdf = hasComment && shouldUseAdfComments(auth.baseUrl);
        const primaryBody = hasComment
            ? {
                ...baseBody,
                comment: useAdf ? buildWorklogCommentDoc(trimmedComment) : trimmedComment
            }
            : baseBody;

        let finalResult = null;
        try {
            finalResult = await submitWorklog(primaryBody, useAdf ? 'adf' : 'primary');
        } catch (primaryErr) {
            if (useAdf && hasComment) {
                try {
                    const fallbackBody = { ...baseBody, comment: trimmedComment };
                    finalResult = await submitWorklog(fallbackBody, 'plain-fallback');
                } catch (fallbackErr) {
                    const reason = fallbackErr?.response?.data?.errorMessages?.join(', ')
                        ?? fallbackErr?.response?.statusText
                        ?? fallbackErr?.message
                        ?? primaryErr?.message
                        ?? 'Failed to add worklog.';
                    const logPayload = buildWorklogFailureLog(issueKey, attemptHistory);
                    console.error('[jira:create-worklog] Failure', logPayload);
                    return { ok: false, reason, log: logPayload };
                }
            } else {
                const reason = primaryErr?.response?.data?.errorMessages?.join(', ')
                    ?? primaryErr?.response?.statusText
                    ?? primaryErr?.message
                    ?? 'Failed to add worklog.';
                const logPayload = buildWorklogFailureLog(issueKey, attemptHistory);
                console.error('[jira:create-worklog] Failure', logPayload);
                return { ok: false, reason, log: logPayload };
            }
        }

        const successLog = {
            success: true,
            issueKey,
            request: {
                url: worklogUrl,
                body: finalResult?.body ?? primaryBody
            },
            response: {
                status: finalResult?.response?.status,
                statusText: finalResult?.response?.statusText,
                data: finalResult?.response?.data
            },
            attempts: attemptHistory
        };
        console.log('[jira:create-worklog] Success', successLog);
        return {
            ok: true,
            worklogId: finalResult?.worklogId ?? null,
            log: successLog
        };
    });

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
        await loadMain();
        return { ok: true };
    });
    ipcMain.handle('auth:logout', async () => {
        await keytar.deletePassword(SERVICE_NAME, TOKEN_ACCOUNT);
        lastUI.username = null;
        await loadLogin();
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

    ipcMain.handle('reports:full-export', async (_evt, payload) => {
        try {
            const entries = Array.isArray(payload?.entries) ? payload.entries : [];
            if (!entries.length) {
                return { ok: false, reason: 'No data provided' };
            }

            const zip = new JSZip();
            entries.forEach((entry) => {
                const rawPath = typeof entry?.path === 'string' ? entry.path : '';
                const segments = rawPath
                    .split('/')
                    .map((segment) => sanitizeZipSegment(segment))
                    .filter(Boolean);
                if (!segments.length) {
                    return;
                }
                const zipPath = segments.join('/');
                const content = entry?.content ?? '';
                zip.file(zipPath, typeof content === 'string' ? content : Buffer.from(content));
            });

            const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
            if (!zipBuffer || !zipBuffer.length) {
                return { ok: false, reason: 'No archive data generated' };
            }

            const defaultName = sanitizeZipFileName(payload?.defaultFileName);
            const suggestedDir = (() => {
                try {
                    return app.getPath('downloads');
                } catch (err) {
                    return app.getPath('documents');
                }
            })();

            const { canceled, filePath } = await dialog.showSaveDialog(mainWindow || BrowserWindow.getFocusedWindow(), {
                title: 'Save Full Report',
                defaultPath: path.join(suggestedDir, defaultName),
                filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
            });

            if (canceled || !filePath) {
                return { ok: false, reason: 'cancelled' };
            }

            await fs.writeFile(filePath, zipBuffer);
            return { ok: true, path: filePath };
        } catch (err) {
            console.error('Failed to generate full report archive', err);
            return { ok: false, reason: err?.message || 'Unable to generate archive' };
        }
    });

    ipcMain.handle('scan:now', (_evt, opts) => computeScan(opts || {}));
    ipcMain.handle('worklogs:range', async (_evt, payload) => fetchWorklogsRange(payload || {}));
})();
