// ADR-255 acceptance gate 2 (own-output-clean): every program emitted by a
// built-in strategy parses into the render model with zero unsupported-word
// notes, zero junk lines, and zero skipped motions. (Test files may import
// across modules — the CLAUDE.md boundary exemption.)
import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import type { Job } from '../job';
import { cncGrblStrategy } from '../output/cnc-grbl-strategy';
import { grblStrategy } from '../output/grbl-strategy';
import { marlinStrategy } from '../output/marlin-strategy';
import { smoothiewareStrategy } from '../output/smoothieware-strategy';
import { buildGcodeRenderModel } from './gcode-render-model';
import { LINE_CATEGORY } from './render-model-types';

const laserJob: Job = {
  groups: [
    {
      kind: 'cut',
      layerId: 'L1',
      color: '#ff0000',
      power: 50,
      speed: 1500,
      passes: 1,
      airAssist: false,
      segments: [
        {
          polyline: [
            { x: 10, y: 20 },
            { x: 30, y: 40 },
            { x: 10, y: 20 },
          ],
          closed: true,
        },
      ],
    },
  ],
};

const cncJob: Job = {
  groups: [
    {
      kind: 'cnc',
      layerId: 'L1',
      color: '#0000ff',
      cutType: 'profile-on-path',
      toolDiameterMm: 3.175,
      feedMmPerMin: 800,
      plungeMmPerMin: 300,
      spindleRpm: 10000,
      spindleSpinupSec: 2,
      safeZMm: 5,
      passes: [
        {
          kind: 'contour',
          zMm: -1.5,
          polyline: [
            { x: 0, y: 0 },
            { x: 20, y: 0 },
            { x: 20, y: 20 },
            { x: 0, y: 0 },
          ],
          closed: true,
        },
        {
          kind: 'arc',
          start: { x: 30, y: 0 },
          end: { x: 40, y: 10 },
          center: { x: 30, y: 10 },
          clockwise: false,
          zMm: -1.5,
          closed: false,
        },
      ],
    },
  ],
};

const CASES: ReadonlyArray<{ readonly name: string; readonly gcode: string }> = [
  { name: 'grbl laser', gcode: grblStrategy.emit(laserJob, DEFAULT_DEVICE_PROFILE) },
  { name: 'grbl cnc', gcode: cncGrblStrategy.emit(cncJob, DEFAULT_DEVICE_PROFILE) },
  { name: 'marlin', gcode: marlinStrategy.emit(laserJob, DEFAULT_DEVICE_PROFILE) },
  { name: 'smoothieware', gcode: smoothiewareStrategy.emit(laserJob, DEFAULT_DEVICE_PROFILE) },
];

describe('own-output-clean (ADR-255 acceptance)', () => {
  for (const strategyCase of CASES) {
    it(`${strategyCase.name} output parses with zero notes, junk, or skips`, () => {
      const result = buildGcodeRenderModel(strategyCase.gcode);
      expect(result.kind).toBe('ok');
      if (result.kind !== 'ok') return;
      expect(result.model.unsupportedWords).toEqual([]);
      expect(result.model.skippedMotions).toEqual([]);
      const junkLines = [...result.model.lineCategories.entries()]
        .filter(([, category]) => category === LINE_CATEGORY.junk)
        .map(([line]) => line);
      expect(junkLines).toEqual([]);
      expect(result.model.segmentCount).toBeGreaterThan(0);
    });
  }
});
