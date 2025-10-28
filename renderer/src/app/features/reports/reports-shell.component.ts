import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-reports-shell',
  standalone: true,
  imports: [RouterOutlet],
  template: `
    <div class="card">
      <router-outlet />
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReportsShellComponent {}
