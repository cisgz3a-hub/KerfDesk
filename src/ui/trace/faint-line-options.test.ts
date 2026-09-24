import { describe, expect, it } from 'vitest';
import { TRACE_PRESETS } from '../../core/trace';
import { mergeLightBurnTraceSettings } from './trace-options';

describe('faint-line and tiny-hole settings', () => {
  it.each(['Line Art', 'Smooth', 'Sharp', 'Centerline'])(
    '%s restores its own threshold in faint mode and returns to deliberate manual settings',
    (name) => {
      const preset = TRACE_PRESETS[name]!;
      const manual = { cutoffLuma: 200, thresholdLuma: 225, sketchTrace: true };
      const faint = mergeLightBurnTraceSettings(preset, {
        ...manual,
        detectionMode: 'faint-lines',
      });
      expect(faint.faintLineRecovery).toBe(true);
      expect(faint.sketchTrace).toBe(false);
      expect(faint.cutoffLuma).toBe(preset.cutoffLuma);
      expect(faint.thresholdLuma).toBe(preset.thresholdLuma);
      expect(faint.useOtsuThreshold).toBe(preset.useOtsuThreshold);
      expect(mergeLightBurnTraceSettings(preset, { ...manual, detectionMode: 'preset' })).toEqual(
        preset,
      );
      const restored = mergeLightBurnTraceSettings(preset, { ...manual, detectionMode: 'manual' });
      expect(restored.faintLineRecovery).not.toBe(true);
      expect(restored.sketchTrace).toBe(false);
      expect(restored.cutoffLuma).toBe(200);
      expect(restored.thresholdLuma).toBe(225);
    },
  );

  it.each(['Line Art', 'Smooth', 'Sharp', 'Centerline'])(
    '%s honours both explicit tiny-hole values without changing its default',
    (name) => {
      const preset = TRACE_PRESETS[name]!;
      expect(mergeLightBurnTraceSettings(preset, {}).fillPinholeCracks).toBe(
        preset.fillPinholeCracks,
      );
      for (const fillPinholeCracks of [false, true])
        expect(mergeLightBurnTraceSettings(preset, { fillPinholeCracks }).fillPinholeCracks).toBe(
          fillPinholeCracks,
        );
    },
  );

  it.each(['Photo shading', 'Edge Detection'])(
    'does not apply hidden recovery settings to %s',
    (name) => {
      const options = mergeLightBurnTraceSettings(TRACE_PRESETS[name]!, {
        detectionMode: 'faint-lines',
        fillPinholeCracks: true,
      });
      expect(options.faintLineRecovery).toBeUndefined();
      expect(options.fillPinholeCracks).toBeUndefined();
    },
  );
});
