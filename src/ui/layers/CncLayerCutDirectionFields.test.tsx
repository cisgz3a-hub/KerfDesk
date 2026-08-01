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

async function renderRows(cutType: CncCutType): Promise<{
  readonly host: HTMLDivElement;
  readonly root: Root;
}> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <MotionPolishRows
        layer={LAYER}
        settings={{ ...DEFAULT_CNC_LAYER_SETTINGS, cutType }}
        onCommit={vi.fn()}
        onCommitSettings={vi.fn()}
      />,
    );
  });
  return { host, root };
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
});
