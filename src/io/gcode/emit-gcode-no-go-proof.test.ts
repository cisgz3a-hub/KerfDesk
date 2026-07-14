import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  addLayer,
  addObject,
  createLayer,
  createProject,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { emitGcode } from './emit-gcode';

describe('relative-origin no-go proof', () => {
  it('keeps a laser job blocked when a perimeter frame cannot prove its interior is clear', () => {
    const result = emitGcode(projectWithInteriorZone('laser'), currentPositionStart());

    expect(result.preflight.issues).toContainEqual(
      expect.objectContaining({ code: 'no-go-zone-collision' }),
    );
  });

  it('keeps a CNC job blocked when a perimeter frame cannot prove its interior is clear', () => {
    const result = emitGcode(projectWithInteriorZone('cnc'), currentPositionStart());

    expect(result.preflight.issues).toContainEqual(
      expect.objectContaining({ code: 'no-go-zone-collision' }),
    );
  });
});

function projectWithInteriorZone(machineKind: 'laser' | 'cnc'): Project {
  const base = createProject({
    ...DEFAULT_DEVICE_PROFILE,
    homing: { enabled: false, direction: 'front-left' },
    noGoZones: [
      { id: 'center', name: 'Center clamp', enabled: true, x: 40, y: 40, width: 20, height: 20 },
    ],
  });
  const object = machineKind === 'cnc' ? perimeterObject() : crossingObject();
  const layer = {
    ...createLayer({ id: 'L1', color: '#ff0000' }),
    ...(machineKind === 'cnc' ? { cnc: DEFAULT_CNC_LAYER_SETTINGS } : {}),
  };
  return {
    ...base,
    ...(machineKind === 'cnc' ? { machine: DEFAULT_CNC_MACHINE_CONFIG } : {}),
    scene: addLayer(addObject(base.scene, object), layer),
  };
}

function crossingObject(): SceneObject {
  return vectorObject(
    [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
    ],
    false,
  );
}

function perimeterObject(): SceneObject {
  return vectorObject(
    [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ],
    true,
  );
}

function vectorObject(
  points: ReadonlyArray<{ readonly x: number; readonly y: number }>,
  closed: boolean,
): SceneObject {
  return {
    kind: 'imported-svg',
    id: 'O1',
    source: 'guard-repro.svg',
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: '#ff0000', polylines: [{ points, closed }] }],
  };
}

function currentPositionStart(): Parameters<typeof emitGcode>[1] {
  return {
    jobOrigin: {
      startFrom: 'current-position',
      anchor: 'front-left',
      currentPosition: { x: 0, y: 0 },
    },
  };
}
