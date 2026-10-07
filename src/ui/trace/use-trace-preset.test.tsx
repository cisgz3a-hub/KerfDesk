import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { EditionContext, UNRESTRICTED_EDITION, type EditionValue } from '../licensing/edition';
import { VISIBLE_TRACE_PRESET_NAMES } from './dialog-parts';
import { useTracePreset } from './use-trace-preset';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const FREE: EditionValue = { ...UNRESTRICTED_EDITION, pro: false, requestPro: () => false };

async function initialPreset(
  edition: EditionValue,
  machineKind: 'laser' | 'cnc',
  recorded?: string,
): Promise<string | undefined> {
  let preset: string | undefined;
  function Probe(): null {
    preset = useTracePreset(machineKind, recorded).preset;
    return null;
  }
  const host = document.createElement('div');
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <EditionContext.Provider value={edition}>
          <Probe />
        </EditionContext.Provider>,
      ),
    );
    return preset;
  } finally {
    await act(async () => root.unmount());
  }
}

describe('trace preset edition defaults', () => {
  it.each(['laser', 'cnc'] as const)('starts new %s traces on Line Art in Free', async (kind) => {
    expect(await initialPreset(FREE, kind)).toBe('Line Art');
  });

  it.each(['laser', 'cnc'] as const)(
    'keeps recorded Pro presets from silently opening in Free on %s',
    async (kind) => {
      for (const recorded of VISIBLE_TRACE_PRESET_NAMES)
        expect(await initialPreset(FREE, kind, recorded), recorded).toBe('Line Art');
    },
  );

  it('keeps Smooth as the Pro CNC default and restores every recorded Pro preset', async () => {
    expect(await initialPreset(UNRESTRICTED_EDITION, 'cnc')).toBe('Smooth');
    for (const recorded of VISIBLE_TRACE_PRESET_NAMES)
      expect(await initialPreset(UNRESTRICTED_EDITION, 'cnc', recorded)).toBe(recorded);
  });
});
