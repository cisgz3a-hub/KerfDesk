import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { createDesktopJobActivity } from './session-end-guard.js';
import { installTaskbarJobProgress } from './taskbar-job-progress.js';

function taskbarWindow(focused = false) {
  const events = new EventEmitter();
  const window = {
    setProgressBar: vi.fn(),
    flashFrame: vi.fn(),
    isFocused: vi.fn(() => focused),
    isDestroyed: vi.fn(() => false),
    once: (event: 'focus' | 'closed', listener: () => void) => events.once(event, listener),
  };
  return { window, events };
}

describe('the job on the taskbar button (ADR-553)', () => {
  it('fills with the job, shows held and failed jobs, and clears when it ends', () => {
    const activity = createDesktopJobActivity();
    const { window } = taskbarWindow(true);
    installTaskbarJobProgress(window, activity);

    activity.set({ busy: true, job: { progress: 0.1, state: 'running' } });
    activity.set({ busy: true, job: { progress: 0.4, state: 'paused' } });
    activity.set({ busy: true, job: { progress: 0.4, state: 'error' } });
    activity.set({ busy: false });
    activity.set({ busy: false });

    expect(window.setProgressBar.mock.calls).toEqual([
      [0.1, { mode: 'normal' }],
      [0.4, { mode: 'paused' }],
      [0.4, { mode: 'error' }],
      [-1],
    ]);
    expect(window.flashFrame).not.toHaveBeenCalled();
  });

  it('flashes when a job ends in the background, until KerfDesk is in front again', () => {
    const activity = createDesktopJobActivity();
    const { window, events } = taskbarWindow(false);
    installTaskbarJobProgress(window, activity);

    activity.set({ busy: true, job: { progress: 0.9, state: 'running' } });
    activity.set({ busy: false });
    expect(window.flashFrame).toHaveBeenLastCalledWith(true);

    events.emit('focus');
    expect(window.flashFrame).toHaveBeenLastCalledWith(false);
  });

  it('shows nothing for a latched Fire, which has no job', () => {
    const activity = createDesktopJobActivity();
    const { window } = taskbarWindow(false);
    installTaskbarJobProgress(window, activity);

    activity.set({ busy: true });
    activity.set({ busy: false });

    expect(window.setProgressBar).not.toHaveBeenCalled();
    expect(window.flashFrame).not.toHaveBeenCalled();
  });

  it('stops listening when its window closes', () => {
    const activity = createDesktopJobActivity();
    const { window, events } = taskbarWindow(true);
    installTaskbarJobProgress(window, activity);

    events.emit('closed');
    activity.set({ busy: true, job: { progress: 0.5, state: 'running' } });

    expect(window.setProgressBar).not.toHaveBeenCalled();
  });
});
