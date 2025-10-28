import { ChangeDetectionStrategy, Component, computed, effect, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AppApiService } from '../../core/app-api.service';
import { TeamDataService } from '../../core/team-data.service';
import { SelectionPanelComponent } from '../reports/components/selection-panel/selection-panel.component';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, SelectionPanelComponent],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardComponent {
  private readonly api = inject(AppApiService);
  private readonly teamData = inject(TeamDataService);

  readonly result = this.api.result;
  readonly error = this.api.errorSignal;
  readonly busy = this.api.busySignal;
  readonly teams = this.teamData.teams;

  readonly deficit = computed(() => this.result()?.summary?.deficitHours ?? '0');
  readonly total = computed(() => this.result()?.summary?.totalHours ?? '0');

  constructor() {
    effect(() => {
      const selection = this.api.selectionSignal();
      if (selection?.username) {
        void this.api.runScan(selection);
      }
    });
  }

  handleSelection(selection: { jYear: number; jMonth: number; username: string }): void {
    void this.api.runScan(selection);
  }
}
