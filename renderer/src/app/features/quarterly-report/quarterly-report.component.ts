import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardComponent, CardGroupComponent } from '../../shared/components/card/card.component';
import { ReportStateService } from '../../core/services/report-state.service';

@Component({
  selector: 'app-quarterly-report',
  standalone: true,
  imports: [CommonModule, CardComponent, CardGroupComponent],
  templateUrl: './quarterly-report.component.html',
  styleUrls: ['./quarterly-report.component.scss'],
})
export class QuarterlyReportComponent {
  private readonly reportState = inject(ReportStateService);

  readonly summary = computed(() => this.reportState.quarterlySummary());
  readonly loading = this.reportState.isLoading;

  constructor() {
    if (!this.summary()) {
      void this.reportState.requestQuarterlySummary().catch((error) => console.error(error));
    }
  }

  refresh() {
    void this.reportState.requestQuarterlySummary();
  }
}
