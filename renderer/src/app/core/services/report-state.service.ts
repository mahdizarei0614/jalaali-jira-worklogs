import { Injectable, Signal, WritableSignal, computed, effect, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { TeamOption, UserOption, ReportSelection, MonthlySummary, QuarterlySummary, MonthlySummaryDay } from '../models/report.models';
import { map } from 'rxjs/operators';
import { lastValueFrom } from 'rxjs';
import { IpcService } from './ipc.service';

interface RemoteDataSchema {
  teams: { value: string; label: string; users: UserOption[] }[];
  adminTeamAccess?: Record<string, string[]>;
}

@Injectable({ providedIn: 'root' })
export class ReportStateService {
  private readonly http = inject(HttpClient);
  private readonly ipc = inject(IpcService);

  private readonly teamOptionsSignal: WritableSignal<TeamOption[]> = signal([]);
  private readonly usersByTeamSignal: WritableSignal<Record<string, UserOption[]>> = signal({});
  private readonly adminTeamsSignal: WritableSignal<Record<string, string[]>> = signal({});

  readonly teams: Signal<TeamOption[]> = this.teamOptionsSignal.asReadonly();
  readonly usersByTeam: Signal<Record<string, UserOption[]>> = this.usersByTeamSignal.asReadonly();

  readonly currentSelection: WritableSignal<ReportSelection> = signal({
    team: null,
    username: null,
    jYear: new Date().getFullYear(),
    jMonth: new Date().getMonth() + 1,
  });

  readonly isLoading: WritableSignal<boolean> = signal(false);
  readonly monthlySummary: WritableSignal<MonthlySummary | null> = signal(null);
  readonly quarterlySummary: WritableSignal<QuarterlySummary | null> = signal(null);

  readonly availableUsers = computed(() => {
    const team = this.currentSelection().team;
    if (!team) {
      return [];
    }
    return this.usersByTeam()[team] ?? [];
  });

  constructor() {
    effect(() => {
      const selection = this.currentSelection();
      void this.ipc.invoke('updateSelection', selection).catch((error) => console.warn(error));
    });
  }

  bootstrap() {
    return lastValueFrom(
      this.http
      .get<RemoteDataSchema>('https://api.github.com/repos/mahdizarei0614/jira-worklogs-electron/contents/data.json?ref=main', {
        headers: { Accept: 'application/vnd.github.v3.raw' },
      })
      .pipe(
        map((payload) => {
          const teamOptions: TeamOption[] = Array.isArray(payload?.teams)
            ? payload.teams.map((team) => ({ value: team.value, label: team.label ?? team.value }))
            : [];
          const usersMap: Record<string, UserOption[]> = {};
          if (Array.isArray(payload?.teams)) {
            payload.teams.forEach((team) => {
              usersMap[team.value] = Array.isArray(team.users)
                ? team.users.map((user) => ({ value: user.value, text: user.text ?? user.value }))
                : [];
            });
          }
          this.teamOptionsSignal.set(teamOptions);
          this.usersByTeamSignal.set(usersMap);
          this.adminTeamsSignal.set(payload?.adminTeamAccess ?? {});
          return teamOptions;
        })
      )
    );
  }

  async initialiseDefaults() {
    try {
      const settings = await this.ipc.invoke<any>('getSettings');
      const baseYear = Number(settings?.defaultJYear);
      const baseMonth = Number(settings?.defaultJMonth);
      this.currentSelection.update((state) => ({
        ...state,
        jYear: Number.isFinite(baseYear) ? baseYear : state.jYear,
        jMonth: Number.isFinite(baseMonth) ? baseMonth : state.jMonth,
      }));
    } catch (error) {
      console.warn('Unable to read default selection', error);
    }
    const teams = this.teams();
    if (teams.length > 0) {
      const firstTeam = teams[0];
      const firstUser = (this.usersByTeam()[firstTeam.value] ?? [])[0]?.value ?? null;
      this.currentSelection.update((state) => ({ ...state, team: firstTeam.value, username: firstUser }));
    }
  }

  async requestMonthlySummary() {
    this.isLoading.set(true);
    try {
      const selection = this.currentSelection();
      const payload = await this.ipc.invoke<any>('scanNow', selection);
      if (payload?.ok === false) {
        throw new Error(payload?.reason || 'Unable to load monthly summary');
      }
      const summary = this.normalizeMonthlySummary(payload);
      this.monthlySummary.set(summary);
      return summary;
    } catch (error) {
      console.error('Failed to load monthly summary', error);
      this.monthlySummary.set(null);
      throw error;
    } finally {
      this.isLoading.set(false);
    }
  }

  async requestQuarterlySummary() {
    this.isLoading.set(true);
    try {
      const selection = this.currentSelection();
      const payload = await this.ipc.invoke<any>('scanNow', { ...selection, scope: 'quarterly' });
      if (payload?.ok === false) {
        throw new Error(payload?.reason || 'Unable to load quarterly summary');
      }
      const quarter = this.normalizeQuarterlySummary(payload?.quarterReport ?? payload?.quarter);
      this.quarterlySummary.set(quarter);
      return quarter;
    } catch (error) {
      console.error('Failed to load quarterly summary', error);
      this.quarterlySummary.set(null);
      throw error;
    } finally {
      this.isLoading.set(false);
    }
  }

  private normalizeMonthlySummary(raw: any): MonthlySummary | null {
    if (!raw) {
      return null;
    }
    const summary = raw.summary ?? raw;
    const totalHours = Number(summary?.totalHours ?? raw?.totalHours ?? 0);
    const deficitHours = Number(summary?.deficitHours ?? raw?.deficitHours ?? 0);
    const requiredHours = Number(summary?.requiredHours ?? raw?.requiredHours ?? 0);
    const days: MonthlySummaryDay[] = Array.isArray(raw?.days)
      ? raw.days.map((day: any) => ({
          date: day?.gregorian ?? day?.date ?? '',
          jalaali: day?.jalaali ?? day?.jalali ?? '',
          totalHours: Number(day?.totalHours ?? day?.hours ?? 0),
          status: (day?.status ?? 'ok') as 'ok' | 'warning' | 'holiday',
        }))
      : [];
    return {
      totalHours,
      deficitHours,
      requiredHours,
      days,
    };
  }

  private normalizeQuarterlySummary(raw: any): QuarterlySummary | null {
    if (!raw) {
      return null;
    }
    const months = Array.isArray(raw?.months)
      ? raw.months
          .map((month: any) => this.normalizeMonthlySummary(month))
          .filter((month): month is MonthlySummary => !!month)
      : [];
    return {
      quarter: raw?.label ?? raw?.quarter ?? '',
      totalHours: Number(raw?.totalHours ?? 0),
      months,
    };
  }
}
