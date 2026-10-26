import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadImageAsRawData } from '../../../trace/image-loader';
import { OutlinePhotoDialog } from './OutlinePhotoDialog';

vi.mock('../../../trace/image-loader', () => ({ loadImageAsRawData: vi.fn() }));
vi.mock('./outline-photo-canvas', () => ({
  usePhotoCanvas: vi.fn(),
  photoDisplaySize: (width: number, height: number) => ({ width, height }),
}));
beforeEach(() => vi.mocked(loadImageAsRawData).mockReset());

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('OutlinePhotoDialog', () => {
  it('offers file, paste and MCP photo sources, blocks drawing until outlined, and cancels', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const onClose = vi.fn();
    await act(async () => {
      root.render(<OutlinePhotoDialog onUseOutline={vi.fn()} onClose={onClose} />);
    });
    expect(host.querySelector('input[type="file"]')).not.toBeNull();
    expect(host.textContent).toContain('paste a photo with Ctrl+V');
    expect(host.textContent).toContain('From your AI assistant (MCP)');
    const draw = [...host.querySelectorAll('button')].find(
      (button) => button.textContent === 'Draw on canvas',
    );
    expect(draw?.disabled).toBe(true);
    const cancel = [...host.querySelectorAll('button')].find(
      (button) => button.textContent === 'Cancel',
    );
    act(() => cancel?.click());
    expect(onClose).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
    host.remove();
  });

  it('loads an initial remote photo once on mount', async () => {
    vi.mocked(loadImageAsRawData).mockResolvedValue({
      data: new Uint8ClampedArray(16),
      width: 2,
      height: 2,
    });
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'board.jpg', {
      type: 'image/jpeg',
    });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <OutlinePhotoDialog initialFile={file} onUseOutline={vi.fn()} onClose={vi.fn()} />,
      );
    });
    expect(loadImageAsRawData).toHaveBeenCalledOnce();
    expect(loadImageAsRawData).toHaveBeenCalledWith(file, 2048);
    await act(async () => root.unmount());
    host.remove();
  });
});
