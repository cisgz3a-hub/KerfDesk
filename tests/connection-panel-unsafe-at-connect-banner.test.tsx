/**
 * T3-91 (T1-25 follow-up): UnsafeAtConnectBanner renders the verdict
 * inline in the connection panel, with reason-specific recovery
 * actions, dismiss-without-recovery, and a clean unmount when the
 * verdict transitions to null.
 *
 * Run: npx tsx tests/connection-panel-unsafe-at-connect-banner.test.tsx
 */
import { JSDOM } from 'jsdom';
import { createRoot, type Root } from 'react-dom/client';
import React, { act } from 'react';
import { UnsafeAtConnectBanner } from '../src/ui/components/connection/UnsafeAtConnectBanner';
import {
  describeUnsafeAtConnect,
  type UnsafeAtConnectActionKind,
} from '../src/ui/components/connection/unsafeAtConnectMessages';
import type {
  UnsafeAtConnectReason,
  UnsafeAtConnectState,
} from '../src/controllers/grbl/GrblController';

const dom = new JSDOM('<!DOCTYPE html><div id="root"></div>', { url: 'http://localhost' });
const win = dom.window;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).window = win;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).document = win.document;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
if (typeof (globalThis as any).requestAnimationFrame !== 'function') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) =>
    setTimeout(() => cb(0), 0) as unknown as number;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let passed = 0;
let failed = 0;

function assert(c: boolean, m: string): void {
  if (c) {
    passed++;
    console.log(`  PASS ${m}`);
  } else {
    failed++;
    console.error(`  FAIL ${m}`);
  }
}

function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

const container = win.document.getElementById('root')!;
let root: Root | null = null;

function mount(node: React.ReactElement): void {
  if (root === null) root = createRoot(container);
  act(() => {
    root!.render(node);
  });
}

function unmount(): void {
  if (root !== null) {
    act(() => {
      root!.unmount();
    });
    root = null;
  }
  container.innerHTML = '';
}

function verdict(reason: UnsafeAtConnectReason): UnsafeAtConnectState {
  return {
    reason,
    capturedAt: 1_700_000_000_000,
    status: reason === 'alarm' ? 'alarm' : 'idle',
    alarmCode: reason === 'alarm' ? 1 : null,
    feedRate: 0,
    spindleSpeed: 0,
  };
}

console.log('\n=== T3-91 unsafe-at-connect banner ===\n');

void (async () => {
  // 1. Helper: every reason maps to a populated message + a valid
  //    action kind. No reason left unmapped.
  {
    const reasons: UnsafeAtConnectReason[] = [
      'alarm',
      'run',
      'hold',
      'check',
      'no-status-response',
      'unsafe-residual-spindle',
    ];
    for (const r of reasons) {
      const m = describeUnsafeAtConnect(r);
      assert(typeof m.headline === 'string' && m.headline.length > 0, `Helper(${r}): headline populated`);
      assert(typeof m.detail === 'string' && m.detail.length > 0, `Helper(${r}): detail populated`);
      assert(typeof m.actionLabel === 'string' && m.actionLabel.length > 0, `Helper(${r}): actionLabel populated`);
      assert(
        m.actionKind === 'reset' || m.actionKind === 'reconnect' || m.actionKind === 'm5',
        `Helper(${r}): actionKind is one of reset/reconnect/m5`,
      );
    }
  }

  // 2. Helper: reason → action mapping per the spec.
  {
    assert(describeUnsafeAtConnect('alarm').actionKind === 'reset', 'alarm → reset');
    assert(describeUnsafeAtConnect('run').actionKind === 'reconnect', 'run → reconnect');
    assert(describeUnsafeAtConnect('hold').actionKind === 'reconnect', 'hold → reconnect');
    assert(describeUnsafeAtConnect('check').actionKind === 'reconnect', 'check → reconnect');
    assert(
      describeUnsafeAtConnect('no-status-response').actionKind === 'reconnect',
      'no-status-response → reconnect',
    );
    assert(
      describeUnsafeAtConnect('unsafe-residual-spindle').actionKind === 'm5',
      'unsafe-residual-spindle → m5',
    );
  }

  // 3. Banner renders nothing when verdict is null.
  {
    const calls: UnsafeAtConnectActionKind[] = [];
    mount(
      <UnsafeAtConnectBanner
        unsafeVerdict={null}
        onRecoveryAction={(k): void => { calls.push(k); }}
      />,
    );
    const banner = container.querySelector('[data-test-id="unsafe-at-connect-banner"]');
    assert(banner === null, 'Null verdict: banner not rendered');
    unmount();
  }

  // 4. Banner renders alarm verdict with "Reset machine" action.
  {
    const calls: UnsafeAtConnectActionKind[] = [];
    mount(
      <UnsafeAtConnectBanner
        unsafeVerdict={verdict('alarm')}
        onRecoveryAction={(k): void => { calls.push(k); }}
      />,
    );
    const banner = container.querySelector('[data-test-id="unsafe-at-connect-banner"]');
    assert(banner !== null, 'Alarm verdict: banner rendered');
    assert(
      banner?.getAttribute('data-reason') === 'alarm',
      'Alarm verdict: data-reason="alarm"',
    );
    assert(
      banner?.textContent?.includes('alarm state from previous session') ?? false,
      'Alarm verdict: headline mentions alarm state',
    );
    const actionBtn = container.querySelector('[data-test-id="unsafe-at-connect-action"]');
    assert(actionBtn !== null, 'Alarm verdict: action button rendered');
    assert(
      actionBtn?.textContent === 'Reset machine',
      'Alarm verdict: action label "Reset machine"',
    );
    act(() => { (actionBtn as HTMLButtonElement | null)?.click(); });
    assert(calls.length === 1 && calls[0] === 'reset', 'Alarm verdict: clicking action calls onRecoveryAction("reset")');
    unmount();
  }

  // 5. Banner renders unsafe-residual-spindle with "Send M5 S0".
  {
    const calls: UnsafeAtConnectActionKind[] = [];
    mount(
      <UnsafeAtConnectBanner
        unsafeVerdict={verdict('unsafe-residual-spindle')}
        onRecoveryAction={(k): void => { calls.push(k); }}
      />,
    );
    const actionBtn = container.querySelector('[data-test-id="unsafe-at-connect-action"]');
    assert(actionBtn?.textContent === 'Send M5 S0', 'Residual spindle: action "Send M5 S0"');
    act(() => { (actionBtn as HTMLButtonElement | null)?.click(); });
    assert(calls.length === 1 && calls[0] === 'm5', 'Residual spindle: action calls onRecoveryAction("m5")');
    unmount();
  }

  // 6. Dismiss link hides banner (UI-only; preflight blocker still
  //    fires on Start click — outside this component's scope).
  {
    mount(
      <UnsafeAtConnectBanner
        unsafeVerdict={verdict('alarm')}
        onRecoveryAction={(): void => {}}
      />,
    );
    let banner = container.querySelector('[data-test-id="unsafe-at-connect-banner"]');
    assert(banner !== null, 'Pre-dismiss: banner present');
    const dismiss = container.querySelector('[data-test-id="unsafe-at-connect-dismiss"]');
    act(() => { (dismiss as HTMLButtonElement | null)?.click(); });
    banner = container.querySelector('[data-test-id="unsafe-at-connect-banner"]');
    assert(banner === null, 'Post-dismiss: banner unmounted');
    unmount();
  }

  // 7. Verdict transitions to null → banner unmounts; transitions
  //    back to non-null → banner re-renders (dismiss flag resets).
  {
    function App({ verdict: v }: { verdict: UnsafeAtConnectState | null }): React.ReactElement {
      return (
        <UnsafeAtConnectBanner unsafeVerdict={v} onRecoveryAction={(): void => {}} />
      );
    }

    mount(<App verdict={verdict('alarm')} />);
    assert(
      container.querySelector('[data-test-id="unsafe-at-connect-banner"]') !== null,
      'Verdict transitions: alarm → banner present',
    );

    mount(<App verdict={null} />);
    assert(
      container.querySelector('[data-test-id="unsafe-at-connect-banner"]') === null,
      'Verdict transitions: null → banner unmounts',
    );

    mount(<App verdict={verdict('hold')} />);
    await flush();
    assert(
      container.querySelector('[data-test-id="unsafe-at-connect-banner"]') !== null,
      'Verdict transitions: re-arm with hold → banner re-renders',
    );
    unmount();
  }

  // 8. Source pin: every UnsafeAtConnectReason has a case in the
  //    helper switch (no fall-through, no missing reason).
  {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const helperSrc = fs.readFileSync(
      path.resolve(here, '../src/app/unsafeAtConnectMessages.ts'),
      'utf-8',
    );
    for (const reason of [
      'alarm',
      'run',
      'hold',
      'door',
      'check',
      'no-status-response',
      'unsafe-residual-spindle',
    ]) {
      assert(
        new RegExp(`case ['"]${reason.replace(/-/g, '\\-')}['"]\\s*:`).test(helperSrc),
        `Helper source has case '${reason}'`,
      );
    }
    assert(/T3-91/.test(helperSrc), 'Helper source: T3-91 marker present');
  }

  console.log(`\nT3-91 unsafe-at-connect banner: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
