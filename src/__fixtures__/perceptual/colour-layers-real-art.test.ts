// Smoke run of the colour-layer backend (ADR-430) on real line art. The
// images are not part of the repository: set COLOUR_LAYER_ART_DIR to a folder
// holding owl.png and hummingbird.png to run it; otherwise it skips.
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodePngFile } from './png-decode';
import { runTraceSteps } from '../../core/trace/trace-steps';
import {
  traceColourLayersSteps,
  type ColourLayerTraceStats,
} from '../../core/trace/colour-layer-trace';
import { TRACE_PRESETS } from '../../core/trace/trace-presets';
import type { TraceOptions } from '../../core/trace/trace-image';

const ART_DIR = process.env['COLOUR_LAYER_ART_DIR'];
const ART = ['owl.png', 'hummingbird.png'].map((name) => `${ART_DIR ?? ''}/${name}`);
const available = ART_DIR !== undefined && ART.every((path) => existsSync(path));

describe.skipIf(!available)('colour layers on real art (smoke)', () => {
  for (const path of ART) {
    it(`${path.split('/').at(-1)} traces with N = auto, 2, 3, 4`, () => {
      const image = decodePngFile(path);
      for (const colours of [undefined, 2, 3, 4]) {
        const options: TraceOptions = {
          ...(TRACE_PRESETS['Colour layers'] as TraceOptions),
          colourLayers: { output: 'cut-out', ...(colours === undefined ? {} : { colours }) },
        };
        let stats: ColourLayerTraceStats | undefined;
        const started = performance.now();
        const paths = runTraceSteps(
          traceColourLayersSteps(image, options, (value) => {
            stats = value;
          }),
        );
        const ms = performance.now() - started;
        const subpaths = paths.reduce((sum, p) => sum + p.polylines.length, 0);
        const segments = paths.reduce(
          (sum, p) => sum + (p.curves ?? []).reduce((s, c) => s + c.segments.length, 0),
          0,
        );
        console.log(
          `[colour-layers] ${path.split('/').at(-1)} N=${colours ?? 'auto'}: ${ms.toFixed(0)} ms, ` +
            `palette ${stats?.palette.join(' ')}, background ${stats?.background}, ` +
            `layers ${paths.length}, subpaths ${subpaths}, segments ${segments}, chains ${stats?.chains}`,
        );
        expect(paths.length).toBeGreaterThan(0);
        expect(paths.length).toBeLessThanOrEqual(colours ?? 8);
      }
    }, 300_000);
  }
});
