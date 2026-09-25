import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { nativeLaserProject } from '../../__fixtures__/controllers/native-laser-project';
import { emitGcode } from '../../io/gcode/emit-gcode';

const OUT = '/tmp/claude-0/-home-user-KerfDesk/e081095c-c1d0-530d-a0e1-2a645748ec6e/scratchpad/ma-explore.txt';

it('explore marlin output', () => {
  const out = emitGcode(nativeLaserProject('marlin'));
  const fan = nativeLaserProject('marlin');
  const out2 = emitGcode({ ...fan, device: { ...fan.device, gcodeDialect: { dialectId: 'marlin-fan' } } });
  writeFileSync(OUT, '=== inline image\n' + out.gcode + '\n=== fan image\n' + out2.gcode + '\n=== preflight\n' + JSON.stringify(out.preflight.issues));
});
