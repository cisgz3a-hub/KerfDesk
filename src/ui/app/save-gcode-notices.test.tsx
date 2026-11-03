// UX audit U3-P3-6: Save G-code shows only the newest three toasts, and the
// beginner's material-test warning and the saved confirmation sat behind three
// expert notes. They now show first, and the technical notes fold into one
// (ADR-687).

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import { Toasts } from '../common/Toasts';
import { describeUncalibratedOperations } from '../laser/uncalibrated-job-warnings';
import { useToastStore } from '../state/toast-store';
import { pushSavedGcodeNotices } from './save-gcode-notices';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const RUNWAY_NOTE =
  'Generic Scan Line feed-matched entry and exit runways are active. The Neotronics-qualified 4040 fill policy is not selected because Default 400×400 is selected.';
const SCAN_OFFSET_NOTE =
  'Bidirectional scan output at 1500 mm/min has no saved scan-offset table. KerfDesk will emit 0 mm scan correction.';
const POWER_SCALE_NOTE = 'Output power uses saved profile S1000.';
const STARTER_VALUES = describeUncalibratedOperations(['a', 'b'], []);
const CUT_ORDER =
  'Cut runs before the engraving inside it: "Ellipse" runs before "Hi". Once a part is cut free it can drop or shift.';

const roots: Array<{ readonly root: Root; readonly host: HTMLElement }> = [];

beforeEach(() => useToastStore.setState({ toasts: [] }));

afterEach(async () => {
  for (const { root, host } of roots.splice(0)) {
    await act(async () => root.unmount());
    host.remove();
  }
  vi.useRealTimers();
  useToastStore.setState({ toasts: [] });
});

function save(machineWarnings: ReadonlyArray<string>, preflight: ReadonlyArray<string> = []): void {
  pushSavedGcodeNotices(
    {
      project: createProject(),
      controllerSettings: null,
      pushToast: useToastStore.getState().pushToast,
    },
    'untitled.gcode',
    {
      preflightAdvisories: preflight.map((message) => ({ code: 'out-of-bed', message })),
      cncVCarveDepths: [],
      machineWarnings,
    },
  );
}

async function renderToasts(): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push({ root, host });
  await act(async () => root.render(<Toasts />));
  return host;
}

describe('Save G-code notices', () => {
  it('shows the saved confirmation and the beginner warning, with expert notes folded into one', async () => {
    save([RUNWAY_NOTE, SCAN_OFFSET_NOTE, STARTER_VALUES, POWER_SCALE_NOTE]);

    const toasts = useToastStore.getState().toasts;
    expect(toasts.map((toast) => toast.message)).toEqual([
      'Technical notes (4) about this G-code.',
      STARTER_VALUES,
      'Saved G-code to untitled.gcode',
    ]);
    expect(toasts[0]?.details).toEqual([
      'Exported G-code assumes GRBL $30=1000 and laser mode ($32=1) — not verified against a connected controller this session.',
      RUNWAY_NOTE,
      SCAN_OFFSET_NOTE,
      POWER_SCALE_NOTE,
    ]);
    const host = await renderToasts();
    expect(host.textContent).toContain('Saved G-code to untitled.gcode');
    expect(host.textContent).toContain('still using the uncalibrated defaults');
    expect(host.querySelector('summary')?.textContent).toBe('Show all 4');
  });

  it('ranks the cut-order warning with the beginner warnings and keeps preflight findings nearest the confirmation', () => {
    save([POWER_SCALE_NOTE, CUT_ORDER], ['Job extends past the bed.']);

    expect(useToastStore.getState().toasts.map((toast) => toast.message)).toEqual([
      'Technical notes (2) about this G-code.',
      CUT_ORDER,
      'Job extends past the bed.',
      'Saved G-code to untitled.gcode',
    ]);
  });

  it('keeps a warning it does not know in view', () => {
    const other = 'Image "logo.png" stores 10 × 10 px but the burn grid wants 40 × 40 px.';
    save([other, RUNWAY_NOTE]);

    expect(useToastStore.getState().toasts.map((toast) => toast.message)).toEqual([
      'Technical notes (2) about this G-code.',
      other,
      'Saved G-code to untitled.gcode',
    ]);
  });

  it('pushes a single note as itself', () => {
    pushSavedGcodeNotices(
      {
        project: createProject(),
        controllerSettings: undefined,
        pushToast: useToastStore.getState().pushToast,
      },
      'untitled.gcode',
      { preflightAdvisories: [], cncVCarveDepths: [], machineWarnings: [POWER_SCALE_NOTE] },
    );

    const toasts = useToastStore.getState().toasts;
    expect(toasts.map((toast) => toast.message)).toEqual([
      POWER_SCALE_NOTE,
      'Saved G-code to untitled.gcode',
    ]);
    expect(toasts[0]).not.toHaveProperty('details');
  });

  it('keeps opened notes until they are dismissed', async () => {
    vi.useFakeTimers();
    save([RUNWAY_NOTE, SCAN_OFFSET_NOTE]);
    const host = await renderToasts();
    const details = host.querySelector('details');
    expect(details).not.toBeNull();

    await act(async () => {
      if (details === null) return;
      details.open = true;
      details.dispatchEvent(new Event('toggle'));
    });
    await act(async () => vi.advanceTimersByTime(60_000));

    expect(useToastStore.getState().toasts.map((toast) => toast.message)).toEqual([
      'Technical notes (3) about this G-code.',
    ]);
  });
});
