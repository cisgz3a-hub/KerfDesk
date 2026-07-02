// Visual-audit harness. Renders each trace preset over representative
// procedural source images to viewable PNGs so a human can SEE current
// output (Karpathy rule). Not part of the suite's intent — run explicitly:
// gated on TRACE_AUDIT=1 so a stray `pnpm test` is a no-op.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'vitest';
import { traceImageToColoredPaths } from '../../core/trace';
import { TRACE_PRESETS } from '../../core/trace/trace-presets';
import type { RawImageData, TraceOptions } from '../../core/trace/trace-image';
import type { Vec2 } from '../../core/scene';
import { inkDisc, inkRect, inkStroke, paper, paperRect, toRawImage } from './procedural-ink';
import { renderTraceOverlay } from './render-overlay';

const OUT_DIR = join(process.cwd(), 'trace-audit-artifacts');
const SCALE = 3;
const PRESETS = ['Line Art', 'Smooth', 'Sharp', 'Centerline', 'Edge Detection'] as const;

function fixtures(): Array<{ name: string; image: RawImageData }> {
  // 1. thin pen strokes: an arc + a straight + a cross junction (3px wide)
  const pen = paper(180, 180);
  for (let a = -80; a <= 80; a += 4)
    inkStroke(pen, arc(40, 90, 30, a - 4), arc(40, 90, 30, a), 1.6); // arc
  inkStroke(pen, { x: 90, y: 30 }, { x: 150, y: 150 }, 1.6); // diagonal
  inkStroke(pen, { x: 80, y: 90 }, { x: 150, y: 90 }, 1.6); // horizontal (crosses diagonal)

  // 2. thick fork: a Y with variable width (centerline stress)
  const fork = paper(180, 180);
  inkStroke(fork, { x: 90, y: 170 }, { x: 90, y: 90 }, 9);
  inkStroke(fork, { x: 90, y: 90 }, { x: 45, y: 20 }, 7);
  inkStroke(fork, { x: 90, y: 90 }, { x: 140, y: 25 }, 6);

  // 3. hard-cornered ring with a notch (sharp corners + hole)
  const hard = paper(180, 180);
  inkRect(hard, 30, 30, 150, 150);
  paperRect(hard, 62, 62, 118, 118); // hole
  inkRect(hard, 84, 10, 96, 40); // notch spike on top

  // 4. soft disc with anti-aliased edge + a lighter inner blob (edge/border + threshold)
  const soft = paper(180, 180);
  inkDisc(soft, 90, 90, 60, 6);
  inkDisc(soft, 110, 75, 22, 10);

  return [
    { name: '1-pen-strokes', image: toRawImage(pen) },
    { name: '2-thick-fork', image: toRawImage(fork) },
    { name: '3-hard-ring-notch', image: toRawImage(hard) },
    { name: '4-soft-disc', image: toRawImage(soft) },
  ];
}

function arc(cx: number, cy: number, r: number, deg: number): Vec2 {
  const a = (deg * Math.PI) / 180;
  return { x: cx + r * Math.cos(a) * 1.6 + 40, y: cy + r * Math.sin(a) };
}

it('renders trace presets for visual audit', async () => {
  if (process.env['TRACE_AUDIT'] !== '1') return;
  mkdirSync(OUT_DIR, { recursive: true });
  for (const fx of fixtures())
    for (const presetName of PRESETS) {
      const options = TRACE_PRESETS[presetName] as TraceOptions;
      const paths = await traceImageToColoredPaths(fx.image, options);
      const png = renderTraceOverlay(fx.image, paths, SCALE);
      const slug = presetName.toLowerCase().replace(/\s+/g, '-');
      writeFileSync(join(OUT_DIR, `${fx.name}__${slug}.png`), png);
    }
}, 60000);
