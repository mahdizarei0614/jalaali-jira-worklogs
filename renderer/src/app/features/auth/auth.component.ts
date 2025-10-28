import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IpcService } from '../../core/services/ipc.service';
import { Router } from '@angular/router';

@Component({
  selector: 'app-auth',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './auth.component.html',
  styleUrls: ['./auth.component.scss'],
})
export class AuthComponent {
  private readonly ipc = inject(IpcService);
  private readonly router = inject(Router);

  readonly token = signal('');
  readonly status = signal('');
  readonly hasToken = signal<boolean | null>(null);

  async ngOnInit() {
    try {
      const exists = await this.ipc.invoke<{ has: boolean }>('hasToken');
      const hasToken = !!exists?.has;
      this.hasToken.set(hasToken);
      if (hasToken) {
        const whoami = await this.ipc.invoke<{ displayName?: string }>('whoami');
        if (whoami?.displayName) {
          this.status.set(`ورود انجام شده توسط ${whoami.displayName}`);
        }
      }
    } catch (error) {
      console.error('Failed to check auth status', error);
      this.status.set('بررسی وضعیت ورود با خطا روبرو شد.');
    }
  }

  async submit() {
    try {
      await this.ipc.invoke('authorize', this.token());
      this.status.set('توکن با موفقیت ذخیره شد.');
      this.hasToken.set(true);
      await this.router.navigate(['/dashboard']);
    } catch (error) {
      console.error('Failed to authorize', error);
      this.status.set('ذخیره توکن با مشکل روبرو شد.');
    }
  }

  async logout() {
    try {
      await this.ipc.invoke('logout');
      this.token.set('');
      this.status.set('خروج انجام شد.');
      this.hasToken.set(false);
      await this.router.navigate(['/auth']);
    } catch (error) {
      console.error('Failed to logout', error);
      this.status.set('خروج با مشکل روبرو شد.');
    }
  }
}
