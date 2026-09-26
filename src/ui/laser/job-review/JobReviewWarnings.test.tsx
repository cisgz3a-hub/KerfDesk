import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CNC_LASER_MODE_ENABLED_MESSAGE,
  CNC_LASER_MODE_UNVERIFIED_MESSAGE,
  FLUIDNC_CNC_LASER_MODE_ENABLED_MESSAGE,
} from '../../../core/preflight/controller-readiness';
import { jobAwareConfirm } from '../../state/job-aware-dialogs';
import { useLaserStore } from '../../state/laser-store';
import { useToastStore } from '../../state/toast-store';
import { JobReviewWarnings } from './JobReviewWarnings';
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
  it('keeps ordinary advisories folded under the count', async () => {
    expect(await listOpens(['Layer L1 cuts 8 mm into 6.35 mm stock.'])).toBe(false);
  });

  // CNC audit JR-1: the $32 warning sat folded while laser mode skips the
  // spindle's spin-up at the dwell, on plunges and on Resume.
  it('opens for a router job whose controller has laser mode on or unconfirmed', async () => {
    expect(await listOpens(['Other advisory.', CNC_LASER_MODE_ENABLED_MESSAGE])).toBe(true);
    expect(await listOpens([CNC_LASER_MODE_UNVERIFIED_MESSAGE])).toBe(true);
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
});
