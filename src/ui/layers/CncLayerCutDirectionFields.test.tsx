import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import {
  createLayer,
  DEFAULT_CNC_LAYER_SETTINGS,
  type CncCutType,
  type Layer,
} from '../../core/scene';
import { MotionPolishRows } from './CncLayerToolFields';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const LAYER: Layer = createLayer({ id: 'L1', color: '#2563eb' });
const DIRECTED_CUT_TYPES: ReadonlyArray<CncCutType> = [
  'profile-outside',
  'profile-inside',
  'pocket',
];
const INERT_CUT_TYPES: ReadonlyArray<CncCutType> = ['profile-on-path', 'engrave'];

async function renderRows(
  cutType: CncCutType,
  extra: Partial<typeof DEFAULT_CNC_LAYER_SETTINGS> = {},
): Promise<{
  readonly host: HTMLDivElement;
  readonly root: Root;
  readonly onCommitSettings: ReturnType<typeof vi.fn>;
}> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const onCommitSettings = vi.fn();
  await act(async () => {
    root.render(
      <MotionPolishRows
        layer={LAYER}
        settings={{ ...DEFAULT_CNC_LAYER_SETTINGS, cutType, ...extra }}
        onCommit={vi.fn()}
        onCommitSettings={onCommitSettings}
      />,
    );
  });
  return { host, root, onCommitSettings };
}

describe('CNC cut-direction editor contract', () => {
  it.each(DIRECTED_CUT_TYPES)('shows direction and ramp for %s', async (cutType) => {
    const view = await renderRows(cutType);
    try {
      expect(
        view.host.querySelector(`select[aria-label="Cut direction for ${LAYER.color}"]`),
      ).not.toBeNull();
      expect(
        view.host.querySelector(`input[aria-label="Ramp entry angle for ${LAYER.color}"]`),
      ).not.toBeNull();
    } finally {
      await act(async () => view.root.unmount());
      view.host.remove();
    }
  });

  it.each(INERT_CUT_TYPES)('hides inert direction but retains ramp for %s', async (cutType) => {
    const view = await renderRows(cutType);
    try {
      expect(
        view.host.querySelector(`select[aria-label="Cut direction for ${LAYER.color}"]`),
      ).toBeNull();
      expect(
        view.host.querySelector(`input[aria-label="Ramp entry angle for ${LAYER.color}"]`),
      ).not.toBeNull();
    } finally {
      await act(async () => view.root.unmount());
      view.host.remove();
    }
  });

  it('hides the unapplied V-carve entry field until a saved request needs clearing', async () => {
    const view = await renderRows('v-carve');
    try {
      expect(
        view.host.querySelector(`select[aria-label="Cut direction for ${LAYER.color}"]`),
      ).toBeNull();
      expect(
        view.host.querySelector(`input[aria-label="Ramp entry angle for ${LAYER.color}"]`),
      ).toBeNull();
    } finally {
      await act(async () => view.root.unmount());
      view.host.remove();
    }
  });

  it('clears a saved V-carve entry request from its dedicated field', async () => {
    vi.useFakeTimers();
    const view = await renderRows('v-carve', { vCarveRampEntryDeg: 3, rampEntryDeg: 4 });
    try {
      const input = view.host.querySelector<HTMLInputElement>(
        `input[aria-label="Ramp entry angle for ${LAYER.color}"]`,
      );
      if (input === null) throw new Error('ramp input missing');
      expect(input.value).toBe('3');
      expect(input.title).toContain('It is not applied');
      expect(view.host.textContent).toContain('° not applied');
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (valueSetter === undefined) throw new Error('input value setter missing');
      await act(async () => {
        valueSetter.call(input, '0');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(350);
      });
      const committed = view.onCommitSettings.mock.calls.at(-1)?.[0];
      expect(committed).toMatchObject({ cutType: 'v-carve', rampEntryDeg: 4 });
      expect(committed).not.toHaveProperty('vCarveRampEntryDeg');
    } finally {
      await act(async () => view.root.unmount());
      view.host.remove();
      vi.useRealTimers();
    }
  });
});
