export interface TeamOption {
  value: string;
  label: string;
}

export interface UserOption {
  value: string;
  text: string;
}

export interface ReportSelection {
  team: string | null;
  username: string | null;
  jYear: number;
  jMonth: number;
}

export interface MonthlySummaryDay {
  date: string;
  jalaali: string;
  totalHours: number;
  status: 'ok' | 'warning' | 'holiday';
}

export interface MonthlySummary {
  totalHours: number;
  deficitHours: number;
  requiredHours: number;
  days: MonthlySummaryDay[];
}

export interface QuarterlySummary {
  quarter: string;
  totalHours: number;
  months: MonthlySummary[];
}
