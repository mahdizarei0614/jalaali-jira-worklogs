import { Component, ViewChild, signal, inject, ElementRef } from '@angular/core';
import { Router, RouterOutlet, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { SidebarComponent } from './shared/components/sidebar/sidebar.component';
import { CommonModule } from '@angular/common';
import { ReportStateService } from './core/services/report-state.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DestroyRef } from '@angular/core';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, SidebarComponent],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent {
  private readonly router = inject(Router);
  private readonly reportState = inject(ReportStateService);
  private readonly destroyRef = inject(DestroyRef);
  readonly breadcrumb = signal('Dashboard');

  @ViewChild('mainContent')
  private mainContent?: ElementRef<HTMLElement>;

  constructor() {
    void this.reportState
      .bootstrap()
      .then(() => this.reportState.initialiseDefaults())
      .catch((error) => console.error('Bootstrap failed', error));

    this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd), takeUntilDestroyed(this.destroyRef))
      .subscribe((event) => {
        const [, route] = event.urlAfterRedirects.split('/');
        this.breadcrumb.set((route || 'dashboard').replace(/-/g, ' '));
        queueMicrotask(() => this.mainContent?.nativeElement?.focus());
      });
  }

  onSidebarToggled(collapsed: boolean) {
    document.documentElement.style.setProperty('--sidebar-width', collapsed ? '72px' : 'clamp(220px, 18vw, 280px)');
  }

  onNavigate(route: string) {
    void this.router.navigate([route]);
  }
}
