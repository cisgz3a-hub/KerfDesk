import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_CNC_MACHINE_CONFIG, createProject } from '../../core/scene';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { CncTilingPanel } from './CncTilingPanel';

// React's test-only act marker is not part of the standard globalThis type.
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => resetStore());

describe('CncTilingPanel', () => {
  it('discloses effective legacy overlap without mutating the project on mount', async () => {
    const project = {
      ...createProject(),
      machine: {
        ...DEFAULT_CNC_MACHINE_CONFIG,
        tiling: {
          tileWidthMm: 60,
          tileHeightMm: 60,
          overlapMm: 100,
          registrationHoles: true,
        },
      },
    };
    useStore.getState().setProject(project);
    const before = JSON.stringify(useStore.getState().project);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    try {
      await act(async () => root.render(<CncTilingPanel machine={project.machine} />));

      expect(host.textContent).toContain('Requested overlap 100 mm');
      expect(host.textContent).toContain('effective overlap 59 mm');
      expect(host.textContent).toContain('saved request is unchanged');
      expect(JSON.stringify(useStore.getState().project)).toBe(before);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('persists the effective overlap after an explicit numeric edit', async () => {
    const project = {
      ...createProject(),
      machine: {
        ...DEFAULT_CNC_MACHINE_CONFIG,
        tiling: {
          tileWidthMm: 100,
          tileHeightMm: 80,
          overlapMm: 100,
          registrationHoles: false,
        },
      },
    };
    useStore.getState().setProject(project);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    try {
      await act(async () => root.render(<CncTilingPanel machine={project.machine} />));
      const input = host.querySelector('input[aria-label="Tile height"]');
      if (!(input instanceof HTMLInputElement)) throw new Error('tile height missing');
      input.value = '60';
      await act(async () => Simulate.change(input));
      await act(async () => Simulate.blur(input));

      const machine = useStore.getState().project.machine;
      expect(machine?.kind === 'cnc' ? machine.tiling : undefined).toMatchObject({
        tileHeightMm: 60,
        overlapMm: 59,
      });
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
