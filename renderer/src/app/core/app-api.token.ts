import { InjectionToken, Provider } from '@angular/core';
import { AppApi } from './app-api.types';

export const APP_API = new InjectionToken<AppApi>('APP_API');

function createNoopApi(): AppApi {
  const notReady = () => Promise.reject(new Error('appApi bridge is not ready'));
  return {
    getSettings: notReady,
    saveSettings: notReady,
    scanNow: notReady,
    updateSelection: notReady,
    loadViewTemplate: notReady,
    onScanResult: () => void 0,
    hasToken: notReady,
    authorize: notReady,
    logout: notReady,
    whoami: notReady,
    openExternal: notReady,
    exportFullReport: notReady,
    getActiveSprintIssues: notReady,
    createWorklog: notReady,
    fetchWorklogsRange: notReady,
  };
}

export function provideAppApi(): Provider {
  return {
    provide: APP_API,
    useFactory: (): AppApi => {
      const api = (window as typeof window & { appApi?: AppApi }).appApi;
      if (!api) {
        console.warn('Electron preload bridge was not found. Falling back to no-op implementation.');
        return createNoopApi();
      }
      return api;
    },
  };
}
