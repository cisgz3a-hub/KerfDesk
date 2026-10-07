import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PROJECT_OPTIMIZATION, type ProjectOptimizationSettings } from '../../core/scene';
import { OptimizationSettingsDialog } from './OptimizationSettingsDialog';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

async function renderDialog(
  onApply = vi.fn(),
  settings: ProjectOptimizationSettings = DEFAULT_PROJECT_OPTIMIZATION,
): Promise<{
  readonly host: HTMLDivElement;
  readonly root: Root;
  readonly onApply: typeof onApply;
}> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <OptimizationSettingsDialog settings={settings} onCancel={vi.fn()} onApply={onApply} />,
    );
  });
  return { host, root, onApply };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('OptimizationSettingsDialog', () => {
  it('offers an effective Line choice under source order without changing legacy policies', async () => {
    const settings: ProjectOptimizationSettings = {
      ...DEFAULT_PROJECT_OPTIMIZATION,
      travelPolicy: 'source-order',
      reduceTravelMoves: false,
      startPoint: 'job-center',
    };
    const { host, root, onApply } = await renderDialog(vi.fn(), settings);
    try {
      const select = host.querySelector<HTMLSelectElement>('select[name="lineStartRegion"]');
      if (select === null) throw new Error('Line preference missing');
      expect(select.disabled).toBe(false);
      expect(select.value).toBe('');
      expect(select.options).toHaveLength(10);
      await act(async () => {
        select.value = 'center';
        Simulate.change(select);
      });
      expect(host.querySelector<HTMLInputElement>('input[name="insideFirst"]')?.disabled).toBe(
        false,
      );
      expect(host.querySelector<HTMLSelectElement>('select[name="pathDirection"]')?.disabled).toBe(
        false,
      );
      expect(host.textContent).toContain('Fill/raster keep their scan order');
      expect(host.textContent).toContain('Job origin is unchanged');
      expect(host.textContent).toContain('Where drawn still applies to other operations');
      await act(async () => {
        const form = host.querySelector('form');
        if (form === null) throw new Error('form missing');
        Simulate.submit(form);
      });
      expect(onApply).toHaveBeenCalledWith({ ...settings, lineStartRegion: 'center' });
      await act(async () => {
        select.value = '';
        Simulate.change(select);
      });
      expect(host.querySelector<HTMLInputElement>('input[name="insideFirst"]')?.disabled).toBe(
        true,
      );
      await act(async () => {
        const form = host.querySelector('form');
        if (form === null) throw new Error('form missing');
        Simulate.submit(form);
      });
      expect(onApply).toHaveBeenLastCalledWith({ ...settings, lineStartRegion: undefined });
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('submits all cut-planner policies and synchronizes the legacy flag', async () => {
    const { host, root, onApply } = await renderDialog();
    try {
      expect(host.textContent).toContain('Cut Planner');
      const travelPolicy = host.querySelector('select[name="travelPolicy"]');
      if (!(travelPolicy instanceof HTMLSelectElement)) {
        throw new Error('travel policy missing');
      }
      expect(travelPolicy.value).toBe('nearest-neighbor');

      await act(async () => {
        travelPolicy.value = 'source-order';
        Simulate.change(travelPolicy);
      });
      expect(host.querySelector<HTMLInputElement>('input[name="insideFirst"]')?.disabled).toBe(
        true,
      );
      expect(host.querySelector<HTMLSelectElement>('select[name="pathDirection"]')?.disabled).toBe(
        true,
      );
      expect(host.querySelector<HTMLSelectElement>('select[name="startPoint"]')?.disabled).toBe(
        true,
      );
      expect(host.querySelector<HTMLSelectElement>('select[name="layerPriority"]')?.disabled).toBe(
        false,
      );
      expect(host.textContent).toContain('saved but bypassed');
      expect(host.textContent).toContain('Layer priority still applies');
      const overlaps = host.querySelector<HTMLInputElement>('input[name="removeOverlappingLines"]');
      expect(overlaps?.checked).toBe(false);
      expect(overlaps?.disabled).toBe(false);
      if (overlaps === null) throw new Error('overlap setting missing');
      await act(async () => {
        overlaps.checked = true;
        Simulate.change(overlaps);
      });
      await act(async () => {
        const form = host.querySelector('form');
        if (!(form instanceof HTMLFormElement)) throw new Error('form missing');
        Simulate.submit(form);
      });

      expect(onApply).toHaveBeenCalledWith({
        ...DEFAULT_PROJECT_OPTIMIZATION,
        reduceTravelMoves: false,
        travelPolicy: 'source-order',
        removeOverlappingLines: true,
      });
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('chooses where closed shapes start, explaining each choice on hover', async () => {
    const { host, root, onApply } = await renderDialog();
    try {
      const select = host.querySelector('select[name="closedShapeStart"]');
      if (!(select instanceof HTMLSelectElement)) throw new Error('closed-shape start missing');
      expect(select.value).toBe('drawn');
      expect(select.title).not.toBe('');
      expect([...select.options].map((option) => [option.value, option.textContent])).toEqual([
        ['drawn', 'Where drawn'],
        ['nearest', 'Nearest point'],
        ['nearest-corner', 'Nearest corner'],
      ]);
      for (const option of select.options) expect(option.title).not.toBe('');
      expect(select.options[2]?.title).toContain('start and stop mark lands on a corner');

      await act(async () => {
        select.value = 'nearest-corner';
        Simulate.change(select);
      });
      await act(async () => {
        const form = host.querySelector('form');
        if (!(form instanceof HTMLFormElement)) throw new Error('form missing');
        Simulate.submit(form);
      });
      expect(onApply).toHaveBeenCalledWith({
        ...DEFAULT_PROJECT_OPTIMIZATION,
        closedShapeStart: 'nearest-corner',
      });
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('sets a merge tolerance for overlap removal, clamped to its range', async () => {
    const { host, root, onApply } = await renderDialog();
    try {
      const tolerance = host.querySelector<HTMLInputElement>(
        'input[name="overlapMergeToleranceMm"]',
      );
      const overlaps = host.querySelector<HTMLInputElement>('input[name="removeOverlappingLines"]');
      if (tolerance === null || overlaps === null) throw new Error('overlap fields missing');
      expect(tolerance.value).toBe('0');
      expect(tolerance.disabled).toBe(true);
      expect(tolerance.title).toContain('Turn on Remove overlapping lines');

      await act(async () => {
        overlaps.checked = true;
        Simulate.change(overlaps);
      });
      expect(tolerance.disabled).toBe(false);
      expect(tolerance.title).toContain('0 to 0.5 mm');
      await act(async () => {
        tolerance.value = '0.8';
        Simulate.change(tolerance);
      });
      await act(async () => {
        const form = host.querySelector('form');
        if (!(form instanceof HTMLFormElement)) throw new Error('form missing');
        Simulate.submit(form);
      });
      expect(onApply).toHaveBeenCalledWith({
        ...DEFAULT_PROJECT_OPTIMIZATION,
        removeOverlappingLines: true,
        overlapMergeToleranceMm: 0.5,
      });
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('keeps Planning start live under Keep source order when it seeds closed-shape starts', async () => {
    const { host, root } = await renderDialog(vi.fn(), {
      ...DEFAULT_PROJECT_OPTIMIZATION,
      travelPolicy: 'source-order',
      reduceTravelMoves: false,
      closedShapeStart: 'nearest',
    });
    try {
      const startPoint = host.querySelector<HTMLSelectElement>('select[name="startPoint"]');
      expect(startPoint?.disabled).toBe(false);
      expect(
        host.querySelector<HTMLSelectElement>('select[name="closedShapeStart"]')?.disabled,
      ).toBe(false);
      expect(host.querySelector<HTMLSelectElement>('select[name="pathDirection"]')?.disabled).toBe(
        true,
      );
      expect(host.textContent).toContain('Start closed shapes still applies');
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('preserves bypassed settings so switching back to Reduce travel restores them', async () => {
    const sourceOrder = {
      ...DEFAULT_PROJECT_OPTIMIZATION,
      travelPolicy: 'source-order' as const,
      reduceTravelMoves: false,
      insideFirst: false,
      pathDirection: 'preserve' as const,
      startPoint: 'job-center' as const,
    };
    const { host, root, onApply } = await renderDialog(vi.fn(), sourceOrder);
    try {
      await act(async () => {
        const form = host.querySelector('form');
        if (!(form instanceof HTMLFormElement)) throw new Error('form missing');
        Simulate.submit(form);
      });

      expect(onApply).toHaveBeenCalledWith(sourceOrder);
    } finally {
      await act(async () => root.unmount());
    }
  });
});
