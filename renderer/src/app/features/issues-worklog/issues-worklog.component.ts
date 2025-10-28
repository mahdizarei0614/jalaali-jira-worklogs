import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReportStateService } from '../../core/services/report-state.service';
import { IpcService } from '../../core/services/ipc.service';

interface IssueWorklog {
  issueKey: string;
  summary: string;
  hours: number;
}

@Component({
  selector: 'app-issues-worklog',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './issues-worklog.component.html',
  styleUrls: ['./issues-worklog.component.scss'],
})
export class IssuesWorklogComponent {
  private readonly reportState = inject(ReportStateService);
  private readonly ipc = inject(IpcService);

  readonly worklogs = signal<IssueWorklog[]>([]);
  readonly loading = this.reportState.isLoading;
  readonly error = signal<string>('');

  async load() {
    try {
      this.error.set('');
      const selection = this.reportState.currentSelection();
      if (!selection.username) {
        throw new Error('No username selected');
      }
      let summary = this.reportState.monthlySummary();
      if (!summary) {
        summary = await this.reportState.requestMonthlySummary();
      }
      let start = null;
      let end = null;
      if (summary?.days?.length) {
        start = summary.days[0]?.date ?? null;
        const lastDate = summary.days[summary.days.length - 1]?.date ?? null;
        if (lastDate) {
          const date = new Date(lastDate + 'T00:00:00Z');
          if (!Number.isNaN(date.getTime())) {
            const next = new Date(date.getTime() + 24 * 60 * 60 * 1000);
            end = next.toISOString().split('T')[0];
          }
        }
      }
      const payload = { ...selection, start, end };
      const response = await this.ipc.invoke<any>('fetchWorklogsRange', payload);
      if (response?.ok === false) {
        throw new Error(response?.reason || 'Unable to load worklogs');
      }
      this.worklogs.set(response?.worklogs ?? []);
    } catch (error) {
      console.error('Failed to load worklogs', error);
      this.error.set('دریافت اطلاعات با خطا مواجه شد.');
    }
  }
}
