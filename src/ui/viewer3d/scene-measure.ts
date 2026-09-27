// The measure overlay (ADR-470): a dot on each chosen point, a line between
// them and the distance at its middle. It draws over everything in the same
// cyan-in-a-dark-casing as the hover outline, which is the view's colour for
// what the operator is pointing at, and it is never clipped: a measurement
// stays whole when the Z range or a section hides part of the job.

import type * as ThreeNamespace from 'three';
import type { Camera } from 'three';
import type { Point3 } from './scene-parts';
import { cssHexColor } from './segment-buckets';
import type { ThreeModules } from './viewer3d-modules';

export type Viewer3dMeasure = {
  readonly from: Point3;
  /** Null while the second point is still to be chosen. */
  readonly to: Point3 | null;
};

export type MeasureOverlay = {
  readonly set: (measure: Viewer3dMeasure | null) => void;
  readonly renderLabel: (camera: Camera) => void;
  readonly resize: (width: number, height: number) => void;
  readonly dispose: () => void;
};

const CORE = 0x38e1ff;
const CASING = 0x0d0f12;
const CORE_PX = 2.5;
const CASING_PX = 6;
const DOT_PX = 13;
const RENDER_ORDER = 8;

export function createMeasureOverlay(
  modules: ThreeModules,
  deps: {
    readonly scene: ThreeNamespace.Scene;
    readonly canvas: HTMLCanvasElement;
    readonly width: number;
    readonly height: number;
  },
): MeasureOverlay {
  const { three } = modules;
  const group = new three.Group();
  group.visible = false;
  deps.scene.add(group);
  const line = createMeasureLine(modules, group, deps);
  const dots = createDots(three, group);
  const label = createLabel(modules, deps);
  return {
    set: (measure) => {
      group.visible = measure !== null;
      label.show(measure);
      if (measure === null) return;
      dots.place(measure);
      line.place(measure);
    },
    renderLabel: label.render,
    resize: (width, height) => {
      line.resize(width, height);
      label.resize(width, height);
    },
    dispose: () => {
      deps.scene.remove(group);
      line.dispose();
      dots.dispose();
      label.dispose();
    },
  };
}

function createMeasureLine(
  modules: ThreeModules,
  group: ThreeNamespace.Group,
  size: { readonly width: number; readonly height: number },
) {
  const geometry = new modules.LineSegmentsGeometry();
  geometry.setPositions(new Float32Array(6));
  const materials = [
    { color: CASING, linewidth: CASING_PX, opacity: 0.85 },
    { color: CORE, linewidth: CORE_PX, opacity: 1 },
  ].map((stroke, order) => {
    const material = new modules.LineMaterial({
      ...stroke,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });
    material.toneMapped = false;
    material.resolution.set(size.width, size.height);
    const stroked = new modules.LineSegments2(geometry, material);
    stroked.renderOrder = RENDER_ORDER + order;
    group.add(stroked);
    return { stroked, material };
  });
  return {
    place: (measure: Viewer3dMeasure): void => {
      for (const { stroked } of materials) stroked.visible = measure.to !== null;
      if (measure.to === null) return;
      const { from, to } = measure;
      geometry.setPositions([from.x, from.y, from.z, to.x, to.y, to.z]);
    },
    resize: (width: number, height: number): void => {
      for (const { material } of materials) material.resolution.set(width, height);
    },
    dispose: (): void => {
      geometry.dispose();
      for (const { material } of materials) material.dispose();
    },
  };
}

// Round dots of a fixed screen size: a cyan disc in a dark ring.
function createDots(three: typeof ThreeNamespace, group: ThreeNamespace.Group) {
  const positions = new Float32Array(6);
  const geometry = new three.BufferGeometry();
  geometry.setAttribute('position', new three.BufferAttribute(positions, 3));
  const map = dotTexture(three);
  const material = new three.PointsMaterial({
    size: DOT_PX,
    sizeAttenuation: false,
    map,
    color: map === null ? CORE : 0xffffff,
    transparent: true,
    alphaTest: 0.2,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const points = new three.Points(geometry, material);
  points.renderOrder = RENDER_ORDER + 2;
  points.frustumCulled = false;
  group.add(points);
  return {
    place: (measure: Viewer3dMeasure): void => {
      const { from } = measure;
      const to = measure.to ?? from;
      positions.set([from.x, from.y, from.z, to.x, to.y, to.z]);
      geometry.getAttribute('position').needsUpdate = true;
      geometry.setDrawRange(0, measure.to === null ? 1 : 2);
    },
    dispose: (): void => {
      geometry.dispose();
      material.dispose();
      map?.dispose();
    },
  };
}

function dotTexture(three: typeof ThreeNamespace): ThreeNamespace.CanvasTexture | null {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const context = canvas.getContext('2d');
  if (context === null) return null;
  const disc = (radius: number, colour: string): void => {
    context.beginPath();
    context.arc(16, 16, radius, 0, Math.PI * 2);
    context.fillStyle = colour;
    context.fill();
  };
  disc(15, cssHexColor(CASING));
  disc(10, cssHexColor(CORE));
  const texture = new three.CanvasTexture(canvas);
  texture.colorSpace = three.SRGBColorSpace;
  return texture;
}

// The distance, as DOM text over the line's middle. It has its own label
// layer so it shows in both looks (Studio's layer draws only in Studio).
function createLabel(modules: ThreeModules, deps: Parameters<typeof createMeasureOverlay>[1]) {
  const scene = new modules.three.Scene();
  const element = document.createElement('div');
  element.className = 'viewer3d-measure-label';
  const label = new modules.CSS2DObject(element);
  label.visible = false;
  scene.add(label);
  let layer: InstanceType<ThreeModules['CSS2DRenderer']> | null = null;
  let size = { width: deps.width, height: deps.height };
  return {
    show: (measure: Viewer3dMeasure | null): void => {
      label.visible = measure?.to != null;
      if (measure === null || measure.to === null) return;
      const { from, to } = measure;
      label.position.set((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2);
      element.textContent = `${Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z).toFixed(2)} mm`;
      if (layer === null) {
        layer = new modules.CSS2DRenderer();
        layer.domElement.className = 'viewer3d-label-layer';
        layer.setSize(size.width, size.height);
        deps.canvas.parentElement?.appendChild(layer.domElement);
      }
    },
    render: (camera: Camera): void => {
      if (layer !== null) layer.render(scene, camera);
    },
    resize: (width: number, height: number): void => {
      size = { width, height };
      layer?.setSize(width, height);
    },
    dispose: (): void => {
      scene.remove(label);
      element.remove();
      layer?.domElement.remove();
    },
  };
}
