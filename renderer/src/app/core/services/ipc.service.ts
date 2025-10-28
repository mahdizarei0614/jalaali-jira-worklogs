import { Injectable, Signal, signal } from '@angular/core';

type AppApi = typeof window & {
  appApi?: {
    getSettings: () => Promise<unknown>;
    saveSettings: (payload: unknown) => Promise<unknown>;
    scanNow: (payload: unknown) => Promise<unknown>;
    updateSelection: (payload: unknown) => Promise<void>;
    loadViewTemplate: (relPath: string) => Promise<string>;
    onScanResult: (cb: (data: unknown) => void) => void;
    hasToken: () => Promise<boolean>;
    authorize: (token: string) => Promise<unknown>;
    logout: () => Promise<void>;
    whoami: () => Promise<unknown>;
    openExternal: (url: string) => Promise<void>;
    exportFullReport: (payload: unknown) => Promise<unknown>;
    getActiveSprintIssues: (payload: unknown) => Promise<unknown>;
    createWorklog: (payload: unknown) => Promise<unknown>;
    fetchWorklogsRange: (payload: unknown) => Promise<unknown>;
  };
};

@Injectable({ providedIn: 'root' })
export class IpcService {
  private readonly bridge: AppApi['appApi'] | undefined = (window as AppApi).appApi;
  readonly available: Signal<boolean> = signal(Boolean(this.bridge));

  invoke<T>(key: keyof NonNullable<AppApi['appApi']>, payload?: unknown): Promise<T> {
    if (!this.bridge) {
      return Promise.reject(new Error('IPC bridge is not available in the current context.'));
    }
    const handler = this.bridge[key] as ((arg?: unknown) => Promise<T>) | undefined;
    if (!handler) {
      return Promise.reject(new Error(`IPC handler "${String(key)}" is not exposed by preload.`));
    }
    return handler(payload as never);
  }

  onScanResult(callback: (data: unknown) => void) {
    if (!this.bridge?.onScanResult) {
      return;
    }
    this.bridge.onScanResult(callback);
  }
}
