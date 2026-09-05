import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateFitCoupon } from '../../core/box';
import { BoxFitTestDialog } from './BoxFitTestDialog';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => localStorage.clear());
const SPEC = {
  thicknessMm: 3,
  fingerWidthMm: 9,
  startClearanceMm: 0.05,
  stepClearanceMm: 0.05,
  rungCount: 6,
};

describe('fit coupon relief validation', () => {
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects invalid core relief diameter %s before geometry',
    (toolDiameterMm) => {
      expect(
        generateFitCoupon({ ...SPEC, relief: { kind: 'corner-overcut', toolDiameterMm } }),
      ).toMatchObject({ kind: 'invalid', issues: [{ field: 'reliefTool' }] });
    },
  );

  it('preserves blank CNC text and prevents native or direct submission until diameter is valid', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const onGenerate = vi.fn();
    await act(async () =>
      root.render(
        <BoxFitTestDialog
          machine={{ kind: 'cnc', stockThicknessMm: 3, toolDiameterMm: 3.175 }}
          onCancel={vi.fn()}
          onGenerate={onGenerate}
        />,
      ),
    );
    try {
      const field = host.querySelector<HTMLInputElement>(
        'input[aria-label="Relief tool diameter"]',
      );
      const form = host.querySelector('form');
      if (!field || !form) throw new Error('form missing');
      await act(async () => {
        field.value = '';
        Simulate.change(field);
      });
      expect(field.value).toBe('');
      expect(field.validity.valueMissing).toBe(true);
      expect(host.querySelector('[role="alert"]')?.textContent).toContain('Relief tool diameter');
      await act(async () => {
        form.requestSubmit();
        Simulate.submit(form);
      });
      expect(onGenerate).not.toHaveBeenCalled();
      expect(localStorage.length).toBe(0);
      await act(async () => {
        field.value = '3.175';
        Simulate.change(field);
      });
      await act(async () =>
        form.querySelector<HTMLButtonElement>('button[type="submit"]')?.click(),
      );
      expect(onGenerate).toHaveBeenCalledOnce();
      const plain = generateFitCoupon({ ...SPEC, relief: { kind: 'none' } });
      if (plain.kind !== 'generated') throw new Error('plain coupon failed');
      expect(onGenerate.mock.calls[0]?.[0][1].rings.outline.points.length).toBeGreaterThan(
        plain.parts[1]?.rings.outline.points.length ?? 0,
      );
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('generates a laser coupon without a hidden relief diameter', () => {
    expect(generateFitCoupon({ ...SPEC, relief: { kind: 'none' } }).kind).toBe('generated');
  });
});
