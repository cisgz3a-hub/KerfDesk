/**
 * T1-23: pause must emit feed-hold then explicit M5; resume must
 * reassert the captured spindle mode before cycle-start.
 *
 * Run: npx tsx tests/pause-emits-m5-after-feed-hold.test.ts
 */
import { GrblController } from '../src/controllers/grbl/GrblController';
import type { SerialPortLike } from '../src/communication/SerialPort';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

interface SentEvent {
  kind: 'line' | 'byte' | 'critical';
  data: string | number;
}

function makeMockPort(): { port: SerialPortLike; events: SentEvent[]; flush: () => Promise<void> } {
  const events: SentEvent[] = [];
  let open = true;
  const port: SerialPortLike = {
    get isOpen() {
      return open;
    },
    write(data: string) {
      events.push({ kind: 'line', data });
    },
    writeByte(byte: number) {
      events.push({ kind: 'byte', data: byte });
    },
    async writeCritical(data: string) {
      events.push({ kind: 'critical', data });
    },
    async writeByteCritical(byte: number) {
      events.push({ kind: 'byte', data: byte });
    },
    onData() {
      /* no-op */
    },
    onError() {
      /* no-op */
    },
    onClose() {
      /* no-op */
    },
    close() {
      open = false;
    },
  };

  return {
    port,
    events,
    flush: async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

function makeController(): { ctrl: GrblController; events: SentEvent[]; flush: () => Promise<void> } {
  const { port, events, flush } = makeMockPort();
  const ctrl = new GrblController();
  const internals = ctrl as unknown as {
    _port: SerialPortLike;
    _isJobRunning: boolean;
    _state: { status: string };
  };
  internals._port = port;
  internals._isJobRunning = true;
  internals._state = { ...internals._state, status: 'run' };
  return { ctrl, events, flush };
}

console.log('\n=== T1-23 pause emits M5 + resume reasserts spindle mode ===\n');

async function main(): Promise<void> {
  {
    const { ctrl, events, flush } = makeController();
    ctrl.pause();
    await flush();
    const feedHoldIdx = events.findIndex(e => e.kind === 'byte' && e.data === 0x21);
    const m5Idx = events.findIndex(e => e.kind === 'critical' && typeof e.data === 'string' && e.data.includes('M5'));
    assert(
      feedHoldIdx >= 0 && m5Idx >= 0 && feedHoldIdx < m5Idx,
      'pause: emits feed-hold byte before M5 writeCritical',
    );
  }

  {
    const { ctrl, events, flush } = makeController();
    const internals = ctrl as unknown as {
      _lastSpindleMode: 'M3' | 'M4' | null;
      _state: { status: string };
    };
    internals._lastSpindleMode = 'M3';
    ctrl.pause();
    await flush();
    internals._state = { ...internals._state, status: 'hold' };
    events.length = 0;
    ctrl.resume();
    await flush();
    const reassertIdx = events.findIndex(e => e.kind === 'critical' && typeof e.data === 'string' && e.data.includes('M3 S0'));
    const cycleStartIdx = events.findIndex(e => e.kind === 'byte' && e.data === 0x7E);
    assert(
      reassertIdx >= 0 && cycleStartIdx >= 0 && reassertIdx < cycleStartIdx,
      'resume after M3-mode pause: emits M3 S0 before cycle-start',
    );
  }

  {
    const { ctrl, events, flush } = makeController();
    const internals = ctrl as unknown as {
      _lastSpindleMode: 'M3' | 'M4' | null;
      _state: { status: string };
    };
    internals._lastSpindleMode = 'M4';
    ctrl.pause();
    await flush();
    internals._state = { ...internals._state, status: 'hold' };
    events.length = 0;
    ctrl.resume();
    await flush();
    const m4Reassert = events.findIndex(e => e.kind === 'critical' && typeof e.data === 'string' && e.data.includes('M4 S0'));
    const m3Reassert = events.findIndex(e => e.kind === 'critical' && typeof e.data === 'string' && e.data.includes('M3 S0'));
    assert(
      m4Reassert >= 0 && m3Reassert < 0,
      'resume after M4-mode pause: emits M4 S0, not M3',
    );
  }

  {
    const { ctrl, events, flush } = makeController();
    const internals = ctrl as unknown as { _state: { status: string } };
    ctrl.pause();
    await flush();
    internals._state = { ...internals._state, status: 'hold' };
    events.length = 0;
    ctrl.resume();
    await flush();
    const anyReassert = events.findIndex(e =>
      e.kind === 'critical'
      && typeof e.data === 'string'
      && (e.data.includes('M3') || e.data.includes('M4')));
    const cycleStartIdx = events.findIndex(e => e.kind === 'byte' && e.data === 0x7E);
    assert(
      anyReassert < 0 && cycleStartIdx >= 0,
      'resume with no prior spindle mode: no reassert, still emits cycle-start',
    );
  }

  {
    const { ctrl } = makeController();
    const internals = ctrl as unknown as {
      _trackSpindleMode: (line: string) => void;
      _lastSpindleMode: 'M3' | 'M4' | null;
    };
    internals._trackSpindleMode('M3 S100');
    assert(internals._lastSpindleMode === 'M3', '_trackSpindleMode: M3 sets mode');
  }

  {
    const { ctrl } = makeController();
    const internals = ctrl as unknown as {
      _trackSpindleMode: (line: string) => void;
      _lastSpindleMode: 'M3' | 'M4' | null;
    };
    internals._trackSpindleMode('M4 S0');
    assert(internals._lastSpindleMode === 'M4', '_trackSpindleMode: M4 sets mode');
  }

  {
    const { ctrl } = makeController();
    const internals = ctrl as unknown as {
      _trackSpindleMode: (line: string) => void;
      _lastSpindleMode: 'M3' | 'M4' | null;
    };
    internals._lastSpindleMode = 'M3';
    internals._trackSpindleMode('M5');
    assert(internals._lastSpindleMode === null, '_trackSpindleMode: M5 clears mode');
  }

  {
    const { ctrl } = makeController();
    const internals = ctrl as unknown as {
      _trackSpindleMode: (line: string) => void;
      _lastSpindleMode: 'M3' | 'M4' | null;
    };
    internals._lastSpindleMode = 'M4';
    internals._trackSpindleMode('G1 X10 Y10 (was M5 here before)');
    assert(internals._lastSpindleMode === 'M4', '_trackSpindleMode: M5 inside comment is ignored');
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void main();

export {};
