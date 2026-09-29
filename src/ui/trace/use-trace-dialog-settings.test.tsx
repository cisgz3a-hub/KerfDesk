// The dialog's preset picker applies the override reset (ADR-434 Amendment 1)
// to the settings it will commit and record for Re-trace (ADR-408).
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { useTraceDialogSettings, type TraceDialogSettingsState } from './use-trace-dialog-settings';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

async function withDialogSettings(
  run: (state: () => TraceDialogSettingsState) => Promise<void>,
): Promise<void> {
  let latest: TraceDialogSettingsState | null = null;
  function Probe(): null {
    latest = useTraceDialogSettings(
      'laser',
      { pixelWidth: 80, pixelHeight: 60 },
      {
        replaceTraceId: 'trace-1',
        traceSettings: {
          schemaVersion: 1,
          presetName: 'Centerline',
          overrides: { despeckleMinPixels: 'auto', smoothness: 0.4, detectionMode: 'manual' },
        },
      },
    );
    return null;
  }
  const host = document.createElement('div');
  const root = createRoot(host);
  await act(async () => root.render(<Probe />));
  try {
    await run(() => {
      if (latest === null) throw new Error('Probe did not render');
      return latest;
    });
  } finally {
    await act(async () => root.unmount());
  }
}

describe('useTraceDialogSettings preset switch', () => {
  it('restores Auto from the record and drops what the new preset defines', async () => {
    await withDialogSettings(async (state) => {
      expect(state().preset).toBe('Centerline');
      expect(state().traceSettings).toEqual({
        despeckleMinPixels: 'auto',
        smoothness: 0.4,
        detectionMode: 'manual',
      });
      await act(async () => state().selectPreset('Line Art'));
      expect(state().preset).toBe('Line Art');
      // Line Art makes its own small-mark choice; Smoothness changes role.
      expect(state().traceSettings).toEqual({ detectionMode: 'manual' });
      expect(state().record().overrides).toEqual({ detectionMode: 'manual' });
    });
  });
});
