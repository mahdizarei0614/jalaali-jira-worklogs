import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  contentChildren,
  effect,
  input,
  model,
  output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'section[sidebarTitle]',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './sidebar-section.component.html',
  styleUrls: ['./sidebar-section.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SidebarSectionComponent {
  readonly sidebarTitle = input.required<string>();
  readonly sidebarIcon = input<string>('chevron_right');
  readonly expanded = model<boolean>(true);
  readonly toggled = output<boolean>();

  private readonly anchors = contentChildren<ElementRef<HTMLAnchorElement>>('a', { descendants: true });
  readonly hasActive = signal(false);

  constructor() {
    effect(() => {
      const active = this.anchors().some((anchor) => anchor.nativeElement.classList.contains('active'));
      this.hasActive.set(active);
      if (active && !this.expanded()) {
        this.expanded.set(true);
      }
    });
  }

  hasActiveLink(): boolean {
    return this.hasActive();
  }

  syncExpandedFromRouter(): void {
    if (this.hasActive()) {
      this.expanded.set(true);
    }
  }

  toggle(): void {
    this.expanded.update((value) => !value);
    this.toggled.emit(this.expanded());
  }
}
