import {
  ChangeDetectionStrategy,
  Component,
  HostBinding,
  computed,
  contentChildren,
  effect,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { SidebarSectionComponent } from '../sidebar-section/sidebar-section.component';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './sidebar.component.html',
  styleUrls: ['./sidebar.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SidebarComponent {
  private readonly sections = contentChildren(SidebarSectionComponent);
  private readonly collapsed = signal(false);

  @HostBinding('class.collapsed')
  readonly isCollapsed = computed(() => this.collapsed());

  constructor() {
    effect(() => {
      const hasActive = this.sections().some((section) => section.hasActiveLink());
      if (hasActive) {
        for (const section of this.sections()) {
          section.syncExpandedFromRouter();
        }
      }
    });
  }

  toggle(): void {
    this.collapsed.update((value) => !value);
  }
}
