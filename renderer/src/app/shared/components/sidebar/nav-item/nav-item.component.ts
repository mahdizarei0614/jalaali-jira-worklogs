import { Component, computed } from '@angular/core';
import { input, output } from '@angular/core';

@Component({
  selector: 'app-nav-item',
  standalone: true,
  template: `
    <button
      type="button"
      class="nav-item"
      [class.nav-item--active]="active()"
      (click)="handleClick()"
    >
      <span class="material-symbols-rounded">{{ icon() }}</span>
      <span class="nav-item__label">{{ label() }}</span>
    </button>
  `,
  styleUrls: ['./nav-item.component.scss'],
})
export class NavItemComponent {
  readonly label = input.required<string>();
  readonly icon = input('dashboard');
  readonly route = input.required<string>();
  readonly isActive = input(false);
  readonly active = computed(() => this.isActive());
  readonly pressed = output<string>();

  handleClick() {
    this.pressed.emit(this.route());
  }
}
