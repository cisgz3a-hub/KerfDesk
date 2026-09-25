// EXPLORATION ONLY (track OR): how many emitted G1 moves are shorter than half a
// step (80 steps/mm) on real glyph outlines?
import { it } from 'vitest';
import { appendFileSync, writeFileSync } from 'node:fs';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import type { Job } from '../../core/job';
import { grblStrategy } from '../../core/output/grbl-strategy';
import { REAL_GLYPH_CORPUS, renderGlyphFixture } from '../../__fixtures__/curves/real-glyph-corpus';

const OUT = '/tmp/claude-0/-home-user-KerfDesk/e081095c-c1d0-530d-a0e1-2a645748ec6e/scratchpad/OR/substep.txt';

it('measures', async () => {
  writeFileSync(OUT, '');
  for (const fixture of REAL_GLYPH_CORPUS) {
    const rendered = await renderGlyphFixture(fixture);
    const polylines = rendered.paths.flatMap((path) => path.polylines);
    const segments = polylines.map((p) => ({ polyline: [...p.points, ...(p.closed && p.points[0] ? [p.points[0]] : [])], closed: p.closed }));
    const job: Job = { groups: [{ kind: 'cut', layerId: 'L', color: '#000000', power: 50, speed: 1000, passes: 1, airAssist: false, powerMode: 'constant', segments } as any] };
    const gcode = grblStrategy.emit(job, DEFAULT_DEVICE_PROFILE);
    let x = 0, y = 0, moves = 0, substep = 0; const examples: string[] = [];
    for (const line of gcode.split('\n')) {
      const mx = /X(-?[\d.]+)/.exec(line); const my = /Y(-?[\d.]+)/.exec(line);
      if (!mx && !my) continue;
      const nx = mx ? Number(mx[1]) : x; const ny = my ? Number(my[1]) : y;
      if (line.startsWith('G1')) {
        moves += 1;
        const sx = Math.abs(Math.round(nx * 80) - Math.round(x * 80));
        const sy = Math.abs(Math.round(ny * 80) - Math.round(y * 80));
        if (sx === 0 && sy === 0) { substep += 1; if (examples.length < 3) examples.push(`${x},${y} -> ${line}`); }
      }
      x = nx; y = ny;
    }
    appendFileSync(OUT, `${fixture.name}: keys=${Object.keys(rendered).join(',')} polylines=${polylines.length} G1=${moves} zeroStepAt80=${substep} ${examples.join(' | ')}\n`);
  }
});
