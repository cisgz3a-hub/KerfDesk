import { it } from 'vitest';
import { emitGcode } from '../../io/gcode/emit-gcode';
import { nativeLaserProject } from '../../__fixtures__/controllers/native-laser-project';
import { createLayer, createProject } from '../../core/scene';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';

it('prints smoothie output', () => {
  const out = emitGcode(nativeLaserProject('smoothieware'));
  console.log('=== raster ===\n' + out.gcode);
  const base = createProject({ ...DEFAULT_DEVICE_PROFILE, controllerKind: 'smoothieware', maxPowerS: 1 });
  const project = {
    ...base,
    scene: {
      ...base.scene,
      layers: [{ ...createLayer({ id: 'cut', color: '#ff0000', mode: 'line' }), power: 40, speed: 1200, airAssist: true }],
      objects: [
        {
          kind: 'path' as const,
          id: 'p',
          color: '#ff0000',
          transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
          subpaths: [{ closed: true, commands: [ { kind: 'M', x: 10, y: 10 }, { kind: 'L', x: 30, y: 10 }, { kind: 'L', x: 30, y: 30 }, { kind: 'Z' } ] }],
        },
      ],
    },
  };
  try {
    const out2 = emitGcode(project as never);
    console.log('=== vector ===\n' + out2.gcode + '\nissues=' + JSON.stringify(out2.preflight.issues));
  } catch (e) { console.log('vector failed', e); }
});
