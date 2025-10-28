import { Routes } from '@angular/router';

export const APP_ROUTES: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  {
    path: 'dashboard',
    loadComponent: () => import('./features/dashboard/dashboard.component').then((m) => m.DashboardComponent),
  },
  {
    path: 'monthly-report',
    loadComponent: () => import('./features/monthly-report/monthly-report.component').then((m) => m.MonthlyReportComponent),
  },
  {
    path: 'quarterly-report',
    loadComponent: () =>
      import('./features/quarterly-report/quarterly-report.component').then((m) => m.QuarterlyReportComponent),
  },
  {
    path: 'issues-worklog',
    loadComponent: () =>
      import('./features/issues-worklog/issues-worklog.component').then((m) => m.IssuesWorklogComponent),
  },
  {
    path: 'settings',
    loadComponent: () => import('./features/settings/settings.component').then((m) => m.SettingsComponent),
  },
  {
    path: 'auth',
    loadComponent: () => import('./features/auth/auth.component').then((m) => m.AuthComponent),
  },
  { path: '**', redirectTo: 'dashboard' },
];
