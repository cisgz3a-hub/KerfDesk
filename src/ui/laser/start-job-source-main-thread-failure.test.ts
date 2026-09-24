// Controller audit gap-start-10: a main-thread Start or Frame preparation that
// throws (a page-backed raster asset missing, for example) escaped as a bare
// "Unhandled rejection" toast. It now resolves to the same named refusal the
// worker path returns.

import { describe, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import { useStore } from '../state';
import { useCameraStore } from '../state/camera-store';
import { useLaserStore } from '../state/laser-store';
import type * as StartJobReadiness from './start-job-readiness';
import { prepareCurrentStartJob } from './start-job-source';

vi.mock('./start-job-readiness', async (importOriginal) => ({
  ...(await importOriginal<typeof StartJobReadiness>()),
  prepareStartJobSnapshot: vi.fn(async () => {
    throw new Error('Page-backed raster luma asset is unavailable.');
  }),
}));

describe('main-thread Start preparation failure', () => {
  it('resolves to a named refusal instead of rejecting', async () => {
    useStore.setState({ project: createProject() });

    const prepared = await prepareCurrentStartJob(
      useStore.getState(),
      useLaserStore.getState(),
      useCameraStore.getState(),
    );

    expect(prepared.ok).toBe(false);
    if (prepared.ok) return;
    expect(prepared.messages.join(' ')).toContain('Page-backed raster luma asset is unavailable.');
  });
});
