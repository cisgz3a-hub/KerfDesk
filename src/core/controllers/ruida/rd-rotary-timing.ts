// The time of a Ruida rotary job (ADR-127 Amendment 7, code quality audit C2
// verify E1-P2-2). On a scaled Y rotary the .rd burns each layer's strokes in
// speed-class parts, reached by laser-off moves the G-code emission does not
// have, so an ETA timed from the G-code missed most of the job's travel. The
// estimate times the .rd's own route instead: its moves, written as G-code for
// the same motion clock (G0 laser off, G1 at each part's speed).

import type { DeviceProfile } from '../../devices';
import type { Job } from '../../job/job';
import { rotaryFeedMatchFor } from '../../output/rotary-surface-feed';
import type { RdMotionPart } from './rd-motion-plan';
import { encodeRdJob } from './rd-encoder';

/** The .rd route of a Ruida rotary job as G-code for the ETA clock, or
 *  undefined when the job is not one (the G-code emission times it then). */
export function ruidaRotaryTimingProgram(job: Job, device: DeviceProfile): string | undefined {
  if (device.controllerKind !== 'ruida') return undefined;
  if (rotaryFeedMatchFor(job, device.maxFeed) === undefined) return undefined;
  const encoded = encodeRdJob(job, device);
  return encoded.ok ? rdMotionProgram(encoded.motion) : undefined;
}

/** The parts' moves in order: a laser-off step as G0, a cut as G1 at its part's speed. */
export function rdMotionProgram(parts: ReadonlyArray<RdMotionPart>): string {
  const lines = ['G21', 'G90', 'M4 S1000'];
  for (const part of parts) {
    for (const step of part.steps) {
      const at = `X${mm(step.xUm)} Y${mm(step.yUm)}`;
      lines.push(step.cut ? `G1 ${at} F${part.group.speed}` : `G0 ${at}`);
    }
  }
  lines.push('M5');
  return `${lines.join('\n')}\n`;
}

function mm(um: number): string {
  return (um / 1000).toFixed(3);
}
