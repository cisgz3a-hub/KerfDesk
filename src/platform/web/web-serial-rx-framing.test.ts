import { afterEach, describe, expect, it, vi } from 'vitest';
import { webSerial } from './web-serial';

const originalSerialDescriptor = Object.getOwnPropertyDescriptor(navigator, 'serial');
const BAUD_RATE = 115_200;
const ACCEPTED_RECORD_LENGTH = 65_536;
const OVERSIZED_RECORD_LENGTH = 65_537;
const SHORT_RECORD_BYTES = new TextEncoder();

class RawReader {
  readonly cancel = vi.fn(async () => this.end());
  readonly releaseLock = vi.fn();
  private readonly queued: ReadableStreamReadResult<Uint8Array>[] = [];
  private resolveRead: ((result: ReadableStreamReadResult<Uint8Array>) => void) | undefined;

  read = vi.fn(async (): Promise<ReadableStreamReadResult<Uint8Array>> => {
    const queued = this.queued.shift();
    if (queued !== undefined) return queued;
    return await new Promise<ReadableStreamReadResult<Uint8Array>>((resolve) => {
      this.resolveRead = resolve;
    });
  });

  push(value: Uint8Array): void {
    this.deliver({ done: false, value });
  }

  end(): void {
    this.deliver({ done: true, value: undefined });
  }

  private deliver(result: ReadableStreamReadResult<Uint8Array>): void {
    const resolve = this.resolveRead;
    this.resolveRead = undefined;
    if (resolve !== undefined) {
      resolve(result);
      return;
    }
    this.queued.push(result);
  }
}

class RawWriter {
  readonly close = vi.fn(async () => undefined);
  readonly releaseLock = vi.fn();
  readonly write = vi.fn(async (_value: Uint8Array) => undefined);
}

class RawPort extends EventTarget {
  readonly reader = new RawReader();
  readonly writer = new RawWriter();
  readonly readable = { getReader: () => this.reader } as unknown as ReadableStream<Uint8Array>;
  readonly writable = { getWriter: () => this.writer } as unknown as WritableStream<Uint8Array>;
  readonly open = vi.fn(async () => undefined);
  readonly close = vi.fn(async () => undefined);
  readonly getInfo = vi.fn(() => ({}));
}

afterEach(() => {
  if (originalSerialDescriptor === undefined) {
    Reflect.deleteProperty(navigator, 'serial');
  } else {
    Object.defineProperty(navigator, 'serial', originalSerialDescriptor);
  }
  vi.restoreAllMocks();
});

// RX-13 was withdrawn: an oversized unterminated record must not turn its tail
// into an acknowledgement. See the dated preservation note for the open B-19 defect.
describe('webSerial raw receive framing', () => {
  it('RX-01: delivers one ok record for coalesced and byte-by-byte schedules', async () => {
    await expectRecords([fixtureBytes('ok\n')], ['ok']);
    await expectRecords(splitEveryByte(fixtureBytes('ok\n')), ['ok']);
  });

  it('RX-02: removes exactly one terminal CR from a coalesced or byte-by-byte CRLF record', async () => {
    await expectRecords([fixtureBytes('ok\r\n')], ['ok']);
    await expectRecords(splitEveryByte(fixtureBytes('ok\r\n')), ['ok']);
  });

  it('RX-03 and RX-04: preserves error and status records across raw chunk schedules', async () => {
    await expectRecords([fixtureBytes('error:14\n')], ['error:14']);
    await expectRecords(splitEveryByte(fixtureBytes('error:14\n')), ['error:14']);
    await expectRecords([fixtureBytes('<Idle|MPos:0,0,0>\n')], ['<Idle|MPos:0,0,0>']);
    await expectRecords(splitEveryByte(fixtureBytes('<Idle|MPos:0,0,0>\n')), ['<Idle|MPos:0,0,0>']);
  });

  it('RX-05: decodes a multibyte non-breaking space when its bytes cross reads', async () => {
    await expectRecords([new Uint8Array([0xc2]), new Uint8Array([0xa0, 0x0a])], ['\u00a0']);
  });

  it('RX-06 and RX-07: pins malformed UTF-8 replacement records without ending the read route', async () => {
    await expectRecords([new Uint8Array([0xff, 0x0a])], ['\ufffd']);
    await expectRecords(splitEveryByte(new Uint8Array([0xff, 0x0a])), ['\ufffd']);
    await expectRecords([new Uint8Array([0xc2, 0x41, 0x0a])], ['\ufffdA']);
    await expectRecords(splitEveryByte(new Uint8Array([0xc2, 0x41, 0x0a])), ['\ufffdA']);
  });

  it('RX-08: pins incomplete UTF-8 handling before a terminator and at stream end', async () => {
    await expectRecords([new Uint8Array([0xc2]), new Uint8Array([0x0a])], ['\ufffd']);
    await expectRecordsAtStreamEnd([new Uint8Array([0xc2])], []);
  });

  it('RX-09: accepts decoded records through 65,536 characters and drops 65,537', async () => {
    await expectRecords([fixtureBytes(`${'A'.repeat(65_535)}\n`)], ['A'.repeat(65_535)]);
    await expectRecords(
      [fixtureBytes(`${'B'.repeat(ACCEPTED_RECORD_LENGTH)}\n`)],
      ['B'.repeat(ACCEPTED_RECORD_LENGTH)],
    );
    await expectRecords([fixtureBytes(`${'C'.repeat(OVERSIZED_RECORD_LENGTH)}\n`)], []);
  });

  it('RX-10 and RX-11: preserves a following ok after an oversized terminated record', async () => {
    await expectRecords([fixtureBytes(`${'D'.repeat(OVERSIZED_RECORD_LENGTH)}\nok\n`)], ['ok']);
    await expectRecords(
      [fixtureBytes(`${'E'.repeat(OVERSIZED_RECORD_LENGTH)}\n`), fixtureBytes('ok\n')],
      ['ok'],
    );
  });

  it('RX-12: retains 65,535 and 65,536 character partial records across a following terminator', async () => {
    await expectRecords(
      [fixtureBytes('F'.repeat(65_535)), fixtureBytes('\n')],
      ['F'.repeat(65_535)],
    );
    await expectRecords(
      [fixtureBytes('G'.repeat(ACCEPTED_RECORD_LENGTH)), fixtureBytes('\n')],
      ['G'.repeat(ACCEPTED_RECORD_LENGTH)],
    );
  });
});

async function expectRecords(
  chunks: ReadonlyArray<Uint8Array>,
  expected: ReadonlyArray<string>,
): Promise<void> {
  const port = installRawPort();
  const reference = await webSerial.requestPort();
  if (reference === null) throw new Error('expected a selected serial port');
  const connection = await reference.open({ baudRate: BAUD_RATE });
  const records: string[] = [];
  const onClose = vi.fn();
  connection.onLine((record) => records.push(record));
  connection.onClose(onClose);

  try {
    for (const chunk of chunks) await deliverAndConsume(port.reader, chunk);
    expect(records).toEqual(expected);
    expect(onClose).not.toHaveBeenCalled();
  } finally {
    await connection.close();
  }
}

async function expectRecordsAtStreamEnd(
  chunks: ReadonlyArray<Uint8Array>,
  expected: ReadonlyArray<string>,
): Promise<void> {
  const port = installRawPort();
  const reference = await webSerial.requestPort();
  if (reference === null) throw new Error('expected a selected serial port');
  const connection = await reference.open({ baudRate: BAUD_RATE });
  const records: string[] = [];
  const onClose = vi.fn();
  connection.onLine((record) => records.push(record));
  connection.onClose(onClose);

  try {
    for (const chunk of chunks) await deliverAndConsume(port.reader, chunk);
    port.reader.end();
    await flushReadLoop();
    expect(records).toEqual(expected);
    expect(onClose).toHaveBeenCalledTimes(1);
  } finally {
    await connection.close();
  }
}

function installRawPort(): RawPort {
  const port = new RawPort();
  Object.defineProperty(navigator, 'serial', {
    configurable: true,
    value: {
      requestPort: vi.fn(async () => port as unknown as SerialPort),
      getPorts: vi.fn(async () => []),
    } satisfies Pick<Serial, 'requestPort' | 'getPorts'>,
  });
  return port;
}

function fixtureBytes(value: string): Uint8Array {
  return SHORT_RECORD_BYTES.encode(value);
}

function splitEveryByte(value: Uint8Array): ReadonlyArray<Uint8Array> {
  return Array.from(value, (byte) => new Uint8Array([byte]));
}

async function deliverAndConsume(reader: RawReader, chunk: Uint8Array): Promise<void> {
  const previousReads = reader.read.mock.calls.length;
  reader.push(chunk);
  await flushReadLoop();
  // Reaching the next read proves that decoding and dispatch of this chunk finished.
  expect(reader.read).toHaveBeenCalledTimes(previousReads + 1);
}

async function flushReadLoop(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
