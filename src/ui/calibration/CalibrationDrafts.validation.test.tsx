import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { compileJob, generateIntervalTestGrid, generateMaterialTestGrid } from '../../core/job';
import { grblStrategy } from '../../core/output/grbl-strategy';
import { IntervalTestDialog } from './IntervalTestDialog';
import { MaterialTestDialog } from './MaterialTestDialog';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => localStorage.clear());

describe('calibration draft validation', () => {
  it.each(['interval', 'material'] as const)(
    'rejects each incomplete %s draft field before persistence or generation',
    async (kind) => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const root = createRoot(host);
      const onGenerate = vi.fn();
      const Component = kind === 'interval' ? IntervalTestDialog : MaterialTestDialog;
      await act(async () =>
        root.render(
          <Component onCancel={vi.fn()} onGenerate={onGenerate} maxFeedMmPerMin={3000} />,
        ),
      );
      try {
        const form = host.querySelector('form');
        if (!form) throw new Error('form missing');
        for (const field of host.querySelectorAll('input[type="number"]')) {
          if (!(field instanceof HTMLInputElement)) throw new Error('number missing');
          const saved = field.value;
          await act(async () => {
            field.value = '';
            Simulate.change(field);
          });
          expect(field.validity.valueMissing).toBe(true);
          expect(host.querySelector('[role="alert"]')?.textContent).toContain(
            field.getAttribute('aria-label'),
          );
          await act(async () => {
            form.querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
            form.requestSubmit();
            // The handler also defends direct callers that bypass browser validation.
            Simulate.submit(form);
          });
          expect(onGenerate).not.toHaveBeenCalled();
          expect(localStorage.length).toBe(0);
          await act(async () => {
            field.value = saved;
            Simulate.change(field);
          });
        }
        expect(form.checkValidity()).toBe(true);
        await act(async () => form.requestSubmit());
        expect(onGenerate).toHaveBeenCalledOnce();
        const options = onGenerate.mock.calls[0]?.[0];
        const grid =
          kind === 'interval'
            ? generateIntervalTestGrid(options)
            : generateMaterialTestGrid(options);
        expect(() =>
          grblStrategy.emit(compileJob(grid.scene, DEFAULT_DEVICE_PROFILE), DEFAULT_DEVICE_PROFILE),
        ).not.toThrow();
      } finally {
        await act(async () => root.unmount());
        host.remove();
      }
    },
  );

  it.each(['interval', 'material'] as const)(
    'rejects out-of-range %s speed even through direct submit',
    async (kind) => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const root = createRoot(host);
      const onGenerate = vi.fn();
      const Component = kind === 'interval' ? IntervalTestDialog : MaterialTestDialog;
      await act(async () =>
        root.render(
          <Component onCancel={vi.fn()} onGenerate={onGenerate} maxFeedMmPerMin={3000} />,
        ),
      );
      try {
        const field = host.querySelector<HTMLInputElement>(
          `input[aria-label="${kind === 'interval' ? 'Speed' : 'Min speed'}"]`,
        );
        const form = host.querySelector('form');
        if (!field || !form) throw new Error('form missing');
        for (const invalid of ['0', '-1', 'NaN', 'Infinity']) {
          await act(async () => {
            field.value = invalid;
            Simulate.change(field);
          });
          await act(async () => Simulate.submit(form));
          expect(host.querySelector('[role="alert"]')).not.toBeNull();
          expect(onGenerate).not.toHaveBeenCalled();
        }
        expect(localStorage.length).toBe(0);
      } finally {
        await act(async () => root.unmount());
        host.remove();
      }
    },
  );
});
