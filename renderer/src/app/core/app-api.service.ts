import { Injectable, effect, inject, signal } from '@angular/core';
import { APP_API } from './app-api.token';
import { AppApi, ScanOptions, ScanResult } from './app-api.types';

@Injectable({ providedIn: 'root' })
export class AppApiService {
  private readonly api = inject<AppApi>(APP_API);
  private readonly lastResult = signal<ScanResult | null>(null);
  private readonly selection = signal<ScanOptions | null>(null);
  private readonly busy = signal(false);
  private readonly error = signal<string | null>(null);

  readonly result = this.lastResult.asReadonly();
  readonly selectionSignal = this.selection.asReadonly();
  readonly busySignal = this.busy.asReadonly();
  readonly errorSignal = this.error.asReadonly();

  constructor() {
    effect((onCleanup) => {
      this.api.onScanResult((data) => this.lastResult.set(data));
      onCleanup(() => void 0);
    });
  }

  async ensureBootstrapSelection(): Promise<void> {
    if (this.selection()) {
      return;
    }
    const settings = await this.api.getSettings().catch(() => ({} as Record<string, unknown>));
    const jYear = Number(settings['defaultJYear']) || new Date().getFullYear();
    const jMonth = Number(settings['defaultJMonth']) || new Date().getMonth() + 1;
    const username = typeof settings['username'] === 'string' ? settings['username'].trim() : '';
    if (username) {
      this.selection.set({ jYear, jMonth, username });
    } else {
      this.selection.set({ jYear, jMonth, username: '' });
    }
  }

  async runScan(request: ScanOptions): Promise<ScanResult | null> {
    this.busy.set(true);
    this.error.set(null);
    try {
      this.selection.set(request);
      await this.api.updateSelection(request);
      const result = await this.api.scanNow(request);
      this.lastResult.set(result);
      return result;
    } catch (err) {
      console.error('Failed to trigger scan', err);
      this.error.set(err instanceof Error ? err.message : 'خطا در دریافت اطلاعات');
      return null;
    } finally {
      this.busy.set(false);
    }
  }

  async authorize(token: string): Promise<boolean> {
    try {
      await this.api.authorize(token);
      return true;
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'ورود ناموفق بود');
      return false;
    }
  }

  async logout(): Promise<void> {
    await this.api.logout().catch((err) => console.error(err));
  }

  async exportFullReport(payload: Record<string, unknown>): Promise<void> {
    await this.api.exportFullReport(payload);
  }
}
