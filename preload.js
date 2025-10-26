const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('appApi', {
    // settings / scan
    getSettings: () => ipcRenderer.invoke('settings:get'),
    saveSettings: (payload) => ipcRenderer.invoke('settings:save', payload),
    scanNow: (opts) => ipcRenderer.invoke('scan:now', opts),
    calendarWorklogs: (payload) => ipcRenderer.invoke('calendar:worklogs', payload),
    updateSelection: (payload) => ipcRenderer.invoke('ui:update-selection', payload),
    loadViewTemplate: (relPath) => ipcRenderer.invoke('views:load', relPath),
    onScanResult: (cb) => ipcRenderer.on('scan-result', (_e, data) => cb(data)),
    // auth
    hasToken: () => ipcRenderer.invoke('auth:has'),
    authorize: (token) => ipcRenderer.invoke('auth:authorize', { token }),
    logout: () => ipcRenderer.invoke('auth:logout'),
    whoami: () => ipcRenderer.invoke('auth:whoami'),
    openExternal: (url) => ipcRenderer.invoke('app:open-external', { url }),
    exportFullReport: (payload) => ipcRenderer.invoke('reports:full-export', payload),
    getActiveSprintIssues: (payload) => ipcRenderer.invoke('jira:active-sprint-issues', payload),
    createWorklog: (payload) => ipcRenderer.invoke('jira:create-worklog', payload),
});
