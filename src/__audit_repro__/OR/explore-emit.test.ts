// EXPLORATION ONLY (track OR) — prints emitted programs; not a repro.
import { it } from 'vitest';
import { appendFileSync, writeFileSync } from 'node:fs';
const OUT = '/tmp/claude-0/-home-user-KerfDesk/e081095c-c1d0-530d-a0e1-2a645748ec6e/scratchpad/OR/explore.txt';
const log = (text: string) => appendFileSync(OUT, text + '\n');
import { DEFAULT_DEVICE_PROFILE, NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../../core/devices';
import type { Job } from '../../core/job';
import { grblStrategy } from '../../core/output/grbl-strategy';

function cut(id: string, air: boolean, passes: number, powerMode?: 'constant' | 'dynamic'): Job['groups'][number] {
  return {
    kind: 'cut',
    layerId: id,
    color: '#ff0000',
    power: 80,
    speed: 1200,
    passes,
    airAssist: air,
    ...(powerMode === undefined ? {} : { powerMode }),
    segments: [
      {
        polyline: [
          { x: 10, y: 10 },
          { x: 20, y: 10 },
          { x: 20, y: 20 },
          { x: 10, y: 10 },
        ],
        closed: true,
      },
    ],
  } as Job['groups'][number];
}

it('prints', () => {
  writeFileSync(OUT, '');
  const job: Job = { groups: [cut('A', false, 2, 'constant'), cut('B', true, 1, 'constant')] };
  log('=== default + constant layers, air on B\n' + grblStrategy.emit(job, { ...DEFAULT_DEVICE_PROFILE, airAssistCommand: 'M8' }));
  log('=== 4040\n' + grblStrategy.emit({ groups: [cut('A', false, 2)] }, NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE));
  log('=== grbl-compatible, air\n' + grblStrategy.emit({ groups: [cut('A', true, 1), cut('B', false, 1)] }, { ...DEFAULT_DEVICE_PROFILE, airAssistCommand: 'M8', gcodeDialect: { dialectId: 'grbl-compatible' } }));
});
