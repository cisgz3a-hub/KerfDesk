import { describe, expect, it, vi } from 'vitest';
import { exportStampDraft } from './stamp-export';
import { stampFixture } from '../state/stamp-preparation.test-fixture';
import type { PlatformAdapter } from '../../platform/types';
import { installChromiumSavePicker } from '../../platform/web/chromium-save-picker.test-support';
import { webAdapter } from '../../platform/web/web-adapter';
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
  it('does not open the picker once the review is closed, edited or superseded', async () => {
    const disk = new Map([['stamp-height-intent.png', 'previous stamp']]);
    const picker = installChromiumSavePicker(disk);
    try {
      await exportStampDraft(webAdapter, stampFixture().draft, () => false, vi.fn());
    } finally {
      picker.restore();
    }
    expect(picker.picks()).toBe(0);
    expect(disk.get('stamp-height-intent.png')).toBe('previous stamp');
  });
});

// Audit 19-P2-1 / ADR-656 Amendment 1: Chromium empties the chosen file as its
// save picker returns, so the stamp checks run first and the pick commits.
describe('stamp Export PNG over an existing file', () => {
  it('writes the reviewed PNG when the review goes stale while the picker is open', async () => {
    const disk = new Map([['stamp-height-intent.png', 'previous stamp']]);
    let current = true;
    const picker = installChromiumSavePicker(disk, {
      whilePicking: () => {
        current = false;
      },
    });
    const toast = vi.fn();
    try {
      // The fixture's PNG is the base64 of "PNG".
      await exportStampDraft(webAdapter, stampFixture().draft, () => current, toast);
    } finally {
      picker.restore();
    }
    expect(picker.picks()).toBe(1);
    expect(disk.get('stamp-height-intent.png')).toBe('PNG');
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('Saved stamp intent'), 'success');
  });
  it('keeps the old file when the prepared PNG is unavailable, without opening the picker', async () => {
    const disk = new Map([['stamp-height-intent.png', 'previous stamp']]);
    const picker = installChromiumSavePicker(disk);
    const toast = vi.fn();
    const draft = { ...stampFixture().draft, dataUrl: 'data:image/jpeg;base64,UE5H' };
    try {
      await exportStampDraft(webAdapter, draft, () => true, toast);
    } finally {
      picker.restore();
    }
    expect(picker.picks()).toBe(0);
    expect(disk.get('stamp-height-intent.png')).toBe('previous stamp');
    expect(toast).toHaveBeenCalledWith('The prepared PNG is unavailable.', 'error');
  });
});
