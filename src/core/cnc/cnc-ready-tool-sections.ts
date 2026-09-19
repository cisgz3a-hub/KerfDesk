/** Original tool-section rank wins when several tools have ready work. */
export class CncReadyToolSections {
  private readonly heap: number[] = [];

  push(rank: number): void {
    let index = this.heap.length;
    this.heap.push(rank);
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      const value = this.heap[parent] as number;
      if (value <= rank) break;
      this.heap[index] = value;
      index = parent;
    }
    this.heap[index] = rank;
  }

  pop(): number | undefined {
    const first = this.heap[0];
    const last = this.heap.pop();
    if (this.heap.length === 0 || last === undefined) return first;
    let index = 0;
    for (;;) {
      const left = 2 * index + 1;
      if (left >= this.heap.length) break;
      const right = left + 1;
      const child =
        right < this.heap.length && (this.heap[right] as number) < (this.heap[left] as number)
          ? right
          : left;
      if ((this.heap[child] as number) >= last) break;
      this.heap[index] = this.heap[child] as number;
      index = child;
    }
    this.heap[index] = last;
    return first;
  }
}
