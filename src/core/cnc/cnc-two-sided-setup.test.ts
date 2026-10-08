import { describe, expect, it } from 'vitest';
import { projectWithLine } from '../../__fixtures__/file-actions';
import { DEFAULT_CNC_MACHINE_CONFIG, applyTransform } from '../scene';
import { toMachineCoords } from '../devices';
import { defaultCncMachiningSetup } from '../scene/cnc-machining-setup';
import type { CncTwoSidedSetup } from '../scene/cnc-two-sided-setup';
import {
  cncSideBPoint,
  cncSideOutputProject,
  cncSideRegistrationPoints,
} from './cnc-two-sided-setup';
import { prepareOutput, emitGcode } from '../../io/gcode';
import { serializeProject, deserializeProject } from '../../io/project';
const stock = {
  ...DEFAULT_CNC_MACHINE_CONFIG.stock,
  widthMm: 100,
  heightMm: 60,
  thicknessMm: 12,
  originOffset: { x: 10, y: 20 },
};
const side: CncTwoSidedSetup = {
  activeSide: 'B',
  flipAxis: 'y',
  sideBStockOriginMm: { x: 4, y: 7 },
  sideAObjectIds: ['A'],
  sideBObjectIds: ['B'],
  registration: [{ id: 'pin', name: 'Pin', stockXMm: 13, stockYMm: 8, diameterMm: 4 }],
};
function project() {
  const original = projectWithLine(),
    object = original.scene.objects[0]!;
  return {
    ...original,
    machine: { ...DEFAULT_CNC_MACHINE_CONFIG, stock },
    cncSetup: { ...defaultCncMachiningSetup(), twoSided: side },
    scene: {
      ...original.scene,
      objects: [
        { ...object, id: 'A' },
        {
          ...object,
          id: 'B',
          transform: { ...object.transform, x: 23, y: 32, rotationDeg: 27, mirrorX: true },
        },
      ],
    },
  };
}
describe('two-sided stock-local CNC coordinates', () => {
  it('matches independently derived asymmetric points for both physical axes', () => {
    expect(cncSideBPoint({ x: 23, y: 28 }, stock, side)).toEqual({ x: 91, y: 15 });
    expect(cncSideBPoint({ x: 23, y: 28 }, stock, { ...side, flipAxis: 'x' })).toEqual({
      x: 17,
      y: 59,
    });
    expect(cncSideRegistrationPoints(stock, side)).toEqual([{ x: 91, y: 15 }]);
  });
  it.each(['front-left', 'front-right', 'rear-left', 'rear-right', 'center'] as const)(
    'composes a physical flip before CAM for %s origin',
    (origin) => {
      const original = project(),
        input = { ...original, device: { ...original.device, origin } };
      const output = cncSideOutputProject(input, input.scene);
      const before = input.scene.objects[1]!,
        after = output.scene.objects[1]!;
      const local = { x: 3.7, y: 8.2 };
      const point = toMachineCoords(applyTransform(local, before.transform), input.device);
      const expected = { x: 4 + 100 - (point.x - 10), y: 7 + point.y - 20 };
      const actual = toMachineCoords(applyTransform(local, after.transform), input.device);
      expect(actual.x).toBeCloseTo(expected.x, 9);
      expect(actual.y).toBeCloseTo(expected.y, 9);
      expect(input.scene.objects[1]).toBe(before);
    },
  );
  it('separately prepares named sides, preserves top Z0 and round-trips registration intent', () => {
    const b = project(),
      a = { ...b, cncSetup: { ...b.cncSetup, twoSided: { ...side, activeSide: 'A' as const } } };
    const pa = prepareOutput(a),
      pb = prepareOutput(b);
    expect(pa.ok && pb.ok).toBe(true);
    if (!pa.ok || !pb.ok) throw new Error('prepare failed');
    expect(pa.project.scene.objects.map((object) => object.id)).toEqual(['A']);
    expect(pb.project.scene.objects.map((object) => object.id)).toEqual(['B']);
    expect(pb.project.machine?.kind === 'cnc' && pb.project.machine.stock.originOffset).toEqual({
      x: 4,
      y: 7,
    });
    expect(emitGcode(a).gcode).toContain('; CNC side A | G54 | stock top Z0');
    expect(emitGcode(b).gcode).toContain('; CNC side B | G54 | stock top Z0');
    expect(emitGcode(b).gcode).not.toBe(emitGcode(a).gcode);
    const opened = deserializeProject(serializeProject(b));
    if (opened.kind !== 'ok') throw new Error('open failed');
    expect(opened.project.cncSetup?.twoSided).toEqual(side);
  });
  it('rejects malformed flips instead of dropping coordinate intent', () => {
    expect(
      deserializeProject(
        JSON.stringify({
          ...project(),
          cncSetup: { ...project().cncSetup, twoSided: { ...side, flipAxis: 'z' } },
        }),
      ).kind,
    ).toBe('invalid');
  });
});
