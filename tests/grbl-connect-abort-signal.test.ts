import { GrblController } from '../src/controllers/grbl/GrblController';
import type { SerialPortLike } from '../src/communication/SerialPort';

class SilentSerialPort implements SerialPortLike {
  private dataCallback: ((line: string) => void) | null = null;
  private errorCallback: ((error: Error) => void) | null = null;
  private closeCallback: (() => void) | null = null;
  private open = true;
  readonly writes: string[] = [];

  get isOpen(): boolean {
    return this.open;
  }

  write(data: string): void {
    if (!this.open) throw new Error('Port is not open');
    this.writes.push(data);
  }

  writeByte(byte: number): void {
    if (!this.open) throw new Error('Port is not open');
    this.writes.push(String.fromCharCode(byte));
  }

  async writeCritical(data: string): Promise<void> {
    this.write(data);
  }

  async writeByteCritical(byte: number): Promise<void> {
    this.writeByte(byte);
  }

  onData(callback: (line: string) => void): void {
    this.dataCallback = callback;
  }

  onError(callback: (error: Error) => void): void {
    this.errorCallback = callback;
  }

  onClose(callback: () => void): void {
    this.closeCallback = callback;
  }

  async close(): Promise<void> {
    this.open = false;
    this.closeCallback?.();
  }

  inject(line: string): void {
    this.dataCallback?.(line);
  }

  fail(message: string): void {
    this.errorCallback?.(new Error(message));
  }
}

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ok ${message}`);
  } else {
    failed++;
    console.error(`  fail ${message}`);
  }
}

function delay(ms: number): Promise<'timeout'> {
  return new Promise(resolve => setTimeout(() => resolve('timeout'), ms));
}

async function run(): Promise<void> {
  console.log('\n=== T1-50 GRBL connect AbortSignal ===\n');

  const ctrl = new GrblController();
  const port = new SilentSerialPort();
  const ac = new AbortController();

  const connectResult = ctrl.connect(port, ac.signal)
    .then(() => 'resolved' as const)
    .catch((err: unknown) => err);

  await delay(20);
  ac.abort(new Error('connect cancelled by test'));

  const result = await Promise.race([connectResult, delay(250)]);

  assert(result instanceof Error, 'aborted signal rejects connect promptly');
  assert(result instanceof Error && /cancelled|abort/i.test(result.message),
    `abort rejection preserves a cancel/abort message (got ${result instanceof Error ? result.message : String(result)})`);
  assert(ctrl.state.status === 'disconnected',
    `controller returns to disconnected after abort (got ${ctrl.state.status})`);
  assert(port.isOpen === false, 'aborted connect closes the serial port');

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void run().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
