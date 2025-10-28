import { AfterContentInit, Component, ContentChildren, QueryList, signal } from '@angular/core';
import { input } from '@angular/core';

@Component({
  selector: 'app-card',
  standalone: true,
  templateUrl: './card.component.html',
  styleUrls: ['./card.component.scss'],
})
export class CardComponent {
  readonly title = input<string>('');
  readonly subtitle = input<string>('');
}

@Component({
  selector: 'app-card-group',
  standalone: true,
  template: `
    <div class="card-grid" [class.card-grid--stacked]="stacked()">
      <ng-content></ng-content>
    </div>
    <p class="text-muted" *ngIf="totalCards() === 0">موردی برای نمایش وجود ندارد.</p>
  `,
  styles: [
    `
      .card-grid--stacked {
        display: flex;
        flex-direction: column;
      }
    `,
  ],
})
export class CardGroupComponent implements AfterContentInit {
  readonly stacked = input(false);

  @ContentChildren(CardComponent)
  private readonly cards?: QueryList<CardComponent>;

  private readonly cardCount = signal(0);
  readonly totalCards = this.cardCount.asReadonly();

  ngAfterContentInit() {
    this.cardCount.set(this.cards?.length ?? 0);
    this.cards?.changes.subscribe((list: QueryList<CardComponent>) => {
      this.cardCount.set(list.length);
    });
  }
}
