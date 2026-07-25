// Toasts render coverage — the last unproven link in the rule-7 advisory
// chain (ADR-228, PRs #439/#440). Those PRs proved a pre-emit policy finding
// reaches ctx.pushToast, but nothing proved the operator can actually READ it:
// pushToast -> store -> rendered text was asserted nowhere, so "the export now
// warns instead of refusing" rested on an untested seam.
//
// This drives the real handleSaveRd through the real toast store into a real
// React root on a throwaway DOM node. It is deliberately side-effect-free
// (CLAUDE.md rule 4): a mock SaveTarget discards the bytes, so no file dialog
// opens and nothing touches a live scene.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { createLayer, createProject, IDENTITY_TRANSFORM, type Project } from '../../core/scene';
import type { PlatformAdapter, SaveTarget } from '../../platform/types';
import type { SaveGcodeCtx } from '../app/file-actions';
import { handleSaveRd } from '../app/save-rd-action';
import { useToastStore } from '../state/toast-store';
import { Toasts } from './Toasts';

// A controlled laser-off seek feed of 0 is unusable, so pre-emit reports
// speed-out-of-range — a policy finding that must warn, never refuse.
function policyFindingRuidaProject(): Project {
  return {
    ...createProject(),
    device: {
      ...DEFAULT_DEVICE_PROFILE,
      controllerKind: 'ruida',
      controlledLaserOffTravelFeedMmPerMin: 0,
    },
    scene: {
      layers: [createLayer({ id: '#000000', color: '#000000', mode: 'line' })],
      objects: [
        {
          kind: 'imported-svg',
          id: 'line-1',
          source: 'line.svg',
          bounds: { minX: 0, minY: 0, maxX: 10, maxY: 0 },
          transform: IDENTITY_TRANSFORM,
          paths: [
            {
              color: '#000000',
              polylines: [
                {
                  closed: false,
                  points: [
                    { x: 0, y: 0 },
                    { x: 10, y: 0 },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

function discardingPlatform(): PlatformAdapter {
  const target: SaveTarget = { displayName: 'job.rd', write: async () => undefined };
  return {
    id: 'mock',
    pickFilesForOpen: async () => [],
    pickFileForSave: async () => target,
    serial: { isSupported: () => false, requestPort: async () => null },
  };
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root !== null) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  for (const toast of useToastStore.getState().toasts) {
    useToastStore.getState().dismissToast(toast.id);
  }
});

function renderToasts(): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root?.render(<Toasts />));
  return host;
}

describe('Toasts', () => {
  it('renders the pre-emit advisory a .rd save raises, so the operator can read it', async () => {
    const ctx: SaveGcodeCtx = {
      platform: discardingPlatform(),
      project: policyFindingRuidaProject(),
      savedName: null,
      pushToast: (message, variant) => useToastStore.getState().pushToast(message, variant),
    };

    await act(async () => {
      await handleSaveRd(ctx, { ok: true });
    });
    const container = renderToasts();

    // The exact operator-facing wording, not a code or a paraphrase.
    expect(container.textContent).toContain('Controlled laser-off seek feed');
    // The advisory must be styled as a warning, not buried as info.
    expect(useToastStore.getState().toasts.map((t) => t.variant)).toContain('warning');
  });

  it('renders nothing when no toast has been raised', () => {
    expect(renderToasts().textContent).toBe('');
  });
});
