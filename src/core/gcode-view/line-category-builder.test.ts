import { describe, expect, it } from 'vitest';
import { createLineCategoryBuilder } from './line-category-builder';

describe('createLineCategoryBuilder', () => {
  it('grows without retaining a string array and returns the exact typed payload', () => {
    const builder = createLineCategoryBuilder(2);

    builder.push(1);
    builder.push(2);
    builder.push(3);
    builder.push(4);
    builder.push(5);

    expect(builder.finish()).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
  });

  it('supports an empty result and a zero initial-capacity hint', () => {
    expect(createLineCategoryBuilder().finish()).toEqual(new Uint8Array());

    const builder = createLineCategoryBuilder(0);
    builder.push(7);
    expect(builder.finish()).toEqual(new Uint8Array([7]));
  });
});
