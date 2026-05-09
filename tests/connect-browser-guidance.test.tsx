/**
 * T3-71: ConnectWizard proactive browser guidance.
 *
 * Run: npx tsx tests/connect-browser-guidance.test.tsx
 */
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ConnectWizard } from '../src/ui/components/connection/ConnectWizard';
import { CONNECT_BROWSER_GUIDANCE_ACK_KEY } from '../src/ui/browser/BrowserCompatibility';

const dom = new JSDOM('<!DOCTYPE html><div id="root"></div>', { url: 'http://localhost' });
const win = dom.window;
Object.defineProperty(globalThis, 'window', { value: win, configurable: true });
Object.defineProperty(globalThis, 'document', { value: win.document, configurable: true });
Object.defineProperty(globalThis, 'localStorage', { value: win.localStorage, configurable: true });
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });

let passed = 0;
let failed = 0;
function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ok - ${message}`);
  } else {
    failed++;
    console.error(`  not ok - ${message}`);
  }
}

async function renderWizard(
  props: Partial<React.ComponentProps<typeof ConnectWizard>>,
): Promise<{ container: HTMLElement; root: Root }> {
  const container = win.document.getElementById('root')!;
  container.innerHTML = '';
  win.localStorage.removeItem(CONNECT_BROWSER_GUIDANCE_ACK_KEY);
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(ConnectWizard, {
      webSerialSupported: true,
      onConnectUsb: () => undefined,
      onConnectSimulator: () => undefined,
      ...props,
    }));
  });
  return { container, root };
}

async function cleanup(root: Root): Promise<void> {
  await act(async () => { root.unmount(); });
}

async function run(): Promise<void> {
  console.log('\n=== T3-71 ConnectWizard browser guidance ===\n');

  {
    const { container, root } = await renderWizard({
      webSerialSupported: false,
      browserCompatibility: {
        family: 'firefox',
        name: 'Firefox',
        version: '121.0',
        webSerialSupported: false,
        canUseUsbLaser: false,
        recommendedBrowser: false,
      },
    });
    const text = container.textContent ?? '';
    assert(container.querySelector('[data-testid="connect-browser-warning"]') != null, 'unsupported browser warning renders');
    assert(text.includes("You're using Firefox 121.0"), 'unsupported warning names detected browser');
    assert(text.includes('Chrome') && text.includes('Edge') && text.includes('simulator mode'), 'unsupported warning gives supported-browser and simulator guidance');
    const buttons = Array.from(container.querySelectorAll('button')).map(btn => btn.textContent ?? '');
    assert(!buttons.includes('USB laser'), 'USB laser button is hidden when Web Serial is unavailable');
    await cleanup(root);
  }

  {
    const { container, root } = await renderWizard({
      webSerialSupported: true,
      browserCompatibility: {
        family: 'chrome',
        name: 'Chrome',
        version: '124.0',
        webSerialSupported: true,
        canUseUsbLaser: true,
        recommendedBrowser: true,
      },
    });
    const text = container.textContent ?? '';
    assert(container.querySelector('[data-testid="connect-browser-guidance"]') != null, 'supported browser guidance renders');
    assert(text.includes('Connect the USB cable') && text.includes('browser permission popup'), 'supported guidance explains USB and permission expectations');
    assert(text.includes('USB laser'), 'USB laser button remains available when Web Serial is supported');

    const gotIt = Array.from(container.querySelectorAll('button')).find(btn => btn.textContent === 'Got it') as HTMLButtonElement | undefined;
    await act(async () => { gotIt?.click(); });
    assert(
      win.localStorage.getItem(CONNECT_BROWSER_GUIDANCE_ACK_KEY) === 'true' &&
        container.querySelector('[data-testid="connect-browser-guidance"]') == null,
      'Got it persists and hides the guidance',
    );
    await cleanup(root);
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void run().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
