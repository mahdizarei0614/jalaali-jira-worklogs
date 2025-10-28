import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  signal,
  viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { SidebarSectionComponent } from '../shared/components/sidebar-section/sidebar-section.component';
import { SidebarComponent } from '../shared/components/sidebar/sidebar.component';
import { AppApiService } from '../core/app-api.service';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive, SidebarComponent, SidebarSectionComponent],
  templateUrl: './app-shell.component.html',
  styleUrls: ['./app-shell.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppShellComponent {
  private readonly prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)');
  readonly sidebar = viewChild.required('sidebar', { read: SidebarComponent });
  readonly clock = signal(new Date());
  readonly timeString = computed(() =>
    new Intl.DateTimeFormat('fa-IR-u-nu-latn', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(this.clock()),
  );

  constructor(private readonly api: AppApiService) {
    document.body.dataset['theme'] = document.body.dataset['theme'] ?? 'dark';
    if (this.prefersDark) {
      effect((onCleanup) => {
        const listener = () => {
          const dark = this.prefersDark?.matches ?? false;
          document.body.dataset['theme'] = dark ? 'dark' : 'light';
        };
        listener();
        this.prefersDark.addEventListener?.('change', listener);
        onCleanup(() => this.prefersDark?.removeEventListener?.('change', listener));
      });
    }
    effect((onCleanup) => {
      const timer = setInterval(() => this.clock.set(new Date()), 1000);
      onCleanup(() => clearInterval(timer));
    });

    void this.api.ensureBootstrapSelection();
  }

  toggleSidebar(): void {
    this.sidebar().toggle();
  }
}
