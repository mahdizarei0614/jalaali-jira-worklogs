import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-not-found',
  standalone: true,
  imports: [RouterLink],
  template: `
    <section class="card">
      <h1>صفحه پیدا نشد</h1>
      <p class="text-muted">آدرس وارد شده در دسترس نیست. لطفاً به داشبورد بازگردید.</p>
      <a class="btn" routerLink="/dashboard">بازگشت به داشبورد</a>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotFoundComponent {}
