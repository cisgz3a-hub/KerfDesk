import * as three from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { buildGcodeRenderModel } from '../../src/core/gcode-view';
import { disposeChildren } from '../../src/ui/viewer3d/scene-furniture';
import {
  applyRecolor,
  applyReveal,
  buildToolpathObjects,
} from '../../src/ui/viewer3d/scene-toolpath';
import { applyTravelLook } from '../../src/ui/viewer3d/scene-travel-look';
import { srgbToLinear } from '../../src/ui/viewer3d/viewer3d-look';
import { resolveViewer3dTheme } from '../../src/ui/viewer3d/viewer3d-theme';
import { fixedWitnessPixels, roundStrokeCoverage } from './cap-future-admission';
import { readFixedPixel, watchDraw, type DrawReceipt } from './cap-future-draw';

export interface CapFutureOptions {
  readonly kind: 'cap' | 'future';
  readonly look: 'classic' | 'studio';
  readonly dpr: 1 | 2;
  readonly mode: 'candidate' | 'source-order';
}

const INPUT = 'G21 G90\nM3 S500\nG1 X100 Z-10 F600\nG1 X0 Z0\nM5\nG0 Z1';
const POINT = { x: 50, y: 0, z: -5 };

/** The exact production factory; only the reference routing is explicitly selected. */
export function capFutureFrame(options: CapFutureOptions) {
  const parsed = buildGcodeRenderModel(INPUT, {
    machineKind: 'laser',
    retainPreciseSegmentLengths: true,
  });
  if (parsed.kind !== 'ok') throw new Error(parsed.reason);
  const renderer = new three.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.localClippingEnabled = true;
  renderer.setPixelRatio(options.dpr);
  renderer.setSize(800, 600, false);
  const theme = resolveViewer3dTheme();
  renderer.setClearColor(theme.background);
  const scene = new three.Scene();
  const built = buildToolpathObjects({
    three,
    LineMaterial,
    LineSegments2,
    LineSegmentsGeometry,
    segments: parsed.model,
    theme,
    viewWidth: 800,
    viewHeight: 600,
    travelVisible: false,
  });
  scene.add(...built.objects);
  try {
    applyTravelLook(three, built.travelLine, options.look, theme, 100);
    // Match the recorded witness: repaint EVERY shown entry, including the future retract.
    applyRecolor(
      built.reveal,
      () => [79 / 255, 163 / 255, 1],
      options.look === 'studio' ? srgbToLinear : undefined,
    );
    const strokes: LineSegments2[] = [];
    scene.traverse((object) => {
      if (object instanceof LineSegments2) strokes.push(object);
    });
    const completed = strokes.filter((stroke) => stroke.renderOrder === 1);
    const ghosts = strokes.filter((stroke) => stroke.renderOrder === -1);
    if (completed.length === 0 || ghosts.length === 0)
      throw new Error('Production factory must supply completed and future-context fat strokes');
    for (const stroke of completed) stroke.material.linewidth = 6;
    applyReveal(built.reveal, { segmentIndex: 1, point: POINT });
    if (built.travelObject !== null) built.travelObject.visible = false;
    // The factory's originals precede any split clones. A retired split is valid.
    if (options.mode === 'source-order') {
      const ghostVisible = built.reveal.solidGhost?.visible ?? false;
      for (const [index, stroke] of completed.entries()) stroke.visible = index === 0;
      for (const [index, stroke] of ghosts.entries()) stroke.visible = index === 0 && ghostVisible;
      built.reveal.active.useHardwareDepth(false);
    }
    const draws: DrawReceipt[] = [];
    for (const [index, stroke] of completed.entries())
      watchDraw(renderer, stroke, 'completed', index === 0, draws);
    for (const [index, stroke] of ghosts.entries())
      watchDraw(renderer, stroke, 'ghost', index === 0, draws);
    built.reveal.active.object.traverse((object) => {
      if (object instanceof LineSegments2)
        watchDraw(renderer, object, object.renderOrder === 4 ? 'core' : 'casing', false, draws);
    });
    const camera =
      options.kind === 'future'
        ? new three.PerspectiveCamera(40, 4 / 3, 0.1, 100_000)
        : new three.OrthographicCamera(-80, 80, 40, -40, 0.1, 100_000);
    camera.up.set(0, 0, 1);
    camera.position.set(150, -150, 50);
    camera.lookAt(50, 0, -5);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    renderer.render(scene, camera);
    const core = draws.find((draw) => draw.role === 'core');
    // Constant clones reject this genuine ramp before extrusion; use its actual ramp draw.
    const main = draws.find(
      (draw) => draw.role === 'completed' && !draw.name.endsWith('-constant'),
    );
    const ghost = draws.find((draw) => draw.role === 'ghost' && !draw.name.endsWith('-constant'));
    const ghostTail = ghost?.ghostTail;
    if (core === undefined || main === undefined || ghost === undefined || ghostTail == null)
      throw new Error('Missing actual core, completed ramp, or full-resolution future-tail draw');
    const active = core.instances[0];
    const done = main.instances[0];
    const future = ghost.instances[1];
    if (active === undefined || done === undefined || future === undefined)
      throw new Error('Missing source endpoints in uploaded Float32 geometry');
    const samples = fixedWitnessPixels(options.kind, options.dpr).map((pixel) => ({
      pixel,
      rgba: readFixedPixel(renderer, pixel),
      coverage:
        options.kind === 'cap'
          ? roundStrokeCoverage(core, pixel, active.start, active.end, core.linewidthCSS)
          : roundStrokeCoverage(main, pixel, done.start, done.end, main.linewidthCSS),
      activeCoverage: roundStrokeCoverage(core, pixel, active.start, active.end, core.linewidthCSS),
      futureCoverage: roundStrokeCoverage(
        ghost,
        pixel,
        ghostTail.point,
        future.end,
        ghost.linewidthCSS,
      ),
    }));
    const gl = renderer.getContext();
    return {
      options,
      input: INPUT,
      camera: {
        position: camera.position.toArray(),
        target: [50, 0, -5],
        up: camera.up.toArray(),
        near: camera.near,
        far: camera.far,
        perspective: options.kind === 'future',
      },
      data: renderer.domElement.toDataURL('image/png'),
      samples,
      backgroundRGBA: readFixedPixel(renderer, [1, 1]),
      draws,
      placedFloat32: [...built.reveal.active.positions()],
      programPositionsFloat32: [...built.reveal.positions],
      packedColors: built.reveal.solid === null ? null : [...built.reveal.solid.colors],
      trail:
        built.reveal.solid === null
          ? null
          : {
              start: built.reveal.solid.trail.trailStart.value,
              end: built.reveal.solid.trail.trailEnd.value,
              fade: built.reveal.solid.trail.trailFade.value,
            },
      batching: {
        split: splitDiagnostic(built.reveal.solid),
        completedMeshes: completed.length,
        ghostMeshes: ghosts.length,
      },
      backend: {
        samples: gl.getParameter(gl.SAMPLES) as number,
        version: gl.getParameter(gl.VERSION) as string,
        renderer: gl.getParameter(gl.RENDERER) as string,
      },
      glError: gl.getError(),
    };
  } finally {
    disposeChildren(scene);
    renderer.dispose();
    renderer.forceContextLoss();
  }
}

/** Diagnostic only: the fixture also supports a factory that has retired batching. */
function splitDiagnostic(solid: unknown): boolean | null {
  if (typeof solid !== 'object' || solid === null || !('depthBatches' in solid)) return null;
  const batch: unknown = solid.depthBatches;
  if (typeof batch !== 'object' || batch === null || !('split' in batch)) return null;
  return typeof batch.split === 'boolean' ? batch.split : null;
}
