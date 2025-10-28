import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'numberToArray',
  standalone: true,
})
export class NumberToArrayPipe implements PipeTransform {
  transform(length: number): number[] {
    return Array.from({ length: Number(length) || 0 }, (_, index) => index);
  }
}
