import { Component, computed, effect, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CardComponent, CardGroupComponent } from '../../shared/components/card/card.component';
import { ReportStateService } from '../../core/services/report-state.service';
import { NumberToArrayPipe } from '../../shared/pipes/number-to-array.pipe';

@Component({
  selector: 'app-monthly-report',
  standalone: true,
  imports: [CommonModule, FormsModule, CardComponent, CardGroupComponent, NumberToArrayPipe],
  templateUrl: './monthly-report.component.html',
  styleUrls: ['./monthly-report.component.scss'],
})
export class MonthlyReportComponent {
  private readonly reportState = inject(ReportStateService);

  readonly selection = this.reportState.currentSelection;
  readonly teams = this.reportState.teams;
  readonly users = this.reportState.availableUsers;
  readonly summary = computed(() => this.reportState.monthlySummary());
  readonly loading = this.reportState.isLoading;

  constructor() {
    effect(() => {
      const current = this.selection();
      if (!current.team || !current.username) {
        return;
      }
      void this.reload();
    });
  }

  async reload() {
    const { team, username } = this.selection();
    if (!team || !username) {
      return;
    }
    await this.reportState.requestMonthlySummary();
  }

  onTeamChange(team: string | null) {
    const users = this.reportState.usersByTeam();
    const nextUser = team ? users[team]?.[0]?.value ?? null : null;
    this.selection.update((state) => ({ ...state, team, username: nextUser }));
  }

  onUserChange(username: string | null) {
    this.selection.update((state) => ({ ...state, username }));
  }

  onMonthChange(month: number) {
    this.selection.update((state) => ({ ...state, jMonth: Number(month) }));
  }

  onYearChange(year: number) {
    this.selection.update((state) => ({ ...state, jYear: Number(year) }));
  }
}
