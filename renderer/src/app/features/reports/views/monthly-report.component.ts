import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AppApiService } from '../../../core/app-api.service';
import { TeamDataService } from '../../../core/team-data.service';
import { SelectionPanelComponent } from '../components/selection-panel/selection-panel.component';

@Component({
  selector: 'app-monthly-report',
  standalone: true,
  imports: [CommonModule, SelectionPanelComponent],
  templateUrl: './monthly-report.component.html',
  styleUrls: ['./monthly-report.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MonthlyReportComponent {
  private readonly api = inject(AppApiService);
  private readonly teamData = inject(TeamDataService);

  readonly result = this.api.result;
  readonly busy = this.api.busySignal;
  readonly error = this.api.errorSignal;
  readonly teams = this.teamData.teams;

  readonly total = computed(() => this.result()?.summary?.totalHours ?? '0');
  readonly deficit = computed(() => this.result()?.summary?.deficitHours ?? '0');

  handleSelection(selection: { jYear: number; jMonth: number; username: string }): void {
    void this.api.runScan(selection);
  }
}
