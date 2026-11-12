// ADR-683 Amendment 4: the phone's vector canvas shows a Fill operation as the
// one even-odd region it burns. The phone draws each path it is sent as one
// SVG path (even-odd within that path only) and picks the topmost object whose
// filled path or outline is under the finger. These tests decode the projection
// with the phone's own code, count the fills that cover each point, compare them
// with the compiled hatch, and compare the phone's pick with the desktop's direct
// hit. The phone has no line-interior pick (ADR-196): as it does a Line shape, it
// picks a hole or a cancelled copy by its outline.
import { describe, expect, it } from 'vitest';
import {
  decodeScene,
  hitTest as phoneHitTest,
  type DecodedObject,
} from '../../../services/remote-control/app/src/core/scene';
import type { Scene as PhoneScene } from '../../../services/remote-control/app/src/core/types';
import { toMachineCoords } from '../../core/devices';
import { compileJob } from '../../core/job';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Layer,
  type Project,
  type SceneObject,
  type Vec2,
} from '../../core/scene';
import { fillPoolParityAt, hitTestObject } from '../../core/scene/hit-test';
import { sceneLayerVisibilityLookup } from '../../core/scene/visibility';
import { createEllipse, createRectangle } from '../../core/shapes/primitives';
import { buildScene } from './scene-projection';

const INK = '#000000';
const RED = '#ff0000';
const SPACING_MM = 0.5;
const TAP_TOLERANCE_MM = 0.2;

function fillLayer(id = INK, color = INK): Layer {
  return { ...createLayer({ id, color, mode: 'fill' }), hatchSpacingMm: SPACING_MM };
}

function project(objects: ReadonlyArray<SceneObject>, layers = [fillLayer()]): Project {
  return { ...createProject(), scene: { layers, objects } };
}

function rectangle(id: string, x: number, y: number, width = 40, height = 30): SceneObject {
  return createRectangle({
    id,
    color: INK,
    spec: { widthMm: width, heightMm: height, cornerRadiusMm: 0 },
    transform: { ...IDENTITY_TRANSFORM, x, y },
  });
}

const plate = (id: string) => rectangle(id, 10, 10);

function circle(id: string, color = INK): SceneObject {
  return createEllipse({
    id,
    color,
    spec: { widthMm: 16, heightMm: 16 },
    transform: { ...IDENTITY_TRANSFORM, x: 22, y: 17 },
  });
}

const PLATE_BODY: Vec2 = { x: 14, y: 14 };
const CIRCLE_CENTRE: Vec2 = { x: 30, y: 25 };
const OUTSIDE: Vec2 = { x: 70, y: 70 };

type Projection = {
  readonly objects: NonNullable<PhoneScene['objects']>;
  readonly decoded: DecodedObject[];
};

function phone(current: Project): Projection {
  const result = buildScene(current) as unknown as PhoneScene;
  expect(result.status).toBe('ready');
  return { objects: result.objects ?? [], decoded: decodeScene(result) };
}

function evenOdd(point: Vec2, rings: ReadonlyArray<{ readonly points: ReadonlyArray<Vec2> }>) {
  let inside = false;
  for (const { points } of rings) {
    for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
      const a = points[i] as Vec2;
      const b = points[j] as Vec2;
      if (
        a.y > point.y !== b.y > point.y &&
        point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
      )
        inside = !inside;
    }
  }
  return inside;
}

/** How many filled phone paths cover the point (the phone fills translucently). */
function fillsAt(decoded: ReadonlyArray<DecodedObject>, point: Vec2, color = INK): number {
  return decoded
    .flatMap((object) => object.paths)
    .filter(
      (path) =>
        path.fill &&
        path.color === color &&
        evenOdd(
          point,
          path.rings.filter((ring) => ring.closed),
        ),
    ).length;
}

/** The topmost object the desktop hits directly (solid fill or outline), as the phone picks. */
function desktopDirectHit(current: Project, point: Vec2): string | null {
  const { scene } = current;
  const layers = sceneLayerVisibilityLookup(scene.layers);
  const pools = fillPoolParityAt(scene, layers, point);
  for (const object of [...scene.objects].reverse()) {
    if (hitTestObject(layers, object, point, pools).kind === 'primary') return object.id;
  }
  return null;
}

/** Whether a compiled hatch line burns through this scene point. */
function burnedAt(current: Project, at: Vec2): boolean {
  const machine = toMachineCoords(at, current.device);
  return compileJob(current.scene, current.device).groups.some(
    (group) =>
      group.kind === 'fill' &&
      group.segments.some((segment) => {
        const [a, b] = segment.polyline;
        if (a === undefined || b === undefined || a.y !== b.y) return false;
        return (
          Math.abs(a.y - machine.y) <= SPACING_MM / 2 &&
          Math.min(a.x, b.x) <= machine.x &&
          Math.max(a.x, b.x) >= machine.x
        );
      }),
  );
}

/** The phone fills each burned point exactly once, and nothing else; taps pick what the desktop picks. */
function expectPhoneShowsTheBurn(current: Project, points: ReadonlyArray<Vec2>): boolean[] {
  const { decoded } = phone(current);
  const fills = points.map((point) => fillsAt(decoded, point));
  const burned = points.map((point) => burnedAt(current, point));
  expect(fills).toEqual(burned.map((burns) => (burns ? 1 : 0)));
  const scene = { status: 'ready', objects: [], images: [] } as unknown as PhoneScene;
  expect(points.map((point) => phoneHitTest(decoded, scene, point, TAP_TOLERANCE_MM))).toEqual(
    points.map((point) => desktopDirectHit(current, point)),
  );
  return burned;
}

describe('a Fill operation on the phone canvas (ADR-683 Amendment 4)', () => {
  it('shows an inner circle as the hole the burn leaves, whichever is drawn first', () => {
    for (const objects of [
      [plate('plate'), circle('circle')],
      [circle('circle'), plate('plate')],
    ]) {
      expect(
        expectPhoneShowsTheBurn(project(objects), [PLATE_BODY, CIRCLE_CENTRE, OUTSIDE]),
      ).toEqual([true, false, false]);
      // A hole drawn above is picked by its outline. Drawn below, the plate's
      // part owns that edge, as the plate's own fill covered the circle before.
      const scene = { status: 'ready', objects: [], images: [] } as unknown as PhoneScene;
      const edge = { x: 30, y: 17 };
      expect(phoneHitTest(phone(project(objects)).decoded, scene, edge, TAP_TOLERANCE_MM)).toBe(
        objects.at(-1)?.id,
      );
    }
  });

  it('shows two copies as burning nothing but still outlined, and three as burning once', () => {
    const twice = project([plate('plate'), plate('copy')]);
    expect(expectPhoneShowsTheBurn(twice, [PLATE_BODY, CIRCLE_CENTRE])).toEqual([false, false]);
    const { objects } = phone(twice);
    // LightBurn shows such copies unfilled, not gone: each keeps its outline and its id.
    expect(objects.map((object) => object.id)).toEqual(['plate', 'copy']);
    for (const object of objects) {
      expect(object.paths.some((path) => !path.fill && path.polylines.some((p) => p.closed))).toBe(
        true,
      );
    }
    const edge = { x: 30, y: 10 };
    const scene = { status: 'ready', objects: [], images: [] } as unknown as PhoneScene;
    expect(phoneHitTest(phone(twice).decoded, scene, edge, TAP_TOLERANCE_MM)).toBe('copy');

    const thrice = project([plate('plate'), plate('copy'), plate('copy-2')]);
    expect(expectPhoneShowsTheBurn(thrice, [PLATE_BODY, CIRCLE_CENTRE])).toEqual([true, true]);
  });

  it('gives each of two crossing plates its own part and leaves their overlap empty', () => {
    const crossing = project([rectangle('left', 10, 10), rectangle('right', 30, 20)]);
    const leftOnly = { x: 14, y: 14 };
    const overlap = { x: 40, y: 30 };
    const rightOnly = { x: 65, y: 45 };
    expect(expectPhoneShowsTheBurn(crossing, [leftOnly, overlap, rightOnly])).toEqual([
      true,
      false,
      true,
    ]);
    const scene = { status: 'ready', objects: [], images: [] } as unknown as PhoneScene;
    const { decoded } = phone(crossing);
    expect(phoneHitTest(decoded, scene, leftOnly, TAP_TOLERANCE_MM)).toBe('left');
    expect(phoneHitTest(decoded, scene, rightOnly, TAP_TOLERANCE_MM)).toBe('right');
  });

  it('keeps separate Fill operations apart, as the burn does', () => {
    const apart = project(
      [plate('plate'), circle('circle', RED)],
      [fillLayer(), fillLayer(RED, RED)],
    );
    const { decoded } = phone(apart);
    expect(fillsAt(decoded, CIRCLE_CENTRE, INK)).toBe(1);
    expect(fillsAt(decoded, CIRCLE_CENTRE, RED)).toBe(1);
    expect(fillsAt(decoded, PLATE_BODY, INK)).toBe(1);
  });

  it('leaves parts that overlap nothing on their operation as they were sent before', () => {
    const apart = project([plate('left'), rectangle('right', 80, 10, 20, 20)]);
    const { objects } = phone(apart);
    expect(objects.map((object) => object.paths.map((path) => path.fill))).toEqual([
      [true],
      [true],
    ]);
    expect(expectPhoneShowsTheBurn(apart, [PLATE_BODY, { x: 90, y: 20 }])).toEqual([true, true]);
  });

  it('keeps the projection contract: every path is a colour, flags and encoded rings', () => {
    const { objects } = phone(project([circle('circle'), plate('plate'), plate('copy')]));
    for (const object of objects) {
      expect(Object.keys(object).sort()).toEqual(
        ['bounds', 'editable', 'id', 'kind', 'operationId', 'paths', 'unitId'].sort(),
      );
      for (const path of object.paths) {
        expect(Object.keys(path).sort()).toEqual(['color', 'fill', 'output', 'polylines']);
        expect(path.color).toMatch(/^#[0-9a-f]{6}$/);
        for (const polyline of path.polylines) {
          expect(Object.keys(polyline).sort()).toEqual(['closed', 'points']);
          expect(polyline.points).toMatch(/^-?\d+,-?\d+( -?\d+,-?\d+)*$/);
        }
      }
    }
  });
});
