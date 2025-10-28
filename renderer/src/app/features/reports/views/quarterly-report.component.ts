import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AppApiService } from '../../../core/app-api.service';

@Component({
  selector: 'app-quarterly-report',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './quarterly-report.component.html',
  styleUrls: ['./quarterly-report.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QuarterlyReportComponent {
  private readonly api = inject(AppApiService);
  readonly result = this.api.result;
  readonly busy = this.api.busySignal;
  readonly error = this.api.errorSignal;

  readonly grouped = computed(() => this.result()?.seasons ?? []);
}
