/**
 * T1-157: regression test for the completion-beep extraction.
 *
 * Verifies the beep envelope (880 Hz sine, two pulses at 0/200ms with
 * 120ms gain-up windows, stopped at 400ms) by mocking AudioContext
 * and asserting the oscillator + gain operations match the
 * pre-extraction contract.
 *
 * Run: npx tsx tests/play-completion-beep.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { playCompletionBeep } from '../src/ui/components/connection/playCompletionBeep';

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

interface RecordedCall {
  fn: string;
  args: unknown[];
}

interface MockAudioCtx {
  currentTime: number;
  destination: object;
  createOscillator: () => MockOscillator;
  createGain: () => MockGain;
}
interface MockOscillator {
  frequency: { value: number };
  type: OscillatorType;
  connect: (target: unknown) => void;
  start: (when: number) => void;
  stop: (when: number) => void;
}
interface MockGain {
  gain: {
    setValueAtTime: (value: number, when: number) => void;
  };
  connect: (target: unknown) => void;
}

function setupMockAudio(): { calls: RecordedCall[]; restore: () => void } {
  const calls: RecordedCall[] = [];

  const oscillator: MockOscillator = {
    frequency: { value: 0 },
    type: 'sine',
    connect: (t) => calls.push({ fn: 'osc.connect', args: [t] }),
    start: (w) => calls.push({ fn: 'osc.start', args: [w] }),
    stop: (w) => calls.push({ fn: 'osc.stop', args: [w] }),
  };
  const gain: MockGain = {
    gain: {
      setValueAtTime: (v, w) => calls.push({ fn: 'gain.setValueAtTime', args: [v, w] }),
    },
    connect: (t) => calls.push({ fn: 'gain.connect', args: [t] }),
  };
  const ctx: MockAudioCtx = {
    currentTime: 0,
    destination: { tag: 'destination' },
    createOscillator: () => oscillator,
    createGain: () => gain,
  };

  const origWindow = globalThis.window as unknown;
  const fakeWindow = {
    AudioContext: function () { return ctx; },
  };
  (globalThis as unknown as { window: unknown }).window = fakeWindow;

  return {
    calls,
    restore: () => {
      (globalThis as unknown as { window: unknown }).window = origWindow;
    },
  };
}

console.log('\n=== T1-157 play completion beep ===\n');

// -------- WebAudio sequence pinned --------
{
  const { calls, restore } = setupMockAudio();
  try {
    playCompletionBeep();
  } finally {
    restore();
  }
  // Expected sequence:
  //  - osc.connect(gain)
  //  - gain.connect(destination)
  //  - setValueAtTime(0.15, 0)
  //  - setValueAtTime(0, 0.12)
  //  - setValueAtTime(0.15, 0.20)
  //  - setValueAtTime(0, 0.32)
  //  - osc.start(0)
  //  - osc.stop(0.40)
  assert(calls.length === 8,
    `8 audio operations expected (got ${calls.length})`);

  assert(calls[0].fn === 'osc.connect',
    'first op: oscillator → gain connect');
  assert(calls[1].fn === 'gain.connect',
    'second op: gain → destination connect');

  // Gain envelope
  assert(calls[2].fn === 'gain.setValueAtTime' && calls[2].args[0] === 0.15 && calls[2].args[1] === 0,
    'pulse 1 start: gain 0.15 at t=0');
  assert(calls[3].fn === 'gain.setValueAtTime' && calls[3].args[0] === 0 && Math.abs(Number(calls[3].args[1]) - 0.12) < 1e-9,
    'pulse 1 end: gain 0 at t=0.12');
  assert(calls[4].fn === 'gain.setValueAtTime' && calls[4].args[0] === 0.15 && Math.abs(Number(calls[4].args[1]) - 0.2) < 1e-9,
    'pulse 2 start: gain 0.15 at t=0.20');
  assert(calls[5].fn === 'gain.setValueAtTime' && calls[5].args[0] === 0 && Math.abs(Number(calls[5].args[1]) - 0.32) < 1e-9,
    'pulse 2 end: gain 0 at t=0.32');

  assert(calls[6].fn === 'osc.start' && calls[6].args[0] === 0,
    'oscillator start at t=0');
  assert(calls[7].fn === 'osc.stop' && Math.abs(Number(calls[7].args[0]) - 0.4) < 1e-9,
    'oscillator stop at t=0.40');
}

// -------- No AudioContext available → silent no-op --------
{
  const origWindow = globalThis.window as unknown;
  (globalThis as unknown as { window: unknown }).window = {};
  let threw = false;
  try {
    playCompletionBeep();
  } catch {
    threw = true;
  }
  (globalThis as unknown as { window: unknown }).window = origWindow;
  assert(!threw, 'no AudioContext → silent no-op (no throw)');
}

// -------- AudioContext throws → swallowed --------
{
  const origWindow = globalThis.window as unknown;
  (globalThis as unknown as { window: unknown }).window = {
    AudioContext: function () { throw new Error('audio busy'); },
  };
  let threw = false;
  try {
    playCompletionBeep();
  } catch {
    threw = true;
  }
  (globalThis as unknown as { window: unknown }).window = origWindow;
  assert(!threw, 'AudioContext constructor throws → swallowed (no throw)');
}

// -------- Source-level pin: ConnectionPanelMain delegates --------
{
  const here = dirname(fileURLToPath(import.meta.url));
  const panelSrc = readFileSync(
    resolve(here, '../src/ui/components/ConnectionPanelMain.tsx'),
    'utf-8',
  );
  assert(/from '\.\/connection\/playCompletionBeep'/.test(panelSrc),
    'ConnectionPanelMain imports from ./connection/playCompletionBeep');
  assert(/T1-157/.test(panelSrc),
    'ConnectionPanelMain carries T1-157 marker');
  assert(!/^function playCompletionBeep/m.test(panelSrc),
    'inline playCompletionBeep is gone from ConnectionPanelMain');

  const helperSrc = readFileSync(
    resolve(here, '../src/ui/components/connection/playCompletionBeep.ts'),
    'utf-8',
  );
  assert(/T1-157/.test(helperSrc),
    'playCompletionBeep helper carries T1-157 marker');
  assert(/export function playCompletionBeep/.test(helperSrc),
    'playCompletionBeep is exported');
  // Envelope constants present in helper (sanity)
  assert(/880/.test(helperSrc), 'helper carries 880 Hz frequency');
  assert(/0\.15/.test(helperSrc), 'helper carries 0.15 gain value');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
