import { Component, computed, effect, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardComponent, CardGroupComponent } from '../../shared/components/card/card.component';
import { ReportStateService } from '../../core/services/report-state.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, CardComponent, CardGroupComponent],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
})
export class DashboardComponent {
  private readonly reportState = inject(ReportStateService);

  readonly loading = this.reportState.isLoading;
  readonly selection = this.reportState.currentSelection;
  readonly summary = computed(() => this.reportState.monthlySummary());

  constructor() {
    effect(() => {
      if (!this.summary()) {
        void this.reportState.requestMonthlySummary().catch((error) => console.error(error));
      }
    });
  }

  refresh() {
    void this.reportState.requestMonthlySummary();
  }
}
