import { Routes } from '@angular/router';

export const REPORT_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./reports-shell.component').then((m) => m.ReportsShellComponent),
    children: [
      {
        path: 'monthly',
        loadComponent: () => import('./views/monthly-report.component').then((m) => m.MonthlyReportComponent),
      },
      {
        path: 'quarterly',
        loadComponent: () => import('./views/quarterly-report.component').then((m) => m.QuarterlyReportComponent),
      },
      {
        path: 'admin',
        loadComponent: () => import('./views/admin-report.component').then((m) => m.AdminReportComponent),
      },
      { path: '', pathMatch: 'full', redirectTo: 'monthly' },
    ],
  },
];
