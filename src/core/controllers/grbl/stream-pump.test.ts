import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGrblSimulator } from '../../../__fixtures__/controllers/grbl-simulator';
import { createStreamer, onAck, step, type StreamerState } from './streamer';
import { pumpFirstWindow, pumpInboundLine, terminalAckKind } from './stream-pump';

describe('terminalAckKind (ADR-334)', () => {
  it('recognizes the three terminal acknowledgements and nothing else', () => {
    expect(terminalAckKind('ok')).toBe('ok');
    expect(terminalAckKind('error:9')).toBe('error');
    expect(terminalAckKind('ALARM:1')).toBe('alarm');
    expect(terminalAckKind('<Idle|MPos:0.000,0.000,0.000|FS:0,0>')).toBeNull();
    expect(terminalAckKind('[GC:G0 G54]')).toBeNull();
    expect(terminalAckKind("Grbl 1.1f ['$' for help]")).toBeNull();
    expect(terminalAckKind('')).toBeNull();
  });
});

describe('pumpInboundLine (ADR-334)', () => {
  const job = 'G1 X1.000\nG1 X2.000\nG1 X3.000\n';

  it('leaves the stream untouched for a line that is not an acknowledgement', () => {
    const started = pumpFirstWindow(createStreamer(job));

    const pumped = pumpInboundLine(started.streamer, '<Run|MPos:1.000,0.000,0.000|FS:600,0>');

    expect(pumped.streamer).toBe(started.streamer);
    expect(pumped.toSend).toBe('');
    expect(pumped.consumedAck).toBe(false);
  });

  it('advances the stream and refills on an ok', () => {
    // A one-line window, so each ok frees room for exactly one more line.
    const started = pumpFirstWindow(createStreamer(job, { rxBufferBytes: 10 }));
    expect(started.toSend).toBe('G1 X1.000\n');

    const first = pumpInboundLine(started.streamer, 'ok');

    expect(first.consumedAck).toBe(true);
    expect(first.toSend).toBe('G1 X2.000\n');
    expect(first.streamer.completed).toBe(1);
  });

  it('matches the loop it replaces, line for line', () => {
    // Same algorithm from both sides of the handover, so the two can be
    // interchanged mid-job: pumpInboundLine must equal onAck + step.
    let pumped: StreamerState = pumpFirstWindow(
      createStreamer(job, { rxBufferBytes: 12 }),
    ).streamer;
    let manual: StreamerState = step(createStreamer(job, { rxBufferBytes: 12 })).state;
    for (let i = 0; i < 3; i += 1) {
      const viaPump = pumpInboundLine(pumped, 'ok');
      const viaManual = step(onAck(manual, 'ok').state);
      pumped = viaPump.streamer;
      manual = viaManual.state;
      expect(viaPump.toSend).toBe(viaManual.toSend);
      expect(pumped).toEqual(manual);
    }
  });

  it('stops sending once an error makes the stream terminal', () => {
    const started = pumpFirstWindow(createStreamer(job, { rxBufferBytes: 10 }));

    const errored = pumpInboundLine(started.streamer, 'error:20');

    expect(errored.streamer.status).toBe('errored');
    expect(errored.toSend).toBe('');
    expect(pumpInboundLine(errored.streamer, 'ok').toSend).toBe('');
  });

  it('stops sending once an alarm cancels the stream', () => {
    const started = pumpFirstWindow(createStreamer(job, { rxBufferBytes: 10 }));

    const alarmed = pumpInboundLine(started.streamer, 'ALARM:1');

    expect(alarmed.streamer.status).toBe('cancelled');
    expect(alarmed.toSend).toBe('');
  });
});

describe('pumpInboundLine against the firmware simulator (ADR-334)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('streams a whole job to completion and the machine executes every line', async () => {
    const sim = createGrblSimulator({ emitBannerOnOpen: false, responseDelayMs: 1 });
    const portRef = await sim.adapter.serial.requestPort();
    if (portRef === null) throw new Error('requestPort returned null');
    const conn = await portRef.open({ baudRate: 115200 });
    const lineCount = 40;
    const gcode = Array.from({ length: lineCount }, (_, i) => `G1 X${i + 1}.000 F600 S0`).join(
      '\n',
    );

    // The entire flow control, exactly as the worker runs it.
    let state = createStreamer(gcode, { rxBufferBytes: 60 });
    const write = (data: string): void => {
      if (data !== '') void conn.write(data);
    };
    conn.onLine((line) => {
      const pumped = pumpInboundLine(state, line);
      state = pumped.streamer;
      write(pumped.toSend);
    });
    const first = pumpFirstWindow(state);
    state = first.streamer;
    write(first.toSend);

    await vi.advanceTimersByTimeAsync(5_000);

    expect(state.status).toBe('done');
    expect(state.completed).toBe(lineCount);
    expect(sim.state().mpos.x).toBeCloseTo(lineCount, 3);
  });
});
