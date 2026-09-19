import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import {
  FIRST,
  SECOND,
  load,
  effective,
  mount,
  field,
  blur,
  edit,
  type,
  openAdvanced,
} from './__fixtures__/selected-operation-inspector';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => {
  resetStore();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  resetStore();
  document.body.replaceChildren();
});

describe('truthful mixed operation editing', () => {
  it('shows mixed numeric and boolean settings without changing anything on blur', async () => {
    load(FIRST, SECOND);
    const before = JSON.stringify(useStore.getState().project);
    const view = await mount();
    try {
      for (const label of [
        'Power',
        'Speed',
        'Passes',
        'Hatch angle',
        'Hatch spacing',
        'Fill overscan',
      ]) {
        const input = field(view.host, label);
        expect(input.value).toBe('');
        expect(input.placeholder).toBe('Mixed');
        await blur(input);
      }
      for (const label of ['Bidirectional fill', 'Air assist']) {
        const input = field(view.host, label);
        expect(input.indeterminate).toBe(true);
        expect(input.getAttribute('aria-checked')).toBe('mixed');
      }
      expect(view.host.textContent).toContain('Mixed settings');
      expect(JSON.stringify(useStore.getState().project)).toBe(before);
      expect(useStore.getState().undoStack).toHaveLength(0);
    } finally {
      await view.unmount();
    }
  });
  it('applies the first value explicitly to both artworks and preserves unrelated overrides in one undo', async () => {
    load(FIRST, SECOND);
    const view = await mount();
    try {
      await edit(field(view.host, 'Power'), '17');
      expect(effective().map((s) => s.power)).toEqual([17, 17]);
      expect(effective().map((s) => s.speed)).toEqual([601, 1801]);
      expect(effective().map((s) => s.minPower)).toEqual([5, 11]);
      expect(field(view.host, 'Power').value).toBe('17');
      expect(useStore.getState().undoStack).toHaveLength(1);
      await act(async () => useStore.getState().undo());
      expect(field(view.host, 'Power').placeholder).toBe('Mixed');
      expect(effective().map((s) => s.power)).toEqual([17, 83]);
    } finally {
      await view.unmount();
    }
  });
  it('only reduces a per-artwork minimum when the newly chosen power requires it', async () => {
    load(FIRST, SECOND);
    const view = await mount();
    try {
      await edit(field(view.host, 'Power'), '8');
      expect(effective().map((s) => s.minPower)).toEqual([5, 8]);
      expect(effective().map((s) => s.power)).toEqual([8, 8]);
    } finally {
      await view.unmount();
    }
  });
  it('represents different modes explicitly and lets a chosen common mode retain per-artwork values', async () => {
    load({ ...FIRST, mode: 'fill' }, { ...SECOND, mode: 'image' });
    const view = await mount();
    try {
      const select = view.host.querySelector<HTMLSelectElement>('select[aria-label^="Mode for"]')!;
      expect(select.value).toBe('');
      expect(select.selectedOptions[0]?.textContent).toBe('Mixed');
      await act(async () => {
        select.value = 'fill';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
      expect(effective().map((s) => s.mode)).toEqual(['fill', 'fill']);
      expect(effective().map((s) => s.speed)).toEqual([601, 1801]);
    } finally {
      await view.unmount();
    }
  });
  it('applies only explicitly changed Advanced fields for a mixed selection', async () => {
    load(FIRST, SECOND);
    const view = await mount();
    try {
      await openAdvanced(view.host);
      const form = document.querySelector('form')!;
      expect(form.textContent).toContain('Only fields you change');
      const speed = form.querySelector<HTMLInputElement>('input[name="speed"]')!;
      await edit(speed, '777');
      await act(async () => form.requestSubmit());
      expect(effective().map((s) => s.speed)).toEqual([777, 777]);
      expect(effective().map((s) => s.power)).toEqual([17, 83]);
      expect(effective().map((s) => s.hatchSpacingMm)).toEqual([0.1, 0.2]);
      expect(effective().map((s) => s.fillBidirectional)).toEqual([false, true]);
    } finally {
      await view.unmount();
    }
  });
  it('does not copy the first artwork by accepting an untouched mixed Advanced dialog', async () => {
    load(FIRST, SECOND);
    const before = JSON.stringify(useStore.getState().project);
    const view = await mount();
    try {
      await openAdvanced(view.host);
      await act(async () => document.querySelector('form')!.requestSubmit());
      expect(JSON.stringify(useStore.getState().project)).toBe(before);
      expect(useStore.getState().undoStack).toHaveLength(0);
    } finally {
      await view.unmount();
    }
  });
  it('shows common values normally', async () => {
    load(FIRST, FIRST);
    const view = await mount();
    try {
      expect(field(view.host, 'Power').value).toBe('17');
      expect(field(view.host, 'Power').placeholder).toBe('');
    } finally {
      await view.unmount();
    }
  });
  it('cancels a pending mixed edit when the same artworks receive new values', async () => {
    load(FIRST, SECOND);
    const view = await mount();
    try {
      await type(field(view.host, 'Power'), '29');
      await act(async () => load({ ...FIRST, power: 18 }, { ...SECOND, power: 84 }));
      await act(async () => vi.advanceTimersByTime(400));
      expect(effective().map((s) => s.power)).toEqual([18, 84]);
      expect(field(view.host, 'Power').placeholder).toBe('Mixed');
      expect(useStore.getState().undoStack).toHaveLength(0);
    } finally {
      await view.unmount();
    }
  });
  it('shows mixed image controls and applies a density without copying the other settings', async () => {
    load(
      {
        ...FIRST,
        mode: 'image',
        linesPerMm: 10,
        negativeImage: false,
        imageBidirectional: false,
        passThrough: false,
        dotWidthCorrectionMm: 0.01,
        ditherAlgorithm: 'grayscale',
      },
      {
        ...SECOND,
        mode: 'image',
        linesPerMm: 5,
        negativeImage: true,
        imageBidirectional: true,
        passThrough: true,
        dotWidthCorrectionMm: 0.02,
        ditherAlgorithm: 'grayscale',
      },
    );
    const view = await mount();
    try {
      for (const label of ['Minimum power', 'Line interval', 'DPI', 'Dot width correction']) {
        expect(field(view.host, label).placeholder).toBe('Mixed');
      }
      for (const label of ['Negative image', 'Bidirectional image scan', 'Pass-through image']) {
        expect(field(view.host, label).indeterminate).toBe(true);
      }
      await edit(field(view.host, 'DPI'), '254');
      expect(effective().map((s) => s.linesPerMm)).toEqual([10, 10]);
      expect(field(view.host, 'Line interval').value).toBe('0.1');
      expect(effective().map((s) => s.minPower)).toEqual([5, 11]);
      expect(effective().map((s) => s.negativeImage)).toEqual([false, true]);
    } finally {
      await view.unmount();
    }
  });
  it('applies Advanced density and checkbox edits without copying untouched values', async () => {
    load(FIRST, SECOND);
    const view = await mount();
    try {
      await openAdvanced(view.host);
      const form = document.querySelector('form')!;
      await edit(
        form.querySelector<HTMLInputElement>('input[aria-label="Cut settings lines per inch"]')!,
        '127',
      );
      await act(async () =>
        form.querySelector<HTMLInputElement>('input[name="fillBidirectional"]')!.click(),
      );
      await act(async () => form.requestSubmit());
      for (const settings of effective()) expect(settings.hatchSpacingMm).toBeCloseTo(0.2);
      expect(effective().map((s) => s.fillBidirectional)).toEqual([true, true]);
      expect(effective().map((s) => s.power)).toEqual([17, 83]);
      expect(effective().map((s) => s.speed)).toEqual([601, 1801]);
    } finally {
      await view.unmount();
    }
  });
  it.each([
    ['Speed', { speed: 7777 }, '7777'],
    ['Hatch spacing', { hatchSpacingMm: 0.025 }, '0.025'],
    ['Fill overscan', { fillOverscanMm: 26.75 }, '26.75'],
  ] as const)('retains the main fix for untouched imported %s', async (label, patch, expected) => {
    load({ ...FIRST, ...patch }, { ...FIRST, ...patch });
    const before = JSON.stringify(useStore.getState().project);
    const view = await mount();
    try {
      const input = field(view.host, label);
      expect(input.value).toBe(expected);
      await blur(input);
      expect(JSON.stringify(useStore.getState().project)).toBe(before);
      expect(useStore.getState().dirty).toBe(false);
    } finally {
      await view.unmount();
    }
  });
  it.each([false, true])(
    'applies image bounds per artwork regardless of order (reverse=%s)',
    async (reverse) => {
      const high = {
        ...SECOND,
        mode: 'image' as const,
        ditherAlgorithm: 'grayscale' as const,
        linesPerMm: 5,
        dotWidthCorrectionMm: 0.02,
      };
      const low = {
        ...FIRST,
        mode: 'image' as const,
        ditherAlgorithm: 'grayscale' as const,
        linesPerMm: 10,
        dotWidthCorrectionMm: 0.01,
      };
      load(reverse ? low : high, reverse ? high : low);
      const view = await mount();
      try {
        await edit(field(view.host, 'Minimum power'), '60');
        await edit(field(view.host, 'Dot width correction'), '0.15');
        expect(effective().map((s) => s.minPower)).toEqual(reverse ? [17, 60] : [60, 17]);
        expect(effective().map((s) => s.dotWidthCorrectionMm)).toEqual(
          reverse ? [0.1, 0.15] : [0.15, 0.1],
        );
        expect(field(view.host, 'Minimum power').placeholder).toBe('Mixed');
        expect(field(view.host, 'Dot width correction').placeholder).toBe('Mixed');
      } finally {
        await view.unmount();
      }
    },
  );
  it('applies Advanced image bounds to each artwork without copying density or power', async () => {
    load(
      { ...SECOND, mode: 'image', ditherAlgorithm: 'grayscale', linesPerMm: 5 },
      { ...FIRST, mode: 'image', ditherAlgorithm: 'grayscale', linesPerMm: 10 },
    );
    const view = await mount();
    try {
      await openAdvanced(view.host);
      const form = document.querySelector('form')!;
      await edit(form.querySelector<HTMLInputElement>('input[name="minPower"]')!, '60');
      await edit(
        form.querySelector<HTMLInputElement>('input[name="dotWidthCorrectionMm"]')!,
        '0.15',
      );
      await act(async () => form.requestSubmit());
      expect(effective().map((s) => s.minPower)).toEqual([60, 17]);
      expect(effective().map((s) => s.dotWidthCorrectionMm)).toEqual([0.15, 0.1]);
      expect(effective().map((s) => s.power)).toEqual([83, 17]);
      expect(effective().map((s) => s.linesPerMm)).toEqual([5, 10]);
    } finally {
      await view.unmount();
    }
  });
  it('keeps dot widths within the newly edited density and preserves smaller widths', async () => {
    load(
      { ...FIRST, mode: 'image', linesPerMm: 5, dotWidthCorrectionMm: 0.15 },
      { ...SECOND, mode: 'image', linesPerMm: 10, dotWidthCorrectionMm: 0.04 },
    );
    const view = await mount();
    try {
      await edit(field(view.host, 'DPI'), '508');
      expect(effective().map((s) => s.linesPerMm)).toEqual([20, 20]);
      expect(effective().map((s) => s.dotWidthCorrectionMm)).toEqual([0.05, 0.04]);
    } finally {
      await view.unmount();
    }
  });
  it.each([false, true])(
    'drops removed Advanced field edits even after returning to Fill (%s)',
    async (returnToFill) => {
      load(FIRST, SECOND);
      const view = await mount();
      try {
        await openAdvanced(view.host);
        const form = document.querySelector('form')!;
        await edit(form.querySelector<HTMLInputElement>('input[name="hatchAngleDeg"]')!, '90');
        const mode = form.querySelector<HTMLSelectElement>('select[name="mode"]')!;
        await act(async () => {
          mode.value = 'image';
          mode.dispatchEvent(new Event('change', { bubbles: true }));
        });
        if (returnToFill)
          await act(async () => {
            mode.value = 'fill';
            mode.dispatchEvent(new Event('change', { bubbles: true }));
          });
        await act(async () => form.requestSubmit());
        expect(effective().map((s) => s.mode)).toEqual(
          returnToFill ? ['fill', 'fill'] : ['image', 'image'],
        );
        expect(effective().map((s) => s.hatchAngleDeg)).toEqual([0, 45]);
      } finally {
        await view.unmount();
      }
    },
  );
  it('does not transfer a Fill edit to a newly mounted Line control with the same name', async () => {
    load(FIRST, SECOND);
    const view = await mount();
    try {
      await openAdvanced(view.host);
      const form = document.querySelector('form')!;
      await edit(form.querySelector<HTMLInputElement>('input[name="fillOverscanMm"]')!, '7');
      const mode = form.querySelector<HTMLSelectElement>('select[name="mode"]')!;
      await act(async () => {
        mode.value = 'line';
        mode.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await act(async () => form.requestSubmit());
      expect(effective().map((s) => s.fillOverscanMm)).toEqual([3, 5]);
      expect(effective().map((s) => s.mode)).toEqual(['line', 'line']);
    } finally {
      await view.unmount();
    }
  });
  it('keeps operation Show/Output controls out of artwork-only Advanced settings', async () => {
    load(FIRST, SECOND);
    const view = await mount();
    try {
      await openAdvanced(view.host);
      const form = document.querySelector('form')!;
      expect(form.querySelector('input[name="visible"]')).toBeNull();
      expect(form.querySelector('input[name="output"]')).toBeNull();
    } finally {
      await view.unmount();
    }
  });
});
