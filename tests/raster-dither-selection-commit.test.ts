/**
 * LF-EXT-LW4-003: raster controls must persist the selected dithering mode
 * before asynchronous preview work finishes.
 *
 * LaserWeb4 exposes raster controls as operation settings. The safety lesson
 * for LaserForge is that a visible raster setting must be job-authoritative as
 * soon as the user selects it; it cannot wait for an async preview worker.
 *
 * Run: npx tsx tests/raster-dither-selection-commit.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const panelSource = readFileSync('src/ui/components/PropertiesPanel.tsx', 'utf8');
const compilerSource = readFileSync('src/core/job/JobCompiler.ts', 'utf8');

function sliceDitherOnChangeBody(source: string): string {
  const selectIdx = source.indexOf('value: ims.dithering ?? ditherMode');
  assert(selectIdx >= 0, 'dithering select is present in PropertiesPanel');
  const handlerIdx = source.indexOf('onChange: (e: React.ChangeEvent<HTMLSelectElement>) => {', selectIdx);
  assert(handlerIdx >= 0, 'dithering select has an onChange handler');
  const workerIdx = source.indexOf('void ditherInWorker', handlerIdx);
  assert(workerIdx >= 0, 'dithering handler starts async worker preview');
  const handlerEndIdx = source.indexOf('}).catch((err) => {', workerIdx);
  assert(handlerEndIdx >= 0, 'dithering handler has async worker catch path');
  return source.slice(handlerIdx, handlerEndIdx);
}

console.log('\n=== LF-EXT-LW4-003 raster dither selection commit ===\n');

{
  const handler = sliceDitherOnChangeBody(panelSource);
  const commitIdx = handler.indexOf("commitRasterLayer({ dithering: mode, imageMode: 'dither' })");
  const workerIdx = handler.indexOf('void ditherInWorker');
  assert(commitIdx >= 0, 'dither selection synchronously commits layer settings');
  assert(
    commitIdx < workerIdx,
    'dither selection commits job-authoritative settings before async worker preview starts',
  );
}

{
  const handler = sliceDitherOnChangeBody(panelSource);
  assert(
    /liveLayer[\s\S]{0,300}settings\.image\.dithering !== mode/.test(handler),
    'async dither worker result is discarded when the live layer changed modes',
  );
  assert(
    /liveLayer[\s\S]{0,300}settings\.image\.imageMode !== 'dither'/.test(handler),
    'async dither worker result is discarded when the live layer left dither image mode',
  );
}

{
  assert(
    /const ditherMode: DitherMode = img\.dithering \?\? 'floyd-steinberg'/.test(compilerSource),
    'JobCompiler treats layer.settings.image.dithering as the authoritative compile setting',
  );
}

console.log('LF-EXT-LW4-003 raster dither selection commit: passed\n');
