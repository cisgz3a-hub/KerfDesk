export interface MachineCommandLogEntry {
  readonly at: string;
  readonly kind: string;
  readonly detail: string;
}

export class MachineCommandLog {
  private readonly entries: MachineCommandLogEntry[] = [];

  add(kind: string, detail: string): void {
    this.entries.push({ at: new Date(0).toISOString(), kind, detail });
  }

  snapshot(): readonly MachineCommandLogEntry[] {
    return [...this.entries];
  }
}
