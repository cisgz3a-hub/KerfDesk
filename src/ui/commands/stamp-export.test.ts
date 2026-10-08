import { describe, expect, it, vi } from 'vitest';
import { exportStampDraft } from './stamp-export';
import { stampFixture } from '../state/stamp-preparation.test-fixture';
import type { PlatformAdapter, SaveTarget } from '../../platform/types';
describe('stamp export ownership', () => {
  it('opens the ordinary save picker and writes only the captured PNG bytes', async () => {
    const write = vi.fn();
    const pickFileForSave = vi.fn(async () => ({ displayName: 'stamp.png', write }));
    const toast = vi.fn();
    const { draft } = stampFixture();
    await exportStampDraft(
      { pickFileForSave } as unknown as PlatformAdapter,
      draft,
      () => true,
      toast,
    );
    expect(pickFileForSave).toHaveBeenCalledWith({
      suggestedName: 'stamp-height-intent.png',
      extensions: ['.png'],
    });
    expect(write).toHaveBeenCalledOnce();
    expect(write.mock.calls[0]?.[0]).toBeInstanceOf(Blob);
    expect(toast.mock.calls[0]?.[0]).toContain(
      `${draft.widthMm.toFixed(3)} × ${draft.heightMm.toFixed(3)} mm`,
    );
  });
  it('does not write after the review is closed, edited or superseded during the picker', async () => {
    let finish: (target: SaveTarget) => void = () => undefined;
    const pickFileForSave = vi.fn(
      () =>
        new Promise<SaveTarget>((resolve) => {
          finish = resolve;
        }),
    );
    let current = true;
    const write = vi.fn();
    const pending = exportStampDraft(
      { pickFileForSave } as unknown as PlatformAdapter,
      stampFixture().draft,
      () => current,
      vi.fn(),
    );
    current = false;
    finish({ displayName: 'stale.png', write });
    await pending;
    expect(write).not.toHaveBeenCalled();
  });
});
