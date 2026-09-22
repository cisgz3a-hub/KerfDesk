import { describe, expect, it } from 'vitest';
import {
  detectLaserSourceFamily,
  laserSecondPassSupportsController,
  unsupportedLaserSourceMessage,
} from './source-family';

describe('laser source family detection', () => {
  it.each([
    ['M5 I\nG21\nG90\nM3 I S0\nG1 X10 F600 S100\nM5 I\n', 'marlin-inline'],
    ['G21\nG90\nM107\nG0 X35 Y226\nG1 X40 F1200\nM106 S120\n', 'marlin-fan'],
    ['fire off\nG21\nG90\nG54\nG94\nM400\nM221 S100 P0\n', 'smoothieware'],
    ['G21\nG90\nG54\nG94\nM4 S0\nG0 X-5 Y0 S0\nG1 X0 F600 S0\n', 'grbl-family'],
    ['; output-dialect: marlin-inline\n(M5 I)\nG21\nM3 S0\nG2 X10 I5 J0\n', 'grbl-family'],
  ])('classifies %j as %s', (source, family) => {
    expect(detectLaserSourceFamily(source)).toBe(family);
  });

  it('reads only the prelude, so a large program is not scanned twice', () => {
    const rows = Array.from({ length: 200 }, (_, index) => `G1X${index}S100`).join('\n');
    expect(detectLaserSourceFamily(`G21\nG90\nM4 S0\n${rows}\nM107\n`)).toBe('grbl-family');
  });

  it('names the controller family in the refusal and accepts GRBL-family profiles', () => {
    expect(unsupportedLaserSourceMessage('grbl-family')).toBeNull();
    expect(unsupportedLaserSourceMessage('marlin-inline')).toContain('Marlin (inline laser mode)');
    expect(unsupportedLaserSourceMessage('marlin-fan')).toContain('Marlin (fan-controlled laser)');
    expect(unsupportedLaserSourceMessage('smoothieware')).toContain('GRBL, grblHAL and FluidNC');
    for (const kind of [undefined, 'grbl-v1.1', 'grblhal', 'fluidnc'] as const) {
      expect(laserSecondPassSupportsController(kind)).toBe(true);
    }
    for (const kind of ['marlin', 'smoothieware', 'ruida'] as const) {
      expect(laserSecondPassSupportsController(kind)).toBe(false);
    }
  });
});
