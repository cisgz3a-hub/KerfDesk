// EXPLORATION ONLY (track OR): zero-step G1 moves through the real pipeline.
import { it } from 'vitest';
import { appendFileSync, writeFileSync } from 'node:fs';
import { emitPreparedGcode } from '../../io/gcode/emit-gcode';
import { prepareOutput } from '../../io/gcode/prepare-output';
import { NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../../core/devices';
import { createLayer, createProject, IDENTITY_TRANSFORM, type Project, type SceneObject } from '../../core/scene';
import { REAL_GLYPH_CORPUS, renderGlyphFixture } from '../../__fixtures__/curves/real-glyph-corpus';

const OUT = '/tmp/claude-0/-home-user-KerfDesk/e081095c-c1d0-530d-a0e1-2a645748ec6e/scratchpad/OR/substep-pipeline.txt';

it('measures', async () => {
  writeFileSync(OUT, '');
  for (const fixture of REAL_GLYPH_CORPUS) {
    const rendered = await renderGlyphFixture(fixture);
    const text: SceneObject = {
      kind: 'text', id: 't', content: fixture.content, fontKey: 'pacifico-regular', sizeMm: fixture.sizeMm,
      alignment: 'left', lineHeight: 1.4, letterSpacing: 0, color: '#000000',
      bounds: rendered.bounds, transform: { ...IDENTITY_TRANSFORM, x: 50, y: 50 },
      paths: rendered.paths,
    } as unknown as SceneObject;
    const base = createProject(NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE);
    const project = { ...base, scene: { ...base.scene, objects: [text], layers: [{ ...createLayer({ id: 'l', color: '#000000', mode: 'line' }), power: 50, speed: 1000 }] } } as Project;
    const prepared = prepareOutput(project);
    if (!prepared.ok) { appendFileSync(OUT, `${fixture.name}: prepare failed\n`); continue; }
    const gcode = emitPreparedGcode(prepared).gcode;
    let x = 0, y = 0, moves = 0, zero = 0, mode = '';
    const ex: string[] = [];
    for (const line of gcode.split('\n')) {
      if (/^M3/.test(line)) mode = 'M3'; if (/^M4/.test(line)) mode = 'M4';
      const mx = /X(-?[\d.]+)/.exec(line); const my = /Y(-?[\d.]+)/.exec(line);
      if (!mx && !my) continue;
      const nx = mx ? Number(mx[1]) : x; const ny = my ? Number(my[1]) : y;
      if (line.startsWith('G1') && !line.includes('laser-off')) {
        moves += 1;
        if (Math.round(nx * 80) === Math.round(x * 80) && Math.round(ny * 80) === Math.round(y * 80)) { zero += 1; if (ex.length < 2) ex.push(`${x},${y} -> ${line} [${mode}]`); }
      }
      x = nx; y = ny;
    }
    appendFileSync(OUT, `${fixture.name}: burnG1=${moves} zeroStepAt80=${zero} ${ex.join(' | ')}\n`);
  }
});
