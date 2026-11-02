// The worker refill reading Marlin's ping-pong acknowledgements (ADR-676).
// Marlin answers every line with `ok`, so the worker writes the next line on
// it. Every other reply that changes what the main thread does with the stream
// hands the refill back before it is forwarded, and any line the main thread
// writes while armed does too, since Marlin has no realtime bytes.

import { describe, expect, it } from 'vitest';
import { createStreamer, step } from '../../core/controllers/grbl';
import { encodeProgramLines } from './serial-program-buffer';
import { createSerialWorkerCore } from './serial-worker-core';
import type { SerialWorkerResponse } from './serial-worker-protocol';

const PROGRAM = 'M3 I S0\nG1 X1 S204\nG1 X2\nG1 X3\nG1 X4\nM5 I\n';

function harness() {
  const posted: SerialWorkerResponse[] = [];
  const written: string[] = [];
  const control: { enqueue?: (bytes: Uint8Array) => void } = {};
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      control.enqueue = (bytes) => controller.enqueue(bytes);
    },
  });
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      written.push(new TextDecoder().decode(chunk));
    },
  });
  const core = createSerialWorkerCore({ post: (message) => posted.push(message) });
  core.handle({ kind: 'attach', readable, writable });
  return {
    core,
    posted,
    written,
    push: (text: string) => control.enqueue?.(new TextEncoder().encode(text)),
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
}

// Ping-pong: the first window is one line, `M3 I S0`, already on the wire.
function armMarlin(core: ReturnType<typeof harness>['core'], acks?: 'marlin'): void {
  const { queued, ...position } = step(
    createStreamer(PROGRAM, { streamingMode: 'ping-pong' }),
  ).state;
  core.handle({ kind: 'program', programId: 1, ...encodeProgramLines(queued) });
  core.handle({ kind: 'prepare-arm', id: 1 });
  core.handle({
    kind: 'arm',
    id: 1,
    programId: 1,
    position,
    ...(acks === undefined ? {} : { acks }),
  });
}

function kinds(posted: ReadonlyArray<SerialWorkerResponse>): ReadonlyArray<string> {
  return posted.map((message) => (message.kind === 'line' ? `line:${message.line}` : message.kind));
}

describe('serial worker core with Marlin acknowledgements (ADR-676)', () => {
  it('writes the next line on each ok, one line in flight', async () => {
    const h = harness();
    armMarlin(h.core, 'marlin');

    h.push('ok\n');
    await flush();
    h.push('ok\n');
    await flush();

    expect(h.written).toEqual(['G1 X1 S204\n', 'G1 X2\n']);
    expect(h.core.armedStreamer()?.completed).toBe(2);
  });

  it('reads an ok that carries ADVANCED_OK or temperature words as an ok', async () => {
    const h = harness();
    armMarlin(h.core, 'marlin');

    h.push('ok N12 P15 B3\n');
    await flush();

    expect(h.written).toEqual(['G1 X1 S204\n']);
  });

  it('does not refill on a busy keepalive, an echo or a position report', async () => {
    const h = harness();
    armMarlin(h.core, 'marlin');

    h.push('echo:busy: processing\necho:Settings Stored\nX:1.00 Y:0.00 Z:0.00 E:0.00\n');
    await flush();

    expect(h.written).toEqual([]);
    expect(h.core.armedStreamer()).not.toBeNull();
  });

  it.each([
    ['a handler error', 'Error:Something went wrong'],
    // The first window, `M3 I S0`, is the line in flight.
    ['an unknown command naming the line in flight', 'echo:Unknown command: "m3  i s0"'],
    // Marlin echoes the bytes it read: this is that line without its first byte
    // (rolling audit v9 R1-P1-1).
    ['an unknown command naming a damaged line', 'echo:Unknown command: "3 I S0"'],
    ['a skipped move', 'echo:Home XY First'],
    ['the stopped notice', 'Printer stopped due to errors. Fix the error and use M999 to restart.'],
    ['a resend request', 'Resend: 3'],
    ['a boot banner', 'start'],
  ])('hands the refill back on %s before the ok that follows it', async (_label, reply) => {
    const h = harness();
    armMarlin(h.core, 'marlin');

    h.push(`${reply}\nok\n`);
    await flush();

    // The main thread decides what that ok means; the worker sent nothing.
    expect(h.written).toEqual([]);
    expect(kinds(h.posted)).toEqual([
      'ready',
      'armed',
      `line:${reply}`,
      'refill-stopped',
      'line:ok',
    ]);
    expect(h.core.armedStreamer()).toBeNull();
  });

  it('keeps the refill through an echo with no line in flight to have been skipped', async () => {
    const h = harness();
    armMarlin(h.core, 'marlin');

    h.push('ok\nok\nok\nok\nok\nok\necho:Unknown command: "FROM THE LCD"\n');
    await flush();

    expect(kinds(h.posted)).not.toContain('refill-stopped');
  });

  it('retires the refill before any line the main thread writes while armed', async () => {
    const h = harness();
    armMarlin(h.core, 'marlin');

    h.core.handle({ kind: 'write', id: 7, data: 'M107\n' });
    h.push('ok\n');
    await flush();

    // Abort's quickstop goes out with no job line after it.
    expect(h.written).toEqual(['M107\n']);
    expect(kinds(h.posted)).toContain('refill-stopped');
    expect(h.core.armedStreamer()).toBeNull();
  });

  it("keeps GRBL's rules for an arm that names no grammar", async () => {
    const h = harness();
    armMarlin(h.core);

    // Under GRBL's grammar a console write mid-stream does not stop the refill.
    h.core.handle({ kind: 'write', id: 7, data: '?' });
    h.push('ok\n');
    await flush();

    expect(h.written).toEqual(['?', 'G1 X1 S204\n']);
    expect(h.core.armedStreamer()).not.toBeNull();
  });
});
