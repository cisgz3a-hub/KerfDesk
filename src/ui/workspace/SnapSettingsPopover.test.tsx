import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useUiStore } from '../state/ui-store';
import { DEFAULT_SNAP_SETTINGS } from './snap-settings';
import { SnapSettingsButton } from './SnapSettingsPopover';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(async () => {
  localStorage.clear();
  useUiStore.setState({ snapSettings: DEFAULT_SNAP_SETTINGS });
  host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    root = createRoot(host as HTMLDivElement);
    root.render(<SnapSettingsButton style={{}} />);
  });
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host?.remove();
  host = null;
  root = null;
  localStorage.clear();
});

async function click(element: Element | null): Promise<void> {
  await act(async () => {
    element?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('SnapSettingsButton', () => {
  it('opens the snap settings with every kind shown and titled', async () => {
    await click(document.querySelector('button[aria-label="Snap settings"]'));

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    for (const name of [
      'Nodes',
      'Midpoints',
      'Centres',
      'Intersections',
      'Grid',
      'Alignment guides',
    ]) {
      const box = dialog?.querySelector(`input[aria-label="${name}"]`);
      expect(box, name).toBeInstanceOf(HTMLInputElement);
      expect((box as HTMLInputElement).checked).toBe(true);
      expect(box?.getAttribute('title')).toBeTruthy();
    }
    expect(dialog?.querySelector('[aria-label="Snap grid spacing in millimetres"]')).not.toBeNull();
    expect(dialog?.querySelector('[aria-label="Snap distance in screen pixels"]')).not.toBeNull();
  });

  it('switches a snap kind off at once and remembers it', async () => {
    await click(document.querySelector('button[aria-label="Snap settings"]'));

    await click(document.querySelector('input[aria-label="Intersections"]'));

    expect(useUiStore.getState().snapSettings.snapToIntersections).toBe(false);
    expect(localStorage.getItem('laserforge.snap-settings.v1')).toContain(
      '"snapToIntersections":false',
    );
  });
});
