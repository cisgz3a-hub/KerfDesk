import { useState } from 'react';
import { expect, it, vi } from 'vitest';
import { TRACE_PRESETS } from '../../core/trace';
import {
  clickControl,
  clickElement,
  control,
  mountControl,
} from '../image-editor/control-audit-test-support';
import { TraceSettingsControls } from './TraceSettingsControls';
import type { LightBurnTraceSettingOverrides } from './trace-options';
import { DeleteImageAfterTraceToggle, DialogActions, TraceDialogHeader } from './dialog-parts';
import { settlementSource } from './trace-settlement.test-support';

it.each(['Sharp', 'Edge Detection'])(
  'opens $0 finishing disclosure and Reset clears real override state',
  async (preset) => {
    let current: LightBurnTraceSettingOverrides = {};
    function Harness() {
      const [overrides, set] = useState<LightBurnTraceSettingOverrides>({ smoothness: 1 });
      current = overrides;
      return (
        <TraceSettingsControls
          preset={TRACE_PRESETS[preset]!}
          overrides={overrides}
          onChange={set}
          sourceHasTransparency
        />
      );
    }
    const host = await mountControl(<Harness />);
    for (const summary of host.querySelectorAll('summary')) {
      await clickElement(summary);
      expect(summary.parentElement?.hasAttribute('open')).toBe(true);
    }
    const alpha = host.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (preset === 'Sharp') {
      await clickElement(alpha);
      expect(current.traceTransparency).toBe(true);
    }
    await clickControl(host, 'Reset trace settings');
    expect(current).toEqual({});
    expect(control(host, 'Reset trace settings').disabled).toBe(true);
  },
);

it('trace header Close, source-removal toggle, Cancel and submit dispatch distinct dialog actions', async () => {
  const close = vi.fn();
  const cancel = vi.fn();
  const submit = vi.fn();
  const removal = vi.fn();
  const host = await mountControl(
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <TraceDialogHeader source={settlementSource} onClose={close} />
      <DeleteImageAfterTraceToggle checked={false} onChange={removal} />
      <DialogActions canSubmit busy={false} onCancel={cancel} />
    </form>,
  );
  await clickControl(host, 'Close trace image');
  expect(close).toHaveBeenCalledTimes(1);
  await clickElement(host.querySelector<HTMLInputElement>('input[type="checkbox"]'));
  expect(removal).toHaveBeenCalledWith(true);
  await clickControl(host, 'Cancel');
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(submit).not.toHaveBeenCalled();
  await clickControl(host, 'Trace');
  expect(submit).toHaveBeenCalledTimes(1);
  const blocked = await mountControl(<DialogActions canSubmit={false} busy onCancel={cancel} />);
  expect(control(blocked, 'Tracing…').disabled).toBe(true);
});
