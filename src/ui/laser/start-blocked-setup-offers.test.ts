import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../state';
import { appConfirm } from '../state/app-dialogs';
import { resetStore } from '../state/test-helpers';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import {
  ABSOLUTE_WORK_OFFSET_REQUIRED_MESSAGE,
  USER_ORIGIN_REQUIRED_MESSAGE,
  VERIFIED_ORIGIN_REQUIRED_MESSAGE,
} from '../job-placement';
import { parseStatusReport } from '../../core/controllers/grbl';
import { restartedOriginNote, unrestoredOriginOfferPrompt } from './unrestored-abort-origin';
import {
  offerSetupFixForBlockedStart,
  SET_ORIGIN_OFFER_PROMPT,
  setOriginOfferPrompt,
  VERIFIED_ORIGIN_SET_ORIGIN_OFFER_PROMPT,
} from './start-blocked-setup-offers';

vi.mock('../state/app-dialogs', () => ({
  appConfirm: vi.fn(async () => true),
}));

const original = {
  setOriginHere: useLaserStore.getState().setOriginHere,
  resetOrigin: useLaserStore.getState().resetOrigin,
  restoreWorkOrigin: useLaserStore.getState().restoreWorkOrigin,
  jobStopRequest: useLaserStore.getState().jobStopRequest ?? null,
  streamerEpoch: useLaserStore.getState().streamerEpoch,
  statusReport: useLaserStore.getState().statusReport,
  wcoCache: useLaserStore.getState().wcoCache,
  machineZeroEpoch: useLaserStore.getState().machineZeroEpoch ?? 0,
};

beforeEach(() => {
  vi.mocked(appConfirm).mockReset().mockResolvedValue(true);
  useLaserStore.setState({
    setOriginHere: vi.fn(async () => undefined),
    resetOrigin: vi.fn(async () => undefined),
  });
  useToastStore.setState({ toasts: [] });
});

afterEach(() => {
  useLaserStore.setState({ ...original });
  useToastStore.setState({ toasts: [] });
  vi.restoreAllMocks();
});

describe('set-origin offer', () => {
  // UX audit U4-P3-6: the offer did not say which point of the design goes at
  // the head.
  it('names the point of the design that goes where the head is', async () => {
    resetStore();
    useStore.getState().setJobPlacement({ startFrom: 'user-origin', anchor: 'center' });
    await offerSetupFixForBlockedStart(USER_ORIGIN_REQUIRED_MESSAGE);
    expect(appConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ message: setOriginOfferPrompt('User Origin', 'center') }),
    );
    expect(setOriginOfferPrompt('User Origin', 'center')).toContain(
      'The centre of your design goes there',
    );
    expect(SET_ORIGIN_OFFER_PROMPT).toContain('The front-left corner of your design goes there');
    resetStore();
  });

  it('sets the work origin at the current position and retries', async () => {
    await expect(offerSetupFixForBlockedStart(USER_ORIGIN_REQUIRED_MESSAGE)).resolves.toBe('retry');
    expect(appConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ message: SET_ORIGIN_OFFER_PROMPT }),
    );
    expect(SET_ORIGIN_OFFER_PROMPT).toContain('Frame the updated placement before starting');
    expect(vi.mocked(useLaserStore.getState().setOriginHere)).toHaveBeenCalledTimes(1);
    expect(useToastStore.getState().toasts.at(-1)).toMatchObject({ variant: 'success' });
  });

  it('keeps the block when the operator declines', async () => {
    vi.mocked(appConfirm).mockResolvedValue(false);
    await expect(offerSetupFixForBlockedStart(USER_ORIGIN_REQUIRED_MESSAGE)).resolves.toBe(
      'unrepaired',
    );
    expect(vi.mocked(useLaserStore.getState().setOriginHere)).not.toHaveBeenCalled();
  });

  it('reports the failure and keeps the block when Set origin throws', async () => {
    useLaserStore.setState({
      setOriginHere: vi.fn(async () => {
        throw new Error('not idle');
      }),
    });
    await expect(offerSetupFixForBlockedStart(USER_ORIGIN_REQUIRED_MESSAGE)).resolves.toBe(
      'unrepaired',
    );
    expect(useToastStore.getState().toasts.at(-1)).toMatchObject({ variant: 'warning' });
  });
});

describe('unknown Absolute offset', () => {
  it('does not offer to erase an origin while waiting for controller coordinates', async () => {
    await expect(offerSetupFixForBlockedStart(ABSOLUTE_WORK_OFFSET_REQUIRED_MESSAGE)).resolves.toBe(
      'unrepaired',
    );
    expect(appConfirm).not.toHaveBeenCalled();
    expect(vi.mocked(useLaserStore.getState().resetOrigin)).not.toHaveBeenCalled();
  });
});

describe('refusals without a one-click remedy', () => {
  it('offers nothing for an unknown refusal', async () => {
    await expect(offerSetupFixForBlockedStart('A job is already active.')).resolves.toBe(
      'unrepaired',
    );
    expect(appConfirm).not.toHaveBeenCalled();
  });
});

describe('verified-origin set-origin offer (ADR-327)', () => {
  it('offers the same one-click Set origin remedy as User Origin', async () => {
    await expect(offerSetupFixForBlockedStart(VERIFIED_ORIGIN_REQUIRED_MESSAGE)).resolves.toBe(
      'retry',
    );
    expect(appConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ message: VERIFIED_ORIGIN_SET_ORIGIN_OFFER_PROMPT }),
    );
    expect(useLaserStore.getState().setOriginHere).toHaveBeenCalledTimes(1);
  });

  it('keeps the block when the operator declines', async () => {
    vi.mocked(appConfirm).mockResolvedValue(false);
    await expect(offerSetupFixForBlockedStart(VERIFIED_ORIGIN_REQUIRED_MESSAGE)).resolves.toBe(
      'unrepaired',
    );
    expect(useLaserStore.getState().setOriginHere).not.toHaveBeenCalled();
  });
});

// Rolling audit v10 V3-P2-2 (re-rated P1): after ABORT JOB the origin the job
// ran from is kept, and when it was not put back the offer names it and the
// head's distance, and Restore origin puts it back instead of setting the origin at the head.
describe('offer while an aborted job origin is unrestored', () => {
  const SAVED = { x: 60, y: 40 };

  beforeEach(() => {
    useLaserStore.setState({
      restoreWorkOrigin: vi.fn(async () => undefined),
      streamerEpoch: 7,
      jobStopRequest: {
        reason: 'operator',
        streamerEpoch: 7,
        originAtStopMm: SAVED,
        originMachineZeroEpoch: 3,
      },
      machineZeroEpoch: 3,
      statusReport: parseStatusReport('<Idle|MPos:69.800,45.750,0.000|FS:0,0>'),
      wcoCache: null,
    });
  });

  it('names the saved origin and the head distance, and Restore origin puts it back', async () => {
    await expect(offerSetupFixForBlockedStart(USER_ORIGIN_REQUIRED_MESSAGE)).resolves.toBe('retry');
    const prompt = vi.mocked(appConfirm).mock.calls[0]?.[0]?.message ?? '';
    expect(prompt).toBe(
      unrestoredOriginOfferPrompt('User Origin', SAVED, { x: 9.8, y: 5.75 }, false),
    );
    expect(prompt).toContain(
      'The job you stopped ran from X 60, Y 40 mm from machine zero, and that origin was not restored.',
    );
    expect(prompt).toContain('The head is 11.36 mm from it (X +9.8, Y +5.75 mm).');
    expect(prompt).toContain('"Restore origin" puts the saved origin back with one G92');
    expect(prompt).toContain('use Set origin here in the Machine panel');
    expect(prompt).not.toContain('set the work origin at the current head position');
    expect(useLaserStore.getState().restoreWorkOrigin).toHaveBeenCalledWith(SAVED);
    expect(useLaserStore.getState().setOriginHere).not.toHaveBeenCalled();
  });

  it('sets nothing when the operator declines', async () => {
    vi.mocked(appConfirm).mockResolvedValue(false);
    await expect(offerSetupFixForBlockedStart(USER_ORIGIN_REQUIRED_MESSAGE)).resolves.toBe(
      'unrepaired',
    );
    expect(useLaserStore.getState().restoreWorkOrigin).not.toHaveBeenCalled();
    expect(useLaserStore.getState().setOriginHere).not.toHaveBeenCalled();
  });

  it('says so when the head position is unknown', () => {
    expect(unrestoredOriginOfferPrompt('Verified Origin', SAVED, null, true)).toContain(
      'KerfDesk cannot tell how far the head is from it.',
    );
    expect(unrestoredOriginOfferPrompt('Verified Origin', SAVED, null, true)).toContain(
      '"Home and restore origin" homes the machine',
    );
  });

  // Rolling audit v12 X1-P1-1: a new connection or a power-up re-zeroes machine
  // position on a machine without homing, so the saved origin cannot go back.
  it('after machine zero may have moved, without homing, offers only the origin at the head', async () => {
    useLaserStore.setState({ machineZeroEpoch: 4 });
    await expect(offerSetupFixForBlockedStart(USER_ORIGIN_REQUIRED_MESSAGE)).resolves.toBe('retry');
    const prompt = vi.mocked(appConfirm).mock.calls[0]?.[0]?.message ?? '';
    expect(prompt).toContain(restartedOriginNote(SAVED));
    expect(prompt).toContain(
      'The job you stopped ran from X 60, Y 40 mm from machine zero, but the controller has restarted',
    );
    expect(prompt).toContain('"Set origin here" sets the work origin where the head is now.');
    expect(prompt).not.toContain('puts the saved origin back');
    expect(prompt).not.toContain('The head is');
    expect(useLaserStore.getState().restoreWorkOrigin).not.toHaveBeenCalled();
    expect(useLaserStore.getState().setOriginHere).toHaveBeenCalledTimes(1);
  });

  it('after machine zero may have moved, with homing, says Home comes first', () => {
    const prompt = unrestoredOriginOfferPrompt('User Origin', SAVED, { x: 1, y: 2 }, true, true);
    expect(prompt).toContain(
      'The controller has restarted since then, so its machine zero may have moved: Home ' +
        'measures it again before the origin goes back.',
    );
    expect(prompt).toContain('"Home and restore origin" homes the machine');
    expect(prompt).not.toContain('The head is');
  });

  it('keeps the plain offer for a stop that was not the operator Abort', async () => {
    useLaserStore.setState({ jobStopRequest: { reason: 'app-closing', streamerEpoch: 7 } });
    await offerSetupFixForBlockedStart(USER_ORIGIN_REQUIRED_MESSAGE);
    expect(appConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ message: SET_ORIGIN_OFFER_PROMPT }),
    );
  });
});
