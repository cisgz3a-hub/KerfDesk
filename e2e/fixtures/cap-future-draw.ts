import * as three from 'three';
import type { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import type { Point3, UploadedProjection, Viewport } from './cap-future-admission';

export type Role = 'completed' | 'ghost' | 'core' | 'casing';

export interface DrawReceipt extends UploadedProjection {
  readonly role: Role;
  readonly name: string;
  readonly originalFirst: boolean;
  readonly linewidthCSS: number;
  readonly materialWidthCSS: number;
  readonly resolution: readonly number[];
  readonly instanceCount: number;
  readonly positionStorageFloat32: boolean;
  readonly instances: readonly {
    readonly index: number;
    readonly start: Point3;
    readonly end: Point3;
  }[];
  readonly shaderKey: string;
  readonly depthWrite: boolean;
  readonly transparent: boolean;
  readonly alphaToCoverage: boolean;
  readonly ghostTail: {
    readonly enabled: number;
    readonly index: number;
    readonly point: Point3;
    readonly coreWidthCSS: number;
    readonly viewport: readonly number[];
    readonly scale: readonly number[];
  } | null;
}

/** Capture the program that just drew; a CPU matrix reconstruction is not the receipt. */
export function captureDraw(
  renderer: three.WebGLRenderer,
  stroke: LineSegments2,
  role: Role,
  originalFirst: boolean,
): DrawReceipt {
  const gl = renderer.getContext();
  const program = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null;
  if (program === null) throw new Error('No current program after the witnessed draw');
  const uniform = (name: string): unknown => {
    const location = gl.getUniformLocation(program, name);
    if (location === null) throw new Error('Witness program has no uniform: ' + name);
    return gl.getUniform(program, location) as unknown;
  };
  const numbers = (name: string, count: number): number[] => {
    const value = uniform(name);
    if (!(value instanceof Float32Array) || value.length !== count)
      throw new Error('Expected uploaded Float32 uniform: ' + name);
    return [...value];
  };
  const number = (name: string): number => {
    const value = uniform(name);
    if (typeof value !== 'number' || !Number.isFinite(value))
      throw new Error('Expected finite scalar uniform: ' + name);
    return value;
  };
  const start = stroke.geometry.getAttribute('instanceStart');
  const end = stroke.geometry.getAttribute('instanceEnd');
  const point = (attribute: typeof start, index: number): Point3 => [
    attribute.getX(index),
    attribute.getY(index),
    attribute.getZ(index),
  ];
  const viewport = (value: three.Vector4): Viewport => [value.x, value.y, value.z, value.w];
  const physical = viewport(renderer.getCurrentViewport(new three.Vector4()));
  const logical = viewport(renderer.getViewport(new three.Vector4()));
  const uploadedPoint = (name: string): Point3 => {
    const [x, y, z] = numbers(name, 3);
    if (x === undefined || y === undefined || z === undefined)
      throw new Error('Missing uploaded Float32 point: ' + name);
    return [x, y, z];
  };
  const instances = Array.from({ length: Math.min(start.count, 2) }, (_, index) => ({
    index,
    start: point(start, index),
    end: point(end, index),
  }));
  return {
    role,
    name: stroke.name,
    originalFirst,
    modelViewMatrix: numbers('modelViewMatrix', 16),
    projectionMatrix: numbers('projectionMatrix', 16),
    physicalViewport: physical,
    logicalViewport: logical,
    framebuffer: [renderer.domElement.width, renderer.domElement.height],
    linewidthCSS: number('linewidth'),
    materialWidthCSS: stroke.material.linewidth,
    resolution: numbers('resolution', 2),
    instanceCount: stroke.geometry.instanceCount,
    positionStorageFloat32:
      start.array instanceof Float32Array && end.array instanceof Float32Array,
    instances,
    shaderKey: stroke.material.customProgramCacheKey(),
    depthWrite: stroke.material.depthWrite,
    transparent: stroke.material.transparent,
    alphaToCoverage: stroke.material.alphaToCoverage,
    ghostTail:
      role === 'ghost'
        ? {
            enabled: number('kerfdeskGhostTailEnabled'),
            index: number('kerfdeskGhostActiveIndex'),
            point: uploadedPoint('kerfdeskGhostActivePoint'),
            coreWidthCSS: number('kerfdeskGhostCoreWidthCSS'),
            viewport: numbers('kerfdeskGhostViewport', 4),
            scale: numbers('kerfdeskGhostCoreScale', 2),
          }
        : null,
  };
}

export function watchDraw(
  renderer: three.WebGLRenderer,
  stroke: LineSegments2,
  role: Role,
  originalFirst: boolean,
  receipts: DrawReceipt[],
): void {
  const previous = stroke.onAfterRender;
  stroke.onAfterRender = (drawRenderer, scene, camera, geometry, material, group) => {
    previous.call(stroke, drawRenderer, scene, camera, geometry, material, group);
    receipts.push(captureDraw(renderer, stroke, role, originalFirst));
  };
}

/** Reject coordinates outside the real buffer; do not clamp or search for a neighbour. */
export function readFixedPixel(renderer: three.WebGLRenderer, pixel: readonly [number, number]) {
  const [x, y] = pixel;
  const { width, height } = renderer.domElement;
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= width || y >= height)
    throw new Error(
      'Fixed pixel outside the framebuffer: ' + JSON.stringify({ pixel, width, height }),
    );
  const gl = renderer.getContext();
  const rgba = new Uint8Array(4);
  gl.readPixels(x, height - 1 - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
  return [...rgba];
}
