// Browser component pipeline using the shipped import, trace, bitmap, preview,
// preparation and output APIs. The runner supplies local same-origin modules.
/* global document, requestAnimationFrame */
import { benchmarkSvg, benchmarkImage } from './large-file-benchmark-cases.mjs';
import { benchmarkPng, benchmarkRgbaPng } from './large-file-benchmark-png.mjs';
import { createLayer, createProject, IDENTITY_TRANSFORM } from '../src/core/scene/index.ts';
import { TRACE_PRESETS, coloredPathsToSvg } from '../src/core/trace/index.ts';
import { parseSvgOffThread } from '../src/ui/import/document-import-worker-client.ts';
import { prepareSvgFragment } from '../src/ui/import/svg-image-hydration.ts';
import { importImageFile } from '../src/ui/commands/import-image-action.ts';
import { readRasterSourceFile } from '../src/ui/import/paged-raster-source.ts';
import { hydratePagedRasterImage } from '../src/ui/import/paged-raster-hydration.ts';
import { decodeTraceSource } from '../src/ui/trace/trace-preview-preparation.ts';
import { createTracePreparation } from '../src/ui/trace/trace-preparation.ts';
import { resolveTraceCommitResult } from '../src/ui/trace/trace-commit-result.ts';
import { traceCommitGridContext } from '../src/ui/trace/trace-commit-grid.ts';
import { positionTraceOverRasterSource } from '../src/ui/state/trace-placement.ts';
import { buildRasterTraceOutput } from '../src/ui/trace/trace-raster-output.ts';
import { prepareOutput } from '../src/io/gcode/prepare-output.ts';
import { emitPreparedGcode } from '../src/io/gcode/emit-gcode.ts';
import { buildPreviewToolpathFromPrepared, drawPreview } from '../src/ui/workspace/draw-preview.ts';
import { buildGcodeRenderModel } from '../src/core/gcode-view/index.ts';
import { applyImageMaskToLuma } from '../src/core/raster/image-mask.ts';
import { bindTraceSourceMask } from '../src/ui/trace/trace-source-mask.ts';
import { dataUrlToFile, loadImageAsRawData } from '../src/ui/trace/image-loader.ts';

const image = benchmarkImage();
const fixtures = {
  svg: new File([benchmarkSvg()], 'fixed-50000.svg', { type: 'image/svg+xml' }),
  png: new File([benchmarkPng(image)], 'fixed-4096.png', { type: 'image/png' }),
  pngPaged: new File([benchmarkRgbaPng(image)], 'fixed-4096-rgba-large.png', { type: 'image/png' }),
};
const hash = async (value) => {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};
const phase = async (timings, name, work) => {
  const started = performance.now();
  const output = await work();
  timings[name] = performance.now() - started;
  return output;
};
function projectFor(objects, mode) {
  const base = createProject();
  const color = objects[0]?.color ?? '#000000';
  const layer = {
    ...createLayer({ id: 'bench-operation', color, mode }),
    speed: 1000,
    power: 50,
    linesPerMm: 10,
    ditherAlgorithm: 'threshold',
  };
  return {
    ...base,
    device: { ...base.device, bedWidth: 600, bedHeight: 600 },
    workspace: { ...base.workspace, width: 600, height: 600 },
    optimization: {
      ...base.optimization,
      reduceTravelMoves: false,
      travelPolicy: 'source-order',
      insideFirst: false,
      closedShapeStart: 'drawn',
    },
    scene: {
      ...base.scene,
      objects: objects.map((object) => ({ ...object, operationIds: [layer.id] })),
      layers: [layer],
    },
  };
}

async function outputPipeline(project, timings, prefix) {
  const prepared = await phase(timings, `${prefix}Cam`, () => prepareOutput(project));
  if (!prepared.ok) throw new Error(JSON.stringify(prepared.preflight));
  const emitted = await phase(timings, `${prefix}Gcode`, () => emitPreparedGcode(prepared));
  if (emitted.gcode.length === 0) throw new Error('No executable output');
  const route = await phase(timings, `${prefix}PreviewData`, () =>
    buildPreviewToolpathFromPrepared(project, prepared),
  );
  const canvas = document.getElementById('route');
  await phase(timings, `${prefix}CanvasPaint`, async () => {
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, canvas.width, canvas.height);
    drawPreview(context, route, { scale: 1.5, offsetX: 5, offsetY: 5 }, 1);
    // Readback requires actual native rasterization; a RAF includes a presentation opportunity.
    context.getImageData(0, 0, canvas.width, canvas.height);
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
  const parsed = await phase(timings, `${prefix}OutputParse`, () =>
    buildGcodeRenderModel(emitted.gcode, { machineKind: 'laser' }),
  );
  if (parsed.kind !== 'ok') throw new Error(parsed.reason);
  return {
    gcode: emitted.gcode,
    counts: {
      groups: prepared.job.groups.length,
      groupKinds: prepared.job.groups.map((group) => group.kind),
      previewSteps: route.steps.length,
      previewLengthMm: route.totalLength,
      gcodeBytes: new TextEncoder().encode(emitted.gcode).length,
      gcodeLines: emitted.gcode.split('\n').length,
      preflightIssues: emitted.preflight.issues.map((issue) => issue.code),
    },
  };
}

async function svgRun() {
  const timings = {},
    started = performance.now();
  const parsed = await phase(timings, 'importWorker', async () => {
    const pending = parseSvgOffThread(fixtures.svg, 'fixed-svg', fixtures.svg.name);
    if (pending === null) throw new Error('Native document import worker unavailable');
    return pending;
  });
  if (parsed.object?.kind !== 'imported-svg') throw new Error('SVG fixture import failed');
  const fragment = await phase(timings, 'importHydration', () =>
    prepareSvgFragment(parsed.fragment),
  );
  fragment.commit();
  const project = projectFor(fragment.objects, 'line');
  const output = await outputPipeline(project, timings, 'vector');
  const totalMs = performance.now() - started;
  return {
    timings,
    totalMs,
    outputHashes: {
      geometry: await hash(JSON.stringify(project.scene.objects[0].paths)),
      gcode: await hash(output.gcode),
    },
    counts: {
      objects: project.scene.objects.length,
      contours: project.scene.objects
        .flatMap((object) => object.paths)
        .reduce((sum, path) => sum + path.polylines.length, 0),
      ...output.counts,
    },
  };
}

async function pngRun(paged = false) {
  const timings = {},
    started = performance.now(),
    notices = [];
  const imported = await phase(timings, 'imageImport', () =>
    importImageFile(
      paged ? fixtures.pngPaged : fixtures.png,
      () => undefined,
      (message, variant) => notices.push({ message, variant }),
    ),
  );
  if (imported?.kind !== 'raster-image') throw new Error(JSON.stringify(notices));
  if (paged && imported.imageAsset === undefined)
    throw new Error('Large PNG did not exercise page-backed storage');
  // Fixed physical placement only: retain every original input pixel and byte.
  const source = {
    ...imported,
    transform: { ...imported.transform, scaleX: 0.3125, scaleY: 0.3125 },
  };
  if (paged) await phase(timings, 'sourceLumaHydration', () => hydratePagedRasterImage(source));
  const traceFile = await phase(timings, 'traceSourceRead', () =>
    readRasterSourceFile(source, source.source),
  );
  const decoded = decodeTraceSource(traceFile);
  const options = TRACE_PRESETS['Line Art'];
  const request = {
    file: traceFile,
    options,
    boundary: null,
    boundaryMode: 'crop',
    sourceGrid: { width: source.pixelWidth, height: source.pixelHeight },
  };
  const preview = await phase(timings, 'tracePreviewDecodeAndWorker', () =>
    createTracePreparation(request, decoded.promise, 0, () => undefined).consume(),
  );
  await phase(timings, 'traceSvgAndPaint', async () => {
    document.getElementById('trace').innerHTML = coloredPathsToSvg(
      preview.paths,
      preview.width,
      preview.height,
    );
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  const sourceProject = projectFor([source], 'image');
  const commitGrid = traceCommitGridContext(source, sourceProject, 8);
  const committed = await phase(timings, 'traceCommitDecodeAndWorker', () =>
    resolveTraceCommitResult({
      ...request,
      preparedTrace: { request, result: preview },
      commitGrid,
    }),
  );
  const trace = {
    kind: 'traced-image',
    id: 'fixed-trace',
    source: source.source,
    traceSourceId: source.id,
    traceMode: 'filled-contours',
    tracePixelWidth: committed.width,
    tracePixelHeight: committed.height,
    bounds: committed.bounds,
    transform: IDENTITY_TRANSFORM,
    paths: committed.paths,
  };
  const vector = await outputPipeline(
    projectFor([positionTraceOverRasterSource(source, trace)], 'line'),
    timings,
    'vector',
  );
  const raster = await phase(timings, 'traceRasterWorker', () =>
    buildRasterTraceOutput(source, trace, sourceProject.scene.layers),
  );
  const rasterOutput = await outputPipeline(projectFor([raster], 'image'), timings, 'raster');
  const totalMs = performance.now() - started;
  decoded.controller.abort();
  return {
    timings,
    totalMs,
    outputHashes: {
      preview: await hash(JSON.stringify(preview.paths)),
      committed: await hash(JSON.stringify(committed.paths)),
      vectorGcode: await hash(vector.gcode),
      rasterGcode: await hash(rasterOutput.gcode),
    },
    counts: {
      naturalGrid: [4096, 4096],
      importStorage: source.imageAsset === undefined ? 'embedded' : 'paged-indexeddb',
      importedGrid: [source.pixelWidth, source.pixelHeight],
      previewGrid: [preview.width, preview.height],
      commitGrid: [committed.width, committed.height],
      traceContours: committed.paths.reduce((sum, path) => sum + path.polylines.length, 0),
      rasterGrid: [raster.pixelWidth, raster.pixelHeight],
      vector: vector.counts,
      raster: rasterOutput.counts,
      notices: committed.notices ?? [],
    },
  };
}

globalThis.kerfdeskBenchmark = {
  verifyMaskParity: async () => {
    const pixels = { width: 64, height: 64, data: new Uint8ClampedArray(64 * 64 * 4) };
    for (let i = 3; i < pixels.data.length; i += 4) pixels.data[i] = 255;
    const file = new File([benchmarkPng(pixels)], 'fixed-mask.png', { type: 'image/png' });
    const rectangle = (a, b) => ({
      closed: true,
      points: [
        { x: a, y: a },
        { x: b, y: a },
        { x: b, y: b },
        { x: a, y: b },
      ],
    });
    const imageClip = [{ color: '#000000', polylines: [rectangle(8, 56), rectangle(24, 40)] }];
    const seed = {
      kind: 'raster-image',
      id: 'mask-source',
      source: file.name,
      pixelWidth: 64,
      pixelHeight: 64,
      bounds: { minX: 0, minY: 0, maxX: 64, maxY: 64 },
      transform: IDENTITY_TRANSFORM,
      color: '#000000',
      dither: 'threshold',
      linesPerMm: 1,
      imageClip,
    };
    const before = await hash(await file.arrayBuffer());
    const source = decodeTraceSource(bindTraceSourceMask(file, seed));
    const decoded = await source.promise;
    if (source.sourceDataUrl === undefined) throw new Error('Masked comparison image absent');
    const comparison = await loadImageAsRawData(
      await dataUrlToFile(source.sourceDataUrl, 'comparison.png'),
    );
    const expected = applyImageMaskToLuma({
      image: seed,
      width: 64,
      height: 64,
      luma: new Uint8Array(64 * 64),
    });
    let maskedPixels = 0;
    for (let index = 0; index < expected.length; index += 1) {
      const alpha = expected[index] === 255 ? 0 : 255;
      if (alpha === 0) maskedPixels += 1;
      if (
        decoded.img.data[index * 4] !== expected[index] ||
        decoded.img.data[index * 4 + 3] !== alpha ||
        comparison.data[index * 4] !== expected[index] ||
        comparison.data[index * 4 + 3] !== alpha
      )
        throw new Error(`Native mask parity mismatch at pixel ${index}`);
    }
    const after = await hash(await file.arrayBuffer());
    if (before !== after || seed.imageClip !== imageClip)
      throw new Error('Original image or native clip changed');
    source.controller.abort();
    return {
      verifiedPixels: expected.length,
      maskedPixels,
      originalSha256: before,
      originalPreserved: true,
      nativeClipPreserved: true,
      comparisonMatchesEngravingMask: true,
    };
  },
  fixtures: async () => ({
    svgBytes: fixtures.svg.size,
    svgSha256: await hash(await fixtures.svg.arrayBuffer()),
    pngBytes: fixtures.png.size,
    pngSha256: await hash(await fixtures.png.arrayBuffer()),
    pagedPngBytes: fixtures.pngPaged.size,
    pagedPngSha256: await hash(await fixtures.pngPaged.arrayBuffer()),
    rgbaSha256: await hash(image.data),
  }),
  run: (name) => (name === 'svg50000' ? svgRun() : pngRun(name === 'sparse4096Paged')),
};
