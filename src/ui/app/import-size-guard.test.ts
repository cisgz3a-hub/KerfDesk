import { describe, expect, it, vi } from 'vitest';
import { confirmOversizeImport, MAX_IMPORT_FILE_BYTES } from './import-size-guard';

describe('confirmOversizeImport (F-A3)', () => {
  it('proceeds without confirming for a file within the limit', () => {
    const confirm = vi.spyOn(window, 'confirm');
    expect(confirmOversizeImport('small.svg', MAX_IMPORT_FILE_BYTES)).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('confirms before importing an oversize file and reflects a declined choice', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    expect(confirmOversizeImport('huge.png', 31 * 1024 * 1024)).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0]?.[0]).toContain('larger than 25 MB');
    expect(confirm.mock.calls[0]?.[0]).toContain('31 MB');
    vi.restoreAllMocks();
  });

  it('returns true when the operator confirms the oversize import', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    expect(confirmOversizeImport('huge.png', 31 * 1024 * 1024)).toBe(true);
    vi.restoreAllMocks();
  });
});
