/**
 * LaserModeBanner — connect snapshot + enable/dismiss flows (stub controller).
 * Run: npx tsx tests/laser-mode-banner.test.tsx
 */
import { JSDOM } from 'jsdom';
import { createRoot, type Root } from 'react-dom/client';
import React, { act } from 'react';
import { LaserModeBanner } from '../src/ui/components/LaserModeBanner';
import { type LaserController } from '../src/controllers/ControllerInterface';

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

function makeStub(opts: {
  laserMode: boolean;
  throwSend?: boolean;
}): { ctrl: LaserController; sends: Array<{ cmd: string; source?: 'internal' | 'user' }> } {
  const sends: Array<{ cmd: string; source?: 'internal' | 'user' }> = [];
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
    getMachineInfo() {
      return { laserMode: opts.laserMode };
    },
    sendCommand(cmd: string, source?: 'internal' | 'user'): void {
      if (opts.throwSend) throw new Error('simulated send failure');
      sends.push({ cmd, source });
    },
  } as unknown as LaserController;
  return { ctrl, sends };
}

async function renderBanner(props: {
  controller: LaserController | null;
  isOperational: boolean;
  showConfirm: () => Promise<boolean>;
  sendUserCommand?: (cmd: string) => void | Promise<void>;
  appendMessage?: (msg: string) => void;
}): Promise<void> {
  if (root) {
    await act(async () => {
      root!.unmount();
    });
    root = null;
  }
  root = createRoot(container);
  await act(async () => {
    root!.render(
      React.createElement(LaserModeBanner, {
        controller: props.controller,
        isOperational: props.isOperational,
        showConfirm: props.showConfirm,
        sendUserCommand: props.sendUserCommand ?? ((cmd: string) => props.controller?.sendCommand(cmd, 'user')),
        appendMessage: props.appendMessage,
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
  console.log('\n=== LaserModeBanner: shows when laser mode off + operational ===\n');
  {
    const { ctrl } = makeStub({ laserMode: false });
    await renderBanner({
      controller: ctrl,
      isOperational: true,
      showConfirm: async () => false,
    });
    const t = container.textContent ?? '';
    assert(t.includes('$32=0'), 'banner mentions $32=0');
    assert(t.includes('Enable laser mode'), 'Enable button label present');
    assert(t.includes('Frame and Test Fire'), 'explains Frame/Test Fire risk');
    await cleanup();
  }

  console.log('\n=== LaserModeBanner: hidden when laser mode on ===\n');
  {
    const { ctrl } = makeStub({ laserMode: true });
    await renderBanner({
      controller: ctrl,
      isOperational: true,
      showConfirm: async () => false,
    });
    const t = container.textContent ?? '';
    assert(!t.includes('standard CNC mode'), 'no banner headline when laser mode on');
    assert(container.querySelectorAll('button').length === 0, 'no action buttons when hidden');
    await cleanup();
  }

  console.log('\n=== LaserModeBanner: hidden while not operational ===\n');
  {
    const { ctrl } = makeStub({ laserMode: false });
    await renderBanner({
      controller: ctrl,
      isOperational: false,
      showConfirm: async () => false,
    });
    const t = container.textContent ?? '';
    assert(!t.includes('Machine in standard CNC mode'), 'no banner when not operational');
    assert(t.trim() === '' || !t.includes('Enable laser mode'), 'no enable affordance when not operational');
    await cleanup();
  }

  console.log('\n=== LaserModeBanner: Enable confirms and sends $32=1 ===\n');
  {
    const { ctrl, sends } = makeStub({ laserMode: false });
    const messages: string[] = [];
    await renderBanner({
      controller: ctrl,
      isOperational: true,
      showConfirm: async () => true,
      appendMessage: m => messages.push(m),
    });
    const enable = [...container.querySelectorAll('button')].find(b => b.textContent === 'Enable laser mode');
    assert(enable !== undefined, 'Enable button exists');
    await act(async () => {
      enable!.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    });
    await flush();
    assert(sends.length === 1 && sends[0]!.cmd === '$32=1' && sends[0]!.source === 'user', 'sendCommand($32=1, user)');
    assert(messages.some(m => m.includes('Laser mode enabled')), 'success message appended');
    assert(!(container.textContent ?? '').includes('standard CNC mode'), 'banner hides after optimistic flip');
    await cleanup();
  }

  console.log('\n=== LaserModeBanner: confirm declined — no send ===\n');
  {
    const { ctrl, sends } = makeStub({ laserMode: false });
    await renderBanner({
      controller: ctrl,
      isOperational: true,
      showConfirm: async () => false,
    });
    const enable = [...container.querySelectorAll('button')].find(b => b.textContent === 'Enable laser mode');
    await act(async () => {
      enable!.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    });
    await flush();
    assert(sends.length === 0, 'no send when confirm declined');
    assert((container.textContent ?? '').includes('standard CNC mode'), 'banner still visible after decline');
    await cleanup();
  }

  console.log('\n=== LaserModeBanner: sendCommand error surfaces ===\n');
  {
    const { ctrl } = makeStub({ laserMode: false, throwSend: true });
    const messages: string[] = [];
    await renderBanner({
      controller: ctrl,
      isOperational: true,
      showConfirm: async () => true,
      appendMessage: m => messages.push(m),
    });
    const enable = [...container.querySelectorAll('button')].find(b => b.textContent === 'Enable laser mode');
    await act(async () => {
      enable!.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    });
    await flush();
    assert(messages.some(m => m.includes('Failed to enable')), 'failure message appended');
    assert((container.textContent ?? '').includes('standard CNC mode'), 'banner stays visible on send error');
    await cleanup();
  }

  console.log('\n=== LaserModeBanner: Dismiss hides without send ===\n');
  {
    const { ctrl, sends } = makeStub({ laserMode: false });
    await renderBanner({
      controller: ctrl,
      isOperational: true,
      showConfirm: async () => true,
    });
    const dismiss = [...container.querySelectorAll('button')].find(b => b.textContent === 'Dismiss');
    assert(dismiss !== undefined, 'Dismiss button exists');
    await act(async () => {
      dismiss!.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    });
    await flush();
    assert(sends.length === 0, 'dismiss does not send commands');
    assert(!(container.textContent ?? '').includes('standard CNC mode'), 'banner hidden after dismiss');
    await cleanup();
  }

  console.log('\n=== LaserModeBanner: disconnect resets dismiss — banner can return ===\n');
  {
    const { ctrl } = makeStub({ laserMode: false });
    await renderBanner({
      controller: ctrl,
      isOperational: true,
      showConfirm: async () => false,
    });
    const dismiss = [...container.querySelectorAll('button')].find(b => b.textContent === 'Dismiss');
    await act(async () => {
      dismiss!.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    });
    await flush();
    await renderBanner({
      controller: ctrl,
      isOperational: false,
      showConfirm: async () => false,
    });
    await flush();
    assert(!(container.textContent ?? '').includes('standard CNC mode'), 'no banner while disconnected');
    await renderBanner({
      controller: ctrl,
      isOperational: true,
      showConfirm: async () => false,
    });
    await flush();
    assert((container.textContent ?? '').includes('standard CNC mode'), 'banner shows again after reconnect simulation');
    await cleanup();
  }

  console.log('\n=== LaserModeBanner: no getMachineInfo — unknown, no banner ===\n');
  {
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
      sendCommand: (): void => {},
    } as unknown as LaserController;
    await renderBanner({
      controller: ctrl,
      isOperational: true,
      showConfirm: async () => false,
    });
    const t = container.textContent ?? '';
    assert(!t.includes('standard CNC mode'), 'no headline without laserMode snapshot');
    assert([...container.querySelectorAll('button')].every(b => b.textContent !== 'Enable laser mode'), 'no Enable without snapshot');
    await cleanup();
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
