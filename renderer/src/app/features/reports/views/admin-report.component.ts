import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AppApiService } from '../../../core/app-api.service';

@Component({
  selector: 'app-admin-report',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './admin-report.component.html',
  styleUrls: ['./admin-report.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminReportComponent {
  private readonly api = inject(AppApiService);

  readonly busy = this.api.busySignal;
  readonly error = this.api.errorSignal;

  async export(): Promise<void> {
    try {
      await this.api.exportFullReport({ includeAttachments: true });
    } catch (err) {
      console.error(err);
    }
  }
}
