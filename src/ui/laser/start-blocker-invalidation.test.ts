// The Start-blocker banner names specific artwork and settings ("… is outside
// the bed"). It used to survive deleting that very artwork, because only a new
// Start, a Frame, or Forget Controller cleared it — so the operator fixed the
// canvas and the red banner kept accusing the object that no longer existed.
import { beforeEach, describe, expect, it } from 'vitest';
import { USER_ORIGIN_REQUIRED_MESSAGE } from '../job-placement';
import { useLaserStore } from '../state/laser-store';
import { useStore } from '../state/store';
import { useStartBlockerStore } from './start-blocker-store';
import { reportStartBlockers } from './start-blocker-invalidation';

const BLOCKED_MESSAGE = 'Start blocked: artwork is outside the bed.';

describe('Start-blocker expiry', () => {
  beforeEach(() => {
    useStartBlockerStore.getState().clear();
  });

  it('retains the refusal until the operator changes something', () => {
    reportStartBlockers([BLOCKED_MESSAGE]);
    useStore.setState({ selectedObjectId: 'object-1' });
    expect(useStartBlockerStore.getState().messages).toEqual([BLOCKED_MESSAGE]);
  });

  it('clears the refusal once the project the refusal described changes', () => {
    reportStartBlockers([BLOCKED_MESSAGE]);
    useStore.setState((state) => ({ project: { ...state.project } }));
    expect(useStartBlockerStore.getState().messages).toEqual([]);
  });

  it('clears the refusal when the canvas is emptied', () => {
    reportStartBlockers([BLOCKED_MESSAGE]);
    useStore.getState().newProject();
    expect(useStartBlockerStore.getState().messages).toEqual([]);
  });

  // UX audit U4-P3-6: "User Origin needs a custom work origin" stayed after
  // Set origin here.
  it('retires the origin request once a work origin is set, keeping other refusals', () => {
    useLaserStore.setState({ workOriginActive: false });
    reportStartBlockers([USER_ORIGIN_REQUIRED_MESSAGE, BLOCKED_MESSAGE], 'frame');
    useLaserStore.setState({ workOriginActive: true });
    expect(useStartBlockerStore.getState().messages).toEqual([BLOCKED_MESSAGE]);
    expect(useStartBlockerStore.getState().attempt).toBe('frame');
  });

  it('clears the banner when the origin request was its only refusal', () => {
    useLaserStore.setState({ workOriginActive: false });
    reportStartBlockers([USER_ORIGIN_REQUIRED_MESSAGE], 'frame');
    useLaserStore.setState({ workOriginActive: true });
    expect(useStartBlockerStore.getState().messages).toEqual([]);
  });
});
