import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import { AddTextDialog } from './AddTextDialog';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  useStore.getState().newProject();
  useUiStore.setState({ textDialog: null });
});

afterEach(() => {
  useStore.getState().newProject();
  useUiStore.setState({ textDialog: null });
});

describe('single-line text dialog flow', () => {
  it('creates native open CNC geometry and an Engrave layer', async () => {
    useStore.getState().setMachineKind('cnc');
    useStore.getState().updateCncMachine({ toolId: 'vb-60' });
    useUiStore.setState({ textDialog: { mode: 'add' } });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(<AddTextDialog />));
      await act(async () => {
        const content = requireTextarea(host);
        content.value = 'CNC';
        Simulate.change(content);
        requireButton(host, 'Open the font picker and choose the text typeface.').click();
      });
      await act(async () => {
        requireButton(host, 'Use Hershey Simplex for this text object.').click();
      });

      expect(host.textContent).toContain('CNC single-line font');
      await act(async () => {
        Simulate.submit(requireForm(host));
        await Promise.resolve();
      });

      const text = useStore
        .getState()
        .project.scene.objects.find((object) => object.kind === 'text');
      expect(text).toMatchObject({ kind: 'text', fontKey: 'hershey-simplex' });
      expect(text?.kind === 'text' && text.paths[0]?.polylines.every((line) => !line.closed)).toBe(
        true,
      );
      expect(useStore.getState().project.scene.layers[0]?.cnc?.cutType).toBe('engrave');
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});

function requireTextarea(host: HTMLElement): HTMLTextAreaElement {
  const textarea = host.querySelector('textarea');
  if (!(textarea instanceof HTMLTextAreaElement)) throw new Error('Text area not rendered');
  return textarea;
}

function requireButton(host: HTMLElement, title: string): HTMLButtonElement {
  const button = host.querySelector(`button[title="${title}"]`);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`${title} button not rendered`);
  return button;
}

function requireForm(host: HTMLElement): HTMLFormElement {
  const form = host.querySelector('form');
  if (!(form instanceof HTMLFormElement)) throw new Error('Text form not rendered');
  return form;
}
