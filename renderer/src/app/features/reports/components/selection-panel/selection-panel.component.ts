import { ChangeDetectionStrategy, Component, computed, effect, input, model, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TeamInfo } from '../../../../core/team-data.service';

export interface ReportSelection {
  jYear: number;
  jMonth: number;
  username: string;
}

@Component({
  selector: 'app-selection-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './selection-panel.component.html',
  styleUrls: ['./selection-panel.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SelectionPanelComponent {
  readonly teams = input<TeamInfo[]>([], { alias: 'teams' });
  readonly busy = input(false);
  readonly selectionChange = output<ReportSelection>();

  readonly modelYear = model<number>(new Date().getFullYear());
  readonly modelMonth = model<number>(new Date().getMonth() + 1);
  readonly modelTeam = model<string>('');
  readonly modelUser = model<string>('');

  readonly months = Array.from({ length: 12 }).map((_, idx) => ({ value: idx + 1, label: `ماه ${idx + 1}` }));

  readonly users = computed(() => {
    const teamId = this.modelTeam();
    const teams = this.teams();
    const team = teams.find((t) => t.value === teamId) ?? teams[0];
    return team?.users ?? [];
  });

  readonly canSubmit = computed(
    () => !!this.modelUser().trim() && this.modelMonth() > 0 && this.modelYear() > 1300 && !this.busy(),
  );

  constructor() {
    effect(() => {
      const teamList = this.teams();
      if (!teamList.length) {
        return;
      }
      if (!this.modelTeam()) {
        this.modelTeam.set(teamList[0].value);
      }
      const selectedTeam = teamList.find((team) => team.value === this.modelTeam()) ?? teamList[0];
      if (selectedTeam && !this.modelUser()) {
        const firstUser = selectedTeam.users[0];
        if (firstUser) this.modelUser.set(firstUser.value);
      }
    });

    effect(() => {
      const availableUsers = this.users();
      if (!availableUsers.length) {
        this.modelUser.set('');
        return;
      }
      if (!availableUsers.some((user) => user.value === this.modelUser())) {
        this.modelUser.set(availableUsers[0].value);
      }
    });
  }

  submit(): void {
    if (!this.canSubmit()) {
      return;
    }
    this.selectionChange.emit({
      jYear: this.modelYear(),
      jMonth: this.modelMonth(),
      username: this.modelUser(),
    });
  }
}
