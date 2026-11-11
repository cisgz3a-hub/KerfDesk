// Close and Update with a Moshi or Ruida link job (ADR-705 Amendment 3, code
// quality audit C2 D1-P2-3): Update waits and sends nothing; close sends the
// link's own stop and closes only once the link reports idle.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { rendererCloseRequestScript } from '../../../electron/renderer-close-request';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import {
  reportLinkMachineWork,
  resetLinkMachineWorkForTests,
  type LinkMachineWork,
} from '../state/link-machine-work';
import { useToastStore } from '../state/toast-store';
import { desktopCloseController } from './desktop-close-runtime';
import { installUnloadStop } from './use-unload-stop';

const initialLaser = useLaserStore.getState();
const initialScene = useStore.getState();
let dispose = (): void => undefined;

function request(operation: 'prepare' | 'prepare-update', id = 1): Promise<unknown> {
  const result: unknown = window.eval(rendererCloseRequestScript(operation, id));
  return Promise.resolve(result);
}

function moshiJob(abort: () => Promise<void>): LinkMachineWork {
  return { controller: 'Moshiboard', activity: 'running', advisories: [], abort };
}

afterEach(() => {
  dispose();
  desktopCloseController.keepOpen();
  resetLinkMachineWorkForTests();
  useLaserStore.setState(initialLaser);
  useStore.setState(initialScene);
  useToastStore.setState({ toasts: [] });
});

describe('desktop close with a link job', () => {
  it('keeps the app open for Update and sends no stop', async () => {
    const abort = vi.fn(async () => undefined);
    useLaserStore.setState({ streamer: null, fireActive: false });
    dispose = installUnloadStop(window);
    reportLinkMachineWork('moshi-usb', moshiJob(abort));
    expect(await request('prepare-update')).toEqual({ status: 'cancelled' });
    expect(abort).not.toHaveBeenCalled();
  });

  it('sends the link stop before closing, then closes once the link is idle', async () => {
    const stopJob = vi.fn(async () => undefined);
    useLaserStore.setState({ streamer: null, fireActive: false, stopJob });
    useStore.setState({ dirty: false });
    dispose = installUnloadStop(window);
    const abort = vi.fn(async () => {
      reportLinkMachineWork('moshi-usb', null);
    });
    reportLinkMachineWork('moshi-usb', moshiJob(abort));
    expect(await request('prepare')).toMatchObject({ status: 'ready' });
    expect(abort).toHaveBeenCalledTimes(1);
    // The laser store had no job: its Abort is not sent.
    expect(stopJob).not.toHaveBeenCalled();
  });
});
