// A held key never presses what a focused button turned into (rolling audit
// v10 V8-P2-1, ADR-207 Amendment 3).
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiveMotionActionButton } from '../laser/LiveMotionActionButton';
import { freshActivationKeyDown, freshActivationKeyUp } from './use-fresh-key-activation';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('fresh key activation rules', () => {
  const enter = { key: 'Enter', repeat: false };
  const space = { key: ' ', repeat: false };

  it('lets a fresh Enter through and remembers it', () => {
    expect(freshActivationKeyDown(null, enter, 'Pause|on')).toEqual({
      held: { key: 'Enter', meaning: 'Pause|on' },
      cancel: false,
    });
  });

  it('cancels an auto-repeat even when no press was seen here', () => {
    // Start job's press moved focus to Pause; only its repeats arrive.
    expect(freshActivationKeyDown(null, { key: 'Enter', repeat: true }, 'Pause|on').cancel).toBe(
      true,
    );
  });

  it('cancels a second press until the first key is released', () => {
    const held = { key: 'Enter', meaning: 'Pause|on' };
    expect(freshActivationKeyDown(held, enter, 'Resume|on').cancel).toBe(true);
    expect(freshActivationKeyDown(held, space, 'Resume|on').cancel).toBe(true);
    const released = freshActivationKeyUp(held, enter, 'Resume|on');
    expect(released.held).toBeNull();
    expect(freshActivationKeyDown(released.held, enter, 'Resume|on').cancel).toBe(false);
  });

  it('cancels a Space released after the button changed meaning', () => {
    const held = { key: ' ', meaning: 'Pause|on' };
    expect(freshActivationKeyUp(held, space, 'Pause|on')).toEqual({ held: null, cancel: false });
    expect(freshActivationKeyUp(held, space, 'Resume|on')).toEqual({ held: null, cancel: true });
    // Tool-change Continue turning on under a held Space is a new meaning too.
    const off = { key: ' ', meaning: 'Continue|off' };
    expect(freshActivationKeyUp(off, space, 'Continue|on').cancel).toBe(true);
  });

  it('cancels a Space release it never saw pressed', () => {
    expect(freshActivationKeyUp(null, space, 'Pause|on').cancel).toBe(true);
    expect(freshActivationKeyUp(null, enter, 'Pause|on').cancel).toBe(false);
  });

  it('ignores other keys', () => {
    const held = { key: 'Enter', meaning: 'Pause|on' };
    expect(freshActivationKeyDown(held, { key: 'Tab', repeat: false }, 'Pause|on')).toEqual({
      held,
      cancel: false,
    });
    expect(freshActivationKeyUp(held, { key: 'Escape', repeat: true }, 'Pause|on')).toEqual({
      held,
      cancel: false,
    });
  });
});

type Props = Parameters<typeof LiveMotionActionButton>[0];

function renderButton(props: Props): HTMLButtonElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root?.render(<LiveMotionActionButton {...props} />));
  return host.querySelector('button') as HTMLButtonElement;
}

function rerender(props: Props): void {
  act(() => root?.render(<LiveMotionActionButton {...props} />));
}

// jsdom never turns keys into clicks; this follows Chromium: Enter clicks on
// an uncancelled keydown (through keypress), Space on an uncancelled keyup.
function keyDown(button: HTMLButtonElement, key: string, repeat = false): void {
  const event = new KeyboardEvent('keydown', { key, repeat, bubbles: true, cancelable: true });
  act(() => {
    if (button.dispatchEvent(event) && key === 'Enter') button.click();
  });
}

function keyUp(button: HTMLButtonElement, key: string): void {
  const event = new KeyboardEvent('keyup', { key, bubbles: true, cancelable: true });
  act(() => {
    if (button.dispatchEvent(event) && key === ' ') button.click();
  });
}

describe('LiveMotionActionButton under a held key (V8-P2-1)', () => {
  it('pauses once on a held Enter and never resumes', () => {
    const pauseJob = vi.fn(async () => undefined);
    const resumeJob = vi.fn(async () => undefined);
    const button = renderButton({ label: 'Pause', title: 'Pause', onClick: pauseJob });
    button.focus();
    keyDown(button, 'Enter');
    expect(pauseJob).toHaveBeenCalledTimes(1);
    rerender({ label: 'Pausing…', title: 'Waiting', disabled: true, onClick: pauseJob });
    keyDown(button, 'Enter', true);
    rerender({ label: 'Resume', title: 'Resume', onClick: resumeJob });
    expect(document.activeElement).toBe(button);
    for (let index = 0; index < 20; index += 1) keyDown(button, 'Enter', true);
    expect(resumeJob).not.toHaveBeenCalled();
    keyUp(button, 'Enter');
    // A fresh press after the release is a deliberate Resume.
    keyDown(button, 'Enter');
    expect(resumeJob).toHaveBeenCalledTimes(1);
    expect(pauseJob).toHaveBeenCalledTimes(1);
  });

  it('refuses a held Enter that arrives with focus from Start job', () => {
    const pauseJob = vi.fn(async () => undefined);
    const button = renderButton({ label: 'Pause', title: 'Pause', onClick: pauseJob });
    button.focus();
    for (let index = 0; index < 10; index += 1) keyDown(button, 'Enter', true);
    expect(pauseJob).not.toHaveBeenCalled();
  });

  it('refuses a Space pressed on Pause and released on Resume', () => {
    const pauseJob = vi.fn(async () => undefined);
    const resumeJob = vi.fn(async () => undefined);
    const button = renderButton({ label: 'Pause', title: 'Pause', onClick: pauseJob });
    button.focus();
    keyDown(button, ' ');
    rerender({ label: 'Resume', title: 'Resume', onClick: resumeJob });
    keyUp(button, ' ');
    expect(pauseJob).not.toHaveBeenCalled();
    expect(resumeJob).not.toHaveBeenCalled();
    keyDown(button, ' ');
    keyUp(button, ' ');
    expect(resumeJob).toHaveBeenCalledTimes(1);
  });

  it('forgets a held key when focus leaves, and leaves mouse clicks alone', () => {
    const resumeJob = vi.fn(async () => undefined);
    const button = renderButton({ label: 'Resume', title: 'Resume', onClick: resumeJob });
    button.focus();
    keyDown(button, 'Enter');
    act(() => button.blur());
    button.focus();
    keyDown(button, 'Enter');
    expect(resumeJob).toHaveBeenCalledTimes(2);
    act(() => button.click());
    expect(resumeJob).toHaveBeenCalledTimes(3);
  });
});
