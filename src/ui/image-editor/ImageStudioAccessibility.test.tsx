import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditorTestBuffer } from './create-editor-test-buffer';
import { createSession } from './editor-session';
import { EditorToolStrip } from './EditorToolStrip';
import { ImageEditorTopBar } from './ImageEditorTopBar';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => document.body.replaceChildren());

describe('Image Studio reachability', () => {
  it('wraps the session actions instead of clipping them at narrow width or high zoom', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const session = createSession('image', 'source.png', createEditorTestBuffer(2, 2), {
      minX: 0,
      minY: 0,
      maxX: 2,
      maxY: 2,
    });
    const action = (): void => undefined;
    await act(async () =>
      root.render(
        <ImageEditorTopBar
          session={session}
          isApplying={false}
          isHistoryOpen={false}
          onToggleHistory={action}
          actions={{
            undo: action,
            redo: action,
            revert: action,
            apply: action,
            applyAndTrace: action,
            close: action,
          }}
        />,
      ),
    );

    const bar = host.querySelector<HTMLElement>('[aria-label="Image Studio actions"]');
    expect(bar?.style.flexWrap).toBe('wrap');
    expect(bar?.querySelector('button[title^="Close"]')?.parentElement?.style.flexWrap).toBe(
      'wrap',
    );
    await act(async () => root.unmount());
  });

  it('scrolls the tool rail and gives the two-dimensional color pad keyboard control', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => root.render(<EditorToolStrip />));

    const rail = host.querySelector<HTMLElement>('aside[aria-label="Image Studio tools"]');
    expect(rail?.style.overflowY).toBe('auto');
    const foreground = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Choose foreground color"]',
    );
    if (foreground === null) throw new Error('foreground control missing');
    await act(async () => foreground.click());

    const pad = host.querySelector<HTMLElement>('[aria-label="Saturation and brightness"]');
    if (pad === null) throw new Error('color pad missing');
    await pressKey(pad, 'ArrowRight');
    expect(pad.getAttribute('aria-valuenow')).toBe('1');
    await pressKey(pad, 'ArrowUp', true);
    expect(pad.getAttribute('aria-valuetext')).toContain('brightness 10%');
    const card = host.querySelector<HTMLElement>('[role="dialog"] > div');
    expect(card?.style.maxHeight).toContain('100vh');

    await act(async () => root.unmount());
  });
});

async function pressKey(target: HTMLElement, key: string, shiftKey = false): Promise<void> {
  await act(async () =>
    target.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true })),
  );
}
