// emitRdFile coverage (CTL-10). The encoder's typed refusals (empty-job,
// raster-unsupported) are exercised at the encoder layer in
// core/controllers/ruida/ruida.test.ts; here we cover the emit wrapper's own
// seams: the prepareOutput success path yields bytes, and a project with no
// output geometry is refused with a message (never reaching the encoder).

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { createLayer, createProject, IDENTITY_TRANSFORM, type Project } from '../../core/scene';
import { emitRdFile } from './emit-rd';

function ruidaLineProject(): Project {
  return {
    ...createProject(),
    device: { ...DEFAULT_DEVICE_PROFILE, controllerKind: 'ruida' },
    scene: {
      layers: [createLayer({ id: '#000000', color: '#000000', mode: 'line' })],
      objects: [
        {
          kind: 'imported-svg',
          id: 'line-1',
          source: 'line.svg',
          bounds: { minX: 0, minY: 0, maxX: 10, maxY: 0 },
          transform: IDENTITY_TRANSFORM,
          paths: [
            {
              color: '#000000',
              polylines: [{ closed: false, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }],
            },
          ],
        },
      ],
    },
  };
}

describe('emitRdFile', () => {
  it('emits a non-empty byte stream for a line job', () => {
    const result = emitRdFile(ruidaLineProject());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.bytes.length).toBeGreaterThan(0);
  });

  it('refuses a project with no output geometry with a message', () => {
    const result = emitRdFile(createProject());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messages.length).toBeGreaterThan(0);
  });

  it('is deterministic across calls', () => {
    const project = ruidaLineProject();
    const a = emitRdFile(project);
    const b = emitRdFile(project);
    if (!a.ok || !b.ok) throw new Error('fixture should emit ok');
    expect([...a.bytes]).toEqual([...b.bytes]);
  });
});
