// Centerline and Line + fill offer Join gaps, the distance across which they
// join facing line ends (centerlineJoinGapPx); 0 leaves every gap open. The
// settings panel also names the preview's pixel grid when it is not the
// image's own size (ADR-559).

import { describe, expect, it } from 'vitest';
import { TRACE_PRESETS } from '../../core/trace';
import { fill, loopCount, paper } from './trace-controls-test-helpers';
import { withControls } from './trace-settings-controls.test-support';
import { captureTraceSettings, restoreTraceSettings } from './trace-settings-snapshot';

describe('Join gaps', () => {
  it('joins a broken Centerline stroke by default and leaves it open at 0', async () => {
    // One 4 px stroke broken by a one-pixel gap.
    const image = paper();
    fill(image, 5, 28, 30, 4, [0, 0, 0]);
    fill(image, 36, 28, 30, 4, [0, 0, 0]);
    await withControls('Centerline', async (controls) => {
      expect(controls.number('Join gaps').value).toBe('3');
      expect(await loopCount(image, controls.options())).toBe(1);
      await controls.change('Join gaps', 0);
      expect(controls.options().centerlineJoinGapPx).toBe(0);
      expect(await loopCount(image, controls.options())).toBe(2);
      await controls.reset();
      expect(controls.options()).toEqual(TRACE_PRESETS['Centerline']);
    });
  });

  it('is offered by Line + fill and not by the outline styles', async () => {
    await withControls('Line + fill', async (controls) => {
      await controls.change('Join gaps', 7);
      expect(controls.options().centerlineJoinGapPx).toBe(7);
      await controls.selectPreset('Sharp');
      expect(controls.host.querySelector('[aria-label="Trace Join gaps"]')).toBeNull();
      expect(controls.options().centerlineJoinGapPx).toBeUndefined();
      await controls.selectPreset('Centerline');
      expect(controls.number('Join gaps').value).toBe('7');
    });
  });

  it('travels with Re-trace Original within the control range', () => {
    const settings = {
      presetName: 'Centerline',
      overrides: { centerlineJoinGapPx: 0 },
      output: 'vector' as const,
      fillStyle: 'scanline' as const,
      boundary: null,
      boundaryMode: 'crop' as const,
    };
    const grid = { width: 100, height: 100 };
    expect(restoreTraceSettings(captureTraceSettings(settings), grid).overrides).toEqual({
      centerlineJoinGapPx: 0,
    });
    const tooWide = captureTraceSettings({ ...settings, overrides: { centerlineJoinGapPx: 80 } });
    expect(restoreTraceSettings(tooWide, grid).overrides).toEqual({ centerlineJoinGapPx: 50 });
  });
});

describe('preview grid note', () => {
  it('names the grid pixel settings count on when it is not the image size', async () => {
    await withControls('Line Art', async (controls) => {
      expect(controls.host.textContent).not.toContain('The preview traces this image at');
      await controls.setPreviewFacts({ previewGrid: { width: 2048, height: 1365 } });
      expect(controls.host.textContent).toContain(
        'The preview traces this image at 2048 × 1365 px; pixel sizes here count those pixels.',
      );
    });
  });
});
