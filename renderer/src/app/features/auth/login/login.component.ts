import { ChangeDetectionStrategy, Component, computed, effect, model, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AppApiService } from '../../../core/app-api.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginComponent {
  readonly token = model('');
  readonly isSubmitting = signal(false);
  readonly error = signal<string | null>(null);
  readonly canSubmit = computed(() => this.token().trim().length > 10 && !this.isSubmitting());

  constructor(private readonly api: AppApiService, private readonly router: Router) {
    effect(() => {
      const lastError = this.api.errorSignal();
      if (lastError) {
        this.error.set(lastError);
      }
    });
  }

  async submit(): Promise<void> {
    if (!this.canSubmit()) {
      return;
    }
    this.isSubmitting.set(true);
    this.error.set(null);
    const ok = await this.api.authorize(this.token());
    this.isSubmitting.set(false);
    if (ok) {
      await this.router.navigate(['/dashboard']);
    }
  }
}
