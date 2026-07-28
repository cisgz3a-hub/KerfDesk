import { describe, expect, it, vi } from 'vitest';
import { planTiles } from '../../core/cnc';
import { handleSaveTiledGcode } from './save-tiled-gcode';
import {
  capturingPlatform,
  tiledCncProject,
  withOverBudgetTiling,
} from './save-tiled-gcode-testing';
import { tiledSaveWorkBudgetMessage } from './tiled-save-work-budget';

const DEGENERATE_TILING = {
  tileWidthMm: 60,
  tileHeightMm: 60,
  overlapMm: 100,
  registrationHoles: false,
};

describe('tiledSaveWorkBudgetMessage', () => {
  it('stops an over-budget normalized grid before emission or file I/O', async () => {
    const written: string[] = [];
    const pickedNames: string[] = [];
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    const pushToast = vi.fn();
    try {
      const handled = await handleSaveTiledGcode({
        platform: capturingPlatform(written, pickedNames),
        project: withOverBudgetTiling(tiledCncProject()),
        savedName: 'job',
        pushToast,
      });
      expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('No files were written'));
      expect([handled, pickedNames.length, written.length, pushToast.mock.calls.length]).toEqual([
        true,
        0,
        0,
        0,
      ]);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('reports exact normalized work without implying any file was written', () => {
    const result = planTiles({ minX: 0, minY: 0, maxX: 400, maxY: 400 }, DEGENERATE_TILING);
    if (result.kind !== 'work-budget-exceeded') throw new Error('expected budget outcome');

    expect(tiledSaveWorkBudgetMessage(result.grid)).toBe(
      'Cannot export tiles:\n\nThis job would require 116,281 planned grid cells using an effective ' +
        'overlap of 59 mm (X step 1 mm, Y step 1 mm), which exceeds the 500-cell work limit. ' +
        'Increase tile width or height, or reduce overlap, then try again.\n\nNo files were written.',
    );
  });

  it('does not present an unsafe astronomical count as exact', () => {
    const result = planTiles(
      { minX: 0, minY: 0, maxX: Number.MAX_VALUE, maxY: Number.MAX_VALUE },
      DEGENERATE_TILING,
    );
    if (result.kind !== 'work-budget-exceeded') throw new Error('expected budget outcome');

    expect(tiledSaveWorkBudgetMessage(result.grid)).toContain(
      'would require more than 500 planned grid cells',
    );
  });

  it('formats the same large work budget consistently in both message clauses', () => {
    const result = planTiles(
      { minX: 0, minY: 0, maxX: Number.MAX_VALUE, maxY: Number.MAX_VALUE },
      DEGENERATE_TILING,
    );
    if (result.kind !== 'work-budget-exceeded') throw new Error('expected budget outcome');
    const grid = {
      ...result.grid,
      work: { ...result.grid.work, budget: 12_345 },
    };

    expect(tiledSaveWorkBudgetMessage(grid)).toContain(
      'more than 12,345 planned grid cells using an effective',
    );
    expect(tiledSaveWorkBudgetMessage(grid)).toContain('12,345-cell work limit');
  });
});
