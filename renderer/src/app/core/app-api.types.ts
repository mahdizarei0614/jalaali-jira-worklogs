export interface ScanOptions {
  jYear: number;
  jMonth: number;
  username: string;
}

export interface ScanResult {
  ok: boolean;
  reason?: string;
  totalHours?: number;
  summary?: {
    totalHours: string;
    deficitHours: string;
  };
  days?: Array<{
    date: string;
    totalHours: number;
    classification: string;
  }>;
  seasons?: Array<{
    label: string;
    totalHours: number | string;
    months: Array<{ label: string; totalHours: number | string }>;
  }>;
}

export interface AppApi {
  getSettings(): Promise<Record<string, unknown>>;
  saveSettings(payload: Record<string, unknown>): Promise<void>;
  scanNow(options: ScanOptions): Promise<ScanResult>;
  updateSelection(payload: Partial<ScanOptions>): Promise<void>;
  loadViewTemplate(relPath: string): Promise<string>;
  onScanResult(cb: (data: ScanResult) => void): void;
  hasToken(): Promise<boolean>;
  authorize(token: string): Promise<void>;
  logout(): Promise<void>;
  whoami(): Promise<{ displayName?: string } | null>;
  openExternal(url: string): Promise<void>;
  exportFullReport(payload: Record<string, unknown>): Promise<void>;
  getActiveSprintIssues(payload: Record<string, unknown>): Promise<unknown>;
  createWorklog(payload: Record<string, unknown>): Promise<unknown>;
  fetchWorklogsRange(payload: Record<string, unknown>): Promise<unknown>;
}
