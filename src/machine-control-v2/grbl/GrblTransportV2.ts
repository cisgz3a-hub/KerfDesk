export interface GrblTransportDeps {
  readonly rxBufferSize: number;
  readonly write: (data: string) => Promise<void>;
}

export class GrblTransportV2 {
  private readonly pendingLengths: number[] = [];
  private count = 0;

  constructor(private readonly deps: GrblTransportDeps) {}

  get bufferCount(): number {
    return this.count;
  }

  async sendGcodeLine(line: string): Promise<void> {
    const data = line.endsWith('\n') ? line : `${line}\n`;
    const len = asciiLength(data);

    if (len > this.deps.rxBufferSize) {
      throw new Error(
        `G-code line length ${len} exceeds GRBL RX buffer ${this.deps.rxBufferSize}.`,
      );
    }
    if (this.count + len > this.deps.rxBufferSize) {
      throw new Error(
        `GRBL RX buffer full: ${this.count}/${this.deps.rxBufferSize}.`,
      );
    }

    this.pendingLengths.push(len);
    this.count += len;
    await this.deps.write(data);
  }

  async sendRealtime(char: string): Promise<void> {
    await this.deps.write(char);
  }

  acceptResponse(text: string): void {
    const acks = text
      .split(/\r?\n/)
      .filter((line) => line === 'ok' || line.startsWith('error:')).length;

    for (let i = 0; i < acks; i++) {
      const len = this.pendingLengths.shift() ?? 0;
      this.count = Math.max(0, this.count - len);
    }
  }

  reset(): void {
    this.pendingLengths.length = 0;
    this.count = 0;
  }
}

function asciiLength(value: string): number {
  return value.length;
}
