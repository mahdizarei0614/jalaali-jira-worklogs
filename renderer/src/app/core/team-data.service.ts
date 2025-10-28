import { HttpClient } from '@angular/common/http';
import { Injectable, computed, signal, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export interface TeamUserOption {
  text: string;
  value: string;
}

export interface TeamInfo {
  value: string;
  label: string;
  users: TeamUserOption[];
}

export interface RemoteDataSchema {
  teams: TeamInfo[];
  adminTeamAccess: Record<string, string[]>;
}

@Injectable({ providedIn: 'root' })
export class TeamDataService {
  private readonly http = inject(HttpClient);
  private readonly loading = signal(false);
  private readonly error = signal<string | null>(null);
  private readonly data = signal<RemoteDataSchema | null>(null);

  readonly loadingState = this.loading.asReadonly();
  readonly errorState = this.error.asReadonly();
  readonly teams = computed(() => this.data()?.teams ?? []);

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const remote = await firstValueFrom(
        this.http.get<RemoteDataSchema>('https://raw.githubusercontent.com/SkyBlueZ/jalaali-jira-worklogs/master/data.json', {
          headers: { Accept: 'application/json' },
          withCredentials: false,
        }),
      );
      this.data.set(remote);
    } catch (err) {
      try {
        const fallback = await firstValueFrom(
          this.http.get<RemoteDataSchema>('data.json', { headers: { Accept: 'application/json' }, withCredentials: false }),
        );
        this.data.set(fallback);
      } catch (inner) {
        console.error('Failed to load team data', inner);
        this.error.set('خطا در دریافت اطلاعات تیم');
      }
    } finally {
      this.loading.set(false);
    }
  }
}
