/**
 * T1-97: Frame-before-start bypass override (per-session, free-user accessible).
 *
 * Run: npx tsx tests/frame-bypass-override.test.tsx
 */
import { JSDOM } from 'jsdom';
import React, { act, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const dom = new JSDOM('<!DOCTYPE html><div id="root"></div>', { url: 'http://localhost' });
const win = dom.window;
Object.defineProperty(globalThis, 'window', { value: win, configurable: true });
Object.defineProperty(globalThis, 'document', { value: win.document, configurable: true });
if (typeof (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame !== 'function') {
  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    value: (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number,
    configurable: true,
  });
}
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
}

interface HarnessState {
  frameBypass: boolean;
  hasFramed: boolean;
  canStart: boolean;
  messages: string[];
  enableBypass: (ack: boolean) => void;
  bumpHistory: () => void;
  setIsConnected: (next: boolean) => void;
  markFramed: () => void;
}

const captures: HarnessState[] = [];

function Harness({ requireFrame }: { requireFrame: boolean }): React.ReactElement {
  const hasFramed = useRef(false);
  const [frameBypassState, setFrameBypassState] = useState(false);
  const frameBypassRef = useRef(false);
  const setFrameBypass = useCallback((next: boolean) => {
    frameBypassRef.current = next;
    setFrameBypassState(next);
  }, []);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [isConnected, setIsConnected] = useState(true);
  const [renderVersion, setRenderVersion] = useState(0);
  const [messages, setMessages] = useState<string[]>([]);

  useEffect(() => {
    setFrameBypass(false);
    if (isConnected) {
      hasFramed.current = false;
    }
  }, [isConnected, setFrameBypass]);

  useEffect(() => {
    hasFramed.current = false;
    if (frameBypassRef.current) {
      setFrameBypass(false);
      setMessages(prev => [...prev, '⚠ Frame-bypass auto-disengaged: design changed.']);
    }
  }, [historyVersion, setFrameBypass]);

  const effectiveFrameBypass = frameBypassState;
  const canStart = !requireFrame || hasFramed.current || effectiveFrameBypass;

  captures.push({
    frameBypass: frameBypassState,
    hasFramed: hasFramed.current,
    canStart,
    messages,
    enableBypass: (ack: boolean) => {
      if (!ack) return;
      setFrameBypass(true);
      setMessages(prev => [...prev, '⚠ T1-97 FRAME-BYPASS ENABLED.']);
    },
    bumpHistory: () => setHistoryVersion(v => v + 1),
    setIsConnected,
    markFramed: () => {
      hasFramed.current = true;
      setRenderVersion(v => v + 1);
    },
  });
  void renderVersion;

  return React.createElement('div');
}

async function renderHarness(requireFrame = true): Promise<{ root: Root }> {
  const container = win.document.getElementById('root')!;
  container.innerHTML = '';
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(Harness, { requireFrame }));
  });
  return { root };
}

async function cleanup(root: Root): Promise<void> {
  await act(async () => { root.unmount(); });
}

async function run(): Promise<void> {
  console.log('\n=== T1-97 frame-bypass override (free-user accessible) ===\n');

  {
    captures.length = 0;
    const { root } = await renderHarness();
    const last = captures[captures.length - 1]!;
    assert(!last.frameBypass && !last.hasFramed && !last.canStart, 'initial state: bypass off and T1-59 enforced');
    await cleanup(root);
  }

  {
    captures.length = 0;
    const { root } = await renderHarness();
    await act(async () => { captures[captures.length - 1]!.enableBypass(true); });
    const last = captures[captures.length - 1]!;
    assert(last.frameBypass && !last.hasFramed && last.canStart, 'acknowledged bypass overrides frame conjunct');
    await cleanup(root);
  }

  {
    captures.length = 0;
    const { root } = await renderHarness();
    await act(async () => { captures[captures.length - 1]!.enableBypass(true); });
    await act(async () => { captures[captures.length - 1]!.bumpHistory(); });
    const last = captures[captures.length - 1]!;
    assert(!last.frameBypass && !last.canStart && last.messages.some(m => m.includes('auto-disengaged')),
      'historyVersion bump auto-disengages bypass and logs');
    await cleanup(root);
  }

  {
    captures.length = 0;
    const { root } = await renderHarness();
    await act(async () => { captures[captures.length - 1]!.enableBypass(true); });
    await act(async () => { captures[captures.length - 1]!.setIsConnected(false); });
    const disconnected = captures[captures.length - 1]!;
    await act(async () => { disconnected.markFramed(); });
    const framed = captures[captures.length - 1]!;
    await cleanup(root);

    captures.length = 0;
    const noFrame = await renderHarness(false);
    const noFrameLast = captures[captures.length - 1]!;
    assert(!disconnected.frameBypass && !disconnected.canStart, 'disconnect clears bypass and re-enforces the gate');
    assert(framed.canStart, 'normal frame path still passes without bypass');
    assert(noFrameLast.canStart, 'requireFrame=false makes bypass irrelevant');
    await cleanup(noFrame.root);
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void run().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
