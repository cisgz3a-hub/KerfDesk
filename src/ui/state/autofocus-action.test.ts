import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { classifyResponse, type StatusReport } from '../../core/controllers/grbl';
import { describeAutofocusResult, runAutofocus, type RunAutofocusArgs } from './autofocus-action';
import {
  cancelControllerLifecycleRefs,
  consumeControllerCommandResponse,
  type ControllerLifecycleRefs,
} from './laser-interactive-command';

type AutofocusHarness = {
  readonly refs: ControllerLifecycleRefs;
  readonly written: string[];
  readonly emit: (line: string) => void;
  readonly args: (overrides?: Partial<RunAutofocusArgs>) => RunAutofocusArgs;
};

function makeHarness(write?: (line: string) => Promise<void>): AutofocusHarness {
  const refs: ControllerLifecycleRefs = {
    controllerCommand: null,
    controllerIdleWait: null,
    writeEpoch: 0,
  };
  const written: string[] = [];
  const sharedWrite = async (line: string): Promise<void> => {
    written.push(line);
    await write?.(line);
  };
  return {
    refs,
    written,
    emit: (line) => {
      const response = classifyResponse(line);
      consumeControllerCommandResponse(refs, response, line);
      if (response.kind === 'status' && response.report.state === 'Alarm') {
        cancelControllerLifecycleRefs(refs, 'Controller entered Alarm.');
      }
    },
    args: (overrides = {}) => ({
      connected: true,
      statusReport: idleStatus(),
      command: '$HZ1',
      refs,
      write: sharedWrite,
      ...overrides,
    }),
  };
}

function idleStatus(): StatusReport {
  return {
    state: 'Idle',
    subState: null,
    mPos: { x: 0, y: 0, z: 0 },
    wPos: null,
    feed: 0,
    spindle: 0,
    wco: null,
  };
}

describe('runAutofocus — preflight', () => {
  it('rejects when not connected', async () => {
    const harness = makeHarness();
    const result = await runAutofocus(harness.args({ connected: false }));
    expect(result.kind).toBe('preflight-failed');
    if (result.kind === 'preflight-failed') expect(result.reason).toMatch(/not connected/i);
  });

  it('rejects when command is empty', async () => {
    const harness = makeHarness();
    expect((await runAutofocus(harness.args({ command: '   ' }))).kind).toBe('preflight-failed');
  });

  it('rejects multi-line commands', async () => {
    const harness = makeHarness();
    const result = await runAutofocus(harness.args({ command: '$HZ1\nG1 Z0' }));
    expect(result.kind).toBe('preflight-failed');
    if (result.kind === 'preflight-failed') expect(result.reason).toMatch(/single line/i);
  });

  it('rejects when controller is not Idle', async () => {
    const harness = makeHarness();
    const result = await runAutofocus(
      harness.args({ statusReport: { ...idleStatus(), state: 'Run' } }),
    );
    expect(result.kind).toBe('preflight-failed');
    if (result.kind === 'preflight-failed') expect(result.reason).toMatch(/Idle/i);
  });
});

describe('runAutofocus — shared response ownership', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sends the command through the shared write function', async () => {
    const harness = makeHarness();
    const pending = runAutofocus(harness.args());
    await flush();
    expect(harness.written).toEqual(['$HZ1\n']);
    harness.emit('ok');
    harness.emit('<Idle|MPos:0.000,0.000,-8.000|FS:0,0>');
    expect((await pending).kind).toBe('ok');
  });

  it('resolves when ok and Idle arrive synchronously in one pump turn', async () => {
    const harness = makeHarness();
    const pending = runAutofocus(harness.args());
    await flush();
    harness.emit('ok');
    harness.emit('<Idle|MPos:0.000,0.000,-8.000|FS:0,0>');
    expect((await pending).kind).toBe('ok');
  });

  it('retains ok and Idle delivered before the shared write promise resolves', async () => {
    let releaseWrite: () => void = () => undefined;
    const harness = makeHarness(
      async () =>
        await new Promise<void>((resolve) => {
          releaseWrite = resolve;
        }),
    );
    const pending = runAutofocus(harness.args());
    await flush();

    harness.emit('ok');
    harness.emit('<Idle|MPos:0.000,0.000,-8.000|FS:0,0>');
    releaseWrite();
    await flush();

    expect((await pending).kind).toBe('ok');
  });

  it('accepts an active-to-Idle cycle that completes before the terminal ok', async () => {
    const harness = makeHarness();
    const pending = runAutofocus(harness.args());
    await flush();
    harness.emit('<Run|MPos:0.000,0.000,-2.000|FS:0,0>');
    harness.emit('<Idle|MPos:0.000,0.000,-8.000|FS:0,0>');
    harness.emit('ok');
    expect((await pending).kind).toBe('ok');
  });

  it('ignores a stale pre-ack Idle until a fresh post-ack Idle arrives', async () => {
    const harness = makeHarness();
    let settled = false;
    const pending = runAutofocus(harness.args()).then((result) => {
      settled = true;
      return result;
    });
    await flush();
    harness.emit('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    harness.emit('ok');
    await flush();
    expect(settled).toBe(false);
    harness.emit('<Idle|MPos:0.000,0.000,-8.000|FS:0,0>');
    expect((await pending).kind).toBe('ok');
  });

  it('rejects on error response with the error code', async () => {
    const harness = makeHarness();
    const pending = runAutofocus(harness.args());
    await flush();
    harness.emit('error:20');
    expect(await pending).toEqual({ kind: 'rejected', errorCode: 20, raw: 'error:20' });
  });

  it('preserves unrecognized error responses without assigning a GRBL code', async () => {
    const harness = makeHarness();
    const pending = runAutofocus(harness.args());
    await flush();
    harness.emit('error:7002009');
    expect(await pending).toEqual({
      kind: 'rejected',
      errorCode: null,
      raw: 'error:7002009',
    });
  });

  it('rejects on Alarm status', async () => {
    const harness = makeHarness();
    const pending = runAutofocus(harness.args());
    await flush();
    harness.emit('ok');
    harness.emit('<Alarm|MPos:0.000,0.000,0.000|FS:0,0>');
    expect((await pending).kind).toBe('alarm');
  });

  it('rejects on a terminal ALARM with its code', async () => {
    const harness = makeHarness();
    const pending = runAutofocus(harness.args());
    await flush();
    harness.emit('ALARM:3');
    expect(await pending).toEqual({ kind: 'alarm', alarmCode: 3 });
  });

  it('times out and releases the semantic owner', async () => {
    const harness = makeHarness();
    const pending = runAutofocus(harness.args({ timeoutMs: 1000 }));
    await flush();
    await vi.advanceTimersByTimeAsync(1500);
    expect((await pending).kind).toBe('timeout');
    expect(harness.refs.controllerCommand).toBeNull();
  });

  it('is cancelled promptly through the shared lifecycle', async () => {
    const harness = makeHarness();
    const pending = runAutofocus(harness.args());
    await flush();
    cancelControllerLifecycleRefs(harness.refs, 'Controller disconnected.');
    expect(await pending).toEqual({
      kind: 'preflight-failed',
      reason: 'Controller disconnected.',
    });
  });

  it('reports shared write failures and releases the semantic owner', async () => {
    const harness = makeHarness(async () => {
      throw new Error('USB write failed');
    });
    expect(await runAutofocus(harness.args())).toEqual({
      kind: 'preflight-failed',
      reason: 'USB write failed',
    });
    expect(harness.refs.controllerCommand).toBeNull();
  });
});

async function flush(): Promise<void> {
  for (let i = 0; i < 4; i += 1) await Promise.resolve();
}

describe('describeAutofocusResult', () => {
  it('maps error:20 to a helpful firmware hint', () => {
    const result = describeAutofocusResult({ kind: 'rejected', errorCode: 20, raw: 'error:20' });
    expect(result.variant).toBe('error');
    expect(result.message).toMatch(/firmware/i);
  });

  it('maps error:9 to the no-probe-pin hint', () => {
    const result = describeAutofocusResult({ kind: 'rejected', errorCode: 9, raw: 'error:9' });
    expect(result.message).toMatch(/probe pin/i);
  });

  it('maps unrecognized error responses to the raw controller reply', () => {
    const result = describeAutofocusResult({
      kind: 'rejected',
      errorCode: null,
      raw: 'error:7002009',
    });
    expect(result.message).toContain('error:7002009');
  });

  it('maps timeout to a warning', () => {
    const result = describeAutofocusResult({ kind: 'timeout' });
    expect(result.variant).toBe('warning');
    expect(result.message).toMatch(/may still be moving/i);
    expect(result.message).toMatch(/physical/i);
  });

  it('maps ok to a success toast', () => {
    const result = describeAutofocusResult({ kind: 'ok' });
    expect(result.variant).toBe('success');
  });
});
