// Switches the G-code scene between Classic and Studio (ADR-426). Studio adds
// a soft gradient background, image-based lighting for the tool model, tone
// mapping, its own furniture and labels; Classic is the scene as it always
// was. Everything Studio creates is built on first use and kept until the
// view closes, so switching back and forth costs nothing after the first.

import type * as ThreeNamespace from 'three';
import type { Camera, Group, Object3D, Scene, Texture, WebGLRenderer } from 'three';
import type * as CSS2DModule from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { AxisBounds } from '../../core/gcode-view';
import { disposeChildren } from './scene-furniture';
import { buildStudioFurniture } from './studio-furniture';
import { buildStudioTool } from './studio-tool-models';
import { prefilteredRoomEnvironment } from './viewer3d-environment';
import {
  CLASSIC_STAGE,
  type StudioToolSpec,
  type Viewer3dLook,
  type Viewer3dStage,
} from './viewer3d-look';

type ThreeModule = typeof ThreeNamespace;

export type StudioModules = {
  readonly three: ThreeModule;
  readonly CSS2DRenderer: typeof CSS2DModule.CSS2DRenderer;
  readonly CSS2DObject: typeof CSS2DModule.CSS2DObject;
};

export type StudioStage = {
  readonly look: () => Viewer3dLook;
  /** Applies a look and dresses the job for it. */
  readonly setStage: (stage: Viewer3dStage, bounds: AxisBounds | null) => void;
  /** Moves the Studio tool to the playhead, or hides it. */
  readonly placeTool: (
    point: { readonly x: number; readonly y: number; readonly z: number } | null,
  ) => void;
  /** Whether Studio draws its own tool, so the Classic marker stays hidden. */
  readonly drawsTool: () => boolean;
  readonly renderLabels: (camera: Camera) => void;
  readonly resize: (width: number, height: number) => void;
  readonly dispose: () => void;
};

const ENVIRONMENT_BLUR = 0.04;
const ENVIRONMENT_INTENSITY = 0.7;
const SUN_DIRECTION = [-0.45, -0.62, 0.9] as const;

export function createStudioStage(
  modules: StudioModules,
  deps: {
    readonly renderer: WebGLRenderer;
    readonly scene: Scene;
    readonly canvas: HTMLCanvasElement;
    readonly classicObjects: ReadonlyArray<Object3D>;
  },
): StudioStage {
  const { three } = modules;
  const { renderer, scene } = deps;
  const root = new three.Group();
  root.visible = false;
  scene.add(root);
  const dress = createFurnitureDresser(modules, root);
  const tool = createToolSlot(three, root);
  let stage: Viewer3dStage = CLASSIC_STAGE;
  let lighting: StudioLighting | null = null;
  let labels: InstanceType<StudioModules['CSS2DRenderer']> | null = null;
  const studio = (): boolean => stage.look === 'studio';

  return {
    look: () => stage.look,
    setStage: (next, bounds) => {
      stage = next;
      const on = studio();
      for (const object of deps.classicObjects) object.visible = !on;
      root.visible = on;
      if (on) {
        lighting ??= createStudioLighting(three, renderer, root);
        labels ??= createLabelLayer(modules, deps.canvas);
        dress(stage, bounds);
        tool.swap(stage.tool);
      }
      applyRendererLook(three, renderer, scene, on ? lighting : null);
      if (labels !== null) labels.domElement.hidden = !on;
    },
    placeTool: tool.place,
    drawsTool: () => studio() && tool.present(),
    renderLabels: (camera) => {
      if (studio() && labels !== null) labels.render(scene, camera);
    },
    resize: (width, height) => labels?.setSize(width, height),
    dispose: () => {
      disposeChildren(root);
      scene.remove(root);
      lighting?.environment.dispose();
      lighting?.background.dispose();
      labels?.domElement.remove();
    },
  };
}

// Rebuilds the floor, work area and job box only when one of them changed.
function createFurnitureDresser(
  modules: StudioModules,
  root: Group,
): (stage: Viewer3dStage, bounds: AxisBounds | null) => void {
  const furniture = new modules.three.Group();
  root.add(furniture);
  let dressedFor: { readonly stage: Viewer3dStage; readonly bounds: AxisBounds | null } | null =
    null;
  return (stage, bounds) => {
    if (
      dressedFor !== null &&
      sameBox(dressedFor.stage.jobBox, stage.jobBox) &&
      sameBox(dressedFor.stage.workArea, stage.workArea) &&
      sameBox(dressedFor.bounds, bounds)
    ) {
      return;
    }
    disposeChildren(furniture);
    furniture.add(
      buildStudioFurniture(modules.three, modules.CSS2DObject, {
        jobBox: stage.jobBox,
        workArea: stage.workArea,
        bounds,
      }),
    );
    dressedFor = { stage, bounds };
  };
}

// The tool model at the playhead, rebuilt only when the tool changes.
function createToolSlot(
  three: ThreeModule,
  root: Group,
): {
  readonly swap: (spec: StudioToolSpec) => void;
  readonly place: StudioStage['placeTool'];
  readonly present: () => boolean;
} {
  let tool: Group | null = null;
  let toolKey: string | null = null;
  return {
    swap: (spec) => {
      const key = studioToolKey(spec);
      if (toolKey === key) return;
      if (tool !== null) {
        disposeChildren(tool);
        root.remove(tool);
      }
      tool = buildStudioTool(three, spec);
      toolKey = key;
      if (tool !== null) {
        tool.visible = false;
        root.add(tool);
      }
    },
    place: (point) => {
      if (tool === null) return;
      tool.visible = point !== null;
      if (point !== null) tool.position.set(point.x, point.y, point.z);
    },
    present: () => tool !== null,
  };
}

type Box = Readonly<Record<string, number>>;

// Value equality: the stage is rebuilt by React on every commit, so identity
// alone would rebuild the furniture each frame of playback.
function sameBox(left: Box | null, right: Box | null): boolean {
  if (left === null || right === null) return left === right;
  return Object.keys(left).every((key) => left[key] === right[key]);
}

function studioToolKey(tool: StudioToolSpec): string {
  if (tool.kind !== 'bit') return tool.kind;
  const profile = tool.profile.map((point) => `${point.radiusMm},${point.heightMm}`).join(' ');
  return `bit ${tool.shankDiameterMm} ${profile}`;
}

type StudioLighting = {
  readonly environment: Texture;
  readonly background: Texture;
};

// Hemisphere fill, a warm key from the front left and a cool rim from behind,
// plus the prefiltered environment the metal reflects.
function createStudioLighting(
  three: ThreeModule,
  renderer: WebGLRenderer,
  root: Group,
): StudioLighting {
  const hemisphere = new three.HemisphereLight(0xe2e8f0, 0x34302c, 0.55);
  hemisphere.position.set(0, 0, 1);
  const key = new three.DirectionalLight(0xfff6ec, 2.3);
  key.position.set(...SUN_DIRECTION);
  const rim = new three.DirectionalLight(0xa9c2ff, 0.5);
  rim.position.set(0.6, 0.9, 0.4);
  root.add(hemisphere, key, rim);
  return {
    environment: prefilteredRoomEnvironment(three, renderer, ENVIRONMENT_BLUR),
    background: gradientBackground(three),
  };
}

function applyRendererLook(
  three: ThreeModule,
  renderer: WebGLRenderer,
  scene: Scene,
  lighting: StudioLighting | null,
): void {
  scene.background = lighting?.background ?? null;
  scene.environment = lighting?.environment ?? null;
  scene.environmentIntensity = ENVIRONMENT_INTENSITY;
  // Only the lit tool model is tone mapped: every line and label material is
  // created with toneMapped false, so their colours stay exact (ADR-426).
  renderer.toneMapping = lighting === null ? three.NoToneMapping : three.NeutralToneMapping;
}

function gradientBackground(three: ThreeModule): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext('2d');
  if (context !== null) {
    const gradient = context.createRadialGradient(256, 190, 20, 256, 256, 420);
    /* eslint-disable no-restricted-syntax -- Studio's scene backdrop is a
       fixed dark studio sweep in every app theme; not UI chrome. */
    gradient.addColorStop(0, '#343a43');
    gradient.addColorStop(0.55, '#1f2329');
    gradient.addColorStop(1, '#0d0f12');
    /* eslint-enable no-restricted-syntax */
    context.fillStyle = gradient;
    context.fillRect(0, 0, 512, 512);
  }
  const texture = new three.CanvasTexture(canvas);
  texture.colorSpace = three.SRGBColorSpace;
  return texture;
}

// Size labels and axis letters are DOM text laid over the canvas, so they
// stay crisp at any zoom and fade with the rest of the overlays.
function createLabelLayer(
  modules: StudioModules,
  canvas: HTMLCanvasElement,
): InstanceType<StudioModules['CSS2DRenderer']> {
  const labels = new modules.CSS2DRenderer();
  labels.domElement.className = 'viewer3d-label-layer';
  labels.setSize(canvas.clientWidth, canvas.clientHeight);
  canvas.parentElement?.appendChild(labels.domElement);
  return labels;
}
