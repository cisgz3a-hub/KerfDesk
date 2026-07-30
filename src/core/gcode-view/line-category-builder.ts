export type LineCategoryBuilder = {
  push(value: number): void;
  finish(): Uint8Array;
};

export function createLineCategoryBuilder(initialCapacity = 1024): LineCategoryBuilder {
  let values = new Uint8Array(Math.max(1, Math.floor(initialCapacity)));
  let count = 0;

  return {
    push(value): void {
      if (count === values.length) {
        const grown = new Uint8Array(values.length * 2);
        grown.set(values);
        values = grown;
      }
      values[count] = value;
      count += 1;
    },
    finish(): Uint8Array {
      return values.slice(0, count);
    },
  };
}
