import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dismissStartupSplash, SPLASH_HELD_VERSION_KEY, splashHoldVersion } from './startup-splash';

let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;
let visibility: DocumentVisibilityState;
let reducedMotion: boolean;

function frame(elapsed = 16): void {
  vi.advanceTimersByTime(elapsed);
  const callbacks = [...frames.values()];
  frames.clear();
  for (const callback of callbacks) callback(performance.now());
}

function setVisibility(state: DocumentVisibilityState): void {
  visibility = state;
  document.dispatchEvent(new Event('visibilitychange'));
}

function splash(): HTMLElement | null {
  return document.getElementById('app-splash');
}

function paintWorkspace(): void {
  const canvas = document.createElement('canvas');
  canvas.dataset.workspacePainted = 'true';
  document.getElementById('app-root')?.append(canvas);
}

function crashWorkspace(): void {
  const alert = document.createElement('section');
  alert.setAttribute('role', 'alert');
  document.getElementById('app-root')?.replaceChildren(alert);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  frames = new Map();
  nextFrame = 0;
  visibility = 'visible';
  reducedMotion = false;
  // Every case starts as the first launch of this version on the device.
  localStorage.clear();
  delete document.documentElement.dataset.desktopWindowVisible;
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal('matchMedia', () => ({ matches: reducedMotion }));
  document.body.innerHTML = '<div id="app-root"></div><div id="app-splash">Loading</div>';
});

afterEach(() => {
  // End any still-waiting lifecycle before restoring document and clock spies.
  crashWorkspace();
  frame();
  frame();
  vi.runOnlyPendingTimers();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('startup splash', () => {
  it('holds for four visible seconds from its first frame, then fades slowly', () => {
    vi.advanceTimersByTime(20_000);
    paintWorkspace();
    dismissStartupSplash();
    vi.advanceTimersByTime(1000);
    frame();
    frame(3999);
    expect(splash()?.classList.contains('app-splash--hidden')).toBe(false);
    frame(1);
    expect(splash()?.classList.contains('app-splash--hidden')).toBe(false);
    frame();
    expect(splash()?.classList.contains('app-splash--hidden')).toBe(true);
    expect(splash()?.style.transitionDuration).toBe('750ms');
    vi.advanceTimersByTime(799);
    expect(splash()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(splash()).toBeNull();
    expect(localStorage.getItem(SPLASH_HELD_VERSION_KEY)).toBe(
      splashHoldVersion(__APP_VERSION__, false),
    );
  });

  it('excludes hidden intervals from the hold and removes its visibility listener', () => {
    const removeListener = vi.spyOn(document, 'removeEventListener');
    paintWorkspace();
    dismissStartupSplash();
    frame();
    vi.advanceTimersByTime(1500);
    setVisibility('hidden');
    frame(20_000);
    setVisibility('visible');
    frame(2499);
    expect(splash()?.classList.contains('app-splash--hidden')).toBe(false);
    frame(1);
    expect(removeListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    frame();
    expect(splash()?.classList.contains('app-splash--hidden')).toBe(true);
  });

  it('waits for the first visible frame when installed into a hidden document', () => {
    setVisibility('hidden');
    paintWorkspace();
    dismissStartupSplash();
    frame(20_000);
    setVisibility('visible');
    frame(3999);
    expect(splash()?.classList.contains('app-splash--hidden')).toBe(false);
    frame(1);
    frame();
    expect(splash()?.classList.contains('app-splash--hidden')).toBe(true);
  });

  it('reveals a startup error immediately without the hold', () => {
    crashWorkspace();
    dismissStartupSplash();
    frame();
    frame();
    expect(performance.now()).toBeLessThan(4000);
    expect(splash()?.classList.contains('app-splash--hidden')).toBe(true);
  });

  it('retains the hold but removes the fade for reduced motion', () => {
    reducedMotion = true;
    paintWorkspace();
    dismissStartupSplash();
    frame();
    frame(3999);
    expect(splash()).not.toBeNull();
    frame(1);
    frame();
    expect(splash()).toBeNull();
    expect(document.getElementById('app-root')?.hasAttribute('inert')).toBe(false);
  });

  it('keeps the mounted workspace inert until the splash is removed', () => {
    const shortcut = vi.fn();
    window.addEventListener('keydown', shortcut);
    paintWorkspace();
    dismissStartupSplash();
    expect(document.getElementById('app-root')?.hasAttribute('inert')).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', cancelable: true }));
    expect(shortcut).not.toHaveBeenCalled();
    frame();
    frame(4000);
    frame();
    expect(document.getElementById('app-root')?.hasAttribute('inert')).toBe(true);
    vi.advanceTimersByTime(800);
    expect(document.getElementById('app-root')?.hasAttribute('inert')).toBe(false);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', cancelable: true }));
    expect(shortcut).toHaveBeenCalledOnce();
    window.removeEventListener('keydown', shortcut);
  });

  it('uses native desktop visibility while document visibility remains visible', () => {
    const nativeVisible = (visible: boolean): void => {
      document.documentElement.dataset.desktopWindowVisible = String(visible);
      window.dispatchEvent(new Event('kerfdesk:window-visibility'));
    };
    nativeVisible(false);
    paintWorkspace();
    dismissStartupSplash({ desktop: true });
    frame(3000);
    nativeVisible(true);
    frame(1500);
    nativeVisible(false);
    frame(20_000);
    nativeVisible(true);
    frame(2499);
    expect(splash()?.classList.contains('app-splash--hidden')).toBe(false);
    frame(1);
    frame();
    expect(splash()?.classList.contains('app-splash--hidden')).toBe(true);
  });

  it('uses document visibility when main never publishes desktop visibility', () => {
    paintWorkspace();
    dismissStartupSplash({ desktop: true });
    frame();
    frame(3999);
    expect(splash()?.classList.contains('app-splash--hidden')).toBe(false);
    frame(1);
    frame();
    expect(splash()?.classList.contains('app-splash--hidden')).toBe(true);
  });

  it('stops waiting for a desktop window that is never reported shown', () => {
    document.documentElement.dataset.desktopWindowVisible = 'false';
    paintWorkspace();
    dismissStartupSplash({ desktop: true });
    frame();
    frame(4983);
    // From the five-second mark the document's own visibility counts.
    frame(1);
    frame(3999);
    expect(splash()?.classList.contains('app-splash--hidden')).toBe(false);
    frame(1);
    frame();
    expect(splash()?.classList.contains('app-splash--hidden')).toBe(true);
    expect(document.getElementById('app-root')?.hasAttribute('inert')).toBe(true);
    vi.advanceTimersByTime(800);
    expect(document.getElementById('app-root')?.hasAttribute('inert')).toBe(false);
  });

  it('waits for a successful workspace paint after the minimum hold has elapsed', () => {
    const canvas = document.createElement('canvas');
    document.getElementById('app-root')?.append(canvas);
    dismissStartupSplash();
    frame();
    frame(4000);
    expect(splash()?.classList.contains('app-splash--hidden')).toBe(false);
    canvas.dataset.workspacePainted = 'true';
    frame();
    frame();
    expect(performance.now()).toBeLessThan(5000);
    expect(splash()?.classList.contains('app-splash--hidden')).toBe(true);
  });

  it('treats a settled licence window like a painted workspace (ADR-623)', () => {
    const gate = document.createElement('section');
    gate.dataset.licenceState = 'checking';
    document.getElementById('app-root')?.append(gate);
    dismissStartupSplash({ desktop: true });
    frame();
    frame(4000);
    // Still checking the licence: keep the hold.
    expect(splash()?.classList.contains('app-splash--hidden')).toBe(false);
    gate.dataset.licenceState = 'activation-required';
    frame();
    frame();
    expect(performance.now()).toBeLessThan(5000);
    expect(splash()?.classList.contains('app-splash--hidden')).toBe(true);
  });

  it('uses the five-second missing-workspace fallback', () => {
    dismissStartupSplash();
    frame();
    frame(4983);
    expect(splash()?.classList.contains('app-splash--hidden')).toBe(false);
    frame(1);
    frame();
    expect(splash()?.classList.contains('app-splash--hidden')).toBe(true);
  });

  it('starts the workspace fallback at installation rather than the first frame', () => {
    dismissStartupSplash();
    frame(1000);
    frame(4000);
    frame();
    expect(splash()?.classList.contains('app-splash--hidden')).toBe(true);
  });

  it('does not leave a visibility listener behind when another startup path removes the splash', () => {
    const removeListener = vi.spyOn(document, 'removeEventListener');
    dismissStartupSplash();
    splash()?.remove();
    frame();
    expect(removeListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    expect(frames.size).toBe(0);
  });

  it('does no work when the splash is absent', () => {
    splash()?.remove();
    const addListener = vi.spyOn(document, 'addEventListener');
    dismissStartupSplash();
    expect(addListener).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });
});

describe('startup splash after this version has been shown (ADR-049 Amendment 3)', () => {
  const fading = (): boolean => splash()?.classList.contains('app-splash--hidden') === true;
  const inert = (): boolean => document.getElementById('app-root')?.hasAttribute('inert') === true;

  it('releases a later launch as soon as the workspace has painted', () => {
    localStorage.setItem(SPLASH_HELD_VERSION_KEY, splashHoldVersion(__APP_VERSION__, false));
    const shortcut = vi.fn();
    window.addEventListener('keydown', shortcut);
    paintWorkspace();
    dismissStartupSplash();
    expect(inert()).toBe(true);
    frame();
    frame();
    expect(performance.now()).toBeLessThan(100);
    expect(fading()).toBe(true);
    expect(splash()?.style.transitionDuration).toBe('750ms');
    // Input comes back with the splash's removal, not before it.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', cancelable: true }));
    expect(shortcut).not.toHaveBeenCalled();
    expect(inert()).toBe(true);
    vi.advanceTimersByTime(800);
    expect(splash()).toBeNull();
    expect(inert()).toBe(false);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', cancelable: true }));
    expect(shortcut).toHaveBeenCalledOnce();
    window.removeEventListener('keydown', shortcut);
  });

  it('still waits for the workspace to paint on a later launch', () => {
    localStorage.setItem(SPLASH_HELD_VERSION_KEY, splashHoldVersion(__APP_VERSION__, false));
    const canvas = document.createElement('canvas');
    document.getElementById('app-root')?.append(canvas);
    dismissStartupSplash();
    frame();
    frame(2000);
    expect(fading()).toBe(false);
    canvas.dataset.workspacePainted = 'true';
    frame();
    frame();
    expect(fading()).toBe(true);
  });

  it('releases a later desktop launch on paint, shown or not, and at the licence window', () => {
    localStorage.setItem(SPLASH_HELD_VERSION_KEY, splashHoldVersion(__APP_VERSION__, true));
    document.documentElement.dataset.desktopWindowVisible = 'false';
    const gate = document.createElement('section');
    gate.dataset.licenceState = 'checking';
    document.getElementById('app-root')?.append(gate);
    dismissStartupSplash({ desktop: true });
    frame();
    frame(500);
    expect(fading()).toBe(false);
    gate.dataset.licenceState = 'activation-required';
    frame();
    frame();
    expect(performance.now()).toBeLessThan(1000);
    expect(fading()).toBe(true);
  });

  it('keeps the five-second missing-workspace fallback on a later launch', () => {
    localStorage.setItem(SPLASH_HELD_VERSION_KEY, splashHoldVersion(__APP_VERSION__, false));
    dismissStartupSplash();
    frame();
    frame(4983);
    expect(fading()).toBe(false);
    frame(1);
    frame();
    expect(fading()).toBe(true);
  });

  it('removes the splash on paint without a fade for reduced motion', () => {
    localStorage.setItem(SPLASH_HELD_VERSION_KEY, splashHoldVersion(__APP_VERSION__, false));
    reducedMotion = true;
    paintWorkspace();
    dismissStartupSplash();
    frame();
    frame();
    expect(splash()).toBeNull();
    expect(inert()).toBe(false);
  });

  it('holds in full again after an update, then remembers the new version', () => {
    localStorage.setItem(SPLASH_HELD_VERSION_KEY, 'an-older-version');
    paintWorkspace();
    dismissStartupSplash();
    frame();
    frame(3999);
    expect(fading()).toBe(false);
    expect(localStorage.getItem(SPLASH_HELD_VERSION_KEY)).toBe('an-older-version');
    frame(1);
    frame();
    expect(fading()).toBe(true);
    expect(localStorage.getItem(SPLASH_HELD_VERSION_KEY)).toBe(
      splashHoldVersion(__APP_VERSION__, false),
    );
  });

  it('owes the hold again when the first launch of a version ends early', () => {
    paintWorkspace();
    dismissStartupSplash();
    frame();
    frame(2000);
    // A reload or a crash screen before the hold is served records nothing.
    crashWorkspace();
    frame();
    frame();
    expect(fading()).toBe(true);
    expect(localStorage.getItem(SPLASH_HELD_VERSION_KEY)).not.toBe(
      splashHoldVersion(__APP_VERSION__, false),
    );
  });

  it.each(['getItem', 'setItem'] as const)('does not hold when storage %s throws', (method) => {
    vi.spyOn(Storage.prototype, method).mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    paintWorkspace();
    dismissStartupSplash();
    frame();
    frame();
    expect(performance.now()).toBeLessThan(100);
    expect(fading()).toBe(true);
  });

  it('does not hold when the storage getter itself is denied', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    paintWorkspace();
    dismissStartupSplash();
    frame();
    frame();
    expect(fading()).toBe(true);
  });
});

describe('what counts as a version for the startup hold (ADR-049 Amendment 3)', () => {
  it('keys the desktop app on its full release number', () => {
    expect(splashHoldVersion('1.0.31', true)).toBe('1.0.31');
  });

  it('keys the web app on major.minor, so a deploy alone does not hold', () => {
    expect(splashHoldVersion('1.4.2310', false)).toBe('1.4');
    expect(splashHoldVersion('1.4.2311', false)).toBe('1.4');
    expect(splashHoldVersion('1.5.2312', false)).toBe('1.5');
  });

  it('keeps a version with no commit count whole', () => {
    expect(splashHoldVersion('2.0', false)).toBe('2.0');
  });
});
