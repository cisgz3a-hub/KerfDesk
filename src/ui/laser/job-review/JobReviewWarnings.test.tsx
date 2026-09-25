import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CNC_LASER_MODE_ENABLED_MESSAGE,
  CNC_LASER_MODE_UNVERIFIED_MESSAGE,
} from '../../../core/preflight/controller-readiness';
import { JobReviewWarnings } from './JobReviewWarnings';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<{ readonly host: HTMLElement; readonly root: ReturnType<typeof createRoot> }> =
  [];

afterEach(async () => {
  for (const { host, root } of mounted.splice(0)) {
    await act(async () => root.unmount());
    host.remove();
  }
});

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
});
