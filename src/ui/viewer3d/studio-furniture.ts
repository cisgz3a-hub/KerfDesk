// Studio furniture (ADR-426): a floor grid that fades out under the job, the
// job box with its sizes, the machine's work area when its frame is known,
// and a labelled axis triad at the work origin. Classic keeps its own grid
// and triad (scene-furniture.ts) untouched.

import type * as ThreeNamespace from 'three';
import type { Group, Object3D } from 'three';
import type * as CSS2DModule from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { AxisBounds } from '../../core/gcode-view';
import { boundsExtent } from './camera-presets';
import type { Viewer3dRect } from './viewer3d-look';

type ThreeModule = typeof ThreeNamespace;
type CSS2DObjectCtor = typeof CSS2DModule.CSS2DObject;

export type StudioFurnitureInput = {
  readonly jobBox: AxisBounds | null;
  readonly workArea: Viewer3dRect | null;
  /** Where the grid and triad centre when there is no job box. */
  readonly bounds: AxisBounds | null;
};

const DIMENSION_COLOR = 0xc9ced6;
const BOX_EDGE_COLOR = 0xd9dde3;
const WORK_AREA_COLOR = 0x8f99a6;
// X keeps the CAD red, muted: a bright saturated red is reserved for the live
// machine marker (scene-markers.ts).
const AXIS_COLORS = { x: 0xd9776f, y: 0x71d08f, z: 0x6fa9f2 } as const;
// A job thinner than this draws as an outline, not a box.
const FLAT_JOB_MM = 0.01;
const FLOOR_GAP_MM = 0.05;

export function buildStudioFurniture(
  three: ThreeModule,
  CSS2DObject: CSS2DObjectCtor,
  input: StudioFurnitureInput,
): Group {
  const group = new three.Group();
  const { extent, floorZ, centre } = floorFrame(input.jobBox ?? input.bounds);
  group.add(floorGrid(three, centre, floorZ, extent * 1.6));
  if (input.workArea !== null)
    group.add(workAreaOutline(three, input.workArea, floorZ + FLOOR_GAP_MM / 2));
  if (input.jobBox !== null) {
    group.add(jobBoxObject(three, input.jobBox));
    group.add(dimensions(three, CSS2DObject, input.jobBox));
  }
  group.add(axisTriad(three, CSS2DObject, Math.max(10, extent * 0.11)));
  return group;
}

// The floor sits just under the job (or under Z0 when the job is above it),
// centred on the job, and fades out a little beyond its extent.
function floorFrame(frame: AxisBounds | null): {
  readonly extent: number;
  readonly floorZ: number;
  readonly centre: { readonly x: number; readonly y: number };
} {
  if (frame === null)
    return { extent: boundsExtent(null), floorZ: -FLOOR_GAP_MM, centre: { x: 0, y: 0 } };
  return {
    extent: boundsExtent(frame),
    floorZ: Math.min(0, frame.minZ) - FLOOR_GAP_MM,
    centre: { x: (frame.minX + frame.maxX) / 2, y: (frame.minY + frame.maxY) / 2 },
  };
}

// A shader grid on the floor plane: 10 mm and 50 mm lines that fade with
// distance from the job, with the X and Y axes tinted from the origin out.
function floorGrid(
  three: ThreeModule,
  centre: { readonly x: number; readonly y: number },
  z: number,
  fadeMm: number,
): Object3D {
  const material = new three.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uCentre: { value: new three.Vector2(centre.x, centre.y) },
      uFade: { value: fadeMm },
    },
    vertexShader: FLOOR_VERTEX,
    fragmentShader: FLOOR_FRAGMENT,
  });
  const mesh = new three.Mesh(new three.PlaneGeometry(fadeMm * 2.4, fadeMm * 2.4), material);
  mesh.position.set(centre.x, centre.y, z);
  mesh.renderOrder = -1;
  return mesh;
}

const FLOOR_VERTEX = `
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

const FLOOR_FRAGMENT = `
varying vec3 vWorld;
uniform vec2 uCentre;
uniform float uFade;
float gridLine(vec2 p, float spacing, float width) {
  vec2 q = p / spacing;
  vec2 d = fwidth(q);
  vec2 g = abs(fract(q - 0.5) - 0.5) / max(d, 1e-5);
  return 1.0 - min(min(g.x, g.y) / width, 1.0);
}
void main() {
  float minor = gridLine(vWorld.xy, 10.0, 1.0);
  float major = gridLine(vWorld.xy, 50.0, 1.3);
  float fade = 1.0 - smoothstep(uFade * 0.3, uFade, length(vWorld.xy - uCentre));
  vec3 colour = mix(vec3(0.075), vec3(0.16), major);
  float alpha = max(minor * 0.45, major * 0.8) * fade;
  float onX = (1.0 - min(abs(vWorld.y) / max(fwidth(vWorld.y), 1e-5) / 1.5, 1.0)) * step(0.0, vWorld.x);
  float onY = (1.0 - min(abs(vWorld.x) / max(fwidth(vWorld.x), 1e-5) / 1.5, 1.0)) * step(0.0, vWorld.y);
  colour = mix(colour, vec3(0.55, 0.16, 0.14), onX * fade);
  colour = mix(colour, vec3(0.16, 0.45, 0.2), onY * fade);
  alpha = max(alpha, max(onX, onY) * 0.7 * fade);
  gl_FragColor = vec4(colour, alpha);
  #include <colorspace_fragment>
}`;

function workAreaOutline(three: ThreeModule, area: Viewer3dRect, z: number): Object3D {
  const points = rectanglePoints(area, z);
  const outline = thinLines(three, points, WORK_AREA_COLOR, 0.55);
  const fill = new three.Mesh(
    new three.PlaneGeometry(area.maxX - area.minX, area.maxY - area.minY),
    new three.MeshBasicMaterial({
      color: WORK_AREA_COLOR,
      transparent: true,
      opacity: 0.05,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  fill.position.set((area.minX + area.maxX) / 2, (area.minY + area.maxY) / 2, z);
  fill.renderOrder = -1;
  const group = new three.Group();
  group.add(fill, outline);
  return group;
}

function jobBoxObject(three: ThreeModule, box: AxisBounds): Object3D {
  const thickness = box.maxZ - box.minZ;
  if (thickness < FLAT_JOB_MM) {
    return thinLines(three, rectanglePoints(box, box.maxZ), BOX_EDGE_COLOR, 0.4);
  }
  const width = box.maxX - box.minX;
  const depth = box.maxY - box.minY;
  const geometry = new three.BoxGeometry(width, depth, thickness);
  const ghost = new three.Mesh(
    geometry,
    new three.MeshBasicMaterial({
      color: 0x8f99a6,
      transparent: true,
      opacity: 0.07,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  const edges = new three.LineSegments(
    new three.EdgesGeometry(geometry),
    new three.LineBasicMaterial({
      color: BOX_EDGE_COLOR,
      transparent: true,
      opacity: 0.28,
      toneMapped: false,
    }),
  );
  const group = new three.Group();
  group.add(ghost, edges);
  group.position.set(
    (box.minX + box.maxX) / 2,
    (box.minY + box.maxY) / 2,
    (box.minZ + box.maxZ) / 2,
  );
  return group;
}

// CAD-style dimension lines along the front and right edges and up the
// front-right corner, each with its size as a label.
function dimensions(three: ThreeModule, CSS2DObject: CSS2DObjectCtor, box: AxisBounds): Object3D {
  const width = box.maxX - box.minX;
  const depth = box.maxY - box.minY;
  const thickness = box.maxZ - box.minZ;
  const extent = Math.max(width, depth, 10);
  const offset = extent * 0.075;
  const tick = extent * 0.012;
  const z = box.minZ;
  const frontY = box.minY - offset;
  const rightX = box.maxX + offset;
  const points: number[] = [];
  const line = (a: readonly number[], b: readonly number[]): void => {
    points.push(...a, ...b);
  };
  line([box.minX, box.minY - tick, z], [box.minX, frontY - tick, z]);
  line([box.maxX, box.minY - tick, z], [box.maxX, frontY - tick, z]);
  line([box.minX, frontY, z], [box.maxX, frontY, z]);
  arrowHeads(line, [box.minX, frontY, z], [box.maxX, frontY, z], tick);
  line([box.maxX + tick, box.minY, z], [rightX + tick, box.minY, z]);
  line([box.maxX + tick, box.maxY, z], [rightX + tick, box.maxY, z]);
  line([rightX, box.minY, z], [rightX, box.maxY, z]);
  arrowHeads(line, [rightX, box.minY, z], [rightX, box.maxY, z], tick);
  const group = new three.Group();
  group.add(thinLines(three, points, DIMENSION_COLOR, 0.7));
  group.add(
    label(CSS2DObject, `${formatMm(width)} mm`, 'viewer3d-dim-label', [
      (box.minX + box.maxX) / 2,
      frontY,
      z,
    ]),
  );
  group.add(
    label(CSS2DObject, `${formatMm(depth)} mm`, 'viewer3d-dim-label', [
      rightX,
      (box.minY + box.maxY) / 2,
      z,
    ]),
  );
  if (thickness >= FLAT_JOB_MM) {
    const cornerX = box.maxX + offset * 0.55;
    const cornerY = box.minY - offset * 0.55;
    const riser: number[] = [];
    riser.push(cornerX, cornerY, box.minZ, cornerX, cornerY, box.maxZ);
    group.add(thinLines(three, riser, DIMENSION_COLOR, 0.7));
    group.add(
      label(CSS2DObject, `${formatMm(thickness)} mm`, 'viewer3d-dim-label', [
        cornerX,
        cornerY,
        (box.minZ + box.maxZ) / 2,
      ]),
    );
  }
  return group;
}

function arrowHeads(
  line: (a: readonly number[], b: readonly number[]) => void,
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  tick: number,
): void {
  const alongX = Math.abs(to[0] - from[0]) >= Math.abs(to[1] - from[1]);
  const [ax, ay, az] = from;
  const [bx, by, bz] = to;
  if (alongX) {
    line([ax, ay, az], [ax + tick * 1.6, ay + tick * 0.7, az]);
    line([ax, ay, az], [ax + tick * 1.6, ay - tick * 0.7, az]);
    line([bx, by, bz], [bx - tick * 1.6, by + tick * 0.7, bz]);
    line([bx, by, bz], [bx - tick * 1.6, by - tick * 0.7, bz]);
    return;
  }
  line([ax, ay, az], [ax + tick * 0.7, ay + tick * 1.6, az]);
  line([ax, ay, az], [ax - tick * 0.7, ay + tick * 1.6, az]);
  line([bx, by, bz], [bx + tick * 0.7, by - tick * 1.6, bz]);
  line([bx, by, bz], [bx - tick * 0.7, by - tick * 1.6, bz]);
}

// X, Y and Z arrows at the work origin, drawn over everything so the origin
// is never hidden inside the job.
function axisTriad(three: ThreeModule, CSS2DObject: CSS2DObjectCtor, length: number): Object3D {
  const group = new three.Group();
  const yAxis = new three.Vector3(0, 1, 0);
  for (const [name, direction] of [
    ['x', new three.Vector3(1, 0, 0)],
    ['y', new three.Vector3(0, 1, 0)],
    ['z', new three.Vector3(0, 0, 1)],
  ] as const) {
    const material = new three.MeshBasicMaterial({
      color: AXIS_COLORS[name],
      depthTest: false,
      toneMapped: false,
    });
    const turn = new three.Quaternion().setFromUnitVectors(yAxis, direction);
    const shaft = new three.Mesh(
      new three.CylinderGeometry(length * 0.022, length * 0.022, length * 0.8, 12),
      material,
    );
    const head = new three.Mesh(
      new three.ConeGeometry(length * 0.075, length * 0.22, 20),
      material,
    );
    shaft.quaternion.copy(turn);
    head.quaternion.copy(turn);
    shaft.position.copy(direction).multiplyScalar(length * 0.4);
    head.position.copy(direction).multiplyScalar(length * 0.89);
    shaft.renderOrder = 10;
    head.renderOrder = 10;
    const tip = direction.clone().multiplyScalar(length * 1.18);
    group.add(
      shaft,
      head,
      label(CSS2DObject, name.toUpperCase(), `viewer3d-axis-label viewer3d-axis-label-${name}`, [
        tip.x,
        tip.y,
        tip.z,
      ]),
    );
  }
  const dot = new three.Mesh(
    new three.SphereGeometry(length * 0.05, 16, 12),
    new three.MeshBasicMaterial({ color: 0xe8e4de, depthTest: false, toneMapped: false }),
  );
  dot.renderOrder = 10;
  group.add(dot);
  return group;
}

function thinLines(
  three: ThreeModule,
  points: ReadonlyArray<number>,
  color: number,
  opacity: number,
): Object3D {
  const geometry = new three.BufferGeometry();
  geometry.setAttribute('position', new three.Float32BufferAttribute(points, 3));
  return new three.LineSegments(
    geometry,
    new three.LineBasicMaterial({ color, transparent: true, opacity, toneMapped: false }),
  );
}

function rectanglePoints(rect: Viewer3dRect, z: number): ReadonlyArray<number> {
  const { minX, maxX, minY, maxY } = rect;
  return [
    minX,
    minY,
    z,
    maxX,
    minY,
    z,
    maxX,
    minY,
    z,
    maxX,
    maxY,
    z,
    maxX,
    maxY,
    z,
    minX,
    maxY,
    z,
    minX,
    maxY,
    z,
    minX,
    minY,
    z,
  ];
}

function label(
  CSS2DObject: CSS2DObjectCtor,
  text: string,
  className: string,
  at: readonly [number, number, number],
): Object3D {
  const element = document.createElement('div');
  element.className = className;
  element.textContent = text;
  const object = new CSS2DObject(element);
  object.position.set(at[0], at[1], at[2]);
  return object;
}

function formatMm(value: number): string {
  return String(Math.round(value * 10) / 10);
}
