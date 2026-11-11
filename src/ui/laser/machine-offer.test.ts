// Frame's fix offers as in-app questions (ADR-707; annoyance audit A1-P3-8).
// They were native OK/Cancel boxes, which froze the page: the controller could
// not be seen to change while one was open. These tests pin what replaces
// that: named buttons, no key landing on the action by accident, and no
// command sent for a question the controller has moved on from.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStreamer, step, type StatusReport } from '../../core/controllers/grbl';
import { createProject } from '../../core/scene';
import { useStore } from '../state';
import { answerAppDialogs, clearAppDialogs } from '../state/app-dialog-test-helpers';
import { useAppDialogStore } from '../state/app-dialog-store';
import { useLaserStore } from '../state/laser-store';
import { ACTIVE_JOB_COMMAND_MESSAGE } from '../state/laser-store-helpers';
import { useToastStore } from '../state/toast-store';
import { ZERO_Z_OFFER_BUTTON, ZERO_Z_OFFER_PROMPT } from './frame-cnc-preparation';
import { askMachineOffer, MACHINE_CHANGED_WHILE_ASKED_MESSAGE } from './machine-offer';
import {
  HOME_OFFER_BUTTON,
  HOME_OFFER_CURRENT_POSITION_PROMPT,
  HOME_OFFER_PROMPT,
  offerAlarmFixForBlockedStart,
  PROBE_UNLOCK_OFFER_PROMPT,
  UNLOCK_OFFER_BUTTON,
  UNLOCK_OFFER_PROMPT,
} from './start-blocked-alarm-offers';
import { SET_ORIGIN_OFFER_BUTTON, SET_ORIGIN_OFFER_PROMPT } from './start-blocked-setup-offers';
import { STATUS_ALARM_START_MESSAGE } from './start-job-readiness';
import {
  abortTurnOfferNote,
  restoreOriginOfferButton,
  unrestoredOriginOfferPrompt,
} from './unrestored-abort-origin';

const original = {
  unlockAlarm: useLaserStore.getState().unlockAlarm,
  home: useLaserStore.getState().home,
  capabilities: useLaserStore.getState().capabilities,
  controllerSessionEpoch: useLaserStore.getState().controllerSessionEpoch,
};

const offer = { title: 'Home the machine?', message: HOME_OFFER_PROMPT, confirmLabel: 'Home now' };

function alarmStatus(): StatusReport {
  // Test-only shorthand: the offers read the state alone from the report.
  return { state: 'Alarm' } as StatusReport;
}

function toastMessages(): string[] {
  return useToastStore.getState().toasts.map((toast) => toast.message);
}

/** The question on screen, once the offer has asked it. */
async function openQuestion(): Promise<
  Extract<ReturnType<typeof useAppDialogStore.getState>['queue'][number], { kind: 'confirm' }>
> {
  await vi.waitFor(() => expect(useAppDialogStore.getState().queue).toHaveLength(1));
  const request = useAppDialogStore.getState().queue[0];
  if (request?.kind !== 'confirm') throw new Error('no confirm is open');
  return request;
}

beforeEach(() => {
  useLaserStore.setState({
    unlockAlarm: vi.fn(async () => undefined),
    home: vi.fn(async () => undefined),
    capabilities: { ...original.capabilities, unlock: true },
    statusReport: alarmStatus(),
    alarmCode: 9,
    streamer: null,
  });
  useToastStore.setState({ toasts: [] });
});

afterEach(() => {
  clearAppDialogs();
  useLaserStore.setState({
    ...original,
    statusReport: null,
    alarmCode: null,
    positionEvidenceSuppressed: false,
    streamer: null,
  });
  useStore.setState({ project: createProject() });
  vi.restoreAllMocks();
});

describe('askMachineOffer', () => {
  it('asks in the app with the action as the button, focus on the dialog itself', async () => {
    const native = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const answers = answerAppDialogs(() => true);

    await expect(askMachineOffer(offer)).resolves.toBe(true);

    answers.stop();
    expect(native).not.toHaveBeenCalled();
    expect(answers.asked.map((request) => request.options)).toEqual([
      {
        title: 'Home the machine?',
        message: HOME_OFFER_PROMPT,
        confirmLabel: 'Home now',
        // A key on its way to another control must not home the machine.
        initialFocus: 'surface',
        refuseDuringJob: ACTIVE_JOB_COMMAND_MESSAGE,
      },
    ]);
  });

  it('resolves false when the operator cancels, with no toast', async () => {
    const answers = answerAppDialogs(() => false);

    await expect(askMachineOffer(offer)).resolves.toBe(false);

    answers.stop();
    expect(toastMessages()).toEqual([]);
  });

  it('is refused while a job is active, saying why', async () => {
    useLaserStore.setState({ streamer: step(createStreamer('G1 X1 S100')).state });
    const answers = answerAppDialogs(() => true);

    await expect(askMachineOffer(offer)).resolves.toBe(false);

    answers.stop();
    expect(answers.asked).toEqual([]);
    expect(toastMessages()).toEqual([ACTIVE_JOB_COMMAND_MESSAGE]);
  });

  it('counts a yes as no when the controller session changed while it was open', async () => {
    const asked = askMachineOffer(offer);
    const question = await openQuestion();
    // A reconnect or a reset: the alarm that was asked about belongs to the old session.
    useLaserStore.setState({
      controllerSessionEpoch: useLaserStore.getState().controllerSessionEpoch + 1,
    });
    question.resolve({ confirmed: true, dontAskAgain: false });

    await expect(asked).resolves.toBe(false);
    expect(toastMessages()).toEqual([MACHINE_CHANGED_WHILE_ASKED_MESSAGE]);
  });

  it('counts a yes as no when what the question described no longer holds', async () => {
    const asked = askMachineOffer(offer, (laser) => laser.alarmCode === 9);
    const question = await openQuestion();
    useLaserStore.setState({ alarmCode: null });
    question.resolve({ confirmed: true, dontAskAgain: false });

    await expect(asked).resolves.toBe(false);
    expect(toastMessages()).toEqual([MACHINE_CHANGED_WHILE_ASKED_MESSAGE]);
  });
});

describe('the alarm offers', () => {
  it('Unlock sends nothing when the alarm cleared while the question was open', async () => {
    const repair = offerAlarmFixForBlockedStart([STATUS_ALARM_START_MESSAGE]);
    const question = await openQuestion();
    expect(question.options.confirmLabel).toBe(UNLOCK_OFFER_BUTTON);
    // The operator reset the controller at the machine instead.
    useLaserStore.setState({ alarmCode: null, statusReport: { state: 'Idle' } as StatusReport });
    question.resolve({ confirmed: true, dontAskAgain: false });

    await expect(repair).resolves.toBe('unrepaired');
    expect(vi.mocked(useLaserStore.getState().unlockAlarm)).not.toHaveBeenCalled();
    expect(toastMessages()).toEqual([MACHINE_CHANGED_WHILE_ASKED_MESSAGE]);
  });

  it('Unlock sends the unlock when nothing changed', async () => {
    const repair = offerAlarmFixForBlockedStart([STATUS_ALARM_START_MESSAGE]);
    const question = await openQuestion();
    question.resolve({ confirmed: true, dontAskAgain: false });

    await expect(repair).resolves.toBe('handled');
    expect(vi.mocked(useLaserStore.getState().unlockAlarm)).toHaveBeenCalledTimes(1);
  });

  it('Home now sends nothing when a different alarm stands by the answer', async () => {
    const project = createProject();
    useStore.setState({
      project: {
        ...project,
        device: { ...project.device, homing: { ...project.device.homing, enabled: true } },
      },
    });
    const repair = offerAlarmFixForBlockedStart([STATUS_ALARM_START_MESSAGE]);
    const question = await openQuestion();
    expect(question.options.confirmLabel).toBe(HOME_OFFER_BUTTON);
    useLaserStore.setState({ alarmCode: 1 });
    question.resolve({ confirmed: true, dontAskAgain: false });

    await expect(repair).resolves.toBe('unrepaired');
    expect(vi.mocked(useLaserStore.getState().home)).not.toHaveBeenCalled();
  });
});

describe('the offers’ wording', () => {
  const prompts = {
    unlock: UNLOCK_OFFER_PROMPT,
    probeUnlock: PROBE_UNLOCK_OFFER_PROMPT,
    home: HOME_OFFER_PROMPT,
    homeAtHead: HOME_OFFER_CURRENT_POSITION_PROMPT,
    setOrigin: SET_ORIGIN_OFFER_PROMPT,
    zeroZ: ZERO_Z_OFFER_PROMPT,
    restore: unrestoredOriginOfferPrompt('User Origin', { x: 60, y: 40 }, { x: 1, y: 2 }, false),
    homeAndRestore: unrestoredOriginOfferPrompt('User Origin', { x: 60, y: 40 }, null, true),
  };

  it.each(Object.entries(prompts))('%s no longer explains OK and Cancel', (_name, prompt) => {
    expect(prompt).not.toMatch(/\bOK\b/);
    expect(prompt).not.toMatch(/^Cancel:/m);
  });

  it('names each action on its button', () => {
    expect([
      UNLOCK_OFFER_BUTTON,
      HOME_OFFER_BUTTON,
      SET_ORIGIN_OFFER_BUTTON,
      ZERO_Z_OFFER_BUTTON,
      restoreOriginOfferButton(false),
      restoreOriginOfferButton(true),
    ]).toEqual([
      'Unlock',
      'Home now',
      'Set origin here',
      'Zero Z here',
      'Restore origin',
      'Home and restore origin',
    ]);
  });

  // Other branches call this with the turn alone; that shape still works and
  // names the button this machine's offer shows.
  it('names the restore button in the rotary note, with or without being told it', () => {
    const turn = { axis: 'A', machine: 0 } as const;

    expect(abortTurnOfferNote(undefined)).toBe('');
    expect(abortTurnOfferNote(turn)).toContain(
      '"Restore origin" also turns it back to where the job started.',
    );
    expect(abortTurnOfferNote(turn, 'Home and restore origin')).toContain(
      '"Home and restore origin" also turns it back to where the job started.',
    );
    expect(abortTurnOfferNote(turn)).not.toMatch(/\bOK\b/);
  });

  // ADR-367: the offers are deliberate. Their safety sentences are unchanged.
  it('keeps the safety wording of each offer', () => {
    expect(prompts.unlock).toContain(
      'Unlock clears the alarm WITHOUT re-establishing position — only continue if the head ' +
        'is safe where it is.',
    );
    expect(prompts.probeUnlock).toContain(
      'Only continue if the head is safe where it is and the touch plate is out of the way.',
    );
    expect(prompts.home).toContain('Make sure the machine is clear before it moves.');
    expect(prompts.homeAtHead).toContain(
      'This job starts where the head is, and homing moves the head, so framing stops after ' +
        'the cycle',
    );
    expect(prompts.setOrigin).toContain('Then Frame the updated placement before starting.');
    expect(prompts.zeroZ).toContain('If the bit is touching the stock-top Z reference now');
    expect(prompts.restore).toContain('with one G92 (the head does not move)');
    expect(prompts.homeAndRestore).toContain('(the head moves to its home switches)');
  });
});
