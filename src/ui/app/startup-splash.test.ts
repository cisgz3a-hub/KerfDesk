import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dismissStartupSplash } from './startup-splash';

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
