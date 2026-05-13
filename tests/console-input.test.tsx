/**
 * GRBL ConsoleInput — wiring via quick-command buttons (same send() path as typed Send).
 * Run: npx tsx tests/console-input.test.tsx
 */
import { JSDOM } from 'jsdom';
import { createRoot, type Root } from 'react-dom/client';
import React, { act } from 'react';
import { ConsoleInput } from '../src/ui/components/ConsoleInput';
import { type LaserController, type RawLineCallback } from '../src/controllers/ControllerInterface';

const dom = new JSDOM('<!DOCTYPE html><div id="root"></div>', { url: 'http://localhost' });
const win = dom.window;
(globalThis as any).window = win;
(globalThis as any).document = win.document;
if (typeof (globalThis as any).requestAnimationFrame !== 'function') {
  (globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) =>
    setTimeout(() => cb(0), 0) as unknown as number;
}
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let passed = 0;
let failed = 0;

function assert(c: boolean, m: string): void {
  if (c) {
    passed++;
    console.log(`  ✓ ${m}`);
  } else {
    failed++;
    console.error(`  ✗ ${m}`);
  }
}

function flush(): Promise<void> {
  return new Promise(r => setTimeout(r, 0));
}

const container = win.document.getElementById('root')!;

let root: Root | null = null;

function makeController(opts?: {
  throwOnSend?: boolean;
}): { ctrl: LaserController; sends: Array<{ cmd: string; source?: 'internal' | 'user' }>; emit: RawLineCallback } {
  const sends: Array<{ cmd: string; source?: 'internal' | 'user' }> = [];
  const rawSubs: RawLineCallback[] = [];

  const emit: RawLineCallback = (line, direction, kind) => {
    for (const cb of rawSubs) cb(line, direction, kind);
  };

  const ctrl = {
    protocolName: 'stub',
    state: {
      status: 'idle' as const,
      position: { x: 0, y: 0, z: 0 },
      feedRate: 0,
      spindleSpeed: 0,
      alarmCode: null,
      errorCode: null,
    },
    isJobRunning: false,
    maxSpindle: null,
    sendCommand(command: string, source?: 'internal' | 'user'): void {
      if (opts?.throwOnSend) throw new Error('simulated guard');
      sends.push({ cmd: command, source });
    },
    onRawLine(cb: RawLineCallback) {
      rawSubs.push(cb);
      return () => {
        const i = rawSubs.indexOf(cb);
        if (i >= 0) rawSubs.splice(i, 1);
      };
    },
  } as unknown as LaserController;

  return { ctrl, sends, emit };
}

async function renderConsole(props: {
  controller: LaserController | null;
  isConnected: boolean;
  isRunning: boolean;
  sendUserCommand?: (cmd: string) => void | Promise<void>;
}): Promise<void> {
  if (root) {
    root.unmount();
    root = null;
  }
  root = createRoot(container);
  await act(async () => {
    root!.render(
      React.createElement(ConsoleInput, {
        controller: props.controller,
        isConnected: props.isConnected,
        isRunning: props.isRunning,
        sendUserCommand: props.sendUserCommand ?? ((cmd: string) => props.controller?.sendCommand(cmd, 'user')),
      }),
    );
  });
  await flush();
}

async function cleanup(): Promise<void> {
  if (root) {
    await act(async () => {
      root!.unmount();
    });
    root = null;
  }
  await flush();
}

async function main(): Promise<void> {
  console.log('\n=== ConsoleInput: quick $$ sends with user source ===');
  {
    const { ctrl, sends } = makeController();
    await renderConsole({ controller: ctrl, isConnected: true, isRunning: false });
    const btn = [...container.querySelectorAll('button')].find(b => b.textContent === '$$');
    assert(btn !== undefined, '$$ quick button exists');
    await act(async () => {
      btn!.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    });
    await flush();
    assert(sends.length === 1 && sends[0]!.cmd === '$$' && sends[0]!.source === 'user', 'first $$ → sendCommand($$, user)');
    await act(async () => {
      btn!.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    });
    await flush();
    assert(sends.length === 2 && sends[1]!.cmd === '$$' && sends[1]!.source === 'user', 'second click → second send with user');
    await cleanup();
  }

  console.log('\n=== ConsoleInput: four quick-command buttons ===');
  {
    const { ctrl } = makeController();
    await renderConsole({ controller: ctrl, isConnected: true, isRunning: false });
    const labels = ['$$', '?', '$X', '$32=1'];
    for (const lab of labels) {
      const b = [...container.querySelectorAll('button')].find(x => x.textContent === lab);
      assert(b !== undefined, `quick button ${lab} renders`);
    }
    const dumpBtn = [...container.querySelectorAll('button')].find(b => b.textContent === '$$');
    assert(
      dumpBtn?.getAttribute('title')?.includes('settings') === true || dumpBtn?.getAttribute('title')?.includes('GRBL') === true,
      '$$ button has descriptive title when idle',
    );
    await cleanup();
  }

  console.log('\n=== ConsoleInput: sendCommand error surfaces in log ===');
  {
    const { ctrl, sends } = makeController({ throwOnSend: true });
    await renderConsole({ controller: ctrl, isConnected: true, isRunning: false });
    const btn = [...container.querySelectorAll('button')].find(b => b.textContent === '?');
    await act(async () => {
      btn!.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    });
    await flush();
    assert(sends.length === 0, 'throwing sendCommand does not record successful send');
    assert(container.textContent!.includes('[error]'), 'log shows [error] prefix');
    assert(container.textContent!.includes('simulated guard'), 'log shows error message body');
    await cleanup();
  }

  console.log('\n=== ConsoleInput: disabled when job running ===');
  {
    const { ctrl, sends } = makeController();
    await renderConsole({ controller: ctrl, isConnected: true, isRunning: true });
    const inp = container.querySelector('input');
    const sendBtn = [...container.querySelectorAll('button')].find(b => b.textContent === 'Send');
    const quick = [...container.querySelectorAll('button')].find(b => b.textContent === '$32=1');
    assert(inp?.disabled === true, 'text input disabled while running');
    assert(sendBtn?.disabled === true, 'Send disabled while running');
    assert(quick?.disabled === true, 'quick command disabled while running');
    await act(async () => {
      quick!.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    });
    await flush();
    assert(sends.length === 0, 'disabled quick click does not call sendCommand');
    await cleanup();
  }

  console.log('\n=== ConsoleInput: Send disabled when input empty ===');
  {
    const { ctrl } = makeController();
    await renderConsole({ controller: ctrl, isConnected: true, isRunning: false });
    const sendBtn = [...container.querySelectorAll('button')].find(b => b.textContent === 'Send');
    assert(sendBtn?.disabled === true, 'Send disabled with empty input');
    assert(sendBtn?.getAttribute('title') === 'Send command', 'Send shows helpful title when idle');
    await cleanup();
  }

  console.log('\n=== ConsoleInput: hidden when not connected ===');
  {
    const { ctrl } = makeController();
    await renderConsole({ controller: ctrl, isConnected: false, isRunning: false });
    assert(!container.textContent!.includes('GRBL Console'), 'no panel chrome when disconnected');
    assert(container.querySelector('input') === null, 'no input when disconnected');
    await cleanup();
  }

  console.log('\n=== ConsoleInput: raw-line log population ===');
  {
    const { ctrl, emit } = makeController();
    await renderConsole({ controller: ctrl, isConnected: true, isRunning: false });
    await act(async () => {
      emit('$$', 'tx', 'system');
      emit('$32=1', 'tx', 'user');
      emit('ok', 'rx');
    });
    await flush();
    const t = container.textContent ?? '';
    assert(t.includes('> $$'), 'system tx appears in log');
    assert(t.includes('> $32=1'), 'user tx appears in log');
    assert(t.includes('ok'), 'rx appears in log');
    await cleanup();
  }

  console.log('\n=== ConsoleInput: log capped at 80 lines ===');
  {
    const { ctrl, emit } = makeController();
    await renderConsole({ controller: ctrl, isConnected: true, isRunning: false });
    await act(async () => {
      for (let i = 0; i < 200; i++) {
        emit(`LINE_${i}`, 'rx');
      }
    });
    await flush();
    const t = container.textContent ?? '';
    assert(!t.includes('LINE_0'), 'oldest line rolled off');
    assert(t.includes('LINE_199'), 'newest line still visible');
    await cleanup();
  }

  console.log('\n=== ConsoleInput: disabled tooltip explains running job ===');
  {
    const { ctrl } = makeController();
    await renderConsole({ controller: ctrl, isConnected: true, isRunning: true });
    const quick = [...container.querySelectorAll('button')].find(b => b.textContent === '?');
    assert(quick?.getAttribute('title') === 'Job is running', 'quick button title when running');
    await cleanup();
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
