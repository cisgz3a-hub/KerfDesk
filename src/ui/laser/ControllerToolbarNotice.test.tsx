import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ControllerToolbarNotice } from './ControllerToolbarNotice';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type Props = Parameters<typeof ControllerToolbarNotice>[0];
const baseProps: Props = {
  message: 'Waiting to read controller settings…',
  detail: 'Controller must report Idle or Alarm before reading machine settings.',
  onShow: () => undefined,
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});

async function render(props: Partial<Props> = {}): Promise<HTMLButtonElement> {
  await act(async () => root.render(<ControllerToolbarNotice {...baseProps} {...props} />));
  const button = host.querySelector('button');
  if (button === null) throw new Error('Expected a visible controller notice');
  return button;
}

async function advance(milliseconds: number): Promise<void> {
  await act(async () => vi.advanceTimersByTime(milliseconds));
}

async function hover(button: HTMLButtonElement, active: boolean): Promise<void> {
  await act(async () => {
    button.dispatchEvent(
      new MouseEvent(active ? 'mouseover' : 'mouseout', { bubbles: true, relatedTarget: null }),
    );
  });
}

describe('ControllerToolbarNotice', () => {
  it('expires after six seconds without taking focus or opening controller info', async () => {
    const onShow = vi.fn();
    const editor = document.createElement('input');
    document.body.appendChild(editor);
    editor.focus();
    try {
      await render({ onShow });
      expect(document.activeElement).toBe(editor);
      await advance(5999);
      expect(host.querySelector('[role="group"]')).not.toBeNull();
      await advance(1);
      expect(host.querySelector('[role="group"]')).toBeNull();
      expect(document.activeElement).toBe(editor);
      expect(onShow).not.toHaveBeenCalled();
    } finally {
      editor.remove();
    }
  });

  it('does not restart expiry when the same notice is rendered again', async () => {
    await render();
    await advance(4000);
    await render({ onShow: vi.fn() });
    await advance(2000);
    expect(host.querySelector('[role="group"]')).toBeNull();
  });

  it('keeps a hovered notice available, then expires after the pointer leaves', async () => {
    const button = await render();
    await advance(5000);
    await hover(button, true);
    await advance(10000);
    expect(host.querySelector('button')).toBe(button);
    await hover(button, false);
    await advance(5999);
    expect(host.querySelector('button')).toBe(button);
    await advance(1);
    expect(host.querySelector('[role="group"]')).toBeNull();
  });

  it('keeps keyboard focus through pointer departure and opens info only when activated', async () => {
    const onShow = vi.fn();
    const button = await render({ onShow });
    await hover(button, true);
    await act(async () => button.focus());
    await hover(button, false);
    await advance(10000);
    expect(document.activeElement).toBe(button);
    expect(host.querySelector('button')).toBe(button);
    expect(onShow).not.toHaveBeenCalled();
    await act(async () => button.click());
    expect(onShow).toHaveBeenCalledOnce();
    await act(async () => button.blur());
    await advance(6000);
    expect(host.querySelector('[role="group"]')).toBeNull();
  });

  it('keeps a hovered notice available after keyboard focus leaves', async () => {
    const button = await render();
    await act(async () => button.focus());
    await hover(button, true);
    await act(async () => button.blur());
    await advance(10000);
    expect(host.querySelector('button')).toBe(button);
    await hover(button, false);
    await advance(6000);
    expect(host.querySelector('[role="group"]')).toBeNull();
  });

  it('cancels the expiry timer when the notice is removed', async () => {
    const onShow = vi.fn();
    await render({ onShow });
    await act(async () => root.render(null));
    expect(vi.getTimerCount()).toBe(0);
    await advance(6000);
    expect(onShow).not.toHaveBeenCalled();
  });
});
