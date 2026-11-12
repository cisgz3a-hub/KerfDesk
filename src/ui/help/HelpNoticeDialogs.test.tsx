// Annoyance audit A1-P3-1: Help > Safety & liability and Help > About were
// native alerts. The safety link could not be clicked, and during a job both
// were squeezed into a toast that left after eight seconds.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStreamer, step } from '../../core/controllers/grbl';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import { useUiStore } from '../state/ui-store';
import { HelpNoticeHost } from './HelpNoticeDialogs';
import { openHelpNotice } from './help-notices';
import { LICENSE_NOTICE_EVENT } from './license-notice';
import { SAFETY_NOTICE_BODY } from './safety-notice';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
const nativeAlert = vi.fn<(message?: string) => void>();

beforeEach(async () => {
  nativeAlert.mockClear();
  vi.spyOn(window, 'alert').mockImplementation(nativeAlert);
  host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    root = createRoot(host);
    root.render(<HelpNoticeHost />);
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  useLaserStore.setState({ streamer: null });
  useToastStore.setState({ toasts: [] });
  useUiStore.setState({ modalDepth: 0 });
  vi.restoreAllMocks();
});

async function open(kind: 'about' | 'safety'): Promise<HTMLElement> {
  await act(async () => openHelpNotice(kind));
  const dialog = host.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]');
  if (dialog === null) throw new Error(`the ${kind} dialog did not open`);
  return dialog;
}

function button(dialog: HTMLElement, text: string): HTMLButtonElement {
  const found = [...dialog.querySelectorAll('button')].find((b) => b.textContent === text);
  if (found === undefined) throw new Error(`button "${text}" missing`);
  return found;
}

describe('Help > Safety & liability', () => {
  it('opens as a dialog with the whole notice and a link that can be clicked', async () => {
    const dialog = await open('safety');

    expect(dialog.querySelector('h2')?.textContent).toBe('Safety & liability');
    expect(dialog.querySelector('pre')?.textContent).toBe(SAFETY_NOTICE_BODY);
    const link = dialog.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://kerfdesk.com/safety/');
    // The desktop app sends target=_blank https links to the browser (ADR-482).
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(nativeAlert).not.toHaveBeenCalled();
  });

  it('can be scrolled from the keyboard', async () => {
    const dialog = await open('safety');
    expect(dialog.querySelector('pre')?.getAttribute('tabindex')).toBe('0');
    expect(document.activeElement).toBe(dialog.querySelector('pre'));
  });

  it('stays readable during a job instead of becoming a toast', async () => {
    useLaserStore.setState({ streamer: step(createStreamer('G1 X1 S100')).state });

    const dialog = await open('safety');

    expect(dialog.querySelector('pre')?.textContent).toBe(SAFETY_NOTICE_BODY);
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it('closes on Close and on Escape', async () => {
    const dialog = await open('safety');
    await act(async () => button(dialog, 'Close').click());
    expect(host.querySelector('[role="dialog"]')).toBeNull();

    const again = await open('safety');
    await act(async () => {
      again.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  it('hands over to the licence notice', async () => {
    const asked = vi.fn();
    window.addEventListener(LICENSE_NOTICE_EVENT, asked);
    try {
      const dialog = await open('safety');
      await act(async () => button(dialog, 'License & Safety Notice…').click());

      expect(asked).toHaveBeenCalledTimes(1);
      expect(host.querySelector('[role="dialog"]')).toBeNull();
    } finally {
      window.removeEventListener(LICENSE_NOTICE_EVENT, asked);
    }
  });
});

describe('Help > About', () => {
  it('opens as a dialog with the build, the terms line and the safety reminder', async () => {
    const dialog = await open('about');
    const text = dialog.querySelector('pre')?.textContent ?? '';

    expect(dialog.querySelector('h2')?.textContent).toMatch(/^About /);
    expect(text).toContain(`Commit ${__GIT_SHA__}`);
    expect(text).toContain('All rights reserved.');
    // verify-packaged-preview-metadata.mjs finds the About asset by this line.
    expect(text).toContain('Terms of use: License & Safety Notice');
    expect(text).toContain('never\nleave a running machine unattended.');
    expect(nativeAlert).not.toHaveBeenCalled();
  });

  it('opens on Close, so a stray key cannot act on anything else', async () => {
    const dialog = await open('about');
    expect(document.activeElement).toBe(button(dialog, 'Close'));
  });

  it('stays readable during a job instead of becoming a toast', async () => {
    useLaserStore.setState({ streamer: step(createStreamer('G1 X1 S100')).state });

    const dialog = await open('about');

    expect(dialog.querySelector('pre')?.textContent).toContain('Copyright');
    expect(useToastStore.getState().toasts).toEqual([]);
  });
});
