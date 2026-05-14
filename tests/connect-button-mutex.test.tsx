/**
 * T1-50 Part A: ConnectWizard's Connect-via-USB button (and Use
 * Simulator button) must be disabled while a connect is already in
 * flight. Without this UI mutex, two rapid clicks each call into
 * `machineService.connectRealLaser`, each constructing a new
 * WebSerialPort and racing on `requestAndOpen` / `controller.connect`.
 *
 * Behavioral test on ConnectWizard via JSDOM + React. Mounts the
 * component with `connecting={true}` / `connecting={false}` and asserts:
 *
 *   - When connecting, the button is `disabled` and shows "Connecting…"
 *   - Clicking a disabled button does not invoke onConnectUsb / onConnectSimulator
 *   - When not connecting, the button shows the regular label and clicks fire
 *
 * Run: npx tsx tests/connect-button-mutex.test.tsx
 */
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ConnectWizard } from '../src/ui/components/connection/ConnectWizard';

const dom = new JSDOM('<!DOCTYPE html><div id="root"></div>', { url: 'http://localhost' });
const win = dom.window;
(globalThis as any).window = win;
(globalThis as any).document = win.document;
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

let root: Root | null = null;

interface Counters {
  usb: number;
  sim: number;
  cancel: number;
  forget: number;
}

async function renderWizard(
  connecting: boolean,
  options: { hasRememberedUsbDevice?: boolean } = {},
): Promise<{ counters: Counters; container: HTMLDivElement }> {
  const container = win.document.getElementById('root') as HTMLDivElement;
  if (root) {
    await act(async () => { root!.unmount(); });
  }
  root = createRoot(container);
  const counters: Counters = { usb: 0, sim: 0, cancel: 0, forget: 0 };
  await act(async () => {
    root!.render(
      React.createElement(ConnectWizard as React.ComponentType<any>, {
        webSerialSupported: true,
        onConnectUsb: () => { counters.usb += 1; },
        onConnectSimulator: () => { counters.sim += 1; },
        onCancelConnect: () => { counters.cancel += 1; },
        onForgetUsbDevice: () => { counters.forget += 1; },
        hasRememberedUsbDevice: options.hasRememberedUsbDevice ?? false,
        connecting,
      }),
    );
  });
  return { counters, container };
}

function findUsbButton(container: HTMLElement): HTMLButtonElement | null {
  return Array.from(container.querySelectorAll('button')).find(b =>
    /USB laser/i.test(b.textContent ?? '') || /Connecting/i.test(b.textContent ?? ''),
  ) as HTMLButtonElement | undefined ?? null;
}
function findSimButton(container: HTMLElement): HTMLButtonElement | null {
  return Array.from(container.querySelectorAll('button')).find(b =>
    /Simulator/i.test(b.textContent ?? '')
    || (b !== findUsbButton(container) && /Connecting/i.test(b.textContent ?? '')),
  ) as HTMLButtonElement | undefined ?? null;
}
function findCancelButton(container: HTMLElement): HTMLButtonElement | null {
  return Array.from(container.querySelectorAll('button')).find(b =>
    /Cancel connect/i.test(b.textContent ?? ''),
  ) as HTMLButtonElement | undefined ?? null;
}
function findForgetButton(container: HTMLElement): HTMLButtonElement | null {
  return Array.from(container.querySelectorAll('button')).find(b =>
    /Forget saved USB laser/i.test(b.textContent ?? ''),
  ) as HTMLButtonElement | undefined ?? null;
}

async function run(): Promise<void> {
  console.log('\n=== T1-50 Part A connect-button-mutex ===\n');

  try {
    // --- connecting=false: regular labels, clicks fire ---
    {
      const { counters, container } = await renderWizard(false);
      const usb = findUsbButton(container);
      const sim = findSimButton(container);
      assert(usb !== null, 'idle: USB button rendered');
      assert(sim !== null, 'idle: Simulator button rendered');
      assert(usb!.disabled === false, 'idle: USB button is enabled');
      assert(sim!.disabled === false, 'idle: Simulator button is enabled');
      assert(/USB laser/.test(usb!.textContent ?? ''),
        'idle: USB button shows "USB laser" label');
      assert(/Simulator/.test(sim!.textContent ?? ''),
        'idle: Simulator button shows "Simulator" label');

      assert(findCancelButton(container) === null,
        'idle: Cancel connect button is hidden');

      await act(async () => { usb!.click(); });
      assert(counters.usb === 1, 'idle: clicking USB fires onConnectUsb once');
      await act(async () => { sim!.click(); });
      assert(counters.sim === 1, 'idle: clicking Simulator fires onConnectSimulator once');
    }

    // --- remembered USB grant: operator can clear the saved device explicitly ---
    {
      const { counters, container } = await renderWizard(false, { hasRememberedUsbDevice: true });
      const forget = findForgetButton(container);
      assert(forget !== null, 'remembered USB: Forget saved USB laser button is rendered');
      assert(forget?.disabled === false, 'remembered USB: Forget saved USB laser button is enabled');
      if (forget) await act(async () => { forget.click(); });
      assert(counters.forget === 1, 'remembered USB: clicking Forget saved USB laser fires onForgetUsbDevice once');
    }

    // --- no remembered USB grant: no extra clutter ---
    {
      const { container } = await renderWizard(false, { hasRememberedUsbDevice: false });
      assert(findForgetButton(container) === null,
        'no remembered USB: Forget saved USB laser button is hidden');
    }

    // --- connecting=true: buttons disabled, label changed, clicks no-op ---
    {
      const { counters, container } = await renderWizard(true, { hasRememberedUsbDevice: true });
      const usb = findUsbButton(container);
      const sim = findSimButton(container);
      assert(usb !== null, 'connecting: USB button still rendered');
      assert(sim !== null, 'connecting: Simulator button still rendered');
      assert(usb!.disabled === true, 'connecting: USB button is disabled');
      assert(sim!.disabled === true, 'connecting: Simulator button is disabled');
      assert(/Connecting/.test(usb!.textContent ?? ''),
        'connecting: USB button label is "Connecting…"');
      assert(/Connecting/.test(sim!.textContent ?? ''),
        'connecting: Simulator button label is "Connecting…"');

      const cancel = findCancelButton(container);
      assert(cancel !== null, 'connecting: Cancel connect button is rendered');
      assert(cancel?.disabled === false, 'connecting: Cancel connect button stays enabled');
      assert(findForgetButton(container) === null,
        'connecting: Forget saved USB laser is hidden while a connect is in flight');

      // The mutex is enforced two ways:
      //   1. `disabled: true` — the browser ignores the click event.
      //   2. The onClick handler short-circuits if `connecting` is true,
      //      so even synthetic .click() during `connecting=true` is a
      //      defense-in-depth no-op.
      await act(async () => { usb!.click(); });
      await act(async () => { sim!.click(); });
      assert(counters.usb === 0, 'connecting: USB click does not invoke onConnectUsb');
      assert(counters.sim === 0, 'connecting: Simulator click does not invoke onConnectSimulator');
      await act(async () => { cancel?.click(); });
      assert(counters.cancel === 1, 'connecting: Cancel connect invokes onCancelConnect once');
    }

    // --- connecting prop omitted: defaults to false (safe default) ---
    {
      const container = win.document.getElementById('root') as HTMLDivElement;
      if (root) await act(async () => { root!.unmount(); });
      root = createRoot(container);
      let usbCount = 0;
      await act(async () => {
        root!.render(
          React.createElement(ConnectWizard, {
            webSerialSupported: true,
            onConnectUsb: () => { usbCount += 1; },
            onConnectSimulator: () => { /* noop */ },
          }),
        );
      });
      const usb = findUsbButton(container);
      assert(usb !== null && usb.disabled === false,
        'connecting prop omitted: defaults to enabled (safe default)');
      await act(async () => { usb!.click(); });
      assert(usbCount === 1,
        'connecting prop omitted: button click fires through to onConnectUsb');
    }

    // --- source pin: parent owns the AbortController and passes its signal ---
    {
      const here = path.dirname(fileURLToPath(import.meta.url));
      const panelSource = fs.readFileSync(path.resolve(here, '../src/ui/components/ConnectionPanelMain.tsx'), 'utf8');
      assert(/connectAbortRef\s*=\s*useRef<AbortController\s*\|\s*null>\(null\)/.test(panelSource),
        'source pin: ConnectionPanelMain stores the active connect AbortController in a ref');
      assert(/new AbortController\(\)/.test(panelSource),
        'source pin: ConnectionPanelMain creates an AbortController for real USB connect');
      assert(/connectRealLaser\(activeProfile\?\.baudRate\s*\?\?\s*115200,\s*connectAbortController\.signal\)/.test(panelSource),
        'source pin: real USB connect passes AbortSignal to MachineService.connectRealLaser');
      assert(/abort\(new Error\('Connection cancelled by user'\)\)/.test(panelSource),
        'source pin: cancel UI aborts the in-flight USB connect with a user-cancel reason');
      assert(/WebSerialPort\.forgetKnownPorts\(/.test(panelSource),
        'source pin: ConnectionPanelMain calls WebSerialPort.forgetKnownPorts for explicit saved-device cleanup');
      assert(/saveDeviceProfile\(\{[\s\S]*?fingerprint:\s*undefined[\s\S]*?\}\)/.test(panelSource),
        'source pin: ConnectionPanelMain clears the active serial profile fingerprint after forgetting the saved USB device');
      assert(/hasRememberedUsbDevice:\s*hasRememberedUsbDevice/.test(panelSource),
        'source pin: ConnectionPanelMain passes hasRememberedUsbDevice into ConnectWizard');
      assert(/onForgetUsbDevice:\s*hasRememberedUsbDevice\s*\?/.test(panelSource),
        'source pin: ConnectionPanelMain passes an explicit forget callback only when a remembered USB device exists');
    }
  } finally {
    if (root) {
      await act(async () => { root!.unmount(); });
      root = null;
    }
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void run().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
