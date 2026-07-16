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
  it('creates smooth EMS geometry and an Engrave layer', async () => {
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
        content.value = 'Beautiful CNC';
        Simulate.change(content);
        requireButton(host, 'Open the font picker and choose the text typeface.').click();
      });
      await act(async () => {
        requireButton(host, 'Use EMS Allure for this text object.').click();
      });

      expect(host.textContent).toContain('CNC single-line font');
      expect(host.textContent).toContain('verify the text size and bit diameter');
      await act(async () => {
        Simulate.submit(requireForm(host));
        await waitForTextObject();
      });

      const text = useStore
        .getState()
        .project.scene.objects.find((object) => object.kind === 'text');
      expect(text).toMatchObject({ kind: 'text', fontKey: 'ems-allure' });
      expect(text?.kind === 'text' && text.paths[0]?.polylines.every((line) => !line.closed)).toBe(
        true,
      );
      expect(text?.kind === 'text' && (text.paths[0]?.curves?.length ?? 0) > 0).toBe(true);
      expect(useStore.getState().project.scene.layers[0]?.cnc?.cutType).toBe('engrave');
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('offers Forge Soft Cursive and stores it as open engraving geometry', async () => {
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
        content.value = 'soft cursive';
        Simulate.change(content);
        requireButton(host, 'Open the font picker and choose the text typeface.').click();
      });
      await act(async () => {
        requireButton(host, 'Use Forge Soft Cursive for this text object.').click();
      });

      expect(host.textContent).toContain('CNC single-line font');
      await act(async () => {
        Simulate.submit(requireForm(host));
        await waitForTextObject();
      });

      const text = useStore
        .getState()
        .project.scene.objects.find((object) => object.kind === 'text');
      expect(text).toMatchObject({ kind: 'text', fontKey: 'forge-soft-cursive' });
      expect(text?.kind === 'text' && text.paths[0]?.polylines.every((line) => !line.closed)).toBe(
        true,
      );
      expect(useStore.getState().project.scene.layers[0]?.cnc?.cutType).toBe('engrave');
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('offers the three approved directions and stores Forge Swing as open engraving geometry', async () => {
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
        content.value = 'Made by hand';
        Simulate.change(content);
        requireButton(host, 'Open the font picker and choose the text typeface.').click();
      });

      expect(requireButton(host, 'Use Forge Compact for this text object.')).toBeTruthy();
      expect(requireButton(host, 'Use Forge Sign for this text object.')).toBeTruthy();
      await act(async () => {
        requireButton(host, 'Use Forge Swing for this text object.').click();
      });

      expect(host.textContent).toContain('verify the text size and bit diameter');
      await act(async () => {
        Simulate.submit(requireForm(host));
        await waitForTextObject();
      });

      const text = useStore
        .getState()
        .project.scene.objects.find((object) => object.kind === 'text');
      expect(text).toMatchObject({ kind: 'text', fontKey: 'forge-swing' });
      expect(text?.kind === 'text' && text.paths[0]?.polylines.every((line) => !line.closed)).toBe(
        true,
      );
      expect(useStore.getState().project.scene.layers[0]?.cnc?.cutType).toBe('engrave');
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('offers Forge Grace editions and stores the Flourish edition as open engraving geometry', async () => {
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
        content.value = 'Cedar & Steel';
        Simulate.change(content);
        requireButton(host, 'Open the font picker and choose the text typeface.').click();
      });

      expect(requireButton(host, 'Use Forge Grace for this text object.')).toBeTruthy();
      await act(async () => {
        requireButton(host, 'Use Forge Grace Flourish for this text object.').click();
      });
      await act(async () => {
        Simulate.submit(requireForm(host));
        await waitForTextObject();
      });

      const text = useStore
        .getState()
        .project.scene.objects.find((object) => object.kind === 'text');
      expect(text).toMatchObject({ kind: 'text', fontKey: 'forge-grace-flourish' });
      expect(text?.kind === 'text' && text.paths[0]?.polylines.every((line) => !line.closed)).toBe(
        true,
      );
      expect(useStore.getState().project.scene.layers[0]?.cnc?.cutType).toBe('engrave');
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('offers all eight approved cursive directions and stores the chosen style as engraving geometry', async () => {
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
        content.value = 'Johann Made by Hand';
        Simulate.change(content);
        requireButton(host, 'Open the font picker and choose the text typeface.').click();
      });

      const styles = [
        'Forge Signature',
        'Forge Romantic',
        'Forge Copperplate',
        'Forge Casual',
        'Forge Friendly',
        'Forge Signwriter',
        'Forge Parisian',
        'Forge Personal',
      ];
      styles.forEach((style) => {
        expect(requireButton(host, `Use ${style} for this text object.`)).toBeTruthy();
      });
      await act(async () => {
        requireButton(host, 'Use Forge Personal for this text object.').click();
      });
      await act(async () => {
        Simulate.submit(requireForm(host));
        await waitForTextObject();
      });

      const text = useStore
        .getState()
        .project.scene.objects.find((object) => object.kind === 'text');
      expect(text).toMatchObject({ kind: 'text', fontKey: 'forge-personal' });
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

async function waitForTextObject(): Promise<void> {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (useStore.getState().project.scene.objects.some((object) => object.kind === 'text')) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for rendered EMS text');
}
