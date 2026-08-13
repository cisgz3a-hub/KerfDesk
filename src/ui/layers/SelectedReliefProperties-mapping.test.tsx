import { act } from 'react';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import {
  depthRelief,
  installProject,
  gammaField,
  storedGamma,
  render,
} from './SelectedReliefProperties.test-support';

afterEach(() => {
  resetStore();
});

describe('SelectedReliefProperties mapping controls', () => {
  it('shows depth-map precision, polarity, input levels, then an uncapped gamma field', async () => {
    installProject('cnc', depthRelief());
    const beforeProject = useStore.getState().project;
    const beforeUndoStack = useStore.getState().undoStack;
    const beforeDirty = useStore.getState().dirty;
    const { host, root } = await render();
    try {
      expect(host.textContent).toContain('2 x 1, canonical 16-bit (source 8-bit)');
      expect(host.querySelector('select[aria-label="Relief background"]')).toBeNull();
      const sourceMeaning = host.querySelector('[aria-label="Relief declared source meaning"]');
      expect(sourceMeaning?.textContent).toContain('Depth map');
      expect(sourceMeaning?.textContent).toContain('Declared scalar depth data.');
      expect(sourceMeaning?.querySelector('input, select, button')).toBeNull();
      expect(useStore.getState().project).toBe(beforeProject);
      expect(useStore.getState().undoStack).toBe(beforeUndoStack);
      expect(useStore.getState().dirty).toBe(beforeDirty);
      const select = host.querySelector('select[aria-label="Relief height-map polarity"]');
      if (!(select instanceof HTMLSelectElement)) throw new Error('polarity select missing');
      const levels = host.querySelector('[aria-label="Relief input levels"]');
      if (!(levels instanceof HTMLDivElement)) throw new Error('input levels missing');
      const gamma = gammaField(host);
      expect(gamma.value).toBe('1');
      expect(gamma.step).toBe('0.05');
      expect(gamma.min).toBe('');
      expect(gamma.max).toBe('');
      expect(select.closest('label')?.nextElementSibling).toBe(levels);
      expect(levels.nextElementSibling).toBe(gamma.closest('label'));
      await act(async () => {
        select.value = 'light-is-deep';
        Simulate.change(select);
      });

      const stored = useStore.getState().project.scene.objects[0];
      expect(
        stored?.kind === 'relief' && stored.reliefSource.kind === 'heightfield-v1'
          ? stored.reliefSource.mapping.polarity
          : undefined,
      ).toBe('light-is-deep');
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('keeps recorded source polarity distinct from the current editable mapping', async () => {
    const object = depthRelief();
    if (object.reliefSource.kind !== 'heightfield-v1') throw new Error('heightfield missing');
    installProject('cnc', {
      ...object,
      reliefSource: {
        ...object.reliefSource,
        mapping: { ...object.reliefSource.mapping, polarity: 'light-is-deep' },
        provenance: {
          ...object.reliefSource.provenance,
          sourceName: 'recorded-depth.png',
          sourcePolarity: 'light-is-high',
          producer: { name: 'Depth Lab', model: 'relative-v2' },
        },
      },
    });
    const beforeProject = useStore.getState().project;
    const beforeUndoStack = useStore.getState().undoStack;
    const beforeDirty = useStore.getState().dirty;
    const { host, root } = await render();
    try {
      const recorded = host.querySelector('[aria-label="Relief recorded source details"]');
      const current = host.querySelector('select[aria-label="Relief height-map polarity"]');
      expect(recorded?.textContent).toContain('recorded-depth.png');
      expect(recorded?.textContent).toContain('Recorded metadata is not authenticated.');
      expect(recorded?.textContent).toContain('Recorded source polarityLight is high');
      expect(recorded?.textContent).toContain('Depth Lab');
      expect(recorded?.textContent).toContain('relative-v2');
      expect(recorded?.querySelector('input, select, button')).toBeNull();
      expect(host.textContent).toContain('Resolved aspect policyPreserve');
      expect(current instanceof HTMLSelectElement ? current.value : null).toBe('light-is-deep');
      expect(useStore.getState().project).toBe(beforeProject);
      expect(useStore.getState().undoStack).toBe(beforeUndoStack);
      expect(useStore.getState().dirty).toBe(beforeDirty);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('commits a large positive gamma unchanged', async () => {
    installProject('cnc', depthRelief());
    const { host, root } = await render();
    try {
      const gamma = gammaField(host);
      await act(async () => {
        gamma.value = '123456.75';
        Simulate.change(gamma);
      });
      await act(async () => Simulate.blur(gamma));

      expect(storedGamma()).toBe(123456.75);
      expect(gammaField(host).value).toBe('123456.75');
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('does not mutate for zero gamma and restores the canonical value on blur', async () => {
    installProject('cnc', depthRelief('R1', 1.25));
    const beforeProject = useStore.getState().project;
    const beforeUndoStack = useStore.getState().undoStack;
    const beforeDirty = useStore.getState().dirty;
    const { host, root } = await render();
    try {
      const gamma = gammaField(host);
      await act(async () => {
        gamma.value = '0';
        Simulate.change(gamma);
      });
      await act(async () => Simulate.blur(gamma));

      expect(useStore.getState().project).toBe(beforeProject);
      expect(useStore.getState().undoStack).toBe(beforeUndoStack);
      expect(useStore.getState().dirty).toBe(beforeDirty);
      expect(gammaField(host).value).toBe('1.25');
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('cancels a pending gamma edit instead of retargeting a new selected relief', async () => {
    vi.useFakeTimers();
    installProject('cnc', depthRelief('R1', 1));
    const project = useStore.getState().project;
    useStore.setState({
      project: {
        ...project,
        scene: {
          ...project.scene,
          objects: [depthRelief('R1', 1), depthRelief('R2', 2)],
        },
      },
    });
    const { host, root } = await render();
    try {
      const gamma = gammaField(host);
      await act(async () => {
        gamma.value = '4';
        Simulate.change(gamma);
      });
      await act(async () => useStore.getState().selectObject('R2'));
      await act(async () => vi.advanceTimersByTime(300));

      expect(gammaField(host).value).toBe('2');
      expect(storedGamma('R1')).toBe(1);
      expect(storedGamma('R2')).toBe(2);
    } finally {
      await act(async () => root.unmount());
      host.remove();
      vi.useRealTimers();
    }
  });
});
