import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  runViewportKey,
  useViewportKeys,
  viewportKeyAction,
  type ViewportKeyTargets,
} from './use-viewport-keys';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const key = (name: string, modifiers: Partial<KeyboardEvent> = {}) => ({
  key: name,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...modifiers,
});

describe('viewportKeyAction', () => {
  it('names the view keys, either case', () => {
    expect(viewportKeyAction(key(' '))).toEqual({ kind: 'play' });
    expect(viewportKeyAction(key('ArrowLeft'))).toEqual({ kind: 'step', direction: -1 });
    expect(viewportKeyAction(key('ArrowRight'))).toEqual({ kind: 'step', direction: 1 });
    expect(viewportKeyAction(key('Home'))).toEqual({ kind: 'start' });
    expect(viewportKeyAction(key('End'))).toEqual({ kind: 'end' });
    expect(viewportKeyAction(key('F'))).toEqual({ kind: 'fit' });
    expect(viewportKeyAction(key('o'))).toEqual({ kind: 'ortho' });
    expect(viewportKeyAction(key('m'))).toEqual({ kind: 'measure' });
    expect(viewportKeyAction(key('Escape'))).toEqual({ kind: 'escape' });
    expect(viewportKeyAction(key('1'))).toEqual({ kind: 'view', view: 'iso' });
    expect(viewportKeyAction(key('4'))).toEqual({ kind: 'view', view: 'right' });
  });

  it('leaves other keys and chords to the page', () => {
    expect(viewportKeyAction(key('5'))).toBeNull();
    expect(viewportKeyAction(key('x'))).toBeNull();
    expect(viewportKeyAction(key('f', { ctrlKey: true }))).toBeNull();
    expect(viewportKeyAction(key('o', { metaKey: true }))).toBeNull();
  });
});

function targets(overrides: Partial<ViewportKeyTargets> = {}): ViewportKeyTargets {
  return {
    ready: true,
    transport: { togglePlay: vi.fn(), stepMove: vi.fn(), toStart: vi.fn(), toEnd: vi.fn() },
    selectView: vi.fn(),
    fit: vi.fn(),
    toggleProjection: vi.fn(),
    measure: { active: false, from: null, toggle: vi.fn(), clear: vi.fn() },
    ...overrides,
  };
}

describe('runViewportKey', () => {
  it('plays, steps and jumps through the transport, and not in live mode', () => {
    const view = targets();
    expect(runViewportKey(view, { kind: 'step', direction: -1 })).toBe(true);
    expect(view.transport?.stepMove).toHaveBeenCalledWith(-1);
    expect(runViewportKey(view, { kind: 'end' })).toBe(true);
    expect(view.transport?.toEnd).toHaveBeenCalled();
    expect(runViewportKey(targets({ transport: undefined }), { kind: 'play' })).toBe(false);
  });

  it('turns the camera only once the view is ready', () => {
    const view = targets();
    expect(runViewportKey(view, { kind: 'view', view: 'top' })).toBe(true);
    expect(view.selectView).toHaveBeenCalledWith('top');
    expect(runViewportKey(targets({ ready: false }), { kind: 'fit' })).toBe(false);
  });

  it('lets Esc drop the points, then the tool, then close the dialog', () => {
    const clear = vi.fn();
    const toggle = vi.fn();
    const measuring = { active: true, from: { x: 1 }, toggle, clear };
    expect(runViewportKey(targets({ measure: measuring }), { kind: 'escape' })).toBe(true);
    expect(clear).toHaveBeenCalled();
    const empty = { ...measuring, from: null };
    expect(runViewportKey(targets({ measure: empty }), { kind: 'escape' })).toBe(true);
    expect(toggle).toHaveBeenCalled();
    expect(runViewportKey(targets(), { kind: 'escape' })).toBe(false);
  });
});

describe('useViewportKeys', () => {
  let host: HTMLDivElement;
  let root: Root;
  const handled: string[] = [];
  const outside = vi.fn();

  function View(props: { readonly handles: boolean }) {
    const ref = useRef<HTMLDivElement | null>(null);
    useViewportKeys(ref, (action) => {
      handled.push(action.kind);
      return props.handles;
    });
    return (
      <div ref={ref}>
        <canvas tabIndex={0} />
        <input aria-label="field" />
        <button type="button">Fit</button>
      </div>
    );
  }

  function press(target: Element, name: string): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
  }

  beforeEach(() => {
    handled.length = 0;
    outside.mockClear();
    host = document.createElement('div');
    host.addEventListener('keydown', outside);
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('keeps a key it uses from the dialog around it', () => {
    act(() => root.render(<View handles />));
    const event = press(host.querySelector('canvas')!, 'Escape');
    expect(handled).toEqual(['escape']);
    expect(event.defaultPrevented).toBe(true);
    expect(outside).not.toHaveBeenCalled();
  });

  it('passes on keys it does not use, typing in fields and Space on a button', () => {
    act(() => root.render(<View handles={false} />));
    press(host.querySelector('canvas')!, 'Escape');
    expect(outside).toHaveBeenCalledOnce();
    act(() => root.render(<View handles />));
    press(host.querySelector('input')!, 'm');
    press(host.querySelector('button')!, ' ');
    expect(handled).toEqual(['escape']);
    press(host.querySelector('button')!, 'f');
    expect(handled).toEqual(['escape', 'fit']);
  });
});
