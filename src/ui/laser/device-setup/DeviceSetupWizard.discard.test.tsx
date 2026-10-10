// Escape and the header close button ask before an edited Machine Setup draft
// is discarded (ADR-420 Amendment 4); Cancel without saving stays immediate.

import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { machineKindOf } from '../../../core/scene';
import { useStore } from '../../state';
import { resetStore } from '../../state/test-helpers';
import { renderWizard } from './device-setup-wizard.test-support';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => resetStore());

describe('Machine Setup discard guard', () => {
  it('closes an unchanged draft on Escape at once', async () => {
    const onClose = vi.fn();
    const view = await renderWizard(onClose);
    try {
      await pressEscape();
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(discardPrompt(view.host)).toBeNull();
    } finally {
      await view.unmount();
    }
  });

  it('closes at once when an edit was put back the way it opened', async () => {
    const onClose = vi.fn();
    const view = await renderWizard(onClose);
    try {
      await chooseCncOnly(view.host);
      await act(async () => radio(view.host, 'Laser only').click());
      await pressEscape();
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      await view.unmount();
    }
  });

  it('asks before Escape discards an edit, and Escape again keeps editing', async () => {
    const onClose = vi.fn();
    const view = await renderWizard(onClose);
    try {
      await chooseCncOnly(view.host);
      await pressEscape();
      expect(onClose).not.toHaveBeenCalled();
      expect(discardPrompt(view.host)?.textContent).toContain('Discard your changes');
      expect(document.activeElement?.textContent).toBe('Keep editing');
      await pressEscape();
      expect(onClose).not.toHaveBeenCalled();
      expect(discardPrompt(view.host)).toBeNull();
      expect(radio(view.host, 'CNC only').checked).toBe(true);
    } finally {
      await view.unmount();
    }
  });

  it('discards from the header close button only after Discard changes', async () => {
    const onClose = vi.fn();
    const view = await renderWizard(onClose);
    try {
      await chooseCncOnly(view.host);
      await act(async () => button(view.host, 'Close Machine Setup').click());
      expect(onClose).not.toHaveBeenCalled();
      await act(async () => button(view.host, 'Keep editing').click());
      expect(discardPrompt(view.host)).toBeNull();
      await act(async () => button(view.host, 'Close Machine Setup').click());
      await act(async () => button(view.host, 'Discard changes').click());
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(machineKindOf(useStore.getState().project.machine)).toBe('laser');
    } finally {
      await view.unmount();
    }
  });

  it('keeps Cancel without saving immediate for an edited draft', async () => {
    const onClose = vi.fn();
    const view = await renderWizard(onClose);
    try {
      await chooseCncOnly(view.host);
      await act(async () => button(view.host, 'Cancel without saving').click());
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(discardPrompt(view.host)).toBeNull();
    } finally {
      await view.unmount();
    }
  });
});

async function chooseCncOnly(host: HTMLElement): Promise<void> {
  await act(async () => radio(host, 'CNC only').click());
  expect(radio(host, 'CNC only').checked).toBe(true);
}

async function pressEscape(): Promise<void> {
  await act(async () => {
    (document.activeElement ?? document.body).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
  });
}

function discardPrompt(host: HTMLElement): Element | null {
  return host.querySelector('[data-confirming="discard"]');
}

function radio(host: HTMLElement, label: string): HTMLInputElement {
  const input = host.querySelector(`input[name="machine-capability"][aria-label="${label}"]`);
  if (!(input instanceof HTMLInputElement)) throw new Error(`Radio missing: ${label}`);
  return input;
}

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const match = [...host.querySelectorAll('button')].find(
    (candidate) =>
      candidate.textContent?.trim() === label || candidate.getAttribute('aria-label') === label,
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error(`Button not rendered: ${label}`);
  return match;
}
