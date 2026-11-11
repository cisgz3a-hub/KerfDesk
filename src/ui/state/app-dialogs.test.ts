import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStreamer, step } from '../../core/controllers/grbl';
import { useAppDialogStore } from './app-dialog-store';
import { answerAppDialogs, clearAppDialogs } from './app-dialog-test-helpers';
import { appAlert, appConfirm, appPrompt } from './app-dialogs';
import { dontAskAgainIsSet, forgetDontAskAgain, rememberDontAskAgain } from './dont-ask-again';
import type { LaserState } from './laser-store';
import { useLaserStore } from './laser-store';
import { useToastStore } from './toast-store';

function patchStreamer(streamer: LaserState['streamer']): void {
  useLaserStore.setState({ streamer } as Partial<ReturnType<typeof useLaserStore.getState>>);
}

function streamingState(): LaserState['streamer'] {
  return step(createStreamer('G1 X1 S100')).state;
}

function toastMessages(): string[] {
  return useToastStore.getState().toasts.map((toast) => toast.message);
}

const question = { title: 'Delete preset?', message: 'Delete "Birch"?', confirmLabel: 'Delete' };

afterEach(() => {
  patchStreamer(null);
  clearAppDialogs();
  forgetDontAskAgain();
  for (const toast of useToastStore.getState().toasts) {
    useToastStore.getState().dismissToast(toast.id);
  }
  vi.restoreAllMocks();
});

describe('in-app dialogs (ADR-707)', () => {
  it('never opens a native box', async () => {
    const native = [
      vi.spyOn(window, 'confirm').mockReturnValue(true),
      vi.spyOn(window, 'alert').mockImplementation(() => undefined),
      vi.spyOn(window, 'prompt').mockReturnValue('typed'),
    ];
    const responder = answerAppDialogs((request) => (request.kind === 'prompt' ? 'Oak' : true));

    await expect(appConfirm(question)).resolves.toBe(true);
    await expect(appAlert({ title: 'Imported', message: 'Three presets.' })).resolves.toBe(
      undefined,
    );
    await expect(
      appPrompt({ title: 'Save preset', message: '', label: 'Preset name', confirmLabel: 'Save' }),
    ).resolves.toBe('Oak');

    responder.stop();
    for (const spy of native) expect(spy).not.toHaveBeenCalled();
    expect(responder.asked.map((request) => request.kind)).toEqual(['confirm', 'alert', 'prompt']);
  });

  it('stays pending until it is answered, and resolves false on Cancel', async () => {
    let settled: boolean | 'pending' = 'pending';
    const asked = appConfirm(question).then((answer) => {
      settled = answer;
    });
    await Promise.resolve();
    expect(settled).toBe('pending');

    const request = useAppDialogStore.getState().queue[0];
    if (request?.kind !== 'confirm') throw new Error('confirm request missing');
    request.resolve({ confirmed: false, dontAskAgain: false });
    await asked;

    expect(settled).toBe(false);
    expect(useAppDialogStore.getState().queue).toEqual([]);
  });

  it('queues a second question behind the first instead of replacing it', async () => {
    const first = appConfirm(question);
    const second = appConfirm({ ...question, title: 'Delete library?' });

    expect(useAppDialogStore.getState().queue.map((request) => request.options.title)).toEqual([
      'Delete preset?',
      'Delete library?',
    ]);
    const responder = answerAppDialogs((request) => request.options.title === 'Delete library?');
    await expect(first).resolves.toBe(false);
    await expect(second).resolves.toBe(true);
    responder.stop();
  });
});

describe('in-app dialogs while a job is running', () => {
  it('asks an ordinary question during a job: nothing freezes, so nothing is refused', async () => {
    patchStreamer(streamingState());
    const responder = answerAppDialogs(() => true);

    await expect(appConfirm(question)).resolves.toBe(true);

    responder.stop();
    expect(responder.asked).toHaveLength(1);
    expect(toastMessages()).toEqual([]);
  });

  it('fails closed, with the caller’s own words, when its yes must wait for the job', async () => {
    patchStreamer(streamingState());
    const responder = answerAppDialogs(() => true);

    await expect(
      appConfirm({ ...question, refuseDuringJob: 'Stop the job before opening another project.' }),
    ).resolves.toBe(false);
    await expect(
      appPrompt({
        title: 'Rename',
        message: '',
        label: 'Name',
        confirmLabel: 'Rename',
        refuseDuringJob: 'Stop the job before renaming the project.',
      }),
    ).resolves.toBeNull();

    responder.stop();
    expect(responder.asked).toEqual([]);
    expect(toastMessages()).toEqual([
      'Stop the job before opening another project.',
      'Stop the job before renaming the project.',
    ]);
  });

  it('refuses a yes given after a job began while the question was open', async () => {
    const asked = appConfirm({ ...question, refuseDuringJob: 'Stop the job first.' });
    patchStreamer(streamingState());
    const responder = answerAppDialogs(() => true);

    await expect(asked).resolves.toBe(false);
    responder.stop();
    expect(toastMessages()).toEqual(['Stop the job first.']);
  });

  it('does not refuse a no', async () => {
    const asked = appConfirm({ ...question, refuseDuringJob: 'Stop the job first.' });
    patchStreamer(streamingState());
    const responder = answerAppDialogs(() => false);

    await expect(asked).resolves.toBe(false);
    responder.stop();
    expect(toastMessages()).toEqual([]);
  });
});

describe('"Don’t ask again"', () => {
  const remembered = { ...question, dontAskAgainKey: 'test.delete-preset' };

  it('remembers a ticked yes and answers the next ask without a dialog', async () => {
    const first = appConfirm(remembered);
    const request = useAppDialogStore.getState().queue[0];
    if (request?.kind !== 'confirm') throw new Error('confirm request missing');
    request.resolve({ confirmed: true, dontAskAgain: true });
    await expect(first).resolves.toBe(true);

    expect(dontAskAgainIsSet('test.delete-preset')).toBe(true);
    await expect(appConfirm(remembered)).resolves.toBe(true);
    expect(useAppDialogStore.getState().queue).toEqual([]);
  });

  it('never remembers a no, a yes without the tick, or a caller that did not opt in', async () => {
    for (const [options, answer] of [
      [remembered, { confirmed: false, dontAskAgain: true }],
      [remembered, { confirmed: true, dontAskAgain: false }],
      [question, { confirmed: true, dontAskAgain: true }],
    ] as const) {
      const asked = appConfirm(options);
      const request = useAppDialogStore.getState().queue[0];
      if (request?.kind !== 'confirm') throw new Error('confirm request missing');
      request.resolve(answer);
      await asked;
    }
    expect(dontAskAgainIsSet('test.delete-preset')).toBe(false);
  });

  it('still refuses during a job when the caller says so', async () => {
    rememberDontAskAgain('test.delete-preset');
    patchStreamer(streamingState());

    await expect(
      appConfirm({ ...remembered, refuseDuringJob: 'Stop the job first.' }),
    ).resolves.toBe(false);
  });

  it('asks again when storage cannot be read or written', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage full');
    });
    const responder = answerAppDialogs(() => true);

    expect(dontAskAgainIsSet('test.delete-preset')).toBe(false);
    expect(() => rememberDontAskAgain('test.delete-preset')).not.toThrow();
    await expect(appConfirm(remembered)).resolves.toBe(true);

    responder.stop();
    expect(responder.asked).toHaveLength(1);
  });
});
