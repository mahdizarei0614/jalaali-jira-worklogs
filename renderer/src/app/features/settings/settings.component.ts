import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IpcService } from '../../core/services/ipc.service';

interface SettingsState {
  jiraBaseUrl: string;
  reminderEnabled: boolean;
}

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './settings.component.html',
  styleUrls: ['./settings.component.scss'],
})
export class SettingsComponent {
  private readonly ipc = inject(IpcService);

  readonly settings = signal<SettingsState>({ jiraBaseUrl: '', reminderEnabled: true });
  readonly status = signal<string>('');

  async ngOnInit() {
    try {
      const data = (await this.ipc.invoke<any>('getSettings')) ?? {};
      this.settings.set({
        jiraBaseUrl: data?.jiraBaseUrl ?? data?.baseUrl ?? '',
        reminderEnabled: data?.reminderEnabled ?? true,
      });
    } catch (error) {
      console.error('Unable to load settings', error);
      this.status.set('عدم توانایی در دریافت تنظیمات.');
    }
  }

  async save() {
    try {
      await this.ipc.invoke('saveSettings', {
        baseUrl: this.settings().jiraBaseUrl,
        reminderEnabled: this.settings().reminderEnabled,
      });
      this.status.set('تنظیمات ذخیره شد.');
    } catch (error) {
      console.error('Failed to save settings', error);
      this.status.set('ذخیره تنظیمات با مشکل مواجه شد.');
    }
  }

  onBaseUrlChange(value: string) {
    this.settings.update((state) => ({ ...state, jiraBaseUrl: value }));
  }

  onReminderChange(value: boolean) {
    this.settings.update((state) => ({ ...state, reminderEnabled: value }));
  }
}
