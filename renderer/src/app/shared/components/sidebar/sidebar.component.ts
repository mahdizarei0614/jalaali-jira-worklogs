import { Component, computed, effect, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { NavItemComponent } from './nav-item/nav-item.component';
import { NgFor } from '@angular/common';
import { output, model } from '@angular/core';

interface NavSection {
  title: string;
  icon: string;
  route: string;
}

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [NgFor, RouterLink, RouterLinkActive, NavItemComponent],
  templateUrl: './sidebar.component.html',
  styleUrls: ['./sidebar.component.scss'],
})
export class SidebarComponent {
  readonly collapsed = model(false);
  readonly toggled = output<boolean>();
  readonly navigate = output<string>();

  readonly navItems = signal<NavSection[]>([
    { title: 'Dashboard', icon: 'dashboard', route: 'dashboard' },
    { title: 'Monthly Report', icon: 'calendar_month', route: 'monthly-report' },
    { title: 'Quarterly Report', icon: 'query_stats', route: 'quarterly-report' },
    { title: 'Issues Worklog', icon: 'task', route: 'issues-worklog' },
    { title: 'Settings', icon: 'settings', route: 'settings' },
  ]);

  readonly currentRoute = signal('dashboard');
  readonly computedItems = computed(() => this.navItems());

  constructor(private readonly router: Router) {
    effect(() => {
      const sub = this.router.events.subscribe(() => {
        this.currentRoute.set(this.router.url.replace(/^\//, '') || 'dashboard');
      });
      return () => sub.unsubscribe();
    });
  }

  toggle() {
    const next = !this.collapsed();
    this.collapsed.set(next);
    this.toggled.emit(next);
  }

  navigateTo(route: string) {
    this.navigate.emit(route);
  }

  trackByRoute(_index: number, item: NavSection) {
    return item.route;
  }
}
