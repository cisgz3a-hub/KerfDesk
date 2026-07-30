import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRgbaBuffer } from '../../core/image-edit/rgba-buffer';
import { applyThicken, type KerfCheck } from './editor-kerf-check';
import { KerfStatus } from './KerfStatus';
import { useKerfCheck } from './use-kerf-check';

vi.mock('./editor-kerf-check', () => ({ applyThicken: vi.fn() }));
vi.mock('./use-kerf-check', () => ({ useKerfCheck: vi.fn() }));

// React's test-only act marker is absent from the standard globalThis type.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function check(
  isRepairable: boolean,
  minCorrectionMm = 0.75,
  maxCorrectionMm = minCorrectionMm,
): KerfCheck {
  return {
    removedPixels: 2,
    minCorrectionMm,
    maxCorrectionMm,
    removedMask: isRepairable ? { width: 1, height: 1, alpha: Uint8Array.of(255) } : null,
    // The component only presents the result; action ownership is tested at its source seam.
    context: {} as KerfCheck['context'],
  };
}

describe('KerfStatus', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.resetAllMocks();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('shows exact output loss without an unproven repair action', () => {
    vi.mocked(useKerfCheck).mockReturnValue(check(false));
    act(() => root.render(<KerfStatus composite={createRgbaBuffer(1, 1)} />));
    expect(host.textContent).toContain('2 output px removed by 0.75 mm');
    expect(host.querySelector('button')).toBeNull();
  });

  it('shows the full correction range for loss across multiple operations', () => {
    vi.mocked(useKerfCheck).mockReturnValue(check(false, 0.4, 0.75));
    act(() => root.render(<KerfStatus composite={createRgbaBuffer(1, 1)} />));

    expect(host.textContent).toContain('2 output px removed by 0.4\u20130.75 mm');
    expect(host.querySelector('span[title]')?.getAttribute('title')).toContain(
      'current 0.4\u20130.75 mm dot-width correction',
    );
  });

  it('offers Thicken only for a reversible target', () => {
    const result = check(true);
    vi.mocked(useKerfCheck).mockReturnValue(result);
    act(() => root.render(<KerfStatus composite={createRgbaBuffer(1, 1)} />));
    const button = host.querySelector('button');
    expect(button?.textContent).toBe('Thicken');
    act(() => button?.click());
    expect(applyThicken).toHaveBeenCalledWith(result);
  });
});
