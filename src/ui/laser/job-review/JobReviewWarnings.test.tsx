import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CNC_LASER_MODE_ENABLED_MESSAGE,
  CNC_LASER_MODE_UNVERIFIED_MESSAGE,
  FLUIDNC_CNC_LASER_MODE_ENABLED_MESSAGE,
  LASER_MODE_DISABLED_MESSAGE,
} from '../../../core/preflight/controller-readiness';
import { laserModeDisabledMessage } from '../../../core/preflight/controller-readiness-messages';
import { FOCUS_TEST_Z_UNCONFIRMED_WARNING } from '../../../core/job/focus-test';
import { jobAwareConfirm } from '../../state/job-aware-dialogs';
import { useLaserStore } from '../../state/laser-store';
import { UNKNOWN_NATIVE_BED_MESSAGE } from '../../state/native-bed-frame';
import { useToastStore } from '../../state/toast-store';
import { describeUncalibratedOperations } from '../uncalibrated-job-warnings';
import { JobReviewWarnings } from './JobReviewWarnings';
import { LASER_MODE_CONFIRMED_MESSAGE } from '../laser-mode-write';
import { SEND_LASER_MODE_PROMPT } from './SendLaserModeButton';
import { ROUTER_MODE_CONFIRMED_MESSAGE, SEND_ROUTER_MODE_PROMPT } from './SendRouterModeButton';

vi.mock('../../state/job-aware-dialogs', () => ({
  jobAwareConfirm: vi.fn(() => true),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<{ readonly host: HTMLElement; readonly root: ReturnType<typeof createRoot> }> =
  [];

const originalWrite = useLaserStore.getState().writeGrblSetting;

afterEach(async () => {
  for (const { host, root } of mounted.splice(0)) {
    await act(async () => root.unmount());
    host.remove();
  }
  useLaserStore.setState({ writeGrblSetting: originalWrite });
  useToastStore.setState({ toasts: [] });
  vi.mocked(jobAwareConfirm).mockReset().mockReturnValue(true);
});

async function renderWarnings(warnings: ReadonlyArray<string>): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  mounted.push({ host, root });
  await act(async () => {
    root.render(<JobReviewWarnings warnings={warnings} />);
  });
  return host;
}

function sendButton(host: HTMLElement): HTMLButtonElement | undefined {
  return [...host.querySelectorAll('button')].find((b) => b.textContent === 'Send $32=0');
}

async function listOpens(warnings: ReadonlyArray<string>): Promise<boolean | undefined> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  mounted.push({ host, root });
  await act(async () => {
    root.render(<JobReviewWarnings warnings={warnings} />);
  });
  return host.querySelector('details')?.open;
}

describe('JobReviewWarnings', () => {
  it('shows each warning as a short headline with the rest folded under it', async () => {
    const host = await renderWarnings([
      'Layer L1 cuts 8 mm into 6.35 mm stock. Check the stock thickness before cutting.',
      'Island fill can overburn small details.',
    ]);
    expect(host.querySelector('h3')?.textContent).toBe('2 warnings· none block the start');
    expect([...host.querySelectorAll('li')].map((item) => item.textContent)).toEqual([
      'Layer L1 cuts 8 mm into 6.35 mm stockCheck the stock thickness before cutting.',
      'Island fill can overburn small details',
    ]);
    expect(host.querySelector('summary')?.textContent).toBe(
      'Layer L1 cuts 8 mm into 6.35 mm stock',
    );
    expect(host.querySelector('details')?.open).toBe(false);
  });

  // CNC audit JR-1: the $32 warning sat folded while laser mode skips the
  // spindle's spin-up at the dwell, on plunges and on Resume.
  it('opens for a router job whose controller has laser mode on or unconfirmed', async () => {
    expect(await listOpens(['Other advisory.', CNC_LASER_MODE_ENABLED_MESSAGE])).toBe(true);
    expect(await listOpens([CNC_LASER_MODE_UNVERIFIED_MESSAGE])).toBe(true);
  });

  it('opens for a Focus Test on a profile without confirmed Z travel', async () => {
    expect(await listOpens(['Other advisory.', FOCUS_TEST_Z_UNCONFIRMED_WARNING])).toBe(true);
  });

  // ADR-180 Amendment 6: the laser-mode-on row fixes itself in place, through
  // Machine Settings' guarded write and read-back.
  it('offers Send $32=0 only on the GRBL laser-mode-on row', async () => {
    const host = await renderWarnings([
      CNC_LASER_MODE_UNVERIFIED_MESSAGE,
      FLUIDNC_CNC_LASER_MODE_ENABLED_MESSAGE,
      'Other advisory.',
    ]);
    expect(sendButton(host)).toBeUndefined();
    expect(sendButton(await renderWarnings([CNC_LASER_MODE_ENABLED_MESSAGE]))).toBeDefined();
  });

  it('writes $32=0 after the operator confirms, and says the controller confirmed it', async () => {
    const write = vi.fn(async () => undefined);
    useLaserStore.setState({ writeGrblSetting: write });
    const host = await renderWarnings([CNC_LASER_MODE_ENABLED_MESSAGE]);

    await act(async () => sendButton(host)?.click());

    expect(jobAwareConfirm).toHaveBeenCalledWith(SEND_ROUTER_MODE_PROMPT);
    expect(write).toHaveBeenCalledExactlyOnceWith(32, '0');
    expect(useToastStore.getState().toasts.at(-1)).toMatchObject({
      message: ROUTER_MODE_CONFIRMED_MESSAGE,
      variant: 'success',
    });
  });

  it('writes nothing when the operator declines', async () => {
    vi.mocked(jobAwareConfirm).mockReturnValue(false);
    const write = vi.fn(async () => undefined);
    useLaserStore.setState({ writeGrblSetting: write });
    const host = await renderWarnings([CNC_LASER_MODE_ENABLED_MESSAGE]);

    await act(async () => sendButton(host)?.click());

    expect(write).not.toHaveBeenCalled();
  });

  it('reports a refused or unverified write with its reason', async () => {
    const reason = 'Machine must report Idle before writing firmware settings.';
    useLaserStore.setState({
      writeGrblSetting: vi.fn(async () => Promise.reject(new Error(reason))),
    });
    const host = await renderWarnings([CNC_LASER_MODE_ENABLED_MESSAGE]);

    await act(async () => sendButton(host)?.click());

    expect(useToastStore.getState().toasts.at(-1)).toMatchObject({
      message: `$32=0 was not written: ${reason}`,
      variant: 'warning',
    });
  });

  // UX audit U8-P2-1 (ADR-637 Amendment 7): the laser twin. A laser whose
  // controller has laser mode off gets Send $32=1 on its row, opened at once.
  it('offers Send $32=1 on the laser-mode-off row and writes it after a confirm', async () => {
    const write = vi.fn(async () => undefined);
    useLaserStore.setState({ writeGrblSetting: write });
    const host = await renderWarnings(['Other advisory.', LASER_MODE_DISABLED_MESSAGE]);
    expect(sendButton(host)).toBeUndefined();
    expect(host.querySelector('summary')?.textContent).toContain('Laser mode is off ($32=0)');
    expect(host.querySelector('details')?.open).toBe(true);

    await act(async () => laserButton(host)?.click());

    expect(jobAwareConfirm).toHaveBeenCalledWith(SEND_LASER_MODE_PROMPT);
    expect(write).toHaveBeenCalledExactlyOnceWith(32, '1');
    expect(useToastStore.getState().toasts.at(-1)).toMatchObject({
      message: LASER_MODE_CONFIRMED_MESSAGE,
      variant: 'success',
    });
  });

  it('leaves Send $32=1 off the FluidNC row and off a driver that writes no $ settings', async () => {
    expect(laserButton(await renderWarnings([FLUIDNC_LASER_MODE_DISABLED]))).toBeUndefined();
    const capabilities = useLaserStore.getState().capabilities;
    useLaserStore.setState({ capabilities: { ...capabilities, settings: 'grbl-dollar-read' } });
    try {
      expect(laserButton(await renderWarnings([LASER_MODE_DISABLED_MESSAGE]))).toBeUndefined();
    } finally {
      useLaserStore.setState({ capabilities });
    }
  });

  it('writes no $32=1 when the operator declines, and reports a refusal', async () => {
    vi.mocked(jobAwareConfirm).mockReturnValue(false);
    const write = vi.fn(async () => undefined);
    useLaserStore.setState({ writeGrblSetting: write });
    const declined = await renderWarnings([LASER_MODE_DISABLED_MESSAGE]);
    await act(async () => laserButton(declined)?.click());
    expect(write).not.toHaveBeenCalled();

    vi.mocked(jobAwareConfirm).mockReturnValue(true);
    const reason = 'Machine must report Idle before writing firmware settings.';
    useLaserStore.setState({
      writeGrblSetting: vi.fn(async () => Promise.reject(new Error(reason))),
    });
    const refused = await renderWarnings([LASER_MODE_DISABLED_MESSAGE]);
    await act(async () => laserButton(refused)?.click());
    expect(useToastStore.getState().toasts.at(-1)).toMatchObject({
      message: `$32=1 was not written: ${reason}`,
      variant: 'warning',
    });
  });
});

const FLUIDNC_LASER_MODE_DISABLED = laserModeDisabledMessage('fluidnc-yaml');

function laserButton(host: HTMLElement): HTMLButtonElement | undefined {
  return [...host.querySelectorAll('button')].find((b) => b.textContent === 'Send $32=1');
}

// UX audit U4-P2-6 (ADR-687): a first job's review led with four expert
// notes. A beginner's warnings now lead, and technical notes fold.
describe('Job Review warning ranking', () => {
  const runway =
    'Generic Scan Line feed-matched entry and exit runways are active. The Neotronics-qualified 4040 fill policy is not selected.';
  const scanOffsets = 'Bidirectional scan output at 1500 mm/min has no saved scan-offset table.';
  const starter = describeUncalibratedOperations(['Rectangle'], []);
  const other = 'Image "logo.png" stores 10 × 10 px but the burn grid wants 40 × 40 px.';

  it("leads with the beginner's warnings and folds the technical notes", async () => {
    const host = await renderWarnings([
      runway,
      other,
      scanOffsets,
      starter,
      UNKNOWN_NATIVE_BED_MESSAGE,
    ]);

    expect(host.querySelector('h3')?.textContent).toContain('3 warnings');
    const visible = [...host.querySelectorAll(':scope section > ul > li')].map(
      (li) => li.textContent,
    );
    expect(visible).toEqual([
      expect.stringContaining('still using the uncalibrated defaults'),
      expect.stringContaining("KerfDesk can't check where this job sits on your bed"),
      expect.stringContaining('logo.png'),
    ]);
    const folded = host.querySelector<HTMLDetailsElement>('section > details');
    expect(folded?.open).toBe(false);
    expect(folded?.querySelector(':scope > summary')?.textContent).toBe('Technical notes (2)');
    expect(folded?.textContent).toContain('scan-offset table');
  });

  it('shows technical notes alone without calling them warnings', async () => {
    const host = await renderWarnings([scanOffsets]);

    expect(host.querySelector('h3')?.textContent).toContain('Notes');
    expect(host.querySelector('section > details > summary')?.textContent).toBe(
      'Technical notes (1)',
    );
  });
});
