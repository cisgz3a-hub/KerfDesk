import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  BoardVerificationTarget,
  CapturedBoardGeometry,
} from '../../../core/scene/board-verification';
import { useStore } from '../../state';
import { useUiStore } from '../../state/ui-store';
import { BoardAnchorOverlay } from './BoardAnchorOverlay';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  useStore.getState().newProject();
  useUiStore.setState({ zoomFactor: 1, panX: 0, panY: 0 });
  vi.restoreAllMocks();
});

describe('BoardAnchorOverlay', () => {
  it('renders clickable rectangle corners that carry typed targets', async () => {
    useStore.getState().addCapturedBoard({ kind: 'rect', widthMm: 120, heightMm: 80 });
    const onSelect = vi.fn<(target: BoardVerificationTarget) => void>();
    await renderOverlay(
      { kind: 'rect', origin: { x: 50, y: 30 }, widthMm: 120, heightMm: 80 },
      onSelect,
    );

    const buttons = host?.querySelectorAll<HTMLButtonElement>('button[data-board-anchor]');
    expect(buttons).toHaveLength(4);
    const topRight = host?.querySelector<HTMLButtonElement>(
      'button[data-board-anchor="top-right"]',
    );
    expect(topRight?.style.left).not.toBe('');
    await act(async () => topRight?.click());
    expect(onSelect).toHaveBeenCalledWith({ kind: 'rect', anchor: 'top-right' });
  });

  it('renders circle center and four rim targets and honors disabled state', async () => {
    useStore.getState().addCapturedBoard({ kind: 'circle', diameterMm: 100 });
    const onSelect = vi.fn<(target: BoardVerificationTarget) => void>();
    await renderOverlay(
      { kind: 'circle', center: { x: 100, y: 100 }, radiusMm: 50 },
      onSelect,
      true,
    );

    const buttons = host?.querySelectorAll<HTMLButtonElement>('button[data-board-anchor]');
    expect(buttons).toHaveLength(5);
    expect([...buttons!].every((button) => button.disabled)).toBe(true);
    host?.querySelector<HTMLButtonElement>('button[data-board-anchor="rim-right"]')?.click();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('omits crowded overlay targets instead of allowing ambiguous clicks', async () => {
    useStore.getState().addCapturedBoard({ kind: 'rect', widthMm: 10, heightMm: 10 });
    const onSelect = vi.fn<(target: BoardVerificationTarget) => void>();
    await renderOverlay(
      { kind: 'rect', origin: { x: 50, y: 30 }, widthMm: 10, heightMm: 10 },
      onSelect,
    );

    expect(host?.querySelectorAll('button[data-board-anchor]')).toHaveLength(0);
  });
});

async function renderOverlay(
  geometry: CapturedBoardGeometry,
  onSelect: (target: BoardVerificationTarget) => void,
  disabled = false,
): Promise<void> {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 800,
    bottom: 600,
    width: 800,
    height: 600,
    toJSON: () => ({}),
  });
  host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    root = createRoot(host!);
    root.render(
      <div style={{ position: 'relative', width: 800, height: 600 }}>
        <BoardAnchorOverlay
          geometry={geometry}
          activeTarget={null}
          disabled={disabled}
          onSelect={onSelect}
        />
      </div>,
    );
  });
}
