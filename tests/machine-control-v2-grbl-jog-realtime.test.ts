import type { ControllerProfile } from '../src/machine-control-v2/ControllerProfile';
import { planGrblJog } from '../src/machine-control-v2/grbl/GrblJog';
import { GRBL_REALTIME } from '../src/machine-control-v2/grbl/GrblRealtime';

const profile: ControllerProfile = {
  family: 'grbl',
  firmwareVersion: '1.1h',
  softLimitsEnabled: true,
  homingEnabled: true,
  laserModeEnabled: true,
  spindleMin: 0,
  spindleMax: 1000,
  travelMm: { X: 400, Y: 300, Z: null, A: null },
  maxFeedMmPerMin: { X: 6000, Y: 5000, Z: null, A: null },
  supportsRealtime: true,
  supportsJogCancel: true,
};

if (GRBL_REALTIME.feedHold !== '!') {
  throw new Error('feed hold must be !');
}
if (GRBL_REALTIME.cycleStart !== '~') {
  throw new Error('cycle start must be ~');
}
if (GRBL_REALTIME.softReset.charCodeAt(0) !== 0x18) {
  throw new Error('soft reset must be ctrl-x');
}
if (GRBL_REALTIME.jogCancel.charCodeAt(0) !== 0x85) {
  throw new Error('jog cancel must be 0x85');
}

const jog = planGrblJog({
  profile,
  axis: 'X',
  distanceMm: 10,
  feedMmPerMin: 2000,
  absolute: false,
});
if (jog.command !== '$J=G91 G21 X10 F2000') {
  throw new Error(jog.command);
}
if (jog.parserStateIndependent !== true) {
  throw new Error('jog must be parser-state independent');
}

const tooFar = planGrblJog({
  profile,
  axis: 'X',
  distanceMm: 500,
  feedMmPerMin: 2000,
  absolute: false,
});
if (tooFar.accepted) {
  throw new Error('out-of-bounds jog should be rejected');
}
