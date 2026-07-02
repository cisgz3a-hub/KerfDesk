import { beforeEach, describe, expect, it } from 'vitest';
import type { Toolpath } from '../../core/job';
import { useStore } from './store';
import { resetStore } from './test-helpers';

const TOOLPATH: Toolpath = {
  steps: [
    {
      kind: 'cut',
      color: '#7c3aed',
      polyline: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      length: 10,
      z: { from: -1, to: -1 },
    },
  ],
  totalLength: 10,
};

beforeEach(() => {
  resetStore();
});

describe('external G-code preview slot (F-CNC10)', () => {
  it('opening a program stores it and forces preview mode on', () => {
    expect(useStore.getState().previewMode).toBe(false);

    useStore.getState().openExternalGcodePreview('job.nc', TOOLPATH);

    const state = useStore.getState();
    expect(state.previewMode).toBe(true);
    expect(state.externalGcodePreview).toEqual({ name: 'job.nc', toolpath: TOOLPATH });
  });

  it('exiting preview clears the external program', () => {
    useStore.getState().openExternalGcodePreview('job.nc', TOOLPATH);

    useStore.getState().togglePreview(); // preview off

    const state = useStore.getState();
    expect(state.previewMode).toBe(false);
    expect(state.externalGcodePreview).toBeNull();
  });

  it('turning preview back on shows the compiled job, not the stale program', () => {
    useStore.getState().openExternalGcodePreview('job.nc', TOOLPATH);
    useStore.getState().togglePreview();
    useStore.getState().togglePreview();

    expect(useStore.getState().previewMode).toBe(true);
    expect(useStore.getState().externalGcodePreview).toBeNull();
  });
});
