import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStreamer, pause, step } from '../../core/controllers/grbl';
import { useStore } from '../state';
import { initialLaserState } from '../state/laser-store-helpers';
import { useLaserStore } from '../state/laser-store';
import { resetStore } from '../state/test-helpers';
import { ConnectionBar } from './ConnectionBar';
import { JobSetupControls } from './JobSetupControls';
import { LiveMotionBar } from './LiveMotionBar';
import { OriginRow } from './OriginRow';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const original = useLaserStore.getState();
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  resetStore();
  useLaserStore.setState(initialLaserState());
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  useLaserStore.setState(original, true);
  resetStore();
  vi.restoreAllMocks();
});
function button(text: string): HTMLButtonElement {
  const node = [...host.querySelectorAll('button')].find(
    (item) => item.textContent?.trim() === text,
  );
  if (!node) throw new Error(`Missing button: ${text}`);
  return node;
}

describe('Machine run control audit', () => {
  it('Connect dispatches only when disconnected and remains inert while connecting', () => {
    const props = {
      machineNoun: 'laser',
      onConnect: vi.fn(),
      onDisconnect: vi.fn(),
      onForget: vi.fn(),
      disabled: false,
    };
    act(() => root.render(<ConnectionBar {...props} connection={{ kind: 'disconnected' }} />));
    act(() => button('Connect…').click());
    expect(props.onConnect).toHaveBeenCalledTimes(1);
    act(() => root.render(<ConnectionBar {...props} connection={{ kind: 'connecting' }} />));
    expect(button('Connecting…').disabled).toBe(true);
    act(() => button('Connecting…').click());
    expect(props.onConnect).toHaveBeenCalledTimes(1);
  });

  it('Home and configured Auto-focus invoke their store actions and remain inert while busy', async () => {
    const home = vi.fn(async () => undefined);
    const autofocus = vi.fn(async () => ({ kind: 'ok' as const }));
    useLaserStore.setState({ home, autofocus });
    useStore.getState().updateDeviceProfile({
      homing: { enabled: true, direction: 'front-left' },
      autofocusCommand: '$HZ1',
    });
    const props = {
      disabled: false,
      streaming: false,
      onConfigureHoming: vi.fn(),
      onConfigureAutofocus: vi.fn(),
    };
    act(() => root.render(<JobSetupControls {...props} />));
    await act(async () => {
      button('Home').click();
      button('Auto-focus').click();
    });
    expect(home).toHaveBeenCalledTimes(1);
    expect(autofocus).toHaveBeenCalledTimes(1);
    expect(props.onConfigureAutofocus).not.toHaveBeenCalled();
    act(() => root.render(<JobSetupControls {...props} streaming={true} />));
    await act(async () => {
      button('Home').click();
      button('Auto-focus').click();
    });
    expect(home).toHaveBeenCalledTimes(1);
    expect(autofocus).toHaveBeenCalledTimes(1);
  });

  it('Pause, Resume and Abort dispatch the matching action in their corresponding lifecycle states', async () => {
    const pauseJob = vi.fn(async () => undefined);
    const resumeJob = vi.fn(async () => undefined);
    const stopJob = vi.fn(async () => undefined);
    const streamer = step(createStreamer('G1 X1 S100\nG1 X2 S100\nG1 X3 S100')).state;
    useLaserStore.setState({ streamer, pauseJob, resumeJob, stopJob });
    act(() => root.render(<LiveMotionBar />));
    await act(async () => button('Pause').click());
    expect(pauseJob).toHaveBeenCalledTimes(1);
    expect(resumeJob).not.toHaveBeenCalled();
    act(() => useLaserStore.setState({ streamer: pause(streamer) }));
    await act(async () => button('Resume').click());
    expect(resumeJob).toHaveBeenCalledTimes(1);
    await act(async () => button('ABORT JOB').click());
    expect(stopJob).toHaveBeenCalledTimes(1);
  });

  it('Reset origin and Clear persistent origin call separate store actions with persistent confirmation', async () => {
    const resetOrigin = vi.fn(async () => undefined);
    const clearPersistentOrigin = vi.fn(async () => undefined);
    useLaserStore.setState({
      resetOrigin,
      clearPersistentOrigin,
      workOriginActive: true,
      workOriginSource: 'g92',
      wcoCache: { x: 20, y: 20, z: 0 },
      statusReport: {
        state: 'Idle',
        subState: null,
        mPos: { x: 20, y: 20, z: 0 },
        wPos: null,
        wco: null,
        feed: 0,
        spindle: 0,
      },
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    act(() => root.render(<OriginRow disabled={false} streaming={false} />));
    await act(async () => button('Reset origin').click());
    expect(resetOrigin).toHaveBeenCalledTimes(1);
    const details = host.querySelector('details')!;
    expect(details.open).toBe(false);
    act(() => details.querySelector('summary')!.click());
    expect(details.open).toBe(true);
    await act(async () => button('Clear persistent origin').click());
    expect(clearPersistentOrigin).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('G54'));
    confirm.mockReturnValue(true);
    await act(async () => button('Clear persistent origin').click());
    expect(clearPersistentOrigin).toHaveBeenCalledTimes(1);
  });

  it('Release motors requires confirmation and does not release while streaming', async () => {
    const releaseMotors = vi.fn(async () => undefined);
    useLaserStore.setState({
      releaseMotors,
      workOriginActive: true,
      workOriginSource: 'g92',
      wcoCache: { x: 20, y: 20, z: 0 },
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    act(() => root.render(<OriginRow disabled={false} streaming={false} />));
    await act(async () => button('Release motors').click());
    expect(releaseMotors).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    await act(async () => button('Release motors').click());
    expect(releaseMotors).toHaveBeenCalledTimes(1);
    act(() => root.render(<OriginRow disabled={false} streaming={true} />));
    await act(async () => button('Release motors').click());
    expect(releaseMotors).toHaveBeenCalledTimes(1);
  });
});
