import { Blob as NodeBlob } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { nativeLaserProject } from '../../__fixtures__/controllers/native-laser-project';
import { LINE_CATEGORY, SEG_KIND } from '../../core/gcode-view';
import { emitGcode } from '../../io/gcode/emit-gcode';
import { canvasJobTimingPlan } from '../state/canvas-job-timing-plan';
import { projectInspectionContext } from './gcode-inspection-source';
import { inspectGcodeSource, inspectGcodeText } from './gcode-inspector-parse';

describe('actual controller output inspection', () => {
  it.each([
    ['smoothieware', undefined, 0.25],
    ['marlin', 'marlin-inline', 64],
    ['marlin', 'marlin-fan', 64],
    ['grbl-v1.1', undefined, 64],
  ] as const)(
    'keeps %s %s power, preview and countdown consistent',
    async (kind, dialect, power) => {
      const base = nativeLaserProject(kind);
      const project = {
        ...base,
        device: {
          ...base.device,
          ...(dialect === undefined ? {} : { gcodeDialect: { dialectId: dialect } }),
        },
      };
      const emitted = emitGcode(project);
      expect(emitted.preflight.issues).toEqual([]);
      const context = projectInspectionContext(project);
      const direct = inspectGcodeText(emitted.gcode, context);
      const streamed = await inspectGcodeSource({
        kind: 'blob',
        blob: new NodeBlob([emitted.gcode]) as unknown as Blob,
        ...context,
      });
      expect(streamed.parsed).toEqual(direct.parsed);
      expect(streamed.analysis).toEqual(direct.analysis);
      expect(streamed.sourceLineCount).toBe(direct.sourceLineCount);
      expect(direct.parsed.kind).toBe('ok');
      if (direct.parsed.kind !== 'ok') return;
      const model = direct.parsed.model;
      expect(model.unsupportedWords).toEqual([]);
      expect([...model.lineCategories]).not.toContain(LINE_CATEGORY.junk);
      expect(model.stats.cutMm).toBeCloseTo(1);
      expect(model.stats.powerMin).toBe(power);
      expect(model.stats.powerMax).toBe(power);
      const burn = [...model.segKind].indexOf(SEG_KIND.cut);
      expect(model.segPower[burn]).toBe(power);
      expect(direct.analysis?.findings.map((finding) => finding.id)).not.toContain(
        'cut-before-spindle',
      );
      const timing = canvasJobTimingPlan(
        emitted.gcode,
        project.device,
        { x: 0, y: 0, z: 0 },
        {
          controllerSessionEpoch: 1,
          positionEpoch: 1,
          activeControllerKind: kind,
          detectedControllerKind: kind,
        },
      );
      expect(timing.kind).toBe('ok');
      if (timing.kind === 'ok') expect(timing.plan.totalSeconds).toBeGreaterThan(0);
    },
  );
});
